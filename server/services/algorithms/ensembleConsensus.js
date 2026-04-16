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
 *   perEngineRanks, perEngineScores, consensusEngines.
 */

const RRF_K = 60;
const DEFAULT_POOL_SIZE = 50;
const DEFAULT_MIN_ENGINES = 2;
const DEFAULT_TOP_N = 10;

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
 * Pick the engine keys where the stock ranked best (lowest numeric rank) and
 * worst (highest rank / missing). Used for UI explanation —
 * topMatches = "these engines loved it"; topDifferences = "these didn't".
 */
function summarizeRanks(perEngineRanks) {
  const entries = Object.entries(perEngineRanks);
  const present = entries.filter(([, r]) => r != null).sort((a, b) => a[1] - b[1]);
  const missingOrWeak = entries
    .slice()
    .sort((a, b) => {
      // null (missing) is worst; otherwise higher rank = worse
      const ra = a[1] == null ? Infinity : a[1];
      const rb = b[1] == null ? Infinity : b[1];
      return rb - ra;
    });
  return {
    topMatches: present.slice(0, 3).map(([k]) => k),
    topDifferences: missingOrWeak.slice(0, 3).map(([k]) => k),
  };
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
 * @param {object}  [args.options._engines]      — TEST ONLY: injected engines map
 * @returns {Array<object>}                      — ranked results
 */
function rank({ template, universe, topN = DEFAULT_TOP_N, options = {} } = {}) {
  if (!universe || universe.size === 0) return [];

  const poolSize = options.poolSize || DEFAULT_POOL_SIZE;
  const minEngines = options.minEngines != null ? options.minEngines : DEFAULT_MIN_ENGINES;

  // Lazy-load the registry to avoid circular require (index.js imports us).
  // options._engines allows test-time injection of a synthetic registry.
  const enginesMap = options._engines || require('./index').ENGINES;

  const engines = resolveEngines({ enginesMap, template, options });
  if (engines.length === 0) return [];

  const engineKeys = engines.map(e => e.key);
  const engineResults = collectEngineResults({ engines, template, universe, poolSize });
  const aggregates = mergeRrf({ engineResults, engineKeys, minEngines });

  if (aggregates.length === 0) return [];

  const maxRrf = aggregates[0].rrfScore;
  const totalEngines = engines.length;

  return aggregates.slice(0, topN).map(agg => {
    const normalized = maxRrf > 0 ? (agg.rrfScore / maxRrf) * 100 : 0;
    const matchScore = Math.round(normalized * 10) / 10;
    const { topMatches, topDifferences } = summarizeRanks(agg.perEngineRanks);
    return {
      ...agg.stock,
      algorithm: 'ensembleConsensus',
      matchScore,
      perEngineRanks: agg.perEngineRanks,
      perEngineScores: agg.perEngineScores,
      consensusEngines: agg.consensusEngines,
      metricsCompared: agg.consensusEngines,
      totalMetrics: totalEngines,
      categoryScores: { consensus: matchScore },
      confidence: agg.consensusEngines / totalEngines,
      topMatches,
      topDifferences,
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
    summarizeRanks,
    RRF_K,
    DEFAULT_POOL_SIZE,
    DEFAULT_MIN_ENGINES,
  },
};
