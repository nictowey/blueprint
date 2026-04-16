const momentumBreakout = require('../services/algorithms/momentumBreakout');
const {
  scoreProximityToHigh,
  scorePriceVsMa50,
  scorePriceVsMa200,
  scoreRsi,
  scoreRelativeVolume,
  combineScores,
  piecewise,
  SIGNAL_WEIGHTS,
  MIN_SIGNALS_REQUIRED,
} = momentumBreakout._test;

// A plausible "mid-breakout" stock. Individual tests override specific fields.
const makeStock = (ticker, overrides = {}) => ({
  ticker,
  companyName: `${ticker} Corp`,
  sector: 'Technology',
  price: 100,
  marketCap: 10_000_000_000,
  rsi14: 65,
  pctBelowHigh: 5,
  priceVsMa50: 0.15,
  priceVsMa200: 0.30,
  relativeVolume: 1.8,
  ...overrides,
});

describe('piecewise interpolator', () => {
  const pts = [[0, 0], [10, 1.0], [20, 0.5]];
  test('clamps below first breakpoint', () => {
    expect(piecewise(-5, pts)).toBe(0);
  });
  test('clamps above last breakpoint', () => {
    expect(piecewise(100, pts)).toBe(0.5);
  });
  test('interpolates linearly between breakpoints', () => {
    expect(piecewise(5, pts)).toBeCloseTo(0.5);
    expect(piecewise(15, pts)).toBeCloseTo(0.75);
  });
  test('returns null for null/NaN input', () => {
    expect(piecewise(null, pts)).toBeNull();
    expect(piecewise(NaN, pts)).toBeNull();
  });
});

describe('scoreProximityToHigh', () => {
  test('at the 52wk high scores 1.0', () => {
    expect(scoreProximityToHigh(0)).toBeCloseTo(1.0);
  });
  test('near the high (3%) scores 1.0', () => {
    expect(scoreProximityToHigh(3)).toBeCloseTo(1.0);
  });
  test('30% below the high scores low', () => {
    expect(scoreProximityToHigh(30)).toBeLessThan(0.2);
  });
  test('deep drawdown scores 0', () => {
    expect(scoreProximityToHigh(50)).toBe(0);
  });
});

describe('scorePriceVsMa50', () => {
  test('below MA scores 0', () => {
    expect(scorePriceVsMa50(-0.05)).toBe(0);
  });
  test('15% above MA is the sweet spot', () => {
    expect(scorePriceVsMa50(0.15)).toBeCloseTo(1.0);
  });
  test('heavily extended tapers', () => {
    expect(scorePriceVsMa50(0.60)).toBeLessThan(0.5);
  });
});

describe('scorePriceVsMa200', () => {
  test('below MA scores 0', () => {
    expect(scorePriceVsMa200(-0.10)).toBe(0);
  });
  test('30% above MA peaks at 1.0', () => {
    expect(scorePriceVsMa200(0.30)).toBeCloseTo(1.0);
  });
  test('tolerates larger extension than MA50', () => {
    // 60% above MA200 should still be strong; 60% above MA50 is penalized
    expect(scorePriceVsMa200(0.60)).toBeGreaterThan(scorePriceVsMa50(0.60));
  });
});

describe('scoreRsi', () => {
  test('RSI under 50 is not momentum', () => {
    expect(scoreRsi(40)).toBe(0);
  });
  test('sweet spot 68 scores 1.0', () => {
    expect(scoreRsi(68)).toBeCloseTo(1.0);
  });
  test('overbought RSI > 80 scores low', () => {
    expect(scoreRsi(85)).toBeLessThan(0.5);
  });
});

describe('scoreRelativeVolume', () => {
  test('drying volume scores 0', () => {
    expect(scoreRelativeVolume(0.5)).toBe(0);
  });
  test('2x avg is the sweet spot', () => {
    expect(scoreRelativeVolume(2.0)).toBeCloseTo(1.0);
  });
  test('extreme spike tapers (news-driven noise)', () => {
    expect(scoreRelativeVolume(10)).toBeLessThan(0.7);
  });
});

