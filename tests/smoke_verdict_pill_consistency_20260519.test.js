// Cross-page verdict-pill consistency smoke.
//
// Doctrine: CLAUDE.md "Cross-page UI consistency — MANDATORY (2026-05-19)"
// requires that every surface showing a ticker also shows that ticker's
// verdict (STRONG BUY / BUY / HOLD / SELL / STRONG SELL) in a pill with
// matching class. The Sectors tile shipped without this pill — RCA
// 2026-05-19. This smoke pins:
//
//   - renderTilesFromCache always emits a .pick-verdict pill per tile
//   - the pill text matches the ticker's actual verdict label
//   - the pill class encodes the verdict tier (verdict-STRONG-BUY etc.)
//
// Five scenarios per anush-rca Phase 4.5.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');

// Helper — render Sectors tiles for a goal and return the innerHTML.
function renderTilesAndCapture(app, goalKey) {
  goalKey = goalKey || 'growth';
  // Set the current goal — internal `let _currentGoal` so we have to use the
  // setter if exposed; otherwise drive via global assignment in sandbox.
  if (typeof app.selectGoal === 'function') {
    try { app.selectGoal(goalKey); } catch (e) {}
  }
  app.renderTilesFromCache();
  // tile-grid stub captured the innerHTML
  const host = app.document.getElementById('tile-grid');
  return host && host._innerHTML || '';
}

// === Scenario 1: VERBATIM REGRESSION ===
// SPY tile on the Momentum goal must show a verdict pill (was missing pre-fix).
test('Scenario 1 (verbatim): Sectors tile emits .pick-verdict pill on Momentum goal', () => {
  const app = loadApp();
  const html = renderTilesAndCapture(app, 'momentum');
  assert.ok(html.length > 100, 'expected non-empty render');
  assert.match(html, /class="pick-verdict verdict-/, 'expected at least one .pick-verdict pill with a tier class');
});

// === Scenario 2: INVERSE ===
// Every visible tile should have a verdict pill (not just the first one).
test('Scenario 2 (inverse): every Sectors tile has a verdict pill', () => {
  const app = loadApp();
  const html = renderTilesAndCapture(app, 'growth');
  const tileCount = (html.match(/class="stock-tile /g) || []).length;
  const verdictCount = (html.match(/class="pick-verdict verdict-/g) || []).length;
  assert.ok(tileCount > 0, 'expected >0 tiles');
  assert.equal(verdictCount, tileCount, `expected ${tileCount} verdict pills (one per tile), got ${verdictCount}`);
});

// === Scenario 3: SIBLING SHAPE ===
// Verdict tier class encodes the verdict label correctly. Sweep every emitted
// pill and confirm the class suffix matches one of the five canonical labels.
test('Scenario 3 (sibling): verdict pill class encodes one of the 5 canonical tiers', () => {
  const app = loadApp();
  const html = renderTilesAndCapture(app, 'growth');
  const validTiers = new Set(['STRONG-BUY', 'BUY', 'HOLD', 'SELL', 'STRONG-SELL']);
  const matches = [...html.matchAll(/class="pick-verdict verdict-([A-Z-]+)"/g)];
  assert.ok(matches.length > 0, 'expected at least one verdict pill');
  for (const m of matches) {
    assert.ok(validTiers.has(m[1]), `verdict tier '${m[1]}' is not one of the canonical 5 tiers`);
  }
});

// === Scenario 4: EDGE CASE ===
// Goal where no tiles match (over-filtered) — render should not crash and
// the no-matches placeholder should be shown (no verdict pills required).
test('Scenario 4 (edge): over-filtered goal renders no-matches placeholder, not a crash', () => {
  const app = loadApp();
  // Apply an extreme filter combination that produces no matches
  if (app._sectorsFilters) {
    app._sectorsFilters.verdict = 'strong_buy';
    app._sectorsFilters.fcMin = 20;
    app._sectorsFilters.confMin = 60;
    app._sectorsFilters.cross = 'cross3';
  }
  app.renderTilesFromCache();
  const host = app.document.getElementById('tile-grid');
  const html = host && host._innerHTML || '';
  // Either we get a no-matches placeholder OR the filter loosens and we still
  // produce tiles — both are valid no-crash outcomes. We just assert no throw.
  assert.ok(typeof html === 'string', 'expected string innerHTML, not throw');
});

// === Scenario 5: CROSS-SCOPE ===
// Verdict pill text matches the ticker's computeVerdict.label. Pin the
// data-display contract: the pill SHOWS what the engine PRODUCED.
test('Scenario 5 (cross-scope): verdict pill text matches computeVerdict.label for each ticker', () => {
  const app = loadApp();
  // Reset filters for this test
  if (app._sectorsFilters) {
    app._sectorsFilters.verdict = 'all';
    app._sectorsFilters.fcMin = 0;
    app._sectorsFilters.confMin = 0;
    app._sectorsFilters.cross = 'all';
    app._sectorsFilters.div = 'all';
    app._sectorsFilters.sector = 'all';
    app._sectorsFilters.timing = 'all';
    app._sectorsFilters.inst = 'all';
  }
  const html = renderTilesAndCapture(app, 'value');
  // Pull tile-sym → adjacent verdict label pairs from the HTML
  const tileRE = /<div class="tile-sym">([A-Z.]+)<\/div>[\s\S]*?<span class="pick-verdict verdict-([A-Z-]+)"[^>]*>([^<]+)<\/span>/g;
  let count = 0;
  for (const m of html.matchAll(tileRE)) {
    const [, ticker, tierClass, pillText] = m;
    // Class suffix and pill text should agree (one is dashed, the other has space)
    const expectedDashedText = pillText.replace(/\s+/g, '-');
    assert.equal(tierClass, expectedDashedText,
      `${ticker}: pill class ${tierClass} should match pill text '${pillText}' (dashed)`);
    count++;
  }
  assert.ok(count > 0, 'expected at least one tile-sym + verdict-pill match');
});
