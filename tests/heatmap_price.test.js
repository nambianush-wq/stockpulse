// Watchlist heatmap tiles must show the current price + today's change-from-
// previous-close when a live quote is present, and gracefully degrade to the
// last bar close + weekly change when no quote is available (DEMO mode).

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');

test('_cockpitRenderHeatmap — LIVE mode tiles show price + today% from quote', () => {
  const app = loadApp();
  // Mount a fake DOM host the function will write into
  app.document.getElementById = ((orig) => (id) => {
    if (id === 'cockpit-heatmap') return { innerHTML: '', _captured: '' };
    return orig(id);
  })(app.document.getElementById);

  // Capture the innerHTML by giving it a getter/setter
  let captured = '';
  const host = {
    get innerHTML() { return captured; },
    set innerHTML(v) { captured = v; },
  };
  app.document.getElementById = (id) => (id === 'cockpit-heatmap' ? host : null);

  // Seed two rows; first has a live quote, second doesn't (DEMO path)
  const ov = {
    empty: false,
    rows: [
      { ticker: 'AAPL', name: 'Apple Inc', industry: 'Technology', last: 168.84,
        wkChg: 4.37, moChg: 1.2, score: 25, verdict: 'BUY', f12: 12, conf12: 60,
        aboveMa40: true, isFav: true,
        livePrice: 170.50, dayChange: 1.66, dayChangePct: 0.98 },
      { ticker: 'MSFT', name: 'Microsoft', industry: 'Technology', last: 415.20,
        wkChg: -1.8, moChg: 3.4, score: 10, verdict: 'HOLD', f12: 8, conf12: 55,
        aboveMa40: true, isFav: false,
        livePrice: 415.20, dayChange: null, dayChangePct: null },
    ],
  };

  app._cockpitRenderHeatmap(ov);

  assert.match(captured, /AAPL ★/, 'starred AAPL tile present');
  assert.match(captured, /\$170\.50/, 'AAPL live price rendered');
  assert.match(captured, /\+0\.98% today/, 'AAPL day-change with "today" label');
  assert.match(captured, /MSFT/, 'MSFT tile present');
  assert.match(captured, /\$415\.20/, 'MSFT price (last close) rendered');
  assert.match(captured, /-1\.80% 1W/, 'MSFT falls back to weekly label when no quote');
});

test('fetchTickerBundle — quote field is populated in LIVE mode', async () => {
  const app = loadApp();
  // Pretend we're LIVE
  app.isLive = () => true;
  app.fetchBars = async () => ({ bars: [{ time: 1, open: 100, high: 110, low: 99, close: 105, volume: 1000 }], source: 'live' });
  app.fetchFinnhubProfile = async () => ({ name: 'Stub Co', finnhubIndustry: 'Tech' });
  app.fetchFinnhubMetrics = async () => ({ peExclExtraTTM: 25, dividendYieldIndicatedAnnual: 1.0 });
  app.fetchQuote = async () => ({ price: 105.50, change: 1.50, changePct: 1.44, high: 106, low: 103, prevClose: 104, open: 104 });
  app.computeVerdict = () => ({ score: 20, label: 'BUY', lastRsi: 55 });

  const bundle = await app.fetchTickerBundle('AAPL');
  assert.ok(bundle.quote, 'quote present');
  assert.equal(bundle.quote.price, 105.50);
  assert.equal(bundle.quote.changePct, 1.44);
  assert.equal(bundle.quote.prevClose, 104);
});

test('fetchTickerBundle — quote is null in DEMO mode', async () => {
  const app = loadApp();
  app.isLive = () => false;
  app.fetchBars = async () => ({ bars: [{ time: 1, open: 100, high: 110, low: 99, close: 105, volume: 1000 }], source: 'demo' });
  app.computeVerdict = () => ({ score: 0, label: 'HOLD', lastRsi: 50 });

  const bundle = await app.fetchTickerBundle('AAPL');
  assert.equal(bundle.quote, null, 'no live quote in DEMO');
});
