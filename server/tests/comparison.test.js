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

  // getHistoricalPrices is called by:
  //   - buildSnapshot (sequential): template 1yr history
  //   - fetchTemplate directly: short interest + sparkline
  //   - buildCurrentMetrics (sequential): match 1yr history
  //   - fetchMatchSparkline: match sparkline
  // Use mockResolvedValue as default, then
  // override specific calls with mockResolvedValueOnce where needed.
  fmp.getHistoricalPrices.mockResolvedValue(mockTemplateHist);
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
    // Put AMZN in the universe cache so buildCurrentMetrics is skipped entirely.
    // This isolates the test to just fetchMatchSparkline, which we make fail.
    universe.getCache.mockReturnValue(new Map([
      ['AMZN', { ticker: 'AMZN', companyName: 'Amazon', sector: 'Technology', rsi14: 50, beta: 1.1 }],
    ]));
    fmp.getHistoricalPrices.mockReset();
    fmp.getHistoricalPrices.mockImplementation((sym) => {
      if (sym === 'AMZN') {
        return Promise.reject(new Error('FMP unavailable'));
      }
      return Promise.resolve(mockTemplateHist);
    });
    const res = await request(app)
      .get('/api/comparison?ticker=NVDA&date=2022-10-15&matchTicker=AMZN');
    expect(res.status).toBe(200);
    expect(res.body.matchSparkline).toEqual([]);
    expect(res.body.matchSparklineGainPct).toBeNull();
  });
});
