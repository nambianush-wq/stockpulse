// Storage safety nets — IDB auto-backup + recovery banner + export-reminder
// nudge. Triggered after the user reported their watchlist + favorites
// disappeared (2026-05-19); localStorage in the browser was empty.
//
// Three layers:
//   A. Recovery banner — fresh-state detection ('sp_watchlist' empty + default
//      4 tickers + 0 favorites + 0 simset) shows a one-time prompt with
//      Import / Dismiss. Dismiss is sticky for 30 days.
//   B. Export-reminder nudge — when watchlist > 5 tickers AND no export in
//      14 days, surface "Last backup: never / Nd ago" nudge. Stamp on export.
//   C. IDB auto-backup — every persistJsonResilient write mirrors the value
//      to IndexedDB. On boot, if both LS slots are empty for a critical list,
//      restore from IDB and mutate the in-memory binding.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');

// === Scenario 1 (VERBATIM): user wakes up to wiped LS — IDB has the data ===
test('Scenario 1 (verbatim): IDB restore replaces the default 4-ticker fallback', async () => {
  const app = loadApp();
  // Simulate: prior session persisted via persistJsonResilient → IDB mirror
  // wrote the value. Now both LS slots are empty (browser cleared) but IDB
  // still has the watchlist.
  await app._idbPut(app.LS_KEY_WL, ['NVDA', 'TSLA', 'AMD', 'GOOGL', 'META', 'AVGO']);
  await app._idbPut(app.LS_KEY_FAVS, ['NVDA', 'AMD']);
  // Pre-conditions: LS truly empty, WATCHLIST is the default
  app.localStorage.removeItem(app.LS_KEY_WL);
  app.localStorage.removeItem(app.LS_KEY_WL_BACKUP);
  app.localStorage.removeItem(app.LS_KEY_FAVS);
  app.localStorage.removeItem(app.LS_KEY_FAVS_BACKUP);
  const result = await app.restoreFromIdbOnBoot();
  assert.ok(result.restored.includes(app.LS_KEY_WL), `expected WL restored, got ${JSON.stringify(result)}`);
  assert.ok(result.restored.includes(app.LS_KEY_FAVS), `expected FAVS restored, got ${JSON.stringify(result)}`);
  // In-memory bindings must reflect the IDB content. Sandbox arrays are not
  // strict-equal to native arrays (different Array prototype), so compare via
  // join() — content, not identity.
  assert.equal([...app.WATCHLIST].sort().join(','), 'AMD,AVGO,GOOGL,META,NVDA,TSLA');
  assert.equal(app.FAVORITES.size, 2);
  assert.ok(app.FAVORITES.has('NVDA'));
  // And LS was re-populated so the next reload doesn't re-restore
  const ls = app.localStorage.getItem(app.LS_KEY_WL) || '';
  assert.ok(ls.includes('NVDA'), `expected LS rewritten after restore, got: ${ls}`);
});

// === Scenario 2 (INVERSE): LS has data — IDB is ignored, no restore ===
test('Scenario 2 (inverse): existing LS short-circuits IDB lookup', async () => {
  const app = loadApp();
  // IDB has stale data
  await app._idbPut(app.LS_KEY_WL, ['STALE1', 'STALE2']);
  // LS has the authoritative current data
  app.localStorage.setItem(app.LS_KEY_WL, JSON.stringify(['CURRENT1', 'CURRENT2', 'CURRENT3']));
  const result = await app.restoreFromIdbOnBoot();
  // Should NOT restore — LS is authoritative
  assert.equal(result.restored.includes(app.LS_KEY_WL), false,
    `expected no WL restore when LS has data, got ${JSON.stringify(result)}`);
});

// === Scenario 3 (SIBLING): fresh-state detection correctly classifies ===
test('Scenario 3 (sibling): _isFreshDefaultState true only for actual fresh state', () => {
  const app = loadApp();
  // After loadApp, WATCHLIST is the default ['ACN','AAPL','MSFT','NVDA']
  // and FAVORITES/SIM_SET are empty. LS has no sp_watchlist key.
  app.localStorage.removeItem(app.LS_KEY_WL);
  app.localStorage.removeItem(app.LS_KEY_WL_BACKUP);
  assert.equal(app._isFreshDefaultState(), true, 'default 4-ticker + empty fav/sim + no LS = fresh');
  // After adding a 5th ticker, no longer fresh
  app.WATCHLIST.push('TSLA');
  assert.equal(app._isFreshDefaultState(), false, 'extra ticker breaks the fresh detection');
  // Remove the extra; add a favorite instead — also not fresh
  app.WATCHLIST.pop();
  app.FAVORITES.add('AAPL');
  assert.equal(app._isFreshDefaultState(), false, 'a favorite breaks the fresh detection');
  // Clean up
  app.FAVORITES.clear();
  // Setting LS_KEY_WL also breaks it (means user has real data)
  app.localStorage.setItem(app.LS_KEY_WL, JSON.stringify(['ACN', 'AAPL', 'MSFT', 'NVDA']));
  assert.equal(app._isFreshDefaultState(), false, 'LS-set watchlist breaks the fresh detection (user data present)');
});

