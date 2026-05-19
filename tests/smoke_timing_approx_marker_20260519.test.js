// Timing-card approximate-bars marker smoke.
//
// Doctrine: 2026-05-19 RCA — CVX showed "Buy on a dip · MA40 ($160.07)" while
// current price was $197, both derived from synthetic-scaled hybrid bars.
// The specific dollar target read as authoritative but was actually a
// synthetic-shape × live-price-scale artefact.
//
// Contract: when d.barsSource ∈ {hybrid, fallback}, the timing card MUST:
//   - carry the .approx-bars class on the .timing-card root
//   - render the .timing-card-approx badge next to the window
//   - render the .timing-card-approx-note explanation block
// When d.barsSource ∈ {yahoo, twelvedata, live, demo}, NONE of the above
// fire — the bars are either real or the demo-mode caveat is already
// surfaced elsewhere.
//
// Five scenarios per anush-rca Phase 4.5.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');

// Helper — render the ticker dashboard for a specific bars-source, return innerHTML.
function renderDashWithSource(app, ticker, source) {
  // Build a minimal _data[ticker] bundle with the given source.
  const bars = app.getBars(ticker);
  if (!bars || bars.length === 0) throw new Error('no bars');
  const verdict = app.computeVerdict(bars);
  const profile = app.getProfileFor(ticker, { name: ticker, finnhubIndustry: 'Other' });
  app._data = app._data || {};
  app._data[ticker] = {
    bars,
    barsSource: source,
    barsNote: source === 'hybrid' ? 'note' : '',
    profile,
    metrics: { '52WeekHigh': 0, '52WeekLow': 0 },
    quote: null,
    verdict,
    ts: Date.now(),
  };
  // selectTicker is the only way to set the script's inner _selected binding
  // — direct assignment via app._selected only updates the sandbox global
  // (the inline JS uses its own let-bound _selected).
  app.selectTicker(ticker);
  const root = app.document.getElementById('content');
  return root && root._innerHTML || '';
}

// === Scenario 1 (VERBATIM): hybrid bars → approx badge + note appear ===
test('Scenario 1 (verbatim): hybrid barsSource → approx badge + note rendered', () => {
  const app = loadApp();
  const html = renderDashWithSource(app, 'AAPL', 'hybrid');
  assert.match(html, /timing-card-approx/, 'expected .timing-card-approx badge in hybrid mode');
  assert.match(html, /approx-bars/, 'expected .approx-bars class on timing-card root');
  assert.match(html, /MA40 target above is computed from synthetic/, 'expected explanation note');
});

// === Scenario 2 (INVERSE): yahoo bars → no approx marker ===
test('Scenario 2 (inverse): yahoo barsSource → no approx marker', () => {
  const app = loadApp();
  const html = renderDashWithSource(app, 'AAPL', 'yahoo');
  assert.doesNotMatch(html, /timing-card-approx[^-]/, 'must NOT have .timing-card-approx when bars are real');
  assert.doesNotMatch(html, /approx-bars/, 'must NOT have .approx-bars class when bars are real');
});

// === Scenario 3 (SIBLING): fallback bars (full synthetic) → approx marker also fires ===
test('Scenario 3 (sibling): fallback barsSource → approx marker fires (sibling of hybrid)', () => {
  const app = loadApp();
  const html = renderDashWithSource(app, 'AAPL', 'fallback');
  assert.match(html, /timing-card-approx/, 'fallback should also trip the approx marker');
  assert.match(html, /approx-bars/);
});

// === Scenario 4 (EDGE): twelvedata bars → no approx marker (TD is real data) ===
test('Scenario 4 (edge): twelvedata barsSource → no approx marker (TD bars are REAL)', () => {
  const app = loadApp();
  const html = renderDashWithSource(app, 'AAPL', 'twelvedata');
  assert.doesNotMatch(html, /timing-card-approx[^-]/);
  assert.doesNotMatch(html, /approx-bars/);
});

// === Scenario 5 (CROSS-SCOPE): live (Finnhub paid) bars → no approx marker ===
test('Scenario 5 (cross-scope): live barsSource (Finnhub paid) → no approx marker', () => {
  const app = loadApp();
  const html = renderDashWithSource(app, 'AAPL', 'live');
  assert.doesNotMatch(html, /timing-card-approx[^-]/);
  assert.doesNotMatch(html, /approx-bars/);
});
