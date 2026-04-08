jest.mock('../services/fmp');
const fmp = require('../services/fmp');
const request = require('supertest');
const app = require('../index');

const mockProfile = { companyName: 'NVIDIA Corp', sector: 'Technology' };
const mockIncome = [
  { date: '2019-01-27', revenue: 11716000000, grossProfit: 7279000000, grossProfitRatio: 0.6213 },
  { date: '2018-01-28', revenue: 9714000000, grossProfit: 5996000000, grossProfitRatio: 0.617 },
];
const mockKeyMetrics = [
  { date: '2019-01-27', peRatio: 32.5, priceToSalesRatio: 5.2, marketCap: 81000000000 },
];
const mockRatios = [
  { date: '2019-01-27', priceToEarningsRatio: 32.5, priceToBookRatio: 8.1, priceToSalesRatio: 5.2 },
];
// 40 prices around 2019-06-15, newest first
const mockHistorical = Array.from({ length: 40 }, (_, i) => ({
  date: new Date(Date.UTC(2019, 5, 15) - i * 86400000).toISOString().slice(0, 10),
  close: 160 + Math.sin(i) * 5,
}));

beforeEach(() => {
  fmp.getProfile.mockResolvedValue(mockProfile);
  fmp.getIncomeStatements.mockResolvedValue(mockIncome);
  fmp.getKeyMetricsAnnual.mockResolvedValue(mockKeyMetrics);
  fmp.getHistoricalPrices.mockResolvedValue(mockHistorical);
  fmp.getShortInterest.mockResolvedValue(null);
  fmp.getRatiosAnnual.mockResolvedValue(mockRatios);
  fmp.getBalanceSheet.mockResolvedValue([]);
  fmp.getCashFlowStatement.mockResolvedValue([]);
});

describe('GET /api/snapshot', () => {
  test('returns 400 when ticker or date missing', async () => {
    const res = await request(app).get('/api/snapshot');
    expect(res.status).toBe(400);
  });

  test('returns snapshot object with correct shape', async () => {
    const res = await request(app).get('/api/snapshot?ticker=NVDA&date=2019-06-15');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ticker: 'NVDA',
      companyName: 'NVIDIA Corp',
      sector: 'Technology',
      date: '2019-06-15',
    });
    expect(typeof res.body.price).toBe('number');
    expect(typeof res.body.peRatio).toBe('number');
    expect(typeof res.body.revenueGrowthYoY).toBe('number');
    expect(typeof res.body.grossMargin).toBe('number');
  });

  test('revenue growth is computed correctly from two income statements', async () => {
    const res = await request(app).get('/api/snapshot?ticker=NVDA&date=2019-06-15');
    // (11716 - 9714) / 9714 ≈ 0.206
    expect(res.body.revenueGrowthYoY).toBeCloseTo(0.206, 2);
  });

  test('key-metrics fields are included in snapshot when available', async () => {
    fmp.getKeyMetricsAnnual.mockResolvedValueOnce([
      {
        date: '2019-01-27',
        evToEBITDA: 20.5,
        evToSales: 5.2,
        earningsYield: 0.049,
        returnOnEquity: 0.443,
        returnOnAssets: 0.17,
        returnOnInvestedCapital: 0.22,
        netDebtToEBITDA: 0.3,
        freeCashFlowYield: 0.04,
      },
    ]);
    const res = await request(app).get('/api/snapshot?ticker=MSFT&date=2019-06-15');
    expect(res.status).toBe(200);
    expect(res.body.evToEBITDA).toBe(20.5);
    expect(res.body.evToRevenue).toBe(5.2);
    expect(res.body.returnOnEquity).toBe(0.443);
    expect(res.body.returnOnAssets).toBe(0.17);
  });

  test('null fields are present but null when data unavailable', async () => {
    fmp.getIncomeStatements.mockResolvedValue([]);
    fmp.getKeyMetricsAnnual.mockResolvedValue([]);
    fmp.getRatiosAnnual.mockResolvedValue([]);
    // Use a different ticker to avoid the in-memory snapshot cache from previous tests
    const res = await request(app).get('/api/snapshot?ticker=AAPL&date=2019-06-15');
    expect(res.status).toBe(200);
    expect(res.body.peRatio).toBeNull();
    expect(res.body.grossMargin).toBeNull();
  });
});
