const ensembleConsensus = require('../services/algorithms/ensembleConsensus');
const registry = require('../services/algorithms/registry');
// Importing ./algorithms triggers registration of the real engines; tests
// that care about that rely on the registry being fully populated.
require('../services/algorithms');

const { resolveEngines, mergeRrf, buildConfidence, RRF_K } = ensembleConsensus._test;

// ---------------------------------------------------------------------------
// Fixtures: fake stocks + fake engines that rank them deterministically.
//
// Integration tests use a small helper that registers fake engines on the
// real registry inside beforeEach and unregisters them in afterEach. This
// replaces the old `options._engines` test hook — ensembleConsensus no
// longer exposes a back door; tests exercise the real code path.
// ---------------------------------------------------------------------------

const makeStock = (ticker, overrides = {}) => ({
  ticker,
  companyName: `${ticker} Corp`,
  sector: 'Technology',
  price: 100,
  marketCap: 10_000_000_000,
  ...overrides,
});

const makeUniverse = (tickers) => {
  const m = new Map();
  for (const t of tickers) m.set(t, makeStock(t));
  return m;
};

/**
 * Build a fake engine that returns a fixed ordered list of tickers, each with
 * a dummy matchScore. Used as a stand-in for component engines during tests.
 */
function fakeEngine(key, orderedTickers, { requiresTemplate = false } = {}) {
  return {
    key,
    name: `Fake ${key}`,
    description: 'test engine',
    requiresTemplate,
    rank: ({ universe, topN = 10 }) => {
      const out = [];
      for (const t of orderedTickers) {
        if (universe.has(t)) {
          const stock = universe.get(t);
          out.push({
            ...stock,
            algorithm: key,
            matchScore: 50 + (orderedTickers.length - out.length),
          });
        }
        if (out.length >= topN) break;
      }
      return out;
    },
  };
}

/**
 * Install a set of fake engines on the real registry, first removing the
 * real component engines so they don't leak into merge results. Returns a
 * cleanup function that restores the pre-test registry state.
 *
 * ensembleConsensus itself stays registered — we want the SUT untouched.
 */
function withFakeRegistry(fakeEngines) {
  const REAL_ENGINE_KEYS = ['templateMatch', 'momentumBreakout', 'catalystDriven'];
  const snapshot = {};
  for (const key of REAL_ENGINE_KEYS) {
    if (registry.ENGINES[key]) {
      snapshot[key] = registry.ENGINES[key];
      registry.unregister(key);
    }
  }
  const fakeKeys = [];
  for (const engine of fakeEngines) {
    registry.register(engine);
    fakeKeys.push(engine.key);
  }
  return () => {
    for (const key of fakeKeys) registry.unregister(key);
    for (const [key, engine] of Object.entries(snapshot)) registry.register(engine);
  };
}

// ---------------------------------------------------------------------------
// resolveEngines — which engines run for a given call
// ---------------------------------------------------------------------------

describe('resolveEngines', () => {
  const enginesMap = {
    templateMatch: { key: 'templateMatch', requiresTemplate: true, rank: () => [] },
    momentumBreakout: { key: 'momentumBreakout', requiresTemplate: false, rank: () => [] },
    catalystDriven: { key: 'catalystDriven', requiresTemplate: false, rank: () => [] },
    ensembleConsensus: { key: 'ensembleConsensus', requiresTemplate: false, rank: () => [] },
  };

  test('default template-free: excludes templateMatch and ensembleConsensus', () => {
    const engines = resolveEngines({ enginesMap, template: null, options: {} });
    const keys = engines.map(e => e.key).sort();
    expect(keys).toEqual(['catalystDriven', 'momentumBreakout']);
  });

  test('default with template: includes templateMatch', () => {
    const engines = resolveEngines({ enginesMap, template: { ticker: 'NVDA' }, options: {} });
    const keys = engines.map(e => e.key).sort();
    expect(keys).toEqual(['catalystDriven', 'momentumBreakout', 'templateMatch']);
  });

  test('explicit options.engines overrides default', () => {
    const engines = resolveEngines({
      enginesMap,
      template: null,
      options: { engines: ['momentumBreakout'] },
    });
    expect(engines.map(e => e.key)).toEqual(['momentumBreakout']);
  });

  test('unknown engine key throws', () => {
    expect(() => resolveEngines({
      enginesMap,
      template: null,
      options: { engines: ['doesNotExist'] },
    })).toThrow(/Unknown engine key/);
  });

  test('template-required engine without template throws', () => {
    expect(() => resolveEngines({
      enginesMap,
      template: null,
      options: { engines: ['templateMatch', 'momentumBreakout'] },
    })).toThrow(/requires a template/);
  });

  test('ensembleConsensus cannot include itself', () => {
    expect(() => resolveEngines({
      enginesMap,
      template: null,
      options: { engines: ['ensembleConsensus'] },
    })).toThrow(/cannot include itself/);
  });
});

