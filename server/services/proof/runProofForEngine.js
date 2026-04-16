/**
 * Per-engine proof runner.
 *
 * Extracted from server/scripts/run-proof.js so each engine can be
 * backtested independently with the same pre-filter + snapshot pipeline.
 *
 * Walk-forward safety notes:
 *   - templateMatch / momentumBreakout — both consume fields built by
 *     `buildSnapshot(ticker, date)`, which filters prices/financials to the
 *     given date. Safe.
 *   - catalystDriven — reads from `catalystSnapshot.js`, which pulls CURRENT
 *     FMP data (last 90 days from today). This is peek-ahead relative to any
 *     historical tc.date. SKIPPED here; the proof UI should say "no
 *     historical record — catalyst signals are forward-looking only".
 *   - ensembleConsensus — if catalystDriven is excluded, its RRF merge runs
 *     on templateMatch + momentumBreakout only. Callers can constrain the
 *     component list via `options.engines`.
 */

const { buildSnapshot } = require('../snapshotBuilder');
const { MATCH_METRICS, isSameCompany } = require('../matcher');
const { getForwardReturns } = require('../backtest');
const defaultRegistry = require('../algorithms');

const CANDIDATE_BATCH_SIZE = 5;
const DEFAULT_TOP_N = 10;

// ---------------------------------------------------------------------------
// Engines that are safe to backtest historically. catalystDriven is
// intentionally omitted because its data layer queries current FMP data.
// ---------------------------------------------------------------------------

const BACKTEST_SAFE_ENGINES = new Set(['templateMatch', 'momentumBreakout', 'ensembleConsensus']);
const BACKTEST_UNSAFE_ENGINES = new Set(['catalystDriven']);

function isBacktestSafe(engineKey) {
  return BACKTEST_SAFE_ENGINES.has(engineKey);
}

// ---------------------------------------------------------------------------
// Pre-filter the universe by the template's market-cap band + positive
// revenue. Mirrors the original helper in run-proof.js so templateMatch and
// momentumBreakout score against the same candidate pool (fairness in
// comparison).
// ---------------------------------------------------------------------------

