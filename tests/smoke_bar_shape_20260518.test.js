// Multi-scenario smoke pinning the BAR-SHAPE CONTRACT across all sources.
//
// Doctrine: 2026-05-18 RCA on Watchlist charts rendering as empty black
// panels + "Invalid Date" timestamp. Yahoo + Twelve Data fetchers were
// returning bars with key `t` (milliseconds), but the chart consumer
// (renderPriceChart, renderRsiChart, renderVolChart) and the exec-summary
// date formatter both read `b.time` in SECONDS. Result: silent chart
// failure on every ticker that hit the Yahoo/TD branches.
//
// Contract every bar MUST satisfy:
//   - field key is `time`, NOT `t`
//   - value is in SECONDS since epoch (UTCTimestamp), NOT milliseconds
//   - bar also has open, high, low, close, volume as finite numbers
//
// Five scenarios (anush-rca Phase 4.5):
//   1. Verbatim: Yahoo result has `time` in seconds, not `t` in ms
//   2. Inverse: Twelve Data result also has `time` in seconds
//   3. Sibling: synthetic generateDemoBars STILL has `time` in seconds
//   4. Edge: chart's date formula `new Date(time * 1000)` produces a valid Date for every source
//   5. Cross-scope: bars from fetchBars (full chain) honour the contract regardless of which source resolved

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');

function yahooSuccessResponse(ticker) {
  const ts = [];
  const close = [], open = [], high = [], low = [], volume = [];
  for (let i = 259; i >= 0; i--) {
    const c = 180 + Math.cos(i / 6) * 12;
    ts.push(Math.floor((Date.now() - i * 7 * 86400000) / 1000));
    close.push(c); open.push(c * 0.99); high.push(c * 1.01); low.push(c * 0.98); volume.push(1_000_000);
  }
  return {
    ok: true,
    status: 200,
    json: async () => ({
      chart: { result: [{ meta: { symbol: ticker }, timestamp: ts, indicators: { quote: [{ open, high, low, close, volume }] } }] },
    }),
  };
}

function tdSuccessResponse(ticker) {
  const values = [];
  for (let i = 0; i < 260; i++) {
    const c = 170 + Math.sin(i / 8) * 15;
    const date = new Date(Date.now() - i * 7 * 86400000);
    values.push({
      datetime: date.toISOString().slice(0, 10),
      open: (c * 0.99).toFixed(2),
      high: (c * 1.01).toFixed(2),
      low:  (c * 0.98).toFixed(2),
      close: c.toFixed(2),
      volume: '1000000',
    });
  }
  return { ok: true, status: 200, json: async () => ({ meta: { symbol: ticker }, values, status: 'ok' }) };
}

// Heuristic for "is this value SECONDS, not milliseconds, since epoch"
// A unix-seconds timestamp for any year 1995+ is in the range ~800_000_000
// to ~32_000_000_000 (year 3000). A ms timestamp for the same range is 1000x
// larger. So any time value > 1e13 is almost certainly ms — a contract violation.
function isUnixSeconds(t) {
  return typeof t === 'number' && isFinite(t) && t > 800_000_000 && t < 32_000_000_000;
}

// === Scenario 1: VERBATIM REGRESSION ===
// Yahoo result must use key `time` in seconds — was `t` in ms before this RCA.
test('Scenario 1 (verbatim): Yahoo bars use key=time, value in SECONDS, NOT milliseconds', async () => {
  const app = loadApp();
  app.fetch = async () => yahooSuccessResponse('ACN');
  const bars = await app.fetchYahooWeekly('ACN');
  assert.ok(Array.isArray(bars) && bars.length > 100, `expected >100 bars, got ${bars && bars.length}`);
  // Every bar must have `time` (not `t`) in seconds:
  for (const b of bars) {
    assert.equal(typeof b.t, 'undefined', `bar has stale key 't': ${JSON.stringify(b)}`);
    assert.ok(isUnixSeconds(b.time), `bar.time must be unix seconds, got ${b.time}`);
    // Chart consumer assumes time * 1000 produces a valid Date:
    const d = new Date(b.time * 1000);
    assert.ok(!isNaN(d.getTime()), `time * 1000 must be a valid Date, got ${b.time}`);
  }
});