// ---------------------------------------------------------------------------
// mergeRrf — the core math
// ---------------------------------------------------------------------------

describe('mergeRrf', () => {
  test('stock at rank 1 in two engines beats stock at rank 1 in one', () => {
    const engineResults = {
      A: {
        results: [makeStock('BOTH'), makeStock('ONLY_A')],
        rankByTicker: new Map([['BOTH', 1], ['ONLY_A', 2]]),
        scoreByTicker: new Map([['BOTH', 90], ['ONLY_A', 80]]),
      },
      B: {
        results: [makeStock('BOTH'), makeStock('ONLY_B')],
        rankByTicker: new Map([['BOTH', 1], ['ONLY_B', 2]]),
        scoreByTicker: new Map([['BOTH', 92], ['ONLY_B', 82]]),
      },
    };
    const merged = mergeRrf({ engineResults, engineKeys: ['A', 'B'], minEngines: 1 });
    // BOTH: 1/(60+1) + 1/(60+1) ≈ 0.0328
    // ONLY_A: 1/(60+2) ≈ 0.0161
    expect(merged[0].ticker).toBe('BOTH');
    expect(merged[0].rrfScore).toBeCloseTo(2 / (RRF_K + 1), 6);
    expect(merged[0].consensusEngines).toBe(2);
  });

  test('stock appearing in only 1 engine is dropped when minEngines=2', () => {
    const engineResults = {
      A: {
        results: [makeStock('SOLO')],
        rankByTicker: new Map([['SOLO', 1]]),
        scoreByTicker: new Map([['SOLO', 90]]),
      },
      B: {
        results: [makeStock('OTHER')],
        rankByTicker: new Map([['OTHER', 1]]),
        scoreByTicker: new Map([['OTHER', 90]]),
      },
    };
    const merged = mergeRrf({ engineResults, engineKeys: ['A', 'B'], minEngines: 2 });
    expect(merged).toEqual([]);
  });

  test('stock in all engines ranks higher than stock in some', () => {
    const engineResults = {
      A: {
        results: [makeStock('ALL'), makeStock('TWO')],
        rankByTicker: new Map([['ALL', 1], ['TWO', 2]]),
        scoreByTicker: new Map([['ALL', 90], ['TWO', 80]]),
      },
      B: {
        results: [makeStock('ALL'), makeStock('TWO')],
        rankByTicker: new Map([['ALL', 1], ['TWO', 2]]),
        scoreByTicker: new Map([['ALL', 90], ['TWO', 80]]),
      },
      C: {
        results: [makeStock('ALL')],
        rankByTicker: new Map([['ALL', 1]]),
        scoreByTicker: new Map([['ALL', 90]]),
      },
    };
    const merged = mergeRrf({ engineResults, engineKeys: ['A', 'B', 'C'], minEngines: 2 });
    expect(merged[0].ticker).toBe('ALL');
    expect(merged[0].consensusEngines).toBe(3);
    expect(merged[1].ticker).toBe('TWO');
    expect(merged[1].consensusEngines).toBe(2);
  });

  test('tied RRF scores sort deterministically by ticker', () => {
    const engineResults = {
      A: {
        results: [makeStock('BBB'), makeStock('AAA')],
        rankByTicker: new Map([['BBB', 1], ['AAA', 2]]),
        scoreByTicker: new Map([['BBB', 90], ['AAA', 80]]),
      },
      B: {
        results: [makeStock('AAA'), makeStock('BBB')],
        rankByTicker: new Map([['AAA', 1], ['BBB', 2]]),
        scoreByTicker: new Map([['AAA', 80], ['BBB', 90]]),
      },
    };
    const merged = mergeRrf({ engineResults, engineKeys: ['A', 'B'], minEngines: 2 });
    // Both stocks: 1/(60+1) + 1/(60+2) — tied
    expect(merged[0].rrfScore).toBeCloseTo(merged[1].rrfScore, 6);
    // Alphabetical tie-break
    expect(merged[0].ticker).toBe('AAA');
    expect(merged[1].ticker).toBe('BBB');
  });
});

