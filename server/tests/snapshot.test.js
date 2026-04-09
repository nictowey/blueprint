jest.mock('../services/fmp');
const fmp = require('../services/fmp');
const request = require('supertest');
const app = require('../index');

// 8 quarters of income data, newest first — simulating NVDA-like quarters
const mockQuarterlyIncome = [
  { date: '2023-10-29', revenue: 18120e6, grossProfit: 13400e6, operatingIncome: 10417e6, netIncome: 9243e6, ebitda: 11200e6, eps: 3.71 },
  { date: '2023-07-30', revenue: 13507e6, grossProfit: 9462e6,  operatingIncome: 6800e6,  netIncome: 6188e6,  ebitda: 7500e6,  eps: 2.48 },
  { date: '2023-04-30', revenue: 7192e6,  grossProfit: 4648e6,  operatingIncome: 2903e6,  netIncome: 2043e6,  ebitda: 3200e6,  eps: 0.82 },
  { date: '2023-01-29', revenue: 6051e6,  grossProfit: 3833e6,  operatingIncome: 1769e6,  netIncome: 1414e6,  ebitda: 2100e6,  eps: 0.57 },
  { date: '2022-10-30', revenue: 5931e6,  grossProfit: 3177e6,  operatingIncome: 601e6,   netIncome: 680e6,   ebitda: 1200e6,  eps: 0.27 },
  { date: '2022-07-31', revenue: 6704e6,  grossProfit: 2915e6,  operatingIncome: 499e6,   netIncome: 656e6,   ebitda: 1100e6,  eps: 0.26 },
  { date: '2022-04-30', revenue: 8288e6,  grossProfit: 5431e6,  operatingIncome: 3052e6,  netIncome: 1618e6,  ebitda: 3500e6,  eps: 0.64 },
  { date: '2022-01-30', revenue: 7643e6,  grossProfit: 4980e6,  operatingIncome: 2970e6,  netIncome: 3003e6,  ebitda: 3400e6,  eps: 1.18 },
];

const mockQuarterlyMetrics = [
  { date: '2023-10-29', evToEBITDA: 60.5, evToSales: 30.2, earningsYield: 0.02, returnOnEquity: 0.91, returnOnAssets: 0.35, returnOnInvestedCapital: 0.50, netDebtToEBITDA: -0.5, freeCashFlowYield: 0.015, marketCap: 1200e9, currentRatio: 4.17 },
  { date: '2023-07-30', evToEBITDA: 55.0, evToSales: 25.0, earningsYield: 0.025, returnOnEquity: 0.70, returnOnAssets: 0.30, returnOnInvestedCapital: 0.40, netDebtToEBITDA: -0.3, freeCashFlowYield: 0.018, marketCap: 1100e9, currentRatio: 3.50 },
  { date: '2023-04-30', evToEBITDA: 100.0, evToSales: 20.0, earningsYield: 0.01, returnOnEquity: 0.30, returnOnAssets: 0.12, returnOnInvestedCapital: 0.18, netDebtToEBITDA: 0.5, freeCashFlowYield: 0.010, marketCap: 700e9, currentRatio: 3.00 },
  { date: '2023-01-29', evToEBITDA: 120.0, evToSales: 18.0, earningsYield: 0.008, returnOnEquity: 0.20, returnOnAssets: 0.10, returnOnInvestedCapital: 0.15, netDebtToEBITDA: 1.0, freeCashFlowYield: 0.008, marketCap: 400e9, currentRatio: 2.80 },
];

const mockQuarterlyRatios = [
  { date: '2023-10-29', priceToEarningsRatio: 65.0, priceToBookRatio: 40.0, priceToSalesRatio: 28.0, priceToEarningsGrowthRatio: 1.2, interestCoverageRatio: 100, debtToEquityRatio: 0.41, currentRatio: 4.17 },
  { date: '2023-07-30', priceToEarningsRatio: 60.0, priceToBookRatio: 35.0, priceToSalesRatio: 25.0, priceToEarningsGrowthRatio: 1.5, interestCoverageRatio: 80, debtToEquityRatio: 0.50, currentRatio: 3.50 },
  { date: '2023-04-30', priceToEarningsRatio: 150.0, priceToBookRatio: 25.0, priceToSalesRatio: 20.0, priceToEarningsGrowthRatio: 3.0, interestCoverageRatio: 50, debtToEquityRatio: 0.55, currentRatio: 3.00 },
  { date: '2023-01-29', priceToEarningsRatio: 200.0, priceToBookRatio: 20.0, priceToSalesRatio: 18.0, priceToEarningsGrowthRatio: 5.0, interestCoverageRatio: 30, debtToEquityRatio: 0.60, currentRatio: 2.80 },
];

const mockProfile = { companyName: 'NVIDIA Corp', sector: 'Technology', beta: 1.7, volAvg: 50000000 };

const mockQuarterlyBalance = [
  { date: '2023-10-29', cashAndCashEquivalents: 18280e6, totalDebt: 11056e6 },
  { date: '2023-07-30', cashAndCashEquivalents: 16023e6, totalDebt: 11056e6 },
];

