const request = require('supertest');
const express = require('express');
const universe = require('../services/universe');
const registry = require('../services/algorithms/registry');

// Triggers engine registration
require('../services/algorithms');

function makeApp() {
  const app = express();
  app.use('/api/stock', require('../routes/stock'));
  return app;
}

function mockUniverse(entries) {
  const cache = new Map();
  for (const e of entries) cache.set(e.ticker, e);
  jest.spyOn(universe, 'getCache').mockReturnValue(cache);
  jest.spyOn(universe, 'isReady').mockReturnValue(true);
}

// Build a stock that will pass investable + momentumBreakout coverage gates.
// momentumBreakout needs ≥3 of 5 signals: pctBelowHigh, priceVsMa50, priceVsMa200, rsi14, relativeVolume.
function investableStock(ticker, overrides = {}) {
  return {
    ticker,
    companyName: `${ticker} Corp`,
    sector: 'Technology',
    price: 100,
    marketCap: 50_000_000_000,
    pctBelowHigh: 5,
    priceVsMa50: 10,
    priceVsMa200: 25,
    rsi14: 65,
    relativeVolume: 1.6,
    ...overrides,
  };
}

beforeEach(() => {
  // Clear the route-level LRU between tests by re-requiring the module after
  // resetting its cache. We expose a _clearCache helper on the router exports.
  const route = require('../routes/stock');
  if (route._clearCache) route._clearCache();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('GET /api/stock/:ticker/engine-scores', () => {
  test('unknown ticker returns 404', async () => {
    mockUniverse([investableStock('NVDA')]);
    const res = await request(makeApp()).get('/api/stock/DOESNOTEXIST/engine-scores');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({});
  });

  test('known ticker returns ticker + asOf + engines shape', async () => {
    mockUniverse([
      investableStock('NVDA'),
      investableStock('AAPL'),
    ]);
    const res = await request(makeApp()).get('/api/stock/NVDA/engine-scores');
    expect(res.status).toBe(200);
    expect(res.body.ticker).toBe('NVDA');
    expect(typeof res.body.asOf).toBe('string');
    expect(res.body.engines).toBeDefined();
    expect(res.body.engines.momentumBreakout).toBeDefined();
    expect(res.body.engines.catalystDriven).toBeDefined();
    expect(res.body.engines.ensembleConsensus).toBeDefined();
  });

  test('momentumBreakout returns numeric score + rank for a qualifying stock', async () => {
    mockUniverse([
      investableStock('NVDA', { rsi14: 70, pctBelowHigh: 2 }),
      investableStock('AAPL', { rsi14: 50, pctBelowHigh: 30 }),
    ]);
    const res = await request(makeApp()).get('/api/stock/NVDA/engine-scores');
    const mb = res.body.engines.momentumBreakout;
    expect(typeof mb.score).toBe('number');
    expect(typeof mb.rank).toBe('number');
    expect(mb.rank).toBeGreaterThanOrEqual(1);
    expect(typeof mb.totalRanked).toBe('number');
    expect(Array.isArray(mb.topSignals)).toBe(true);
    expect(typeof mb.coverageLevel).toBe('string');
  });

  test('insufficient-signal stock: engine returns score: null + insufficientData', async () => {
    // Stock with only price + marketCap — no technical signals. momentumBreakout
    // requires ≥3 of 5, so it will be dropped.
    mockUniverse([
      { ticker: 'THIN', companyName: 'Thin Corp', price: 10, marketCap: 1e9 },
      investableStock('NVDA'),
    ]);
    const res = await request(makeApp()).get('/api/stock/THIN/engine-scores');
    const mb = res.body.engines.momentumBreakout;
    expect(mb.score).toBeNull();
    expect(mb.rank).toBeNull();
    expect(mb.insufficientData).toBe(true);
  });

  test('ensemble response includes totalEngines and consensusEngines', async () => {
    mockUniverse([investableStock('NVDA'), investableStock('AAPL')]);
    const res = await request(makeApp()).get('/api/stock/NVDA/engine-scores');
    const ens = res.body.engines.ensembleConsensus;
    expect(ens.totalEngines).toBeDefined();
    // consensusEngines is only present when the stock made it into the ensemble output.
    if (ens.score != null) {
      expect(typeof ens.consensusEngines).toBe('number');
    }
  });

  test('cache hit: second call within 60s does not re-run engine rank()', async () => {
    mockUniverse([investableStock('NVDA'), investableStock('AAPL')]);
    const momentum = registry.ENGINES.momentumBreakout;
    const spy = jest.spyOn(momentum, 'rank');

    await request(makeApp()).get('/api/stock/NVDA/engine-scores');
    const firstCallCount = spy.mock.calls.length;
    expect(firstCallCount).toBeGreaterThan(0);

    await request(makeApp()).get('/api/stock/NVDA/engine-scores');
    // No additional calls on second request
    expect(spy.mock.calls.length).toBe(firstCallCount);
  });

  test('universe not ready → 404 (prevents partial ranking)', async () => {
    jest.spyOn(universe, 'isReady').mockReturnValue(false);
    jest.spyOn(universe, 'getCache').mockReturnValue(new Map());
    const res = await request(makeApp()).get('/api/stock/NVDA/engine-scores');
    expect(res.status).toBe(404);
  });
});