// ---------------------------------------------------------------------------
// buildConfidence — UI-compatible confidence shape
// ---------------------------------------------------------------------------

describe('buildConfidence', () => {
  test('all engines included → complete', () => {
    const c = buildConfidence(3, 3);
    expect(c).toEqual({ level: 'complete', coverageRatio: 100, metricsAvailable: 3 });
  });

  test('2 of 3 engines (66.7%) → adequate', () => {
    const c = buildConfidence(2, 3);
    expect(c.level).toBe('adequate');
    expect(c.coverageRatio).toBe(67);
    expect(c.metricsAvailable).toBe(2);
  });

  test('1 of 3 engines (33.3%) → sparse', () => {
    const c = buildConfidence(1, 3);
    expect(c.level).toBe('sparse');
    expect(c.coverageRatio).toBe(33);
    expect(c.metricsAvailable).toBe(1);
  });

  test('2 of 2 engines → complete (all included)', () => {
    const c = buildConfidence(2, 2);
    expect(c.level).toBe('complete');
    expect(c.coverageRatio).toBe(100);
  });

  test('degenerate zero total engines → sparse, 0 coverage', () => {
    const c = buildConfidence(0, 0);
    expect(c).toEqual({ level: 'sparse', coverageRatio: 0, metricsAvailable: 0 });
  });
});

// ---------------------------------------------------------------------------
// rank — full engine integration (with fake engines registered for the test)
// ---------------------------------------------------------------------------

describe('rank — engine integration', () => {
  let cleanup;
  afterEach(() => {
    if (cleanup) cleanup();
    cleanup = null;
  });

  test('empty universe returns []', () => {
    cleanup = withFakeRegistry([
      fakeEngine('E1', ['A', 'B']),
      fakeEngine('E2', ['A', 'B']),
    ]);
    expect(ensembleConsensus.rank({ universe: new Map() })).toEqual([]);
  });

  test('basic merge: consensus stock wins over single-engine stock', () => {
    const universe = makeUniverse(['BOTH', 'ONLY1', 'ONLY2']);
    cleanup = withFakeRegistry([
      fakeEngine('E1', ['BOTH', 'ONLY1']),
      fakeEngine('E2', ['BOTH', 'ONLY2']),
    ]);
    const results = ensembleConsensus.rank({ universe });
    expect(results.length).toBe(1);
    expect(results[0].ticker).toBe('BOTH');
  });

  test('respects minEngines option', () => {
    const universe = makeUniverse(['A', 'B', 'C']);
    cleanup = withFakeRegistry([
      fakeEngine('E1', ['A', 'B']),
      fakeEngine('E2', ['B', 'C']),
      fakeEngine('E3', ['B']),
    ]);
    // minEngines=3: only B qualifies
    const strict = ensembleConsensus.rank({ universe, options: { minEngines: 3 } });
    expect(strict.map(r => r.ticker)).toEqual(['B']);
    // minEngines=1: all three qualify
    const loose = ensembleConsensus.rank({ universe, options: { minEngines: 1 } });
    expect(loose.length).toBe(3);
  });

  test('honors topN', () => {
    const universe = makeUniverse(['A', 'B', 'C', 'D', 'E']);
    cleanup = withFakeRegistry([
      fakeEngine('E1', ['A', 'B', 'C', 'D', 'E']),
      fakeEngine('E2', ['A', 'B', 'C', 'D', 'E']),
    ]);
    const results = ensembleConsensus.rank({
      universe,
      topN: 2,
      options: { minEngines: 2 },
    });
    expect(results.length).toBe(2);
    expect(results.map(r => r.ticker)).toEqual(['A', 'B']);
  });

  test('poolSize controls how many results each engine returns', () => {
    const universe = makeUniverse(['A', 'B', 'C', 'D']);
    const callCounts = [];
    const makeCountingEngine = (key, order) => ({
      key,
      name: key,
      description: '',
      requiresTemplate: false,
      rank: ({ universe: u, topN }) => {
        callCounts.push({ key, topN });
        return order.filter(t => u.has(t)).slice(0, topN).map((t, i) => ({
          ...u.get(t),
          matchScore: 90 - i,
        }));
      },
    });
    cleanup = withFakeRegistry([
      makeCountingEngine('E1', ['A', 'B', 'C', 'D']),
      makeCountingEngine('E2', ['A', 'B', 'C', 'D']),
    ]);
    ensembleConsensus.rank({ universe, options: { poolSize: 2, minEngines: 2 } });
    expect(callCounts.every(c => c.topN === 2)).toBe(true);
  });

  test('poolSize of 0 throws (guards against falsy coercion)', () => {
    const universe = makeUniverse(['A']);
    cleanup = withFakeRegistry([
      fakeEngine('E1', ['A']),
      fakeEngine('E2', ['A']),
    ]);
    expect(() => ensembleConsensus.rank({ universe, options: { poolSize: 0 } }))
      .toThrow(/poolSize/);
  });

  test('result shape is UI-compatible (no topMatches/topDifferences, structured confidence)', () => {
    const universe = makeUniverse(['X', 'Y']);
    cleanup = withFakeRegistry([
      fakeEngine('E1', ['X', 'Y']),
      fakeEngine('E2', ['X', 'Y']),
    ]);
    const [top] = ensembleConsensus.rank({ universe });
    expect(top).toMatchObject({
      ticker: 'X',
      algorithm: 'ensembleConsensus',
      matchScore: expect.any(Number),
      metricsCompared: expect.any(Number),
      totalMetrics: 2,
      categoryScores: expect.any(Object),
      perEngineRanks: expect.any(Object),
      perEngineScores: expect.any(Object),
      consensusEngines: 2,
    });
    // Confidence matches the object contract ComparisonDetail.jsx consumes.
    expect(top.confidence).toEqual({
      level: 'complete',
      coverageRatio: 100,
      metricsAvailable: 2,
    });
    // Verify we removed engine-keyed topMatches/topDifferences — the UI runs
    // those arrays through METRIC_LABELS, which doesn't know engine keys.
    expect(top.topMatches).toBeUndefined();
    expect(top.topDifferences).toBeUndefined();
    expect(top.perEngineRanks).toEqual({ E1: 1, E2: 1 });
    expect(top.perEngineScores.E1).toEqual(expect.any(Number));
    expect(top.categoryScores.consensus).toBe(top.matchScore);
  });

  test('matchScore normalizes highest RRF to 100', () => {
    const universe = makeUniverse(['A', 'B']);
    cleanup = withFakeRegistry([
      fakeEngine('E1', ['A', 'B']),
      fakeEngine('E2', ['A', 'B']),
    ]);
    const results = ensembleConsensus.rank({ universe });
    expect(results[0].matchScore).toBe(100);
    expect(results[1].matchScore).toBeLessThan(100);
  });

  test('template-required engine in options.engines without template throws', () => {
    const universe = makeUniverse(['A']);
    cleanup = withFakeRegistry([
      fakeEngine('E1', ['A'], { requiresTemplate: true }),
      fakeEngine('E2', ['A']),
    ]);
    expect(() => ensembleConsensus.rank({
      universe,
      options: { engines: ['E1', 'E2'] },
    })).toThrow(/requires a template/);
  });

  test('template provided → templateMatch-like engine is included; absent → excluded', () => {
    const universe = makeUniverse(['A', 'B']);
    const callRecord = { template: 0, free: 0 };
    const templateLike = {
      key: 'templateLike',
      name: 't',
      description: '',
      requiresTemplate: true,
      rank: ({ universe: u }) => {
        callRecord.template += 1;
        return ['A'].filter(t => u.has(t)).map(t => ({ ...u.get(t), matchScore: 99 }));
      },
    };
    const freeEngine = {
      key: 'freeEngine',
      name: 'f',
      description: '',
      requiresTemplate: false,
      rank: ({ universe: u }) => {
        callRecord.free += 1;
        return ['A', 'B'].filter(t => u.has(t)).map(t => ({ ...u.get(t), matchScore: 99 }));
      },
    };
    cleanup = withFakeRegistry([templateLike, freeEngine]);

    // No template: only freeEngine runs → A appears in only 1 engine → dropped under minEngines=2
    ensembleConsensus.rank({ universe });
    expect(callRecord.template).toBe(0);
    expect(callRecord.free).toBe(1);

    // With template: both run
    ensembleConsensus.rank({ universe, template: { ticker: 'NVDA' } });
    expect(callRecord.template).toBe(1);
    expect(callRecord.free).toBe(2);
  });

  test('unknown engine in options.engines throws', () => {
    const universe = makeUniverse(['A']);
    cleanup = withFakeRegistry([fakeEngine('E1', ['A'])]);
    expect(() => ensembleConsensus.rank({
      universe,
      options: { engines: ['E1', 'bogus'] },
    })).toThrow(/Unknown engine key/);
  });

  test('perEngineRanks uses null for missing engines', () => {
    const universe = makeUniverse(['A', 'B']);
    cleanup = withFakeRegistry([
      fakeEngine('E1', ['A', 'B']),
      fakeEngine('E2', ['A']),          // B missing
      fakeEngine('E3', ['B', 'A']),
    ]);
    const results = ensembleConsensus.rank({ universe });
    const b = results.find(r => r.ticker === 'B');
    expect(b.perEngineRanks.E1).toBe(2); // B is second in E1's ['A', 'B']
    expect(b.perEngineRanks.E2).toBeNull();
    expect(b.perEngineRanks.E3).toBe(1); // B is first in E3's ['B', 'A']
    expect(b.perEngineScores.E2).toBeNull();
    expect(b.consensusEngines).toBe(2);
    // Engine coverage: 2/3 → adequate
    expect(b.confidence.level).toBe('adequate');
    expect(b.confidence.coverageRatio).toBe(67);
    expect(b.confidence.metricsAvailable).toBe(2);
  });

  test('engine metadata is exported', () => {
    expect(ensembleConsensus.key).toBe('ensembleConsensus');
    expect(ensembleConsensus.requiresTemplate).toBe(false);
    expect(typeof ensembleConsensus.rank).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Registry wiring — the real registry should have ensembleConsensus once
// services/algorithms is required. Guards against regressions where the
// registry split drops or duplicates a registration.
// ---------------------------------------------------------------------------

describe('registry wiring', () => {
  test('ensembleConsensus is registered alongside templateMatch and momentumBreakout', () => {
    const keys = Object.keys(registry.ENGINES).sort();
    expect(keys).toContain('ensembleConsensus');
    expect(keys).toContain('templateMatch');
    expect(keys).toContain('momentumBreakout');
  });
});
