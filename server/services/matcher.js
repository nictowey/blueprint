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
  // Size
  'marketCap',
  // Technical
  'rsi14', 'pctBelowHigh', 'priceVsMa50', 'priceVsMa200', 'beta',
];

const METRIC_WEIGHTS = {
  // --- Tier 1: Defines the opportunity (3.0) ---
  revenueGrowthYoY: 3.0,   // accelerating revenue = #1 signal
  epsGrowthYoY: 3.0,       // earnings acceleration = operating leverage
  pegRatio: 3.0,           // growth relative to valuation = value of growth
  operatingMargin: 3.0,    // margin profile defines business economics
  returnOnEquity: 3.0,     // capital efficiency = competitive moat

  // --- Tier 2: Confirms the setup (2.0-2.5) ---
  peRatio: 2.5,            // how market prices earnings
  evToEBITDA: 2.5,         // enterprise valuation
  priceVsMa200: 2.5,       // institutional trend direction
  pctBelowHigh: 2.5,       // near high = breakout, far below = distressed
  marketCap: 2.5,          // size tier defines growth runway
  revenueGrowth3yr: 2.0,   // sustained growth track record

  // --- Tier 3: Risk check (1.5) ---
  debtToEquity: 1.5,       // leverage risk
  freeCashFlowYield: 1.5,  // real cash generation
  netDebtToEBITDA: 1.5,    // balance sheet health
  beta: 1.5,               // volatility/risk profile
  returnOnCapital: 1.5,    // invested capital efficiency
  priceVsMa50: 1.5,        // short-term momentum

  // --- Tier 4: Supporting context (1.0) ---
  grossMargin: 1.0,
  netMargin: 1.0,
  ebitdaMargin: 1.0,
  returnOnAssets: 1.0,
  priceToBook: 1.0,
  priceToSales: 1.0,
  evToRevenue: 1.0,
  earningsYield: 1.0,
  currentRatio: 1.0,
  interestCoverage: 1.0,
  rsi14: 1.0,
};

const MIN_OVERLAP_RATIO = 0.6;
const EPSILON = 0.01;

Object.freeze(MATCH_METRICS);

function metricSimilarity(metric, snapVal, stockVal) {
  if (snapVal == null || stockVal == null || !isFinite(snapVal) || !isFinite(stockVal)) {
    return null;
  }

  // Market cap: use log-scale comparison since values span orders of magnitude.
  // One order of magnitude (10x) difference = 0% similar.
  // 2x difference ≈ 70%, 3x ≈ 52%, 5x ≈ 30%.
  if (metric === 'marketCap') {
    if (snapVal <= 0 || stockVal <= 0) return null;
    const logDiff = Math.abs(Math.log10(snapVal) - Math.log10(stockVal));
    return Math.max(0, 1 - logDiff);
  }

  // Direct percentage difference for all other metrics
  const denominator = Math.max(Math.abs(snapVal), Math.abs(stockVal), EPSILON);
  const diff = Math.abs(snapVal - stockVal) / denominator;
  return Math.max(0, 1 - diff);
}

function calculateSimilarity(snapshot, stock, snapshotPopulatedCount) {
  let score = 0;
  let totalWeight = 0;
  let overlapCount = 0;
  const metricScores = [];

  for (const metric of MATCH_METRICS) {
    const weight = METRIC_WEIGHTS[metric] ?? 1.0;
    const similarity = metricSimilarity(metric, snapshot[metric], stock[metric]);

    if (similarity === null) continue;

    overlapCount++;
    score += similarity * weight;
    totalWeight += weight;
    metricScores.push({ metric, similarity });
  }

  if (totalWeight === 0) {
    return { score: 0, metricScores: [], overlapCount: 0, overlapRatio: 0 };
  }

  let baseScore = (score / totalWeight) * 100;

  const overlapRatio = snapshotPopulatedCount > 0
    ? overlapCount / snapshotPopulatedCount
    : 0;
  baseScore *= Math.sqrt(overlapRatio);

  const finalScore = Math.max(0, Math.min(100, baseScore));
  return { score: finalScore, metricScores, overlapCount, overlapRatio };
}

function findMatches(snapshot, universe, limit = 10) {
  if (!snapshot || universe.size === 0) return [];

  const snapshotPopulatedCount = MATCH_METRICS.reduce((count, metric) => {
    const v = snapshot[metric];
    return (v != null && isFinite(v)) ? count + 1 : count;
  }, 0);

  if (snapshotPopulatedCount < 4) return [];

  const allStocks = Array.from(universe.values());

  const results = allStocks
    .filter(stock => stock.ticker !== snapshot.ticker)
    .map(stock => {
      const { score, metricScores, overlapCount, overlapRatio } =
        calculateSimilarity(snapshot, stock, snapshotPopulatedCount);

      const ranked = [...metricScores].sort((a, b) => b.similarity - a.similarity);
      const topMatches = ranked.slice(0, 3).map(m => m.metric);
      const topDifferences = ranked.slice(-3).reverse().map(m => m.metric);

      return {
        ...stock,
        _rawScore: score,
        _overlapRatio: overlapRatio,
        matchScore: Math.round(score * 10) / 10,
        metricsCompared: overlapCount,
        topMatches,
        topDifferences,
      };
    })
    .filter(r => r._overlapRatio >= MIN_OVERLAP_RATIO)
    .sort((a, b) => b._rawScore - a._rawScore)
    .slice(0, limit)
    .map(({ _rawScore, _overlapRatio, ...rest }) => rest);

  return results;
}

module.exports = { findMatches, MATCH_METRICS };
