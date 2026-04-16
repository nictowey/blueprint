// Mock the catalyst cache BEFORE requiring the engine — the engine imports
// `getCatalystSnapshot` at module load time, so the mock must be installed
// first. Tests seed per-ticker snapshots via `seedSnapshot` below.
jest.mock('../services/catalystSnapshot', () => {
  const snapshots = new Map();
  return {
    __snapshots: snapshots,
    getCatalystSnapshot: jest.fn((ticker) => snapshots.get(ticker) || null),
    // Other exports from the real module aren't needed by the engine,
    // but stub them out so any accidental import doesn't crash.
    populateCatalystCache: jest.fn().mockResolvedValue({ fetched: 0, failed: 0, skipped: 0 }),
    getCatalystCacheStatus: jest.fn().mockReturnValue({ size: 0, ttlMs: 0, lastBuild: null }),
  };
});

const catalystDriven = require('../services/algorithms/catalystDriven');
const catalystSnapshotMock = require('../services/catalystSnapshot');
const {
  signalToContribution,
  computeContributions,
  combineScores,
  SIGNAL_WEIGHTS,
  MIN_SIGNALS_REQUIRED,
} = catalystDriven._test;

// Build a snapshot entry in the shape the real catalystSnapshot emits.
function makeSnapshot(ticker, signals) {
  return {
    ticker,
    fetchedAt: Date.now(),
    earnings: [],
    gradesHistorical: [],
    insiderTrading: [],
    signals: {
      earningsSurprise: null,
      estimateRevisions: null,
      insiderBuying: null,
      ...signals,
    },
  };
}

function seedSnapshot(ticker, signals) {
  catalystSnapshotMock.__snapshots.set(ticker, makeSnapshot(ticker, signals));
}

function resetSnapshots() {
  catalystSnapshotMock.__snapshots.clear();
}

// A plausible investable stock. Individual tests override specific fields.
const makeStock = (ticker, overrides = {}) => ({
  ticker,
  companyName: `${ticker} Corp`,
  sector: 'Technology',
  price: 100,
  marketCap: 10_000_000_000,
  ...overrides,
});

beforeEach(() => {
  resetSnapshots();
  catalystSnapshotMock.getCatalystSnapshot.mockClear();
});

// ---------------------------------------------------------------------------
// signalToContribution
// ---------------------------------------------------------------------------

describe('signalToContribution', () => {
  test('maps +1 to 1.0', () => {
    expect(signalToContribution(1)).toBeCloseTo(1.0);
  });
  test('maps 0 to 0.5 (neutral)', () => {
    expect(signalToContribution(0)).toBeCloseTo(0.5);
  });
  test('maps -1 to 0', () => {
    expect(signalToContribution(-1)).toBeCloseTo(0);
  });
  test('maps +0.5 to 0.75', () => {
    expect(signalToContribution(0.5)).toBeCloseTo(0.75);
  });
  test('clamps >1 to 1.0', () => {
    expect(signalToContribution(1.5)).toBeCloseTo(1.0);
  });
  test('clamps <-1 to 0', () => {
    expect(signalToContribution(-1.5)).toBeCloseTo(0);
  });
  test('returns null for null / NaN / Infinity', () => {
    expect(signalToContribution(null)).toBeNull();
    expect(signalToContribution(undefined)).toBeNull();
    expect(signalToContribution(NaN)).toBeNull();
    expect(signalToContribution(Infinity)).toBeNull();
    expect(signalToContribution(-Infinity)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeContributions
// ---------------------------------------------------------------------------

describe('computeContributions', () => {
  test('maps all three raw signals to contributions', () => {
    const c = computeContributions({
      earningsSurprise: 1.0,
      estimateRevisions: 0.0,
      insiderBuying: -1.0,
    });
    expect(c.earningsSurprise).toBeCloseTo(1.0);
    expect(c.estimateRevisions).toBeCloseTo(0.5);
    expect(c.insiderBuying).toBeCloseTo(0);
  });
  test('passes nulls through', () => {
    const c = computeContributions({
      earningsSurprise: null,
      estimateRevisions: null,
      insiderBuying: null,
    });
    expect(c).toEqual({
      earningsSurprise: null,
      estimateRevisions: null,
      insiderBuying: null,
    });
  });
  test('tolerates a null/undefined signals object', () => {
    expect(computeContributions(null)).toEqual({
      earningsSurprise: null,
      estimateRevisions: null,
      insiderBuying: null,
    });
    expect(computeContributions(undefined)).toEqual({
      earningsSurprise: null,
      estimateRevisions: null,
      insiderBuying: null,
    });
  });
});

// ---------------------------------------------------------------------------
// combineScores
// ---------------------------------------------------------------------------

describe('combineScores', () => {
  test('all 3 contributions = 1.0 → 100', () => {
    const c = Object.fromEntries(Object.keys(SIGNAL_WEIGHTS).map(k => [k, 1.0]));
    expect(combineScores(c)).toBeCloseTo(100);
  });
  test('all 3 contributions = 0 → 0 (all signals at -1 raw)', () => {
    const c = Object.fromEntries(Object.keys(SIGNAL_WEIGHTS).map(k => [k, 0]));
    expect(combineScores(c)).toBe(0);
  });
  test('all 3 contributions = 0.5 (neutral raw signal) → 50', () => {
    const c = Object.fromEntries(Object.keys(SIGNAL_WEIGHTS).map(k => [k, 0.5]));
    expect(combineScores(c)).toBeCloseTo(50);
  });
  test('insufficient coverage (only 1 signal) returns null', () => {
    const c = {
      earningsSurprise: 1.0,
      estimateRevisions: null,
      insiderBuying: null,
    };
    expect(MIN_SIGNALS_REQUIRED).toBe(2);
    expect(combineScores(c)).toBeNull();
  });
  test('zero signals returns null', () => {
    expect(combineScores({
      earningsSurprise: null,
      estimateRevisions: null,
      insiderBuying: null,
    })).toBeNull();
  });
  test('partial coverage (2 of 3) renormalizes over present weights', () => {
    // earningsSurprise (0.40) = 0.8, estimateRevisions (0.35) = 0.8, insiderBuying = null
    // weighted = 0.40*0.8 + 0.35*0.8 = 0.6; weightTotal = 0.75; normalized = 0.8 → 80
    const c = {
      earningsSurprise: 0.8,
      estimateRevisions: 0.8,
      insiderBuying: null,
    };
    expect(combineScores(c)).toBeCloseTo(80);
  });
  test('weight rebalancing matters: higher-weight signal dominates', () => {
    // earningsSurprise (0.40) = 1.0, estimateRevisions (0.35) = 0 → weighted = 0.40, total = 0.75
    // normalized = 0.40 / 0.75 = 0.533... → 53.33
    const c = {
      earningsSurprise: 1.0,
      estimateRevisions: 0.0,
      insiderBuying: null,
    };
    expect(combineScores(c)).toBeCloseTo(53.333, 1);
  });
  test('weights sum to 1.0 (sanity on coefficient table)', () => {
    const total = Object.values(SIGNAL_WEIGHTS).reduce((s, w) => s + w, 0);
    expect(total).toBeCloseTo(1.0);
  });
});

// ---------------------------------------------------------------------------
// rank — engine integration
// ---------------------------------------------------------------------------

describe('rank — engine integration', () => {
  test('returns empty array for empty universe', () => {
    expect(catalystDriven.rank({ universe: new Map() })).toEqual([]);
  });

  test('returns empty array for undefined universe', () => {
    expect(catalystDriven.rank({})).toEqual([]);
  });

  test('ranks a high-catalyst stock above a low-catalyst one', () => {
    seedSnapshot('HOT', {
      earningsSurprise: 1.0,
      estimateRevisions: 1.0,
      insiderBuying: 1.0,
    });
    seedSnapshot('COLD', {
      earningsSurprise: -1.0,
      estimateRevisions: -1.0,
      insiderBuying: -1.0,
    });
    const universe = new Map();
    universe.set('HOT', makeStock('HOT'));
    universe.set('COLD', makeStock('COLD'));

    const results = catalystDriven.rank({ universe });
    expect(results[0].ticker).toBe('HOT');
    expect(results[0].matchScore).toBeGreaterThan(results[results.length - 1].matchScore);
  });

  test('honors topN parameter', () => {
    const universe = new Map();
    for (let i = 0; i < 20; i++) {
      const t = `S${i}`;
      seedSnapshot(t, {
        earningsSurprise: Math.random() * 2 - 1,
        estimateRevisions: Math.random() * 2 - 1,
        insiderBuying: Math.random() * 2 - 1,
      });
      universe.set(t, makeStock(t));
    }
    const results = catalystDriven.rank({ universe, topN: 5 });
    expect(results.length).toBe(5);
  });

  test('excludes non-investable tickers (preferred shares, warrants)', () => {
    seedSnapshot('GOOD', { earningsSurprise: 1.0, estimateRevisions: 1.0, insiderBuying: 1.0 });
    seedSnapshot('BAD-WT', { earningsSurprise: 1.0, estimateRevisions: 1.0, insiderBuying: 1.0 });
    seedSnapshot('BAD-P', { earningsSurprise: 1.0, estimateRevisions: 1.0, insiderBuying: 1.0 });
    const universe = new Map();
    universe.set('GOOD', makeStock('GOOD'));
    universe.set('BAD-WT', makeStock('BAD-WT'));
    universe.set('BAD-P', makeStock('BAD-P'));

    const results = catalystDriven.rank({ universe });
    expect(results.map(r => r.ticker)).toEqual(['GOOD']);
  });

  test('excludes stocks flagged as stale', () => {
    seedSnapshot('LIVE', { earningsSurprise: 1.0, estimateRevisions: 1.0, insiderBuying: 1.0 });
    seedSnapshot('DEAD', { earningsSurprise: 1.0, estimateRevisions: 1.0, insiderBuying: 1.0 });
    const universe = new Map();
    universe.set('LIVE', makeStock('LIVE'));
    universe.set('DEAD', makeStock('DEAD', { _priceStale: true }));

    const results = catalystDriven.rank({ universe });
    expect(results.map(r => r.ticker)).toEqual(['LIVE']);
  });

  test('excludes stocks with no snapshot in cache', () => {
    seedSnapshot('WITH', { earningsSurprise: 1.0, estimateRevisions: 1.0, insiderBuying: 1.0 });
    // WITHOUT: no seedSnapshot call → getCatalystSnapshot returns null → all signals null
    const universe = new Map();
    universe.set('WITH', makeStock('WITH'));
    universe.set('WITHOUT', makeStock('WITHOUT'));

    const results = catalystDriven.rank({ universe });
    expect(results.map(r => r.ticker)).toEqual(['WITH']);
  });

  test('excludes stocks with <MIN_SIGNALS_REQUIRED signals present', () => {
    seedSnapshot('FULL', { earningsSurprise: 1.0, estimateRevisions: 1.0, insiderBuying: 1.0 });
    // SPARSE only has 1 signal — below MIN_SIGNALS_REQUIRED = 2
    seedSnapshot('SPARSE', { earningsSurprise: 1.0, estimateRevisions: null, insiderBuying: null });
    const universe = new Map();
    universe.set('FULL', makeStock('FULL'));
    universe.set('SPARSE', makeStock('SPARSE'));

    const results = catalystDriven.rank({ universe });
    expect(results.map(r => r.ticker)).toEqual(['FULL']);
  });

  test('includes stocks with exactly MIN_SIGNALS_REQUIRED signals (partial)', () => {
    seedSnapshot('PARTIAL', {
      earningsSurprise: 0.5,
      estimateRevisions: 0.5,
      insiderBuying: null,
    });
    const universe = new Map();
    universe.set('PARTIAL', makeStock('PARTIAL'));

    const results = catalystDriven.rank({ universe });
    expect(results).toHaveLength(1);
    expect(results[0].ticker).toBe('PARTIAL');
    expect(results[0].confidence.level).toBe('adequate');
    expect(results[0].metricsCompared).toBe(2);
  });

  test('result shape matches momentumBreakout for UI compatibility', () => {
    seedSnapshot('X', { earningsSurprise: 0.8, estimateRevisions: 0.4, insiderBuying: 1.0 });
    const universe = new Map();
    universe.set('X', makeStock('X'));

    const [result] = catalystDriven.rank({ universe });
    expect(result).toMatchObject({
      ticker: 'X',
      companyName: expect.any(String),
      matchScore: expect.any(Number),
      metricsCompared: expect.any(Number),
      totalMetrics: 3,
      categoryScores: expect.objectContaining({ catalyst: expect.any(Number) }),
      confidence: expect.objectContaining({
        level: expect.stringMatching(/^(complete|adequate|sparse)$/),
        coverageRatio: expect.any(Number),
        metricsAvailable: expect.any(Number),
      }),
      topMatches: expect.any(Array),
      topDifferences: expect.any(Array),
      algorithm: 'catalystDriven',
      signalScores: expect.objectContaining({
        earningsSurprise: expect.any(Number),
        estimateRevisions: expect.any(Number),
        insiderBuying: expect.any(Number),
      }),
    });
    // _rawScore is internal — must be stripped from the final output
    expect(result._rawScore).toBeUndefined();
  });

  test('signalScores surface raw [-1, +1] signals (not 0..1 contributions)', () => {
    seedSnapshot('X', { earningsSurprise: -0.5, estimateRevisions: 0.5, insiderBuying: 1.0 });
    // Even with a negative signal, the 2-of-3 coverage gate is met and the
    // stock is in the output — check the raw values are surfaced.
    const universe = new Map();
    universe.set('X', makeStock('X'));

    const [result] = catalystDriven.rank({ universe });
    expect(result.signalScores.earningsSurprise).toBeCloseTo(-0.5);
    expect(result.signalScores.estimateRevisions).toBeCloseTo(0.5);
    expect(result.signalScores.insiderBuying).toBeCloseTo(1.0);
  });

  test('confidence.level reflects signal coverage', () => {
    seedSnapshot('C', { earningsSurprise: 1.0, estimateRevisions: 1.0, insiderBuying: 1.0 });
    seedSnapshot('A', { earningsSurprise: 1.0, estimateRevisions: 1.0, insiderBuying: null });
    const universe = new Map();
    universe.set('C', makeStock('C'));
    universe.set('A', makeStock('A'));

    const results = catalystDriven.rank({ universe });
    const byTicker = Object.fromEntries(results.map(r => [r.ticker, r]));
    expect(byTicker.C.confidence.level).toBe('complete');
    expect(byTicker.C.confidence.coverageRatio).toBe(100);
    expect(byTicker.A.confidence.level).toBe('adequate');
    expect(byTicker.A.confidence.coverageRatio).toBe(67);
  });

  test('topMatches and topDifferences do not overlap', () => {
    seedSnapshot('X', { earningsSurprise: 1.0, estimateRevisions: 0.0, insiderBuying: -0.5 });
    const universe = new Map();
    universe.set('X', makeStock('X'));

    const [result] = catalystDriven.rank({ universe });
    const inTop = new Set(result.topMatches);
    for (const s of result.topDifferences) {
      expect(inTop.has(s)).toBe(false);
    }
  });

  test('engine metadata is exported', () => {
    expect(catalystDriven.key).toBe('catalystDriven');
    expect(typeof catalystDriven.name).toBe('string');
    expect(typeof catalystDriven.description).toBe('string');
    expect(catalystDriven.requiresTemplate).toBe(false);
    expect(typeof catalystDriven.rank).toBe('function');
  });

  test('engine is template-free (template arg is ignored, does not throw)', () => {
    seedSnapshot('X', { earningsSurprise: 1.0, estimateRevisions: 1.0, insiderBuying: 1.0 });
    const universe = new Map();
    universe.set('X', makeStock('X'));

    // Passing a template object should not change behavior
    const withTemplate = catalystDriven.rank({ universe, template: { ticker: 'REF' } });
    const withoutTemplate = catalystDriven.rank({ universe });
    expect(withTemplate).toEqual(withoutTemplate);
  });

  test('matchScore is rounded to 1 decimal place', () => {
    // Choose values that produce an irrational score, confirm rounding
    seedSnapshot('X', { earningsSurprise: 0.33, estimateRevisions: 0.67, insiderBuying: 0.21 });
    const universe = new Map();
    universe.set('X', makeStock('X'));

    const [result] = catalystDriven.rank({ universe });
    // Scores should not have more than 1 decimal of precision
    const rounded = Math.round(result.matchScore * 10) / 10;
    expect(result.matchScore).toBe(rounded);
  });
});
