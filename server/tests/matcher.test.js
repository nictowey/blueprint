const { findMatches, MATCH_METRICS } = require('../services/matcher');

const makeStock = (ticker, overrides = {}) => ({
  ticker,
  companyName: `${ticker} Corp`,
  sector: 'Technology',
  price: 100,
  // Valuation
  peRatio: 20,
  priceToBook: 3.0,
  priceToSales: 2.5,
  evToEBITDA: 12.0,
  evToRevenue: 3.0,
  pegRatio: 1.5,
  earningsYield: 0.05,
  // Profitability
  grossMargin: 0.5,
  operatingMargin: 0.2,
  netMargin: 0.15,
  ebitdaMargin: 0.25,
  returnOnEquity: 0.18,
  returnOnAssets: 0.1,
  returnOnCapital: 0.14,
  // Growth
  revenueGrowthYoY: 0.2,
  revenueGrowth3yr: 0.18,
  epsGrowthYoY: 0.22,
  // Financial Health
  currentRatio: 1.8,
  debtToEquity: 0.5,
  interestCoverage: 8.0,
  netDebtToEBITDA: 1.2,
  freeCashFlowYield: 0.04,
  // Technical
  rsi14: 50,
  pctBelowHigh: 10,
  priceVsMa50: 2.0,
  priceVsMa200: 8.0,
  // Size (not in MATCH_METRICS but kept for compatibility)
  marketCap: 10_000_000_000,
  ...overrides,
});

describe('findMatches', () => {
  const snapshot = makeStock('TMPL');

  test('returns at most 10 results', () => {
    const universe = new Map();
    for (let i = 0; i < 20; i++) universe.set(`STK${i}`, makeStock(`STK${i}`));
    const results = findMatches(snapshot, universe);
    expect(results.length).toBeLessThanOrEqual(10);
  });

  test('results are sorted by matchScore descending', () => {
    const universe = new Map();
    for (let i = 0; i < 15; i++) {
      universe.set(`STK${i}`, makeStock(`STK${i}`, { peRatio: 20 + i * 3 }));
    }
    const results = findMatches(snapshot, universe);
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].matchScore).toBeGreaterThanOrEqual(results[i + 1].matchScore);
    }
  });

  test('excludes the snapshot ticker from results', () => {
    const universe = new Map();
    universe.set('TMPL', makeStock('TMPL'));
    universe.set('OTHER', makeStock('OTHER', { peRatio: 25 }));
    const results = findMatches(snapshot, universe);
    expect(results.find(r => r.ticker === 'TMPL')).toBeUndefined();
  });

  test('identical stock ranks first and scores higher than a divergent one', () => {
    const universe = new Map();
    universe.set('TWIN', makeStock('TWIN')); // identical to snapshot
    universe.set('DIFF', makeStock('DIFF', { peRatio: 999, grossMargin: 0.01, rsi14: 5 }));
    const results = findMatches(snapshot, universe);
    expect(results[0].ticker).toBe('TWIN');
    expect(results[0].matchScore).toBeGreaterThan(results[1].matchScore);
  });

  test('does not throw when metrics are null', () => {
    const universe = new Map();
    universe.set('SPARSE', makeStock('SPARSE', { peRatio: null, rsi14: null, grossMargin: null }));
    expect(() => findMatches(snapshot, universe)).not.toThrow();
  });

  test('each result has required shape', () => {
    const universe = new Map();
    universe.set('A', makeStock('A'));
    const results = findMatches(snapshot, universe);
    expect(results[0]).toMatchObject({
      ticker: expect.any(String),
      companyName: expect.any(String),
      sector: expect.any(String),
      price: expect.any(Number),
      matchScore: expect.any(Number),
      metricsCompared: expect.any(Number),
      topMatches: expect.any(Array),
      topDifferences: expect.any(Array),
    });
  });

  test('metricsCompared equals number of metrics with data on both sides', () => {
    const universe = new Map();
    // Stock with 3 metrics nulled out
    universe.set('SPARSE', makeStock('SPARSE', { peRatio: null, grossMargin: null, rsi14: null }));
    const results = findMatches(snapshot, universe);
    // snapshot has all 26 metrics; SPARSE has 23 non-null; 23 are comparable
    expect(results[0].metricsCompared).toBe(23);
  });
});

