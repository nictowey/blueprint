const MATCH_METRICS = [
  // Valuation
  'peRatio', 'priceToBook', 'priceToSales', 'evToEBITDA', 'evToRevenue', 'pegRatio', 'earningsYield',
  // Profitability
  'grossMargin', 'operatingMargin', 'netMargin', 'ebitdaMargin',
  'returnOnEquity', 'returnOnAssets', 'returnOnCapital',
  // Growth
  'revenueGrowthYoY', 'revenueGrowth3yr', 'epsGrowthYoY',
  // Financial Health
  'currentRatio', 'debtToEquity', 'interestCoverage', 'netDebtToEBITDA', 'freeCashFlowYield',
  // Technical
  'rsi14', 'pctBelowHigh', 'priceVsMa50', 'priceVsMa200',
];

// Metrics that are log-normally distributed — apply log1p transform before normalizing.
// Log transforms compress the long right tail so a P/E of 200 doesn't dominate the scale
// against a normal cluster of P/E 10-40.
const LOG_TRANSFORM_METRICS = new Set([
  'peRatio', 'priceToBook', 'priceToSales', 'evToEBITDA', 'evToRevenue', 'pegRatio',
  'interestCoverage',
]);

// Growth and profitability matter most for finding breakout candidates.
// Technical signals are supplementary — weighted lower to avoid noise domination.
const METRIC_WEIGHTS = {
  // Valuation
  peRatio: 1.5, priceToBook: 1.0, priceToSales: 1.0,
  evToEBITDA: 1.5, evToRevenue: 1.0, pegRatio: 1.5, earningsYield: 1.0,
  // Profitability
  grossMargin: 1.5, operatingMargin: 2.0, netMargin: 1.5, ebitdaMargin: 1.0,
  returnOnEquity: 2.0, returnOnAssets: 1.5, returnOnCapital: 1.5,
  // Growth — highest weight
  revenueGrowthYoY: 2.5, revenueGrowth3yr: 2.5, epsGrowthYoY: 2.0,
  // Financial Health
  currentRatio: 1.0, debtToEquity: 1.5, interestCoverage: 1.0,
  netDebtToEBITDA: 1.5, freeCashFlowYield: 1.5,
  // Technical — lower weight
  rsi14: 0.5, pctBelowHigh: 0.5, priceVsMa50: 0.5, priceVsMa200: 0.5,
};

// Minimum fraction of the snapshot's populated metrics that a candidate must also
// have populated. Prevents stocks with sparse data from winning by matching on noise.
const MIN_OVERLAP_RATIO = 0.6;

Object.freeze(MATCH_METRICS);

function prepareValue(metric, value) {
  if (value == null || !isFinite(value)) return null;
  if (LOG_TRANSFORM_METRICS.has(metric)) {
    // log1p(x) = log(1 + x); handles zero gracefully. For negative values
    // (e.g. negative P/E from losses) we use sign-preserving log.
    return value >= 0 ? Math.log1p(value) : -Math.log1p(-value);
  }
  return value;
}

// Compute robust scale parameters using median and interquartile range (IQR).
// This is robust to outliers — a few extreme values won't shift the median or IQR
// the way they shift mean/stddev or min/max.
function computeScale(stocks, metric) {
  const values = stocks
    .map(s => prepareValue(metric, s[metric]))
    .filter(v => v != null);

  if (values.length === 0) return { median: 0, iqr: 1 };

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const median = sorted[Math.floor(n / 2)];

  // For tiny samples (< 8 stocks), IQR is unreliable. Fall back to half the
  // value range so that distinct stocks still produce distinct normalized values.
  if (n < 8) {
    const range = sorted[n - 1] - sorted[0];
    return { median, iqr: range > 0 ? range / 2 : 1 };
  }

  const q1 = sorted[Math.floor(n * 0.25)];
  const q3 = sorted[Math.floor(n * 0.75)];
  const iqr = q3 - q1;

  return { median, iqr: iqr === 0 ? 1 : iqr };
}

// Robust z-score, then squashed to [0, 1] via tanh.
// Smaller divisor = sharper response: stocks within 1 IQR of each other still
// produce visible score differences instead of clustering at the median.
function normalize(value, median, iqr) {
  const z = (value - median) / iqr;
  return 0.5 + 0.5 * Math.tanh(z);
}