// === Scenario 2: INVERSE ===
// Twelve Data result must also honour the contract.
test('Scenario 2 (inverse): Twelve Data bars use key=time, value in SECONDS', async () => {
  const app = loadApp();
  app.fetch = async () => tdSuccessResponse('ACN');
  const bars = await app.fetchTwelveDataWeekly('ACN');
  assert.ok(Array.isArray(bars) && bars.length > 100, `expected >100 bars`);
  for (const b of bars) {
    assert.equal(typeof b.t, 'undefined', `bar has stale key 't'`);
    assert.ok(isUnixSeconds(b.time), `bar.time must be unix seconds, got ${b.time}`);
    const d = new Date(b.time * 1000);
    assert.ok(!isNaN(d.getTime()), `time * 1000 must be a valid Date`);
  }
});

// === Scenario 3: SIBLING ===
// synthetic generateDemoBars must STILL honour the contract (regression guard).
test('Scenario 3 (sibling): synthetic generateDemoBars bars use key=time, value in SECONDS', () => {
  const app = loadApp();
  // generateDemoBars is internal — not exported, but getBars calls it for unknown ticker.
  const bars = app.getBars('SYNTH_NONEXISTENT_XYZ');
  assert.ok(Array.isArray(bars) && bars.length > 100, `expected synthetic bars`);
  for (const b of bars) {
    assert.equal(typeof b.t, 'undefined', `synthetic bar has stale key 't'`);
    assert.ok(isUnixSeconds(b.time), `synthetic bar.time must be unix seconds, got ${b.time}`);
  }
});

// === Scenario 4: EDGE — chart consumer's exact date formula works for every source ===
// The exec-summary date formatter does `new Date(last.time * 1000)`. If any
// source returns ms-valued time (or undefined), this produces "Invalid Date".
test('Scenario 4 (edge): exec-summary date formula produces valid Date for all sources', async () => {
  const app = loadApp();
  // Yahoo
  app.fetch = async () => yahooSuccessResponse('ACN');
  const yBars = await app.fetchYahooWeekly('ACN');
  const yLast = yBars[yBars.length - 1];
  const yDate = new Date(yLast.time * 1000);
  assert.ok(!isNaN(yDate.getTime()), `Yahoo last.time * 1000 must be valid Date, got "${yDate}"`);
  // TD
  app.fetch = async () => tdSuccessResponse('ACN');
  const tdBars = await app.fetchTwelveDataWeekly('ACN');
  const tdLast = tdBars[tdBars.length - 1];
  const tdDate = new Date(tdLast.time * 1000);
  assert.ok(!isNaN(tdDate.getTime()), `TD last.time * 1000 must be valid Date, got "${tdDate}"`);
  // Synthetic
  const sBars = app.getBars('SYNTH_NONEXISTENT_XYZ');
  const sLast = sBars[sBars.length - 1];
  const sDate = new Date(sLast.time * 1000);
  assert.ok(!isNaN(sDate.getTime()), `Synthetic last.time * 1000 must be valid Date`);
});

// === Scenario 5: CROSS-SCOPE — fetchBars full chain returns canonical shape ===
// Regardless of which source resolved (yahoo / twelvedata / live / fallback),
// the bars[] inside the result must honour the canonical bar shape so
// downstream consumers (charts + exec-summary) never break.
test('Scenario 5 (cross-scope): fetchBars output honours canonical bar shape across all sources', async () => {
  const app = loadApp();
  // Force Yahoo path
  app.fetch = async (url) => {
    if (String(url).includes('query1.finance.yahoo.com')) return yahooSuccessResponse('TEST');
    throw new Error('unexpected fetch');
  };
  const r1 = await app.fetchBars('TEST');
  assert.equal(r1.source, 'yahoo');
  for (const b of r1.bars) {
    assert.ok(isUnixSeconds(b.time), `yahoo path: bar.time must be unix seconds, got ${b.time}`);
  }
  // Force TD path (Yahoo fails)
  app.fetch = async (url) => {
    const u = String(url);
    if (u.includes('query1.finance.yahoo.com')) return { ok: false, status: 401, json: async () => ({}) };
    if (u.includes('api.twelvedata.com/time_series')) return tdSuccessResponse('TEST');
    throw new Error('unexpected fetch');
  };
  const r2 = await app.fetchBars('TEST');
  assert.equal(r2.source, 'twelvedata');
  for (const b of r2.bars) {
    assert.ok(isUnixSeconds(b.time), `td path: bar.time must be unix seconds, got ${b.time}`);
  }
});
