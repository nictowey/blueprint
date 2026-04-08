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

Object.freeze(MATCH_METRICS);

function prepareValue(metric, value) {
  if (value == null || !isFinite(value)) return null;
  return value;
}

function computeScale(stocks, metric) {
  const values = stocks
    .map(s => prepareValue(metric, s[metric]))
    .filter(v => v != null);
  if (values.length === 0) return { min: 0, max: 1 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min, max: max === min ? min + 1 : max };
}

function normalize(value, min, max) {
  const clamped = Math.max(min, Math.min(max, value));
  return (clamped - min) / (max - min);
}

// Score = weighted similarity on metrics where BOTH snapshot and stock have data.
// Denominator is dynamic (only comparable metrics), so scores reflect actual similarity —
// no neutral credit inflating stocks with missing data.
function calculateSimilarity(snapshot, stock, scales) {
  let score = 0;
  let totalWeight = 0;
  const metricScores = [];

  for (const metric of MATCH_METRICS) {
    const snapVal = prepareValue(metric, snapshot[metric]);
    const stockVal = prepareValue(metric, stock[metric]);
    const weight = METRIC_WEIGHTS[metric] ?? 1.0;

    // Skip if either side has no data — only compare what we can actually measure
    if (snapVal === null || stockVal === null) continue;

    const normSnap = normalize(snapVal, scales[metric].min, scales[metric].max);
    const normStock = normalize(stockVal, scales[metric].min, scales[metric].max);
    const diff = Math.abs(normSnap - normStock);
    const metricSimilarity = 1 - diff;

    score += metricSimilarity * weight;
    totalWeight += weight;
    metricScores.push({ metric, similarity: metricSimilarity });
  }

  // Sector bonus: small nudge for same-sector matches, included in the denominator
  if (snapshot.sector && stock.sector && snapshot.sector === stock.sector) {
    score += 0.15;
    totalWeight += 0.15;
  }

  const finalScore = totalWeight > 0 ? Math.max(0, Math.min(100, (score / totalWeight) * 100)) : 0;
  return { score: finalScore, metricScores };
}

function findMatches(snapshot, universe, limit = 10) {
  if (!snapshot || universe.size === 0) return [];

  const scales = {};
  MATCH_METRICS.forEach(metric => {
    scales[metric] = computeScale(Array.from(universe.values()), metric);
  });

  const results = Array.from(universe.values())
    .filter(stock => stock.ticker !== snapshot.ticker)
    .map(stock => {
      const { score, metricScores } = calculateSimilarity(snapshot, stock, scales);

      // Sort by per-metric similarity to find closest and most divergent
      const ranked = [...metricScores].sort((a, b) => b.similarity - a.similarity);
      const topMatches = ranked.slice(0, 3).map(m => m.metric);
      const topDifferences = ranked.slice(-3).reverse().map(m => m.metric);

      return {
        ...stock,
        _rawScore: score,         // used for accurate ranking before rounding
        matchScore: Math.round(score),
        topMatches,
        topDifferences,
      };
    })
    .sort((a, b) => b._rawScore - a._rawScore)  // sort by raw float, not rounded int
    .slice(0, limit)
    .map(({ _rawScore, ...rest }) => rest);       // strip internal field before returning

  return results;
}

module.exports = { findMatches, MATCH_METRICS };