function preFilterCandidates(universe, templateSnapshot) {
  const templateMcap = templateSnapshot?.marketCap;
  if (!templateMcap || templateMcap <= 0) {
    const filtered = new Map();
    for (const [ticker, stock] of universe) {
      if (stock.revenueGrowthYoY != null) filtered.set(ticker, stock);
    }
    return filtered;
  }

  // Tight band: 0.1x–10x template market cap
  let filtered = new Map();
  const loTight = templateMcap * 0.1;
  const hiTight = templateMcap * 10;

  for (const [ticker, stock] of universe) {
    const mcap = stock.marketCap;
    if (mcap && mcap >= loTight && mcap <= hiTight && stock.revenueGrowthYoY != null) {
      filtered.set(ticker, stock);
    }
  }

  // Widen if too few candidates
  if (filtered.size < 50) {
    filtered = new Map();
    const loWide = templateMcap * 0.01;
    const hiWide = templateMcap * 100;
    for (const [ticker, stock] of universe) {
      const mcap = stock.marketCap;
      if (mcap && mcap >= loWide && mcap <= hiWide && stock.revenueGrowthYoY != null) {
        filtered.set(ticker, stock);
      }
    }
  }

  return filtered;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function noop() {}

function attachForwardReturns(topMatches, matchDate) {
  // Returns a promise — fills `forwardReturns` on each match in place.
  async function run() {
    for (let i = 0; i < topMatches.length; i += CANDIDATE_BATCH_SIZE) {
      const batch = topMatches.slice(i, i + CANDIDATE_BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(m => getForwardReturns(m.ticker, matchDate))
      );
      for (let j = 0; j < batch.length; j++) {
        const r = results[j];
        if (r.status === 'fulfilled' && r.value) {
          const rets = r.value.returns;
          batch[j].forwardReturns = {
            '1m': rets['1m']?.returnPct ?? null,
            '3m': rets['3m']?.returnPct ?? null,
            '6m': rets['6m']?.returnPct ?? null,
            '12m': rets['12m']?.returnPct ?? null,
          };
        } else {
          batch[j].forwardReturns = { '1m': null, '3m': null, '6m': null, '12m': null };
        }
      }
    }
  }
  return run();
}

/**
 * Build historical snapshots for the candidate tickers and return them as a
 * Map keyed by ticker. Batches calls to respect FMP rate limits.
 */
async function buildHistoricalUniverse(candidateTickers, date, onProgress) {
  const out = new Map();
  let built = 0;
  for (let i = 0; i < candidateTickers.length; i += CANDIDATE_BATCH_SIZE) {
    const batch = candidateTickers.slice(i, i + CANDIDATE_BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(t => buildSnapshot(t, date, true))
    );
    for (let j = 0; j < batch.length; j++) {
      const r = results[j];
      if (r.status === 'fulfilled' && r.value) {
        built += 1;
        out.set(batch[j], r.value);
      }
    }
    if (i + CANDIDATE_BATCH_SIZE < candidateTickers.length) {
      onProgress(`  ... ${Math.min(i + CANDIDATE_BATCH_SIZE, candidateTickers.length)}/${candidateTickers.length} candidate snapshots built`);
    }
  }
  return { historicalUniverse: out, snapshotsBuilt: built };
}

// ---------------------------------------------------------------------------
// Seeded random helper (LCG)
// ---------------------------------------------------------------------------

function lcg(seed) {
  // Numerical Recipes parameters; returns a float in [0, 1).
  let state = (seed >>> 0) || 1;
  return function next() {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * Fisher-Yates shuffle, driven by a seeded RNG.
 */
function seededShuffle(arr, rng) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

// ---------------------------------------------------------------------------
// runProofForEngine
// ---------------------------------------------------------------------------

/**
 * Execute the proof pipeline for a single engine against a single historical
 * test case. Engine is resolved via the registry so callers can inject a
 * fake for testing.
 *
 * @param {Object}  args
 * @param {string}  args.engineKey          Registry key (e.g. 'templateMatch')
 * @param {Object}  args.testCase           { ticker, date, label }
 * @param {Map}     args.universe           Full universe Map<ticker, stock>
 * @param {Object} [args.options]           Engine-specific options
 * @param {Object} [args.options.engineOptions]   Passed through to engine.rank(options)
 * @param {number} [args.options.topN=10]   Number of matches to keep
 * @param {Object} [args.engineRegistry]    Injectable for tests
 * @param {Function}[args.onProgress]       Progress-log callback
 * @returns {Object}                        Per-engine result
 */
async function runProofForEngine({
  engineKey,
  testCase,
  universe,
  options = {},
  engineRegistry = defaultRegistry,
  onProgress = noop,
} = {}) {
  const topN = options.topN != null ? options.topN : DEFAULT_TOP_N;
  const engineOptions = options.engineOptions || {};

  // Short-circuit catalystDriven: explicit skip with a clear reason
  if (BACKTEST_UNSAFE_ENGINES.has(engineKey)) {
    return {
      engineKey,
      templateTicker: testCase.ticker,
      templateDate: testCase.date,
      status: 'skipped',
      reason: 'engine not backtest-safe — catalystSnapshot uses current FMP data',
      matches: [],
    };
  }

  const engine = engineRegistry.getEngine
    ? engineRegistry.getEngine(engineKey)
    : (engineRegistry.ENGINES ? engineRegistry.ENGINES[engineKey] : null);

  if (!engine) {
    return {
      engineKey,
      templateTicker: testCase.ticker,
      templateDate: testCase.date,
      status: 'skipped',
      reason: `unknown engine "${engineKey}"`,
      matches: [],
    };
  }

  // 1. Build the template snapshot (always; even engines that don't require
  //    one use it to define the pre-filter market-cap band).
  onProgress(`  [${engineKey}] Building template snapshot for ${testCase.ticker} @ ${testCase.date}...`);
  const templateSnapshot = await buildSnapshot(testCase.ticker, testCase.date, true);
  if (!templateSnapshot) {
    return {
      engineKey,
      templateTicker: testCase.ticker,
      templateDate: testCase.date,
      status: 'skipped',
      reason: 'No template snapshot data',
      matches: [],
    };
  }

  // 2. Extract the trimmed-to-MATCH_METRICS template (templateMatch needs it;
  //    other engines ignore it but we build it once for reuse).
  const template = {};
  let populatedCount = 0;
  for (const metric of MATCH_METRICS) {
    if (templateSnapshot[metric] != null && isFinite(templateSnapshot[metric])) {
      template[metric] = templateSnapshot[metric];
      populatedCount++;
    }
  }
  template.ticker = templateSnapshot.ticker;
  template.companyName = templateSnapshot.companyName;
  template.sector = templateSnapshot.sector;

  // For template-requiring engines, bail if too few metrics populated
  if (engine.requiresTemplate && populatedCount < 4) {
    return {
      engineKey,
      templateTicker: testCase.ticker,
      templateDate: testCase.date,
      status: 'skipped',
      reason: `Only ${populatedCount} metrics populated on template`,
      matches: [],
    };
  }

  // 3. Pre-filter candidate universe by template's market-cap band
  const candidates = preFilterCandidates(universe, templateSnapshot);
  const candidatesScanned = candidates.size;
  onProgress(`  [${engineKey}] ${candidatesScanned} candidates after market-cap + revenue filter`);

  const candidateTickers = Array.from(candidates.keys()).filter(
    t => !isSameCompany(t, testCase.ticker, candidates.get(t)?.companyName, templateSnapshot.companyName)
  );

  // 4. Build historical snapshots for candidates — this is the "historical
  //    universe" the engine sees.
  const { historicalUniverse, snapshotsBuilt } = await buildHistoricalUniverse(
    candidateTickers,
    testCase.date,
    onProgress
  );

  onProgress(`  [${engineKey}] ${snapshotsBuilt} historical snapshots built`);

  // 5. Score via the engine
  const rankArgs = {
    universe: historicalUniverse,
    topN,
    options: engineOptions,
  };
  if (engine.requiresTemplate) rankArgs.template = template;

  // For ensembleConsensus, only include backtest-safe component engines.
  // Without this, the default resolver would pull in catalystDriven (which
  // appears in the registry) and poison the walk-forward guarantee.
  if (engineKey === 'ensembleConsensus' && !rankArgs.options.engines) {
    rankArgs.options = {
      ...rankArgs.options,
      engines: ['templateMatch', 'momentumBreakout'],
    };
  }

  let rawMatches;
  try {
    rawMatches = engine.rank(rankArgs) || [];
  } catch (err) {
    return {
      engineKey,
      templateTicker: testCase.ticker,
      templateDate: testCase.date,
      status: 'error',
      reason: err.message,
      matches: [],
      candidatesScanned,
      snapshotsBuilt,
    };
  }

  // Keep only fields we care about for the proof output (plus matchScore).
  const topMatches = rawMatches.slice(0, topN).map(m => ({
    ticker: m.ticker,
    companyName: m.companyName || '',
    sector: m.sector || '',
    matchScore: m.matchScore != null ? Math.round(m.matchScore * 10) / 10 : null,
    categoryScores: m.categoryScores || null,
    overlapCount: m.overlapCount ?? null,
    perEngineRanks: m.perEngineRanks || null,
    perEngineScores: m.perEngineScores || null,
    consensusEngines: m.consensusEngines ?? null,
  }));

  onProgress(`  [${engineKey}] ${topMatches.length} matches selected; fetching forward returns`);

  // 6. Forward returns
  await attachForwardReturns(topMatches, testCase.date);

  return {
    engineKey,
    templateTicker: testCase.ticker,
    templateDate: testCase.date,
    templateCompanyName: templateSnapshot.companyName || testCase.ticker,
    templateSector: templateSnapshot.sector || '',
    status: 'completed',
    candidatesScanned,
    snapshotsBuilt,
    matches: topMatches,
  };
}

// ---------------------------------------------------------------------------
// runProofForRandom — control group
// ---------------------------------------------------------------------------

/**
 * Pick `sampleSize` random tickers from the same pre-filter pool used by
 * other engines and fetch forward returns for each. Uses a seeded RNG so
 * results are reproducible across runs.
 *
 * Returns the same shape as runProofForEngine but without matchScore.
 */
async function runProofForRandom({
  testCase,
  universe,
  sampleSize = DEFAULT_TOP_N,
  seed,
  onProgress = noop,
} = {}) {
  // Default seed: stable across runs for the same test-case/date
  const effectiveSeed = seed != null
    ? seed
    : ((testCase.ticker || '').split('').reduce((s, c) => s + c.charCodeAt(0), 0) * 1000
        + Number((testCase.date || '').replace(/-/g, '')));

  onProgress(`  [random] Building template snapshot for ${testCase.ticker} @ ${testCase.date}...`);
  const templateSnapshot = await buildSnapshot(testCase.ticker, testCase.date, true);

  if (!templateSnapshot) {
    return {
      engineKey: 'random',
      templateTicker: testCase.ticker,
      templateDate: testCase.date,
      status: 'skipped',
      reason: 'No template snapshot data',
      matches: [],
      seed: effectiveSeed,
    };
  }

  const candidates = preFilterCandidates(universe, templateSnapshot);
  const candidatesScanned = candidates.size;
  const candidateTickers = Array.from(candidates.keys()).filter(
    t => !isSameCompany(t, testCase.ticker, candidates.get(t)?.companyName, templateSnapshot.companyName)
  );

  if (candidateTickers.length === 0) {
    return {
      engineKey: 'random',
      templateTicker: testCase.ticker,
      templateDate: testCase.date,
      status: 'completed',
      candidatesScanned,
      matches: [],
      seed: effectiveSeed,
    };
  }

  const rng = lcg(effectiveSeed);
  const shuffled = seededShuffle(candidateTickers, rng);
  const picked = shuffled.slice(0, Math.min(sampleSize, shuffled.length));

  onProgress(`  [random] Picked ${picked.length} random tickers (seed=${effectiveSeed})`);

  const matches = picked.map(ticker => {
    const stock = candidates.get(ticker) || {};
    return {
      ticker,
      companyName: stock.companyName || '',
      sector: stock.sector || '',
      matchScore: null,
    };
  });

  await attachForwardReturns(matches, testCase.date);

  return {
    engineKey: 'random',
    templateTicker: testCase.ticker,
    templateDate: testCase.date,
    templateCompanyName: templateSnapshot.companyName || testCase.ticker,
    templateSector: templateSnapshot.sector || '',
    status: 'completed',
    candidatesScanned,
    matches,
    seed: effectiveSeed,
  };
}

module.exports = {
  runProofForEngine,
  runProofForRandom,
  preFilterCandidates,
  isBacktestSafe,
  BACKTEST_SAFE_ENGINES,
  BACKTEST_UNSAFE_ENGINES,
  // Test-only helpers
  _test: {
    lcg,
    seededShuffle,
    buildHistoricalUniverse,
    attachForwardReturns,
  },
};
