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

  test('results are sorted by similarity descending', () => {
    const universe = new Map();
    for (let i = 0; i < 15; i++) {
      universe.set(`STK${i}`, makeStock(`STK${i}`, { peRatio: 20 + i * 3 }));
    }
    const results = findMatches(snapshot, universe);
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].similarity).toBeGreaterThanOrEqual(results[i + 1].similarity);
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
    expect(results[0].similarity).toBeGreaterThan(results[1].similarity);
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
      similarity: expect.any(Number),
    });
  });
});
