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

// Fixed denominator: sum of ALL metric weights regardless of which are populated.
// Null snapshot metrics contribute 0 to the numerator but their weight still counts here.
const FIXED_TOTAL_WEIGHT = MATCH_METRICS.reduce((sum, m) => sum + (METRIC_WEIGHTS[m] ?? 1.0), 0);
// = 35.0
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
  if (value == null) return 0.5; // neutral for missing values
  const clamped = Math.max(min, Math.min(max, value));
  return (clamped - min) / (max - min);
}

// Returns { score: 0-100, metricScores: [{ metric, similarity }] }
function calculateSimilarity(snapshot, stock, scales) {
  let score = 0;
  const metricScores = [];

  for (const metric of MATCH_METRICS) {
    const snapVal = prepareValue(metric, snapshot[metric]);
    const stockVal = prepareValue(metric, stock[metric]);
    const weight = METRIC_WEIGHTS[metric] ?? 1.0;

    // Snapshot missing — contributes 0 to numerator; weight already in FIXED_TOTAL_WEIGHT
    if (snapVal === null) continue;

    // Stock missing — neutral contribution (0.5), not tracked for top/diff
    if (stockVal === null) {
      score += 0.5 * weight;
      continue;
    }

    const normSnap = normalize(snapVal, scales[metric].min, scales[metric].max);
    const normStock = normalize(stockVal, scales[metric].min, scales[metric].max);
    const diff = Math.abs(normSnap - normStock);
    const metricSimilarity = 1 - diff;

    score += metricSimilarity * weight;
    metricScores.push({ metric, similarity: metricSimilarity });
  }

  // Sector bonus: small nudge for same-sector matches. Adds to numerator only —
  // scores above 100 before clamping are expected and handled by Math.min below.
  if (snapshot.sector && stock.sector && snapshot.sector === stock.sector) {
    score += 0.15;
  }

  const finalScore = Math.max(0, Math.min(100, (score / FIXED_TOTAL_WEIGHT) * 100));
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

      // Sort by per-metric similarity (unweighted) to find closest and most divergent
      const ranked = [...metricScores].sort((a, b) => b.similarity - a.similarity);
      const topMatches = ranked.slice(0, 3).map(m => m.metric);
      const topDifferences = ranked.slice(-3).reverse().map(m => m.metric);

      return {
        ...stock,
        matchScore: Math.round(score),
        topMatches,
        topDifferences,
      };
    })
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, limit);

  return results;
}

module.exports = { findMatches, MATCH_METRICS };