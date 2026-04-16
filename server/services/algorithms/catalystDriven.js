/**
 * Catalyst-Driven engine.
 *
 * Template-free universe ranker that scores each investable stock by the
 * composite strength of three "catalyst" signals produced by the Phase 3a
 * data layer in `../catalystSnapshot`:
 *
 *   1. Earnings surprise      — EPS beats vs. estimate over last 1–2 reports
 *   2. Estimate revisions     — analyst bullishness delta over ~90 days
 *   3. Insider buying         — distinct insider buyers over trailing 90 days
 *
 * Each signal is produced by catalystSnapshot in [-1, +1] (or null when
 * source data is insufficient). This engine performs no FMP I/O — it reads
 * from the in-memory cache only. The universe worker in `server/index.js`
 * warms the cache at startup; tickers without a cached snapshot are scored
 * as fully-missing (all 3 signals null).
 *
 * Scoring
 * -------
 * Each signal s in [-1, +1] is mapped to a [0, 1] contribution via
 * (s + 1) / 2, so a neutral signal (0) contributes 0.5 — matching the
 * "neutral stock shouldn't rank high or low" intuition. Signals are combined
 * as a weighted average over present signals, then scaled to 0..100.
 * Missing signals are excluded from both numerator and denominator (same
 * idiom as momentumBreakout.combineScores). Stocks with fewer than
 * MIN_SIGNALS_REQUIRED present signals are dropped.
 *
 * Weights (v1):
 *   earningsSurprise   0.40   — hardest signal to fake; weight reflects
 *                               multiple quarters of evidence in FMP rows
 *   estimateRevisions  0.35   — analyst conviction shift; Womack (1996)
 *                               shows revisions lead price moves
 *   insiderBuying      0.25   — high signal-to-noise but sparse; most
 *                               stocks have no insider-buy activity in a
 *                               90-day window so weight is discounted
 *
 * Output shape mirrors momentumBreakout.rank() so the `/api/matches` route
 * and the match-card UI can consume catalyst results without branching.
 */

const { isInvestable } = require('./shared');
const { getCatalystSnapshot } = require('../catalystSnapshot');

// ---------------------------------------------------------------------------
// Signal-to-contribution mapper
// ---------------------------------------------------------------------------

/**
 * Map a catalystSnapshot signal in [-1, +1] to a [0, 1] contribution.
 * Returns null for null/NaN/non-finite input so combineScores can treat it
 * as missing coverage rather than as "worst possible score".
 *
 * A signal of +1 → 1.0, 0 → 0.5, -1 → 0. Inputs are clamped to the range
 * so out-of-band values from future signal tweaks don't produce negative
 * or >1 contributions.
 */
function signalToContribution(signal) {
  if (signal == null || !isFinite(signal)) return null;
  const clamped = Math.max(-1, Math.min(1, signal));
  return (clamped + 1) / 2;
}

// ---------------------------------------------------------------------------
// Composite scoring
// ---------------------------------------------------------------------------

const SIGNAL_WEIGHTS = {
  earningsSurprise:  0.40,
  estimateRevisions: 0.35,
  insiderBuying:     0.25,
};

const MIN_SIGNALS_REQUIRED = 2; // out of 3

/**
 * Build a per-signal contribution map from raw snapshot signals.
 * Returns { earningsSurprise, estimateRevisions, insiderBuying } where each
 * value is either a 0..1 number or null.
 */
function computeContributions(signals) {
  const src = signals || {};
  return {
    earningsSurprise:  signalToContribution(src.earningsSurprise),
    estimateRevisions: signalToContribution(src.estimateRevisions),
    insiderBuying:     signalToContribution(src.insiderBuying),
  };
}

/**
 * Combine per-signal contributions into a 0..100 score.
 * Missing signals are excluded; coverage below MIN_SIGNALS_REQUIRED returns
 * null so the caller can drop the stock.
 */
function combineScores(contributions) {
  let weightedSum = 0;
  let weightTotal = 0;
  let present = 0;

  for (const [signal, contribution] of Object.entries(contributions)) {
    if (contribution == null) continue;
    const w = SIGNAL_WEIGHTS[signal];
    weightedSum += contribution * w;
    weightTotal += w;
    present += 1;
  }

  if (present < MIN_SIGNALS_REQUIRED) return null;

  const normalized = weightedSum / weightTotal;
  return normalized * 100;
}

// ---------------------------------------------------------------------------
// Engine interface
// ---------------------------------------------------------------------------

/**
 * Rank the universe by catalyst score.
 *
 * @param {object}  args
 * @param {*}      [args.template]   — ignored; engine is template-free
 * @param {Map}     args.universe    — stock universe (values are stock objects)
 * @param {number} [args.topN=10]    — max results
 * @param {object} [args.options]    — reserved; currently unused
 * @returns {Array<object>}          — ranked results, shape compatible with
 *                                     momentumBreakout / templateMatch
 */
function rank({ universe, topN = 10 } = {}) {
  if (!universe || universe.size === 0) return [];

  const totalSignals = Object.keys(SIGNAL_WEIGHTS).length;
  const results = [];

  for (const stock of universe.values()) {
    if (!isInvestable(stock)) continue;

    // Read snapshot from cache; missing snapshot → all signals null, which
    // will fail the MIN_SIGNALS_REQUIRED gate below.
    const snapshot = getCatalystSnapshot(stock.ticker);
    const rawSignals = snapshot ? snapshot.signals : null;

    const contributions = computeContributions(rawSignals);
    const rawScore = combineScores(contributions);
    if (rawScore == null) continue;

    // Surface the raw [-1, +1] signals on the result (rather than the
    // internal 0..1 contributions) so the UI can show "EPS beat +0.5" in
    // its native scale, matching how the snapshot stores them.
    const signalScores = rawSignals
      ? {
          earningsSurprise:  rawSignals.earningsSurprise ?? null,
          estimateRevisions: rawSignals.estimateRevisions ?? null,
          insiderBuying:     rawSignals.insiderBuying ?? null,
        }
      : { earningsSurprise: null, estimateRevisions: null, insiderBuying: null };

    // Per-signal weighted contribution for "what drove the score" explanations
    const presentContributions = Object.entries(contributions)
      .filter(([, c]) => c != null)
      .map(([signal, c]) => ({
        signal,
        contribution: c,
        weight: SIGNAL_WEIGHTS[signal],
        weighted: c * SIGNAL_WEIGHTS[signal],
      }));

    const topMatches = [...presentContributions]
      .sort((a, b) => b.weighted - a.weighted)
      .slice(0, 3)
      .map(c => c.signal);
    const topMatchSet = new Set(topMatches);

    // Worst weighted shortfall = (1 - contribution) * weight, highest first.
    // Exclude anything that's already in topMatches to avoid duplicates.
    const topDifferences = [...presentContributions]
      .sort((a, b) => ((1 - b.contribution) * b.weight) - ((1 - a.contribution) * a.weight))
      .filter(c => !topMatchSet.has(c.signal))
      .slice(0, 3)
      .map(c => c.signal);

    const metricsAvailable = presentContributions.length;
    const coverageRatio = Math.round((metricsAvailable / totalSignals) * 100);
    let level;
    if (metricsAvailable === totalSignals) level = 'complete';
    else if (metricsAvailable === 2)       level = 'adequate';
    else                                   level = 'sparse';

    const matchScore = Math.round(rawScore * 10) / 10;

    results.push({
      ...stock,
      _rawScore: rawScore,
      algorithm: 'catalystDriven',
      matchScore,
      signalScores,
      metricsCompared: metricsAvailable,
      totalMetrics: totalSignals,
      categoryScores: { catalyst: matchScore },
      confidence: { level, coverageRatio, metricsAvailable },
      topMatches,
      topDifferences,
    });
  }

  results.sort((a, b) => b._rawScore - a._rawScore);
  return results.slice(0, topN).map(({ _rawScore, ...rest }) => rest);
}

module.exports = {
  key: 'catalystDriven',
  name: 'Catalyst-Driven',
  description: 'Template-free catalyst scanner. Ranks the universe by composite strength of three event-driven signals: earnings-surprise magnitude, analyst estimate revisions (~90d), and insider-buying clusters (~90d). Reads from the catalyst snapshot cache — no FMP I/O at rank time.',
  requiresTemplate: false,
  rank,
  _test: {
    signalToContribution,
    computeContributions,
    combineScores,
    SIGNAL_WEIGHTS,
    MIN_SIGNALS_REQUIRED,
  },
};