describe('combineScores', () => {
  test('full-coverage stock with all 1.0 scores = 100', () => {
    const scores = Object.fromEntries(Object.keys(SIGNAL_WEIGHTS).map(k => [k, 1.0]));
    expect(combineScores(scores)).toBeCloseTo(100);
  });
  test('full-coverage stock with all 0 scores = 0', () => {
    const scores = Object.fromEntries(Object.keys(SIGNAL_WEIGHTS).map(k => [k, 0]));
    expect(combineScores(scores)).toBe(0);
  });
  test('coverage below threshold returns null', () => {
    const scores = {
      pctBelowHigh: 1.0,
      priceVsMa50: 1.0,
      priceVsMa200: null,
      rsi14: null,
      relativeVolume: null,
    };
    expect(scores.pctBelowHigh != null && scores.priceVsMa50 != null).toBe(true);
    expect(combineScores(scores)).toBeNull();
  });
  test('partial coverage renormalizes over present weights', () => {
    // 3 signals present, all scoring 0.8 -> should return 80
    const scores = {
      pctBelowHigh: 0.8,
      priceVsMa50: 0.8,
      priceVsMa200: 0.8,
      rsi14: null,
      relativeVolume: null,
    };
    // Only 3 signals present — coverage threshold is 3, so this should pass
    expect(MIN_SIGNALS_REQUIRED).toBeLessThanOrEqual(3);
    expect(combineScores(scores)).toBeCloseTo(80);
  });
});

describe('rank — engine integration', () => {
  test('returns empty array for empty universe', () => {
    expect(momentumBreakout.rank({ universe: new Map() })).toEqual([]);
  });

  test('ranks a strong breakout setup above a weak one', () => {
    const universe = new Map();
    universe.set('HOT', makeStock('HOT', {
      rsi14: 68, pctBelowHigh: 2, priceVsMa50: 0.15, priceVsMa200: 0.30, relativeVolume: 2.0,
    }));
    universe.set('COLD', makeStock('COLD', {
      rsi14: 35, pctBelowHigh: 40, priceVsMa50: -0.10, priceVsMa200: -0.05, relativeVolume: 0.4,
    }));
    const results = momentumBreakout.rank({ universe });
    // HOT should score above COLD; COLD may be excluded by coverage but if
    // present must rank below HOT
    expect(results[0].ticker).toBe('HOT');
    expect(results[0].matchScore).toBeGreaterThan(results[results.length - 1].matchScore);
  });

  test('honors topN parameter', () => {
    const universe = new Map();
    for (let i = 0; i < 20; i++) {
      universe.set(`S${i}`, makeStock(`S${i}`, { rsi14: 60 + i % 10 }));
    }
    const results = momentumBreakout.rank({ universe, topN: 5 });
    expect(results.length).toBeLessThanOrEqual(5);
  });

  test('excludes non-investable tickers (preferred shares, warrants)', () => {
    const universe = new Map();
    universe.set('GOOD', makeStock('GOOD'));
    universe.set('BAD-WT', makeStock('BAD-WT')); // warrant
    universe.set('BAD-P', makeStock('BAD-P'));   // preferred share
    const results = momentumBreakout.rank({ universe });
    expect(results.map(r => r.ticker)).toEqual(['GOOD']);
  });

  test('excludes stocks flagged as stale', () => {
    const universe = new Map();
    universe.set('LIVE', makeStock('LIVE'));
    universe.set('DEAD', makeStock('DEAD', { _priceStale: true }));
    const results = momentumBreakout.rank({ universe });
    expect(results.map(r => r.ticker)).toEqual(['LIVE']);
  });

  test('excludes stocks missing too many signals', () => {
    const universe = new Map();
    universe.set('FULL', makeStock('FULL'));
    universe.set('SPARSE', makeStock('SPARSE', {
      rsi14: null, pctBelowHigh: null, priceVsMa50: null,
    }));
    const results = momentumBreakout.rank({ universe });
    expect(results.map(r => r.ticker)).toEqual(['FULL']);
  });

  test('result shape matches templateMatch for UI compatibility', () => {
    const universe = new Map();
    universe.set('X', makeStock('X'));
    const [result] = momentumBreakout.rank({ universe });
    expect(result).toMatchObject({
      ticker: 'X',
      companyName: expect.any(String),
      matchScore: expect.any(Number),
      metricsCompared: expect.any(Number),
      totalMetrics: expect.any(Number),
      categoryScores: expect.any(Object),
      confidence: expect.any(Number),
      topMatches: expect.any(Array),
      topDifferences: expect.any(Array),
      algorithm: 'momentumBreakout',
      signalScores: expect.any(Object),
    });
  });

  test('engine metadata is exported', () => {
    expect(momentumBreakout.key).toBe('momentumBreakout');
    expect(momentumBreakout.requiresTemplate).toBe(false);
    expect(typeof momentumBreakout.rank).toBe('function');
  });
});
