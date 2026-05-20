// RCA 2026-05-19 — Watchlist main pane stuck on WATCHLIST[0] (ACN) after launch
// even though heat-sorted sidebar puts AAPL on top.
//
// Root cause: the post-refreshAll heat-top swap block in init() guarded
// renderMain() behind `if (_currentView === 'watchlist')`. But showView('cockpit')
// runs BEFORE refreshAll, so _currentView is always 'cockpit' at that point — the
// guard is dead code. _selected gets correctly updated to the heat-top ticker and
// the sidebar re-renders, but the hidden #content div retains stale HTML from the
// initial renderMain() that ran against WATCHLIST[0]. The moment the user clicks
// Watchlist, the stale ticker surfaces.
//
// Fix: drop the guard. renderMain() writes to a hidden div — no visible cost — and
// the freshness is essential for the next Watchlist click.
//
// This test pins: when _data is populated such that AAPL has a higher verdict score
// than ACN (WATCHLIST[0]), init() must finish with _selected === 'AAPL' AND must
// have called renderMain() AFTER the swap, even though _currentView is 'cockpit'.

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { loadApp } = require('./harness');

// Read a live `let`-bound variable from the vm script scope.
// The harness exports a SNAPSHOT of `_selected` etc. at module-init time, so
// `app._selected` is stuck at the pre-init value. vm.runInContext sees the real
// current binding because the sandbox object IS the vm context.
const peek = (app, name) => vm.runInContext(name, app);

test('init() — post-refreshAll heat-top swap re-renders main pane even when on Cockpit', async () => {
  const app = loadApp();

  // The default WATCHLIST is ['ACN','AAPL','MSFT','NVDA'] (loadWatchlist fallback).
  // WATCHLIST[0] is ACN — the historical "wrong" fallback. That's what we want
  // to verify gets swapped out for the heat-top after refreshAll.

  // Seed _data so pickInitialSelected() returns AAPL after refreshAll:
  //   - Before refreshAll: _data is empty → ACN wins by stable sort.
  //   - After refreshAll: _data has AAPL with higher verdict score → AAPL wins.
  // The _data object is shared (mutating it from outside the vm reaches inside).
  app.refreshAll = async function () {
    const d = peek(app, '_data');
    d['ACN']  = { verdict: { score: -50 } };
    d['AAPL'] = { verdict: { score:  60 } };
    d['MSFT'] = { verdict: { score: -10 } };
    d['NVDA'] = { verdict: { score:  20 } };
  };

  // Track renderMain calls — capture _selected and _currentView from the vm at
  // each call. The stub function body runs in host context, so we MUST use
  // vm.runInContext to read the real bindings (not the stale snapshots).
  const renderMainCalls = [];
  app.renderMain = function () {
    renderMainCalls.push({
      selected: peek(app, '_selected'),
      view:     peek(app, '_currentView'),
    });
  };

  // Stub other init() side-effects that we don't care about for this test.
  app.refreshAll13FFreshness = async () => {};
  app.renderCockpit = () => {};
  app.renderWatchlist = () => {};
  app.requestNotificationPermission = () => {};
  app.startRefreshTimer = () => {};
  app.notifyChanges = () => {};
  app.syncFavoritesToWatchlist = () => 0;
  app.updateSidebarCounters = () => {};
  app.updateVerdictFilterPills = () => {};
  app.updateTypeFilterPills = () => {};
  app.updateTimingFilterPills = () => {};
  app.updateInstFilterPills = () => {};
  app.setCockpitAutoRefresh = () => {};
  app.updateModeIndicators = () => {};
  app._injectPageDisclaimers = () => {};
  app.showToast = () => {};
  // Stub showView so it sets the inner _currentView (init's post-await guard
  // reads it). Use vm.runInContext to mutate the let-bound script-scope variable.
  app.showView = function (view) {
    vm.runInContext(`_currentView = ${JSON.stringify(view)}`, app);
  };

  await app.init();

  const finalSelected = peek(app, '_selected');

  // 1. _selected must end up on the heat-top, not WATCHLIST[0].
  assert.equal(finalSelected, 'AAPL',
    `Expected _selected === 'AAPL' (heat-top) after init, got '${finalSelected}'`);

  // 2. renderMain must have been called at least twice:
  //    (a) initial paint with _selected = ACN (the pre-refreshAll fallback)
  //    (b) post-swap re-paint with _selected = AAPL (the heat-top)
  assert.ok(renderMainCalls.length >= 2,
    `Expected ≥2 renderMain calls, got ${renderMainCalls.length}: ${JSON.stringify(renderMainCalls)}`);

  // 3. The FINAL renderMain call must have _selected === 'AAPL'.
  //    This is the assertion that would have failed on the pre-fix code where the
  //    guard `if (_currentView === 'watchlist') renderMain()` was always false.
  const last = renderMainCalls[renderMainCalls.length - 1];
  assert.equal(last.selected, 'AAPL',
    `Final renderMain must run with _selected='AAPL'. Calls: ${JSON.stringify(renderMainCalls)}`);

  // 4. Sanity: the final renderMain happened while _currentView was 'cockpit'.
  //    This is the proof the guard was dead — the post-fix code re-renders the
  //    hidden Watchlist behind the Cockpit so clicking Watchlist later is fresh.
  assert.equal(last.view, 'cockpit',
    `Final renderMain expected during _currentView='cockpit' (proves guard removal works). Got '${last.view}'`);
});

test('static HTML — #content starts hidden and #cockpit-page starts visible', () => {
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  // The pre-JS DOM must already be in cockpit-first state so there's no flash.
  const contentDiv = html.match(/<div id="content" style="[^"]*"/);
  const cockpitDiv = html.match(/<div id="cockpit-page"[^>]*style="[^"]*"/);
  assert.ok(contentDiv, '#content div not found');
  assert.ok(cockpitDiv, '#cockpit-page div not found');
  assert.match(contentDiv[0], /display:\s*none/,
    `#content must start with display:none to prevent watchlist flash. Got: ${contentDiv[0]}`);
  assert.match(cockpitDiv[0], /display:\s*block/,
    `#cockpit-page must start with display:block. Got: ${cockpitDiv[0]}`);

  // Body must carry cockpit-mode class so any CSS dependent on it applies at first paint.
  const bodyTag = html.match(/<body class="[^"]*"/);
  assert.ok(bodyTag, '<body> tag not found');
  assert.match(bodyTag[0], /cockpit-mode/,
    `<body> must start with class="cockpit-mode" for pre-JS paint parity. Got: ${bodyTag[0]}`);
});
