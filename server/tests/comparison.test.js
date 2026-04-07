jest.mock('../services/fmp');
jest.mock('../services/universe');
const fmp = require('../services/fmp');
const universe = require('../services/universe');
const request = require('supertest');
const app = require('../index');

// 30 price entries for the template historical window
const mockTemplateHist = Array.from({ length: 30 }, (_, i) => ({
  date: new Date(Date.UTC(2022, 9, 15) - i * 86400000).toISOString().slice(0, 10),
  close: 200 + i,
}));

// 30 price entries for the match ticker's last 12 months
const mockMatchHist = Array.from({ length: 30 }, (_, i) => ({
  date: new Date(Date.now() - i * 86400000).toISOString().slice(0, 10),
  close: 100 + i,
}));

const mockProfile = { companyName: 'NVIDIA Corp', sector: 'Technology', beta: 1.5, volAvg: 50000000 };

function setupMocks() {
  // Clear any leftover mock state from previous tests
  jest.clearAllMocks();

  // Universe cache empty → buildCurrentMetrics runs for the match ticker
  universe.getCache.mockReturnValue(new Map());

  fmp.getProfile.mockResolvedValue(mockProfile);
  fmp.getIncomeStatements.mockResolvedValue([]);
  fmp.getKeyMetricsAnnual.mockResolvedValue([]);
  fmp.getRatiosAnnual.mockResolvedValue([]);
  fmp.getShortInterest.mockResolvedValue(null);
  fmp.getBalanceSheet.mockResolvedValue([]);
  fmp.getCashFlowStatement.mockResolvedValue([]);
  fmp.getKeyMetricsTTM.mockResolvedValue({});
  fmp.getRatiosTTM.mockResolvedValue({});

  // getHistoricalPrices call order in the route:
  //   [0] buildCurrentMetrics internal: getHistoricalPrices(matchSym, now-365d, now)
  //   [1] Promise.allSettled slot 5: getHistoricalPrices(sym, fromStr, date) — template 1yr history
  //   [2] Promise.allSettled slot 7: getHistoricalPrices(sym, date, sparklineEnd) — template sparkline
  //   [3] Promise.allSettled slot 11: getHistoricalPrices(matchSym, matchSparklineFrom, matchSparklineTo) — match sparkline
  fmp.getHistoricalPrices
    .mockResolvedValueOnce(mockMatchHist)    // [0] buildCurrentMetrics internal
    .mockResolvedValueOnce(mockTemplateHist) // [1] template 1yr historical
    .mockResolvedValueOnce(mockTemplateHist) // [2] template sparkline
    .mockResolvedValueOnce(mockMatchHist);   // [3] match sparkline
}

beforeEach(setupMocks);

describe('GET /api/comparison', () => {
  test('returns 400 when required params are missing', async () => {
    const res = await request(app).get('/api/comparison');
    expect(res.status).toBe(400);
  });

  test('returns matchSparkline array in response', async () => {
    const res = await request(app)
      .get('/api/comparison?ticker=NVDA&date=2022-10-15&matchTicker=MSFT');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.matchSparkline)).toBe(true);
    expect(res.body.matchSparkline.length).toBeGreaterThan(0);
    expect(res.body.matchSparkline[0]).toHaveProperty('date');
    expect(res.body.matchSparkline[0]).toHaveProperty('price');
  });

  test('returns matchSparklineGainPct as a number', async () => {
    const res = await request(app)
      .get('/api/comparison?ticker=NVDA&date=2022-10-15&matchTicker=AAPL');
    expect(res.status).toBe(200);
    expect(typeof res.body.matchSparklineGainPct).toBe('number');
  });

  test('response still includes template sparkline fields', async () => {
    const res = await request(app)
      .get('/api/comparison?ticker=NVDA&date=2022-10-15&matchTicker=GOOGL');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.sparkline)).toBe(true);
    expect(res.body).toHaveProperty('sparklineGainPct');
  });

  test('returns empty matchSparkline when match prices unavailable', async () => {
    // beforeEach already called setupMocks(); we just need to replace the
    // getHistoricalPrices queue so the match sparkline call rejects instead.
    fmp.getHistoricalPrices.mockReset();
    fmp.getHistoricalPrices
      .mockResolvedValueOnce(mockMatchHist)    // buildCurrentMetrics internal
      .mockResolvedValueOnce(mockTemplateHist) // template hist
      .mockResolvedValueOnce(mockTemplateHist) // template sparkline
      .mockRejectedValueOnce(new Error('FMP unavailable')); // match sparkline fails
    const res = await request(app)
      .get('/api/comparison?ticker=NVDA&date=2022-10-15&matchTicker=AMZN');
    expect(res.status).toBe(200);
    expect(res.body.matchSparkline).toEqual([]);
    expect(res.body.matchSparklineGainPct).toBeNull();
  });
});
