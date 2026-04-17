/**
 * Ensemble Consensus engine.
 *
 * Orchestration layer — runs every other registered algorithm engine on the
 * universe, then merges their rankings using Reciprocal Rank Fusion (RRF).
 * The product pitch: "three independent lenses agree on this stock."
 *
 * Algorithm:
 *   1. Query each component engine for its top `poolSize` matches (default 50).
 *   2. For each stock appearing in any engine's pool, compute an RRF score:
 *        RRF(stock) = sum over engines of 1 / (RRF_K + rank)
 *      where rank is 1-indexed and RRF_K = 60 (Cormack et al. 2009 default).
 *      Stocks missing from an engine's pool contribute 0 from that engine.
 *   3. Drop any stock that appeared in fewer than `minEngines` engines
 *      (default 2) — this is the "≥K engines" consensus threshold.
 *   4. Normalize remaining RRF scores to 0..100 (best = 100, linear scale)
 *      and return the top `topN`.
 *
 * Engine selection:
 *   - By default, run every template-free engine in the registry.
 *   - If a template is provided, also run `templateMatch`.
 *   - Callers can override with options.engines = [...keys].
 *   - ensembleConsensus never recurses (excludes itself from component list).
 *
 * Output shape mirrors other engines for UI compatibility, with extras:
 *   perEngineRanks, perEngineScores, consensusEngines. (Phase 6 UI work
 *   will derive best/worst-engine views from perEngineRanks directly —
 *   we intentionally do NOT populate topMatches/topDifferences, because
 *   those fields are for metric-label rendering, not engine-label rendering.)
 */

// Direct import from the leaf registry module (not `./index`) to avoid a
// circular require. registry.js imports no engines, so there's no cycle.
const registry = require('./registry');

const RRF_K = 60;
const DEFAULT_POOL_SIZE = 50;
const DEFAULT_TOP_N = 10;

/**
 * Default minEngines given how many component engines are running.
 *  - 2 engines → 1 (union view; RRF ordering organically surfaces agreement)
 *  - 3+ engines → strict majority (floor(N/2) + 1)
 * Callers can override via options.minEngines.
 */
function defaultMinEngines(enginesRunning) {
  if (enginesRunning <= 2) return 1;
  return Math.floor(enginesRunning / 2) + 1;
}

/**
 * Resolve which component engines to run for a given invocation.
 * Accepts a raw engines map (from the registry) and the caller's options +
 * whether a template was supplied. Returns an array of engine objects.
 *
 * Throws on: unknown engine key; template-required engine with no template.
 */
function resolveEngines({ enginesMap, template, options }) {
  const SELF_KEY = 'ensembleConsensus';
  const allKeys = Object.keys(enginesMap).filter(k => k !== SELF_KEY);

  let selectedKeys;
  if (Array.isArray(options.engines)) {
    for (const k of options.engines) {
      if (k === SELF_KEY) {
        throw new Error(`ensembleConsensus cannot include itself as a component engine`);
      }
      if (!Object.prototype.hasOwnProperty.call(enginesMap, k)) {
        throw new Error(`Unknown engine key: ${k}`);
      }
    }
    // Dedupe so a caller can't game RRF by listing the same engine twice
    selectedKeys = [...new Set(options.engines)];
  } else {
    // Default: all template-free engines; include templateMatch only if a template is provided
    selectedKeys = allKeys.filter(k => {
      const e = enginesMap[k];
      return !e.requiresTemplate || (e.requiresTemplate && template);
    });
  }

  const engines = selectedKeys.map(k => enginesMap[k]);
  for (const e of engines) {
    if (e.requiresTemplate && !template) {
      throw new Error(`Engine ${e.key} requires a template but none was provided`);
    }
  }
  return engines;
}

/**
 * Run each component engine and return a map keyed by engine key, with
 * { results, rankByTicker, scoreByTicker } so the merge step can look up
 * a stock's rank in O(1).
 */
function collectEngineResults({ engines, template, universe, poolSize }) {
  const out = {};
  for (const engine of engines) {
    const args = { universe, topN: poolSize, options: {} };
    if (engine.requiresTemplate) args.template = template;
    const results = engine.rank(args) || [];

    const rankByTicker = new Map();
    const scoreByTicker = new Map();
    results.forEach((r, idx) => {
      // 1-indexed rank per RRF convention
      rankByTicker.set(r.ticker, idx + 1);
      scoreByTicker.set(r.ticker, r.matchScore);
    });
    out[engine.key] = { results, rankByTicker, scoreByTicker };
  }
  return out;
}

/**
 * Merge per-engine results via RRF. Returns an array of aggregate objects
 * sorted by RRF score descending. Each object has:
 *   ticker, stock, rrfScore, perEngineRanks, perEngineScores, consensusEngines.
 */