// Score = weighted similarity on metrics where BOTH snapshot and stock have data.
// Denominator is dynamic (only comparable metrics), so scores reflect actual similarity.
// An overlap penalty is applied at the end to prevent sparse-data stocks from winning.
function calculateSimilarity(snapshot, stock, scales, snapshotPopulatedCount) {
  let score = 0;
  let totalWeight = 0;
  let overlapCount = 0;
  const metricScores = [];

  for (const metric of MATCH_METRICS) {
    const snapVal = prepareValue(metric, snapshot[metric]);
    const stockVal = prepareValue(metric, stock[metric]);
    const weight = METRIC_WEIGHTS[metric] ?? 1.0;

    // Skip if either side has no data — only compare what we can actually measure
    if (snapVal === null || stockVal === null) continue;

    overlapCount++;

    const normSnap = normalize(snapVal, scales[metric].median, scales[metric].iqr);
    const normStock = normalize(stockVal, scales[metric].median, scales[metric].iqr);
    const diff = Math.abs(normSnap - normStock);
    const metricSimilarity = 1 - diff;

    score += metricSimilarity * weight;
    totalWeight += weight;
    metricScores.push({ metric, similarity: metricSimilarity });
  }

  // Sector as a weighted quasi-metric: same sector = full similarity (1.0),
  // different sector = partial similarity (0.5). Included in the score loop
  // rather than as a post-hoc multiplier to avoid ceiling saturation.
  // Weight of 3.0 makes sector matter roughly as much as two strong fundamental metrics.
  if (snapshot.sector && stock.sector) {
    const sectorSim = snapshot.sector === stock.sector ? 1.0 : 0.5;
    const sectorWeight = 3.0;
    score += sectorSim * sectorWeight;
    totalWeight += sectorWeight;
  }

  if (totalWeight === 0) {
    return { score: 0, metricScores: [], overlapCount: 0, overlapRatio: 0 };
  }

  let baseScore = (score / totalWeight) * 100;

  // Overlap penalty: scale by sqrt(overlap ratio). A stock matching on 50% of available
  // snapshot metrics gets ~71% of its raw score. Matching on 100% keeps the full score.
  const overlapRatio = snapshotPopulatedCount > 0
    ? overlapCount / snapshotPopulatedCount
    : 0;
  baseScore *= Math.sqrt(overlapRatio);

  const finalScore = Math.max(0, Math.min(100, baseScore));
  return { score: finalScore, metricScores, overlapCount, overlapRatio };
}

function findMatches(snapshot, universe, limit = 10) {
  if (!snapshot || universe.size === 0) return [];

  // Count how many match metrics the snapshot actually has populated.
  // This is the denominator for the overlap requirement.
  const snapshotPopulatedCount = MATCH_METRICS.reduce((count, metric) => {
    return prepareValue(metric, snapshot[metric]) !== null ? count + 1 : count;
  }, 0);

  // Need at least a few populated metrics to match meaningfully
  if (snapshotPopulatedCount < 4) return [];

  const allStocks = Array.from(universe.values());
  const scales = {};
  MATCH_METRICS.forEach(metric => {
    scales[metric] = computeScale(allStocks, metric);
  });

  const results = allStocks
    .filter(stock => stock.ticker !== snapshot.ticker)
    .map(stock => {
      const { score, metricScores, overlapCount, overlapRatio } =
        calculateSimilarity(snapshot, stock, scales, snapshotPopulatedCount);

      // Sort by per-metric similarity to find closest and most divergent
      const ranked = [...metricScores].sort((a, b) => b.similarity - a.similarity);
      const topMatches = ranked.slice(0, 3).map(m => m.metric);
      const topDifferences = ranked.slice(-3).reverse().map(m => m.metric);

      return {
        ...stock,
        _rawScore: score,
        _overlapRatio: overlapRatio,
        matchScore: Math.round(score),
        metricsCompared: overlapCount,
        topMatches,
        topDifferences,
      };
    })
    // Filter out stocks that don't share enough metrics with the snapshot.
    // This is the hard floor — anything below 60% overlap can't even be considered.
    .filter(r => r._overlapRatio >= MIN_OVERLAP_RATIO)
    .sort((a, b) => b._rawScore - a._rawScore)
    .slice(0, limit)
    .map(({ _rawScore, _overlapRatio, ...rest }) => rest);

  return results;
}

module.exports = { findMatches, MATCH_METRICS };