describe('findMatches — scoring', () => {
  test('stocks with different metric profiles score differently', () => {
    const universe = new Map();
    const snapshot = makeStock('SNAP');
    universe.set('GOOD', makeStock('GOOD'));
    universe.set('POOR', makeStock('POOR', { peRatio: 999, grossMargin: 0.01, revenueGrowthYoY: -0.5, returnOnEquity: 0.01 }));
    const results = findMatches(snapshot, universe);
    const goodScore = results.find(r => r.ticker === 'GOOD').matchScore;
    const poorScore = results.find(r => r.ticker === 'POOR').matchScore;
    expect(goodScore).toBeGreaterThan(poorScore);
  });

  test('identical stock with all metrics populated scores above 90', () => {
    const universe = new Map();
    universe.set('TWIN', makeStock('TWIN'));
    const snapshot = makeStock('TMPL2');
    const results = findMatches(snapshot, universe);
    expect(results[0].matchScore).toBeGreaterThan(90);
  });

  test('marketCap is not a property of MATCH_METRICS', () => {
    const { MATCH_METRICS } = require('../services/matcher');
    expect(MATCH_METRICS).not.toContain('marketCap');
  });

  test('findMatches does not throw when marketCap is absent from stock', () => {
    const universe = new Map();
    const stockWithoutMarketCap = { ...makeStock('NOMC') };
    delete stockWithoutMarketCap.marketCap;
    universe.set('NOMC', stockWithoutMarketCap);
    expect(() => findMatches(makeStock('SNAP'), universe)).not.toThrow();
  });
});

describe('findMatches — outlier resistance', () => {
  test('outlier stock does not inflate scores of normal stocks', () => {
    const universe = new Map();
    const icValues = [10, 15, 20, 25, 30, 35, 40, 45, 50, 5000];
    icValues.forEach((ic, i) => {
      universe.set(`S${i}`, makeStock(`S${i}`, { interestCoverage: ic }));
    });

    // Snapshot has interestCoverage of 20 — should match S2 (ic=20) best
    const snap = makeStock('SNAP', { interestCoverage: 20 });
    const results = findMatches(snap, universe);

    const s2 = results.find(r => r.ticker === 'S2'); // ic=20, identical to snap
    const s0 = results.find(r => r.ticker === 'S0'); // ic=10, divergent from snap

    // S9 is the extreme outlier (ic=5000). With old min/max normalization, every stock
    // compressed into [0, 0.01] and the outlier looked ~99% similar to everything.
    // With log transform + IQR, the outlier is correctly penalized — S2 (exact ic match)
    // should score higher than S9 (wildly divergent ic).
    const s9 = results.find(r => r.ticker === 'S9');
    expect(s2.matchScore).toBeGreaterThan(s9.matchScore);
  });

  test('scores show meaningful spread across varied universe', () => {
    const universe = new Map();
    universe.set('TWIN',  makeStock('TWIN'));
    universe.set('CLOSE', makeStock('CLOSE', { peRatio: 25, grossMargin: 0.48 }));
    universe.set('FAR',   makeStock('FAR',   { peRatio: 80, grossMargin: 0.1, revenueGrowthYoY: -0.3 }));

    const snap = makeStock('SNAP');
    const results = findMatches(snap, universe);

    const twin  = results.find(r => r.ticker === 'TWIN').matchScore;
    const close = results.find(r => r.ticker === 'CLOSE').matchScore;
    const far   = results.find(r => r.ticker === 'FAR').matchScore;

    expect(twin).toBeGreaterThan(close);
    expect(close).toBeGreaterThan(far);
    expect(twin - far).toBeGreaterThanOrEqual(5);
  });
});
