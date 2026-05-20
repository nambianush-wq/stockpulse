// localStorage bars-cache + cross-check rate-limit messaging smoke.
//
// Doctrine: 2026-05-19 RCA — in production both real-bars sources fail:
//   - Yahoo /chart: CORS-blocked from github.io (no Access-Control-Allow-Origin)
//   - Twelve Data /time_series: 8/min free-tier rate limit, returns
//     {"status":"error","code":429,"message":"out of API credits"} for
//     ticker #9+ on Watchlist load (17+ tickers fire in parallel)
//
// Fix: 24h localStorage cache for TD/Yahoo/Finnhub bars. First load gets
// what it can past the rate limit; subsequent loads hit cache (zero API
// calls) for cached tickers. Plus: cross-check chip now surfaces the
// specific TD error reason (rate_limited / no_key / api_error) instead
// of the generic "no quote".
//
// Five scenarios:

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');

// === Scenario 1 (VERBATIM): bars are cached after a successful TD fetch ===
test('Scenario 1 (verbatim): _writeCachedBars persists, _readCachedBars returns within TTL', () => {
  const app = loadApp();
  const fakeBars = Array.from({ length: 200 }, (_, i) => ({
    time: Math.floor(Date.now() / 1000) - (200 - i) * 7 * 86400,
    open: 100, high: 102, low: 98, close: 101, volume: 1e6,
  }));
  app._writeCachedBars('CVX', fakeBars, 'twelvedata');
  const got = app._readCachedBars('CVX');
  assert.ok(Array.isArray(got), 'expected cached bars to be readable');
  assert.equal(got.length, 200);
  assert.equal(got[0].close, 101);
});

// === Scenario 2 (INVERSE): expired cache returns null ===
test('Scenario 2 (inverse): cache older than 24h TTL is ignored', () => {
  const app = loadApp();
  // Manually write a stale entry directly to localStorage
  const stale = {
    bars: Array.from({ length: 200 }, () => ({ time: 0, open: 1, high: 1, low: 1, close: 1, volume: 0 })),
    source: 'twelvedata',
    ts: Date.now() - (25 * 60 * 60 * 1000), // 25h ago
  };
  app.localStorage.setItem('sp_bars_cache:OLD', JSON.stringify(stale));
  const got = app._readCachedBars('OLD');
  assert.equal(got, null, 'expected stale entry (>24h) to be rejected');
});

// === Scenario 3 (SIBLING): cache hit causes fetchBars to skip network ===
test('Scenario 3 (sibling): cached bars short-circuit fetchBars; no network call', async () => {
  const app = loadApp();
  // Pre-populate the cache
  const fakeBars = Array.from({ length: 200 }, (_, i) => ({
    time: Math.floor(Date.now() / 1000) - (200 - i) * 7 * 86400,
    open: 100, high: 102, low: 98, close: 101, volume: 1e6,
  }));
  app._writeCachedBars('AAPL', fakeBars, 'twelvedata');
  // Make fetch always throw — any network call would fail
  let fetchCalled = false;
  app.fetch = async () => { fetchCalled = true; throw new Error('network should not be called'); };
  const r = await app.fetchBars('AAPL');
  assert.equal(r.source, 'twelvedata', `expected source from cache, got ${r.source}`);
  assert.equal(fetchCalled, false, 'fetch must NOT be called when cache is hit');
});

// === Scenario 4 (EDGE): malformed cache entry is ignored, no crash ===
test('Scenario 4 (edge): malformed cache entry returns null without throwing', () => {
  const app = loadApp();
  app.localStorage.setItem('sp_bars_cache:BAD', 'not-json-{{{');
  const got = app._readCachedBars('BAD');
  assert.equal(got, null);
  // Also empty bars array
  app.localStorage.setItem('sp_bars_cache:EMPTY', JSON.stringify({ bars: [], source: 'x', ts: Date.now() }));
  assert.equal(app._readCachedBars('EMPTY'), null);
});

// === Scenario 5 (CROSS-SCOPE): cross-check chip surfaces specific TD error ===
test('Scenario 5 (cross-scope): TD rate-limit error surfaces in cross-check chip text', async () => {
  const app = loadApp();
  // Stub fetch to return the actual TD rate-limit response shape
  app.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      code: 429,
      status: 'error',
      message: 'You have run out of API credits for the current minute. 17 API credits were used, with the current limit being 8.',
    }),
  });
  const price = await app.fetchTwelveDataPrice('CVX');
  assert.equal(price, null, 'rate-limited response should return null');
  // Now stub the slot DOM and call renderCrossCheckChip
  const slot = app.document.getElementById('cross-check-slot');
  app.renderCrossCheckChip('CVX', 197.25, null);
  const html = slot._innerHTML || '';
  assert.match(html, /rate.?limit/i, `chip text should mention "rate-limit" when TD is rate-limited. Got: ${html}`);
  assert.doesNotMatch(html, /symbol may not be supported/i, 'chip should NOT say "symbol may not be supported" when actual reason is rate-limit');
});
