const MATCH_METRICS = [
  // Valuation
  'peRatio', 'priceToBook', 'priceToSales', 'evToEBITDA', 'evToRevenue', 'pegRatio',
  // Profitability
  'grossMargin', 'operatingMargin', 'netMargin', 'returnOnEquity', 'returnOnAssets',
  // Growth
  'revenueGrowthYoY', 'epsGrowthYoY',
  // Financial Health
  'currentRatio', 'debtToEquity',
  // Technical
  'rsi14', 'pctBelowHigh', 'priceVsMa50', 'priceVsMa200',
  // Size (log normalized)
  'marketCap',
];

function prepareValue(metric, value) {
  if (value == null || !isFinite(value)) return null;
  if (metric === 'marketCap') return value > 0 ? Math.log(value) : null;
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

// New similarity function — much more reliable
function calculateSimilarity(snapshot, stock, scales) {
  let totalWeight = 0;
  let score = 0;

  for (const metric of MATCH_METRICS) {
    const snapVal = prepareValue(metric, snapshot[metric]);
    const stockVal = prepareValue(metric, stock[metric]);

    if (snapVal === null || stockVal === null) {
      // Missing value penalty (milder than before)
      score += 0.3;
      totalWeight += 1;
      continue;
    }

    const normSnap = normalize(snapVal, scales[metric].min, scales[metric].max);
    const normStock = normalize(stockVal, scales[metric].min, scales[metric].max);

    // Weighted Euclidean distance contribution
    const diff = Math.abs(normSnap - normStock);
    const weight = 1.0; // you can tune per-metric later
    score += (1 - diff) * weight;
    totalWeight += weight;
  }

  // Add sector bonus if available
  if (snapshot.sector && stock.sector && snapshot.sector === stock.sector) {
    score += 0.15;
    totalWeight += 0.15;
  }

  return totalWeight > 0 ? Math.max(0, Math.min(100, (score / totalWeight) * 100)) : 0;
}

function findMatches(snapshot, universe, limit = 10) {
  if (!snapshot || universe.size === 0) return [];

  // Pre-compute scales once
  const scales = {};
  MATCH_METRICS.forEach(metric => {
    scales[metric] = computeScale(Array.from(universe.values()), metric);
  });

  const results = Array.from(universe.values())
    .map(stock => ({
      ...stock,
      similarity: calculateSimilarity(snapshot, stock, scales)
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);

  return results;
}

module.exports = { findMatches, MATCH_METRICS };