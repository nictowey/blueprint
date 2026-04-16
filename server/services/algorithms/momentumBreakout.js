/**
 * Momentum + Volume Breakout engine.
 *
 * Template-free universe ranker. Scores each investable stock on 5 technical
 * signals that, taken together, characterize a classical breakout setup:
 *
 *   1. Proximity to 52-week high       (pctBelowHigh, lower = better)
 *   2. Price vs. 50-day moving average (priceVsMa50,  above but not too far)
 *   3. Price vs. 200-day MA            (priceVsMa200, above, trending)
 *   4. RSI-14                          (rsi14,        60–70 sweet spot)
 *   5. Relative volume                 (relativeVolume, >1.5× avg is good)
 *
 * Academic grounding: Jegadeesh & Titman (1993) on cross-sectional momentum;
 * O'Neil's CAN SLIM for the "near 52wk high with volume" component.
 *
 * Each signal function returns a 0..1 score or `null` if the input is missing.
 * Missing signals are excluded from the weighted average and penalize coverage
 * rather than defaulting to 0. Stocks with <3 of 5 signals present are dropped.
 *
 * Output shape mirrors templateMatch.findMatches() so the UI match card can
 * render results from either engine without branching.
 */

const { isInvestable } = require('./shared');

// ---------------------------------------------------------------------------
// Signal scorers — each returns a 0..1 score or null
// ---------------------------------------------------------------------------

/**
 * Piecewise-linear helper. Given a value `v` and an array of breakpoints
 * [[x0, y0], [x1, y1], ...] (x ascending), returns interpolated y.
 * Values below x0 clamp to y0; values above last xN clamp to yN.
 */