const mockQuarterlyCashFlow = [
  { date: '2023-10-29', freeCashFlow: 7500e6, operatingCashFlow: 7800e6 },
  { date: '2023-07-30', freeCashFlow: 6300e6, operatingCashFlow: 6500e6 },
];

// 250 prices around 2023-12-15, newest first
const mockHistorical = Array.from({ length: 250 }, (_, i) => ({
  date: new Date(Date.UTC(2023, 11, 15) - i * 86400000).toISOString().slice(0, 10),
  close: 480 + Math.sin(i / 10) * 20,
}));

beforeEach(() => {
  fmp.getProfile.mockResolvedValue(mockProfile);
  fmp.getIncomeStatements.mockResolvedValue(mockQuarterlyIncome);
  fmp.getKeyMetricsAnnual.mockResolvedValue(mockQuarterlyMetrics);
  fmp.getRatiosAnnual.mockResolvedValue(mockQuarterlyRatios);
  fmp.getHistoricalPrices.mockResolvedValue(mockHistorical);
  fmp.getShortInterest.mockResolvedValue(null);
  fmp.getBalanceSheet.mockResolvedValue(mockQuarterlyBalance);
  fmp.getCashFlowStatement.mockResolvedValue(mockQuarterlyCashFlow);
});

describe('GET /api/snapshot — TTM construction', () => {
  test('returns 400 when ticker or date missing', async () => {
    const res = await request(app).get('/api/snapshot');
    expect(res.status).toBe(400);
  });

  test('returns snapshot with correct shape', async () => {
    const res = await request(app).get('/api/snapshot?ticker=NVDA&date=2023-12-15');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ticker: 'NVDA',
      companyName: 'NVIDIA Corp',
      sector: 'Technology',
      date: '2023-12-15',
    });
    expect(typeof res.body.price).toBe('number');
  });

  test('revenue is TTM sum of 4 most recent quarters before snapshot date', async () => {
    const res = await request(app).get('/api/snapshot?ticker=NVDA&date=2023-12-15');
    // Quarters on or before 2023-12-15: 2023-10-29, 2023-07-30, 2023-04-30, 2023-01-29
    // TTM revenue = 18120 + 13507 + 7192 + 6051 = 44870 (millions)
    expect(res.body.ttmRevenue).toBeCloseTo(44870e6, -6);
  });

  test('margins are computed from TTM sums', async () => {
    const res = await request(app).get('/api/snapshot?ticker=NVDA&date=2023-12-15');
    // TTM grossProfit = 13400 + 9462 + 4648 + 3833 = 31343
    // TTM revenue = 44870
    // grossMargin = 31343 / 44870 ≈ 0.6986
    expect(res.body.grossMargin).toBeCloseTo(0.6986, 3);
  });

  test('revenue growth YoY compares TTM vs prior-year TTM', async () => {
    const res = await request(app).get('/api/snapshot?ticker=NVDA&date=2023-12-15');
    // Current TTM revenue (Q ending 2023-10 through 2023-01): 44870M
    // Prior TTM revenue (Q ending 2022-10 through 2022-01): 5931 + 6704 + 8288 + 7643 = 28566M
    // Growth = (44870 - 28566) / 28566 ≈ 0.5706
    expect(res.body.revenueGrowthYoY).toBeCloseTo(0.5706, 2);
  });

  test('valuation ratios come from most recent quarterly key-metrics/ratios', async () => {
    const res = await request(app).get('/api/snapshot?ticker=NVDA&date=2023-12-15');
    // Most recent quarter on or before 2023-12-15 is 2023-10-29
    expect(res.body.evToEBITDA).toBe(60.5);
    expect(res.body.peRatio).toBe(65.0);
    expect(res.body.priceToBook).toBe(40.0);
  });

  test('balance sheet uses most recent quarter', async () => {
    const res = await request(app).get('/api/snapshot?ticker=NVDA&date=2023-12-15');
    expect(res.body.totalCash).toBe(18280e6);
    expect(res.body.totalDebt).toBe(11056e6);
  });

  test('null fields when no quarterly data available', async () => {
    fmp.getIncomeStatements.mockResolvedValue([]);
    fmp.getKeyMetricsAnnual.mockResolvedValue([]);
    fmp.getRatiosAnnual.mockResolvedValue([]);
    const res = await request(app).get('/api/snapshot?ticker=AAPL&date=2023-12-15');
    expect(res.status).toBe(200);
    expect(res.body.peRatio).toBeNull();
    expect(res.body.grossMargin).toBeNull();
    expect(res.body.revenueGrowthYoY).toBeNull();
  });

  test('technical metrics are computed from price history', async () => {
    const res = await request(app).get('/api/snapshot?ticker=NVDA&date=2023-12-15');
    expect(typeof res.body.rsi14).toBe('number');
    expect(typeof res.body.pctBelowHigh).toBe('number');
    expect(typeof res.body.priceVsMa50).toBe('number');
    expect(typeof res.body.priceVsMa200).toBe('number');
  });
});
