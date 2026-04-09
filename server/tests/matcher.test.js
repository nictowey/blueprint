const { findMatches, MATCH_METRICS } = require('../services/matcher');

const makeStock = (ticker, overrides = {}) => ({
  ticker,
  companyName: `${ticker} Corp`,
  sector: 'Technology',
  price: 100,
  peRatio: 20,
  priceToBook: 3.0,
  priceToSales: 2.5,
  evToEBITDA: 12.0,
  evToRevenue: 3.0,
  pegRatio: 1.5,
  earningsYield: 0.05,
  grossMargin: 0.5,
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
  rsi14: 50,
  pctBelowHigh: 10,
  priceVsMa50: 2.0,
  priceVsMa200: 8.0,
  beta: 1.2,
  marketCap: 10_000_000_000,
  ...overrides,
});

describe('findMatches — basic behavior', () => {
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

  test('does not throw when metrics are null', () => {
    const universe = new Map();
    universe.set('SPARSE', makeStock('SPARSE', { peRatio: null, rsi14: null, grossMargin: null }));
    expect(() => findMatches(snapshot, universe)).not.toThrow();
  });

  test('returns empty when snapshot has fewer than 4 metrics', () => {
    const sparse = { ticker: 'TMPL', peRatio: 20, grossMargin: 0.5, rsi14: 50 };
    const universe = new Map();
    universe.set('A', makeStock('A'));
    expect(findMatches(sparse, universe)).toEqual([]);
  });
});

describe('findMatches — percentage difference scoring', () => {
  test('identical stock scores 100', () => {
    const snapshot = makeStock('SNAP');
    const universe = new Map();
    universe.set('TWIN', makeStock('TWIN'));
    const results = findMatches(snapshot, universe);
    expect(results[0].matchScore).toBe(100);
  });

  test('stock with 10% higher P/E scores lower than identical stock', () => {
    const snapshot = makeStock('SNAP');
    const universe = new Map();
    universe.set('TWIN', makeStock('TWIN'));
    universe.set('CLOSE', makeStock('CLOSE', { peRatio: 22 }));
    const results = findMatches(snapshot, universe);
    const twin = results.find(r => r.ticker === 'TWIN');
    const close = results.find(r => r.ticker === 'CLOSE');
    expect(twin.matchScore).toBeGreaterThan(close.matchScore);
  });

  test('stock with doubled P/E scores much lower', () => {
    const snapshot = makeStock('SNAP', { peRatio: 50 });
    const universe = new Map();
    universe.set('CLOSE', makeStock('CLOSE', { peRatio: 55 }));
    universe.set('FAR', makeStock('FAR', { peRatio: 100 }));
    const results = findMatches(snapshot, universe);
    const close = results.find(r => r.ticker === 'CLOSE');
    const far = results.find(r => r.ticker === 'FAR');
    expect(close.matchScore).toBeGreaterThan(far.matchScore);
    expect(close.matchScore - far.matchScore).toBeGreaterThanOrEqual(1);
  });

  test('sector does NOT affect scoring', () => {
    const snapshot = makeStock('SNAP', { sector: 'Technology' });
    const universe = new Map();
    universe.set('SAME', makeStock('SAME', { sector: 'Technology' }));
    universe.set('DIFF', makeStock('DIFF', { sector: 'Healthcare' }));
    const results = findMatches(snapshot, universe);
    const same = results.find(r => r.ticker === 'SAME');
    const diff = results.find(r => r.ticker === 'DIFF');
    expect(same.matchScore).toBe(diff.matchScore);
  });

  test('marketCap uses log-scale comparison', () => {
    const snapshot = makeStock('SNAP', { marketCap: 10_000_000_000 });
    const universe = new Map();
    universe.set('DOUBLE', makeStock('DOUBLE', { marketCap: 20_000_000_000 }));
    universe.set('TENFOLD', makeStock('TENFOLD', { marketCap: 100_000_000_000 }));
    const results = findMatches(snapshot, universe);
    const dbl = results.find(r => r.ticker === 'DOUBLE');
    const tenX = results.find(r => r.ticker === 'TENFOLD');
    expect(dbl.matchScore).toBeGreaterThan(tenX.matchScore);
  });

  test('metricsCompared equals number of metrics with data on both sides', () => {
    const snapshot = makeStock('SNAP');
    const universe = new Map();
    universe.set('SPARSE', makeStock('SPARSE', { peRatio: null, grossMargin: null, rsi14: null }));
    const results = findMatches(snapshot, universe);
    expect(results[0].metricsCompared).toBe(25);
  });

  test('overlap penalty reduces score for sparse matches', () => {
    const snapshot = makeStock('SNAP');
    const universe = new Map();
    universe.set('FULL', makeStock('FULL'));
    universe.set('SPARSE', makeStock('SPARSE', {
      peRatio: null, priceToBook: null, priceToSales: null,
      evToEBITDA: null, evToRevenue: null, pegRatio: null,
      earningsYield: null, rsi14: null, pctBelowHigh: null,
    }));
    const results = findMatches(snapshot, universe);
    const full = results.find(r => r.ticker === 'FULL');
    const sparse = results.find(r => r.ticker === 'SPARSE');
    expect(full.matchScore).toBeGreaterThan(sparse.matchScore);
  });

  test('filters out stocks below 60% overlap', () => {
    const snapshot = makeStock('SNAP');
    const universe = new Map();
    universe.set('TOOSPARSE', {
      ticker: 'TOOSPARSE', companyName: 'Too Sparse', sector: 'Tech', price: 100,
      peRatio: 20, grossMargin: 0.5, revenueGrowthYoY: 0.2, rsi14: 50,
      currentRatio: 1.8, debtToEquity: 0.5, netMargin: 0.15, operatingMargin: 0.2,
    });
    const results = findMatches(snapshot, universe);
    expect(results.find(r => r.ticker === 'TOOSPARSE')).toBeUndefined();
  });

  test('opposite sign values score 0% similarity for that metric', () => {
    const snapshot = makeStock('SNAP', { revenueGrowthYoY: 0.30 });
    const universe = new Map();
    universe.set('NEG', makeStock('NEG', { revenueGrowthYoY: -0.30 }));
    const results = findMatches(snapshot, universe);
    const neg = results.find(r => r.ticker === 'NEG');
    expect(neg.topDifferences).toContain('revenueGrowthYoY');
  });
});

describe('findMatches — MATCH_METRICS', () => {
  test('marketCap is included in MATCH_METRICS', () => {
    expect(MATCH_METRICS).toContain('marketCap');
  });

  test('MATCH_METRICS has 28 entries', () => {
    expect(MATCH_METRICS).toHaveLength(28);
  });

  test('beta is included in MATCH_METRICS', () => {
    expect(MATCH_METRICS).toContain('beta');
  });
});