function piecewise(v, points) {
  if (v == null || !isFinite(v)) return null;
  if (v <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    if (v <= x1) {
      const t = (v - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return points[points.length - 1][1];
}

// Proximity to 52wk high. `pctBelowHigh` is in percent (0 = at high, 20 = 20% below).
function scoreProximityToHigh(pctBelowHigh) {
  // 0% below = 1.0, 3% = 1.0, 10% = 0.7, 25% = 0.2, 40%+ = 0.0
  return piecewise(pctBelowHigh, [
    [0, 1.0], [3, 1.0], [10, 0.7], [25, 0.2], [40, 0.0],
  ]);
}

// Price vs 50-day MA, in percent (15 = 15% above MA — see computeTechnicals).
function scorePriceVsMa50(pct) {
  if (pct == null || !isFinite(pct)) return null;
  // Below MA -> 0; 0–15% above ramps to peak; 15–40% tapers; >40% overextended.
  return piecewise(pct, [
    [-20, 0.0], [0, 0.0], [15, 1.0], [40, 0.6], [80, 0.2],
  ]);
}

// Price vs 200-day MA, in percent. More lenient on extension (longer trend).
function scorePriceVsMa200(pct) {
  if (pct == null || !isFinite(pct)) return null;
  return piecewise(pct, [
    [-20, 0.0], [0, 0.0], [30, 1.0], [80, 0.5], [150, 0.2],
  ]);
}

// RSI-14. Want strong-but-not-overbought: peak near 65–70.
function scoreRsi(rsi) {
  if (rsi == null || !isFinite(rsi)) return null;
  return piecewise(rsi, [
    [0, 0.0], [50, 0.0], [60, 0.7], [68, 1.0], [72, 1.0], [80, 0.5], [100, 0.2],
  ]);
}

// Relative volume vs. trailing-avg. 1.0 = average.
function scoreRelativeVolume(rvol) {
  if (rvol == null || !isFinite(rvol)) return null;
  return piecewise(rvol, [
    [0, 0.0], [0.8, 0.0], [1.0, 0.5], [1.5, 1.0], [3.0, 1.0], [6.0, 0.6],
  ]);
}

// ---------------------------------------------------------------------------
// Composite scoring
// ---------------------------------------------------------------------------

const SIGNAL_WEIGHTS = {
  pctBelowHigh:   0.25,
  priceVsMa50:    0.20,
  priceVsMa200:   0.20,
  rsi14:          0.20,
  relativeVolume: 0.15,
};

const MIN_SIGNALS_REQUIRED = 3; // out of 5

function computeSignalScores(stock) {
  return {
    pctBelowHigh:   scoreProximityToHigh(stock.pctBelowHigh),
    priceVsMa50:    scorePriceVsMa50(stock.priceVsMa50),
    priceVsMa200:   scorePriceVsMa200(stock.priceVsMa200),
    rsi14:          scoreRsi(stock.rsi14),
    relativeVolume: scoreRelativeVolume(stock.relativeVolume),
  };
}

/**
 * Combine per-signal scores into a 0..100 overall score.
 * Missing signals are excluded from both numerator and denominator —
 * but coverage below MIN_SIGNALS_REQUIRED returns null (stock is dropped).
 */
function combineScores(signalScores) {
  let weightedSum = 0;
  let weightTotal = 0;
  let present = 0;

  for (const [signal, score] of Object.entries(signalScores)) {
    if (score == null) continue;
    const w = SIGNAL_WEIGHTS[signal];
    weightedSum += score * w;
    weightTotal += w;
    present += 1;
  }

  if (present < MIN_SIGNALS_REQUIRED) return null;

  // Normalize by weight of present signals, scale to 0..100
  const normalized = weightedSum / weightTotal;
  return normalized * 100;
}

// ---------------------------------------------------------------------------
// Engine interface
// ---------------------------------------------------------------------------

/**
 * Rank the universe by momentum breakout score.
 *
 * @param {object}  args
 * @param {*}       args.template   — ignored (engine is template-free)
 * @param {Map}     args.universe   — stock universe (values are stock objects)
 * @param {number} [args.topN=10]   — max results
 * @param {object} [args.options]   — currently unused; reserved for custom signal weights
 * @returns {Array<object>}         — ranked results, shape compatible with templateMatch
 */
function rank({ universe, topN = 10, options = {} } = {}) {
  if (!universe || universe.size === 0) return [];

  const results = [];

  for (const stock of universe.values()) {
    if (!isInvestable(stock)) continue;

    const signalScores = computeSignalScores(stock);
    const rawScore = combineScores(signalScores);
    if (rawScore == null) continue; // insufficient coverage

    // Weighted contribution per signal for explanation ("what drove the score")
    const contributions = Object.entries(signalScores)
      .filter(([, s]) => s != null)
      .map(([signal, score]) => ({ signal, score, weight: SIGNAL_WEIGHTS[signal], contribution: score * SIGNAL_WEIGHTS[signal] }));

    const sortedByContribution = [...contributions].sort((a, b) => b.contribution - a.contribution);
    const topSignals = sortedByContribution.slice(0, 3).map(c => c.signal);
    const topSignalSet = new Set(topSignals);
    const weakSignals = [...contributions]
      .sort((a, b) => ((1 - a.score) * a.weight) - ((1 - b.score) * b.weight))
      .reverse()
      .filter(c => !topSignalSet.has(c.signal))
      .slice(0, 3)
      .map(c => c.signal);

    const totalSignals = Object.keys(SIGNAL_WEIGHTS).length;
    const coverageRatio = Math.round((contributions.length / totalSignals) * 100);
    let level;
    if (contributions.length === totalSignals) level = 'complete';
    else if (contributions.length / totalSignals >= 0.66) level = 'adequate';
    else level = 'sparse';

    results.push({
      ...stock,
      _rawScore: rawScore,
      algorithm: 'momentumBreakout',
      matchScore: Math.round(rawScore * 10) / 10,
      signalScores,
      // Fields reused from templateMatch shape so the UI card doesn't need branching:
      metricsCompared: contributions.length,
      totalMetrics: totalSignals,
      categoryScores: { technical: Math.round(rawScore * 10) / 10 },
      confidence: { level, coverageRatio, metricsAvailable: contributions.length },
      topMatches: topSignals,
      topDifferences: weakSignals,
    });
  }

  results.sort((a, b) => b._rawScore - a._rawScore);
  return results.slice(0, topN).map(({ _rawScore, ...rest }) => rest);
}

module.exports = {
  key: 'momentumBreakout',
  name: 'Momentum Breakout',
  description: 'Template-free technical scanner. Ranks the universe by classical breakout setup: proximity to 52-week high, price above 50/200-day MAs, RSI in the 60–70 strong-but-not-overbought band, and above-average relative volume.',
  requiresTemplate: false,
  rank,
  // Exported for unit testing
  _test: {
    scoreProximityToHigh,
    scorePriceVsMa50,
    scorePriceVsMa200,
    scoreRsi,
    scoreRelativeVolume,
    computeSignalScores,
    combineScores,
    piecewise,
    SIGNAL_WEIGHTS,
    MIN_SIGNALS_REQUIRED,
  },
};