// === Scenario 4 (EDGE): IDB unavailable — restore is a graceful no-op ===
test('Scenario 4 (edge): IDB unavailable → no crash, no restore', async () => {
  const app = loadApp();
  // Disable IDB by reassigning the sandbox indexedDB to undefined
  app.indexedDB = undefined;
  // Clear LS
  app.localStorage.removeItem(app.LS_KEY_WL);
  app.localStorage.removeItem(app.LS_KEY_WL_BACKUP);
  // Should not throw, should return empty restored list
  const result = await app.restoreFromIdbOnBoot();
  assert.equal(result.restored.length, 0);
  // Default WATCHLIST untouched
  assert.equal([...app.WATCHLIST].sort().join(','), 'AAPL,ACN,MSFT,NVDA');
});

// === Scenario 5a (CROSS-SCOPE): export nudge fires when conditions met ===
test('Scenario 5a (cross-scope): export nudge fires when watchlist > 5 + no recent export', () => {
  const app = loadApp();
  // Bump watchlist to > 5
  app.WATCHLIST.push('TSLA', 'AMD', 'GOOGL');  // now 7 tickers
  app.localStorage.removeItem(app.LS_KEY_LAST_EXPORT);
  app.localStorage.removeItem(app.LS_KEY_EXPORT_NUDGE_DISMISSED);
  assert.equal(app._shouldShowExportNudge(), true,
    'expected nudge to fire: watchlist 7 + never exported + not dismissed');
  // After a successful export, the nudge stops firing
  app.stampLastExport();
  assert.equal(app._shouldShowExportNudge(), false,
    'expected nudge silenced after stampLastExport()');
  // Simulate 15 days passing — nudge fires again
  app.localStorage.setItem(app.LS_KEY_LAST_EXPORT, String(Date.now() - (15 * 24 * 60 * 60 * 1000)));
  assert.equal(app._shouldShowExportNudge(), true,
    'expected nudge to re-fire 15 days after last export');
});

// === Scenario 5b (CROSS-SCOPE): tiny watchlist suppresses the nudge ===
test('Scenario 5b (cross-scope): nudge suppressed for tiny watchlists (≤5)', () => {
  const app = loadApp();
  // Default WATCHLIST is 4 tickers — well below the > 5 threshold
  app.localStorage.removeItem(app.LS_KEY_LAST_EXPORT);
  assert.equal(app._shouldShowExportNudge(), false,
    'expected nudge suppressed: default 4-ticker watchlist is below threshold');
});

// === Scenario 5c (CROSS-SCOPE): banner respects the dismiss timestamp ===
test('Scenario 5c (cross-scope): showRecoveryBanner respects a recent dismiss', () => {
  // Fresh app — no dismiss timestamp, no prior mount. First call MUST mount.
  const fresh = loadApp();
  fresh.localStorage.removeItem(fresh.LS_KEY_RECOVERY_DISMISSED);
  assert.equal(fresh.showRecoveryBanner(), true, 'expected first call to mount the banner');
  // New app, pretend a dismiss happened 1 day ago — banner must NOT mount.
  const dismissed = loadApp();
  dismissed.localStorage.setItem(dismissed.LS_KEY_RECOVERY_DISMISSED, String(Date.now() - 86400_000));
  assert.equal(dismissed.showRecoveryBanner(), false, 'expected recent dismiss to suppress banner');
  // New app, dismiss happened 31 days ago — banner SHOULD mount again
  const expired = loadApp();
  expired.localStorage.setItem(expired.LS_KEY_RECOVERY_DISMISSED, String(Date.now() - 31 * 86400_000));
  assert.equal(expired.showRecoveryBanner(), true, 'expected 31-day-old dismiss to NOT suppress the banner');
});
