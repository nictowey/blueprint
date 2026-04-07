jest.mock('../services/universe');
const universe = require('../services/universe');
const request = require('supertest');
const app = require('../index');

const makeStock = (ticker) => ({
  ticker,
  companyName: `${ticker} Corp`,
  sector: 'Technology',
  price: 150,
  peRatio: 25,
  revenueGrowthYoY: 0.2,
  grossMargin: 0.6,
  marketCap: 20_000_000_000,
  rsi14: 55,
  pctBelowHigh: 8,
});

const mockUniverse = new Map();
for (let i = 0; i < 15; i++) mockUniverse.set(`STK${i}`, makeStock(`STK${i}`));

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
    const res = await request(app).get('/api/matches?ticker=NVDA&date=2019-06-15');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeLessThanOrEqual(10);
  });

  test('each result has similarity score, ticker, and company name', async () => {
    const res = await request(app).get('/api/matches?ticker=NVDA&date=2019-06-15');
    for (const item of res.body) {
      expect(typeof item.similarity).toBe('number');
      expect(typeof item.ticker).toBe('string');
      expect(typeof item.companyName).toBe('string');
    }
  });
});