function mergeRrf({ engineResults, engineKeys, minEngines }) {
  // Pool of every ticker that appeared in any engine's top-N list
  const stocksByTicker = new Map(); // ticker -> stock object (first one wins)
  for (const key of engineKeys) {
    for (const stock of engineResults[key].results) {
      if (!stocksByTicker.has(stock.ticker)) stocksByTicker.set(stock.ticker, stock);
    }
  }

  const aggregates = [];
  for (const [ticker, stock] of stocksByTicker) {
    let rrfScore = 0;
    let consensusEngines = 0;
    const perEngineRanks = {};
    const perEngineScores = {};

    for (const key of engineKeys) {
      const rank = engineResults[key].rankByTicker.get(ticker);
      const score = engineResults[key].scoreByTicker.get(ticker);
      if (rank != null) {
        rrfScore += 1 / (RRF_K + rank);
        consensusEngines += 1;
        perEngineRanks[key] = rank;
        perEngineScores[key] = score != null ? score : null;
      } else {
        perEngineRanks[key] = null;
        perEngineScores[key] = null;
      }
    }

    if (consensusEngines < minEngines) continue;

    aggregates.push({ ticker, stock, rrfScore, perEngineRanks, perEngineScores, consensusEngines });
  }

  // Stable sort: RRF desc, then ticker asc for tie-breaking (deterministic)
  aggregates.sort((a, b) => {
    if (b.rrfScore !== a.rrfScore) return b.rrfScore - a.rrfScore;
    return a.ticker.localeCompare(b.ticker);
  });
  return aggregates;
}

/**
 * Build the UI-compatible confidence object. Mirrors the shape from
 * matcher.computeConfidence so the UI at ComparisonDetail can consume it
 * without branching per-engine. For the ensemble the "coverage" dimension
 * is engine coverage, not metric coverage:
 *   metricsAvailable = how many engines ranked this stock (= consensusEngines)
 *   coverageRatio    = integer 0..100 of engines / total
 *   level            = 'complete' | 'adequate' | 'sparse'
 */
function buildConfidence(consensusEngines, totalEngines) {
  const ratio = totalEngines > 0 ? consensusEngines / totalEngines : 0;
  const coverageRatio = Math.round(ratio * 100);
  let level;
  if (totalEngines > 0 && consensusEngines === totalEngines) level = 'complete';
  else if (ratio >= 0.66) level = 'adequate';
  else level = 'sparse';
  return { level, coverageRatio, metricsAvailable: consensusEngines };
}

/**
 * Rank the universe by ensemble consensus.
 *
 * @param {object}   args
 * @param {object}  [args.template]              — optional; if present, templateMatch joins
 * @param {Map}      args.universe               — stock universe
 * @param {number}  [args.topN=10]               — max results after merge
 * @param {object}  [args.options]
 * @param {Array}   [args.options.engines]       — override which engines to run
 * @param {number}  [args.options.poolSize=50]   — top-N pulled from each engine
 * @param {number}  [args.options.minEngines=2]  — consensus threshold
 * @returns {Array<object>}                      — ranked results
 */
function rank({ template, universe, topN = DEFAULT_TOP_N, options = {} } = {}) {
  if (!universe || universe.size === 0) return [];

  const poolSize = options.poolSize != null ? options.poolSize : DEFAULT_POOL_SIZE;
  if (poolSize < 1) throw new Error('poolSize must be >= 1');

  const engines = resolveEngines({ enginesMap: registry.ENGINES, template, options });
  if (engines.length === 0) return [];

  const minEngines = options.minEngines != null
    ? options.minEngines
    : defaultMinEngines(engines.length);

  const engineKeys = engines.map(e => e.key);
  const engineResults = collectEngineResults({ engines, template, universe, poolSize });
  const aggregates = mergeRrf({ engineResults, engineKeys, minEngines });

  if (aggregates.length === 0) return [];

  const maxRrf = aggregates[0].rrfScore;
  const totalEngines = engines.length;

  return aggregates.slice(0, topN).map(agg => {
    const normalized = maxRrf > 0 ? (agg.rrfScore / maxRrf) * 100 : 0;
    const matchScore = Math.round(normalized * 10) / 10;
    return {
      ...agg.stock,
      algorithm: 'ensembleConsensus',
      matchScore,
      perEngineRanks: agg.perEngineRanks,
      perEngineScores: agg.perEngineScores,
      consensusEngines: agg.consensusEngines,
      metricsCompared: agg.consensusEngines,
      // totalMetrics here counts engines compared, not metrics — the UI's
      // generic "X/Y metrics" header reads this field, and we overload the
      // semantic so the ensemble can surface "engines compared" without a
      // branching UI change. Field name kept for UI contract stability.
      totalMetrics: totalEngines,
      categoryScores: { consensus: matchScore },
      confidence: buildConfidence(agg.consensusEngines, totalEngines),
    };
  });
}

module.exports = {
  key: 'ensembleConsensus',
  name: 'Ensemble Consensus',
  description: 'Orchestration layer. Runs every other registered engine and merges their rankings via Reciprocal Rank Fusion (RRF), surfacing stocks that appear in the top-N of multiple engines. Templates are optional — if provided, templateMatch joins as a third lens. Default consensus threshold: stock must appear in ≥2 engine pools.',
  requiresTemplate: false,
  rank,
  _test: {
    resolveEngines,
    collectEngineResults,
    mergeRrf,
    buildConfidence,
    defaultMinEngines,
    RRF_K,
    DEFAULT_POOL_SIZE,
  },
};
