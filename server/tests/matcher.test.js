const { findMatches } = require('../services/matcher');

const makeStock = (ticker, overrides = {}) => ({
  ticker,
  companyName: `${ticker} Corp`,
  sector: 'Technology',
  price: 100,
  peRatio: 20,
  revenueGrowthYoY: 0.2,
  grossMargin: 0.5,
  marketCap: 10_000_000_000,
  rsi14: 50,
  pctBelowHigh: 10,
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

  test('perfect match scores 100', () => {
    const universe = new Map();
    universe.set('TWIN', makeStock('TWIN')); // identical to snapshot
    const results = findMatches(snapshot, universe);
    expect(results[0].matchScore).toBe(100);
  });

  test('does not throw when metrics are null', () => {
    const universe = new Map();
    universe.set('SPARSE', makeStock('SPARSE', { peRatio: null, rsi14: null, grossMargin: null }));
    expect(() => findMatches(snapshot, universe)).not.toThrow();
  });

  test('topMatches contains 3 metric keys', () => {
    const universe = new Map();
    universe.set('CLOSE', makeStock('CLOSE'));
    const results = findMatches(snapshot, universe);
    expect(results[0].topMatches).toHaveLength(3);
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
