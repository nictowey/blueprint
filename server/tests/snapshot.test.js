jest.mock('../services/fmp');
const fmp = require('../services/fmp');
const request = require('supertest');
const app = require('../index');
const { snapshotCache } = require('../routes/snapshot');

// 8 quarters of income data, newest first — simulating NVDA-like quarters
const mockQuarterlyIncome = [
  { date: '2023-10-29', revenue: 18120e6, grossProfit: 13400e6, operatingIncome: 10417e6, netIncome: 9243e6, ebitda: 11200e6, eps: 3.71, interestExpense: 63e6, weightedAverageShsOutDil: 2470e6 },
  { date: '2023-07-30', revenue: 13507e6, grossProfit: 9462e6,  operatingIncome: 6800e6,  netIncome: 6188e6,  ebitda: 7500e6,  eps: 2.48, interestExpense: 65e6, weightedAverageShsOutDil: 2470e6 },
  { date: '2023-04-30', revenue: 7192e6,  grossProfit: 4648e6,  operatingIncome: 2903e6,  netIncome: 2043e6,  ebitda: 3200e6,  eps: 0.82, interestExpense: 66e6, weightedAverageShsOutDil: 2470e6 },
  { date: '2023-01-29', revenue: 6051e6,  grossProfit: 3833e6,  operatingIncome: 1769e6,  netIncome: 1414e6,  ebitda: 2100e6,  eps: 0.57, interestExpense: 64e6, weightedAverageShsOutDil: 2470e6 },
  { date: '2022-10-30', revenue: 5931e6,  grossProfit: 3177e6,  operatingIncome: 601e6,   netIncome: 680e6,   ebitda: 1200e6,  eps: 0.27, interestExpense: 60e6, weightedAverageShsOutDil: 2470e6 },
  { date: '2022-07-31', revenue: 6704e6,  grossProfit: 2915e6,  operatingIncome: 499e6,   netIncome: 656e6,   ebitda: 1100e6,  eps: 0.26, interestExpense: 58e6, weightedAverageShsOutDil: 2470e6 },
  { date: '2022-04-30', revenue: 8288e6,  grossProfit: 5431e6,  operatingIncome: 3052e6,  netIncome: 1618e6,  ebitda: 3500e6,  eps: 0.64, interestExpense: 55e6, weightedAverageShsOutDil: 2470e6 },
  { date: '2022-01-30', revenue: 7643e6,  grossProfit: 4980e6,  operatingIncome: 2970e6,  netIncome: 3003e6,  ebitda: 3400e6,  eps: 1.18, interestExpense: 52e6, weightedAverageShsOutDil: 2470e6 },
];

const mockProfile = { companyName: 'NVIDIA Corp', sector: 'Technology', beta: 1.7, volAvg: 50000000 };

const mockQuarterlyBalance = [
  { date: '2023-10-29', cashAndCashEquivalents: 18280e6, totalDebt: 11056e6, totalStockholdersEquity: 42978e6, totalAssets: 65728e6, totalCurrentAssets: 44345e6, totalCurrentLiabilities: 10631e6 },
  { date: '2023-07-30', cashAndCashEquivalents: 16023e6, totalDebt: 11056e6, totalStockholdersEquity: 33265e6, totalAssets: 54245e6, totalCurrentAssets: 33243e6, totalCurrentLiabilities: 10334e6 },
];

const mockQuarterlyCashFlow = [
  { date: '2023-10-29', freeCashFlow: 7500e6, operatingCashFlow: 7800e6 },
  { date: '2023-07-30', freeCashFlow: 6300e6, operatingCashFlow: 6500e6 },
  { date: '2023-04-30', freeCashFlow: 3200e6, operatingCashFlow: 3500e6 },
  { date: '2023-01-29', freeCashFlow: 2800e6, operatingCashFlow: 3100e6 },
];

// 250 prices around 2023-12-15, newest first
const mockHistorical = Array.from({ length: 250 }, (_, i) => ({
  date: new Date(Date.UTC(2023, 11, 15) - i * 86400000).toISOString().slice(0, 10),
  close: 480 + Math.sin(i / 10) * 20,
}));

beforeEach(() => {
  snapshotCache.clear();
  fmp.getProfile.mockResolvedValue(mockProfile);
  fmp.getIncomeStatements.mockResolvedValue(mockQuarterlyIncome);
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

  test('valuation ratios are computed from price + TTM + balance sheet', async () => {
    const res = await request(app).get('/api/snapshot?ticker=NVDA&date=2023-12-15');
    // price ≈ 480, TTM EPS = 3.71+2.48+0.82+0.57 = 7.58
    // sharesOut = 2470e6 (from most recent quarter)
    // marketCap = 480 * 2470e6 ≈ 1.1856e12
    // equity = 42978e6, totalDebt = 11056e6, cash = 18280e6
    // EV = marketCap + totalDebt - cash
    // TTM EBITDA = 11200+7500+3200+2100 = 24000 (millions)
    const price = res.body.price;
    const expectedMarketCap = price * 2470e6;
    const expectedEV = expectedMarketCap + 11056e6 - 18280e6;

    expect(res.body.peRatio).toBeCloseTo(price / 7.58, 1);
    expect(res.body.priceToBook).toBeCloseTo(expectedMarketCap / 42978e6, 1);
    expect(res.body.priceToSales).toBeCloseTo(expectedMarketCap / 44870e6, 1);
    expect(res.body.evToEBITDA).toBeCloseTo(expectedEV / 24000e6, 1);
    expect(res.body.marketCap).toBeCloseTo(expectedMarketCap, -6);
    expect(res.body.returnOnEquity).toBeCloseTo((9243e6 + 6188e6 + 2043e6 + 1414e6) / 42978e6, 2);
    expect(res.body.currentRatio).toBeCloseTo(44345e6 / 10631e6, 2);
    expect(res.body.debtToEquity).toBeCloseTo(11056e6 / 42978e6, 2);
  });

  test('balance sheet uses most recent quarter', async () => {
    const res = await request(app).get('/api/snapshot?ticker=NVDA&date=2023-12-15');
    expect(res.body.totalCash).toBe(18280e6);
    expect(res.body.totalDebt).toBe(11056e6);
  });

  test('null fields when no quarterly data available', async () => {
    fmp.getIncomeStatements.mockResolvedValue([]);
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

  test('snapshot includes snapshotBuilder fields (dataAsOf, ttmQuarters)', async () => {
    const res = await request(app).get('/api/snapshot?ticker=NVDA&date=2023-12-15');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('dataAsOf');
    expect(res.body).toHaveProperty('ttmQuarters');
  });

  test('EV-based ratios are null when balance sheet data is missing', async () => {
    fmp.getBalanceSheet.mockResolvedValue([]);
    const res = await request(app).get('/api/snapshot?ticker=NVDA&date=2023-12-15');
    expect(res.status).toBe(200);
    expect(res.body.evToEBITDA).toBeNull();
    expect(res.body.evToRevenue).toBeNull();
  });

  test('returns 404 when no price data available', async () => {
    fmp.getHistoricalPrices.mockResolvedValue([]);
    const res = await request(app).get('/api/snapshot?ticker=FAKE&date=2023-12-15');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/No price data/);
  });
});
