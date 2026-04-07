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
      topMatches: expect.any(Array),
      topDifferences: expect.any(Array),
    });
  });
});

describe('findMatches — fixed denominator scoring', () => {
  test('sparse snapshot (5 metrics) scores lower than rich snapshot (20 metrics)', () => {
    const universe = new Map();
    universe.set('CANDIDATE', makeStock('CANDIDATE'));

    // Sparse: only 5 metrics populated on snapshot
    const sparseSnap = {
      ticker: 'SPARSE', sector: 'Technology',
      peRatio: 20, grossMargin: 0.5, revenueGrowthYoY: 0.2, rsi14: 50, pctBelowHigh: 10,
      priceToBook: null, priceToSales: null, evToEBITDA: null, evToRevenue: null,
      pegRatio: null, earningsYield: null, operatingMargin: null, netMargin: null,
      ebitdaMargin: null, returnOnEquity: null, returnOnAssets: null, returnOnCapital: null,
      revenueGrowth3yr: null, epsGrowthYoY: null, currentRatio: null, debtToEquity: null,
      interestCoverage: null, netDebtToEBITDA: null, freeCashFlowYield: null,
      priceVsMa50: null, priceVsMa200: null,
    };

    // Rich: all metrics populated on snapshot (identical values to CANDIDATE)
    const richSnap = makeStock('RICH');

    const sparseResults = findMatches(sparseSnap, universe);
    const richResults = findMatches(richSnap, universe);

    expect(sparseResults[0].matchScore).toBeLessThan(richResults[0].matchScore);
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
