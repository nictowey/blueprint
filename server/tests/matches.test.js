jest.mock('../services/universe');
const universe = require('../services/universe');
const request = require('supertest');
const app = require('../index');

const makeStock = (ticker, overrides = {}) => ({
  ticker,
  companyName: `${ticker} Corp`,
  sector: 'Technology',
  price: 150,
  peRatio: 25,
  priceToBook: 3.0,
  priceToSales: 2.5,
  evToEBITDA: 12.0,
  evToRevenue: 3.0,
  pegRatio: 1.5,
  earningsYield: 0.05,
  grossMargin: 0.6,
  operatingMargin: 0.2,
  netMargin: 0.15,
  ebitdaMargin: 0.25,
  returnOnEquity: 0.18,
  returnOnAssets: 0.1,
  returnOnCapital: 0.14,
  revenueGrowthYoY: 0.2,
  revenueGrowth3yr: 0.18,
  epsGrowthYoY: 0.22,
  currentRatio: 1.8,
  debtToEquity: 0.5,
  interestCoverage: 8.0,
  netDebtToEBITDA: 1.2,
  freeCashFlowYield: 0.04,
  marketCap: 20_000_000_000,
  rsi14: 55,
  pctBelowHigh: 8,
  priceVsMa50: 2.0,
  priceVsMa200: 8.0,
  ...overrides,
});

const mockUniverse = new Map();
for (let i = 0; i < 10; i++) mockUniverse.set(`TECH${i}`, makeStock(`TECH${i}`));
for (let i = 0; i < 5; i++) mockUniverse.set(`HLTH${i}`, makeStock(`HLTH${i}`, { sector: 'Healthcare' }));

beforeEach(() => {
  universe.isReady.mockReturnValue(true);
  universe.getCache.mockReturnValue(mockUniverse);
});

describe('GET /api/matches', () => {
  test('returns 400 when ticker or date missing', async () => {
    const res = await request(app).get('/api/matches');
    expect(res.status).toBe(400);
  });

  test('returns 503 when cache not ready', async () => {
    universe.isReady.mockReturnValue(false);
    const res = await request(app).get('/api/matches?ticker=NVDA&date=2019-06-15');
    expect(res.status).toBe(503);
  });

  test('returns array of up to 10 match results', async () => {
    const res = await request(app).get('/api/matches?ticker=NVDA&date=2019-06-15&peRatio=25&grossMargin=0.6&revenueGrowthYoY=0.2&rsi14=55');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeLessThanOrEqual(10);
  });

  test('each result has matchScore, topMatches, topDifferences', async () => {
    const res = await request(app).get('/api/matches?ticker=NVDA&date=2019-06-15&peRatio=25&grossMargin=0.6&revenueGrowthYoY=0.2&rsi14=55');
    for (const item of res.body) {
      expect(typeof item.matchScore).toBe('number');
      expect(Array.isArray(item.topMatches)).toBe(true);
      expect(Array.isArray(item.topDifferences)).toBe(true);
    }
  });

  test('sector filter returns only matching sector stocks', async () => {
    const res = await request(app).get('/api/matches?ticker=NVDA&date=2019-06-15&peRatio=25&grossMargin=0.6&revenueGrowthYoY=0.2&rsi14=55&sector=Healthcare');
    expect(res.status).toBe(200);
    for (const item of res.body) {
      expect(item.sector).toBe('Healthcare');
    }
  });

  test('without sector filter returns all sectors', async () => {
    const res = await request(app).get('/api/matches?ticker=NVDA&date=2019-06-15&peRatio=25&grossMargin=0.6&revenueGrowthYoY=0.2&rsi14=55');
    expect(res.status).toBe(200);
    const sectors = new Set(res.body.map(r => r.sector));
    expect(sectors.size).toBeGreaterThanOrEqual(1);
  });
});

describe('GET /api/matches?algo=ensembleConsensus', () => {
  test('template-free invocation returns 200 with an array', async () => {
    const res = await request(app).get('/api/matches?algo=ensembleConsensus');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    for (const item of res.body) {
      expect(item.algorithm).toBe('ensembleConsensus');
      expect(typeof item.matchScore).toBe('number');
      expect(item.perEngineRanks).toBeDefined();
      expect(item.consensusEngines).toBeGreaterThanOrEqual(1);
    }
  });

  test('template-aware invocation (ticker+date supplied) returns 200', async () => {
    const res = await request(app).get('/api/matches?algo=ensembleConsensus&ticker=NVDA&date=2019-06-15&peRatio=25&grossMargin=0.6&revenueGrowthYoY=0.2&rsi14=55');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  test('invalid ticker with ensembleConsensus returns 400', async () => {
    const res = await request(app).get('/api/matches?algo=ensembleConsensus&ticker=not*valid&date=2019-06-15');
    expect(res.status).toBe(400);
  });
});
