// Metrics where HIGHER is better for the investor
const HIGHER_IS_BETTER = new Set([
  'grossMargin', 'operatingMargin', 'netMargin', 'ebitdaMargin',
  'returnOnEquity', 'returnOnAssets', 'returnOnCapital',
  'revenueGrowthYoY', 'revenueGrowth3yr', 'epsGrowthYoY',
  'earningsYield', 'freeCashFlowYield',
  'interestCoverage', 'currentRatio',
  'eps', 'freeCashFlow', 'operatingCashFlow', 'totalCash',
]);

// Metrics where LOWER is better for the investor
const LOWER_IS_BETTER = new Set([
  'peRatio', 'priceToBook', 'priceToSales',
  'evToEBITDA', 'evToRevenue', 'pegRatio',
  'debtToEquity', 'netDebtToEBITDA', 'totalDebt',
  'pctBelowHigh', 'beta',
]);

// Metrics where direction doesn't clearly mean better/worse —
// color by closeness only (green = similar, red = different)
// rsi14, priceVsMa50, priceVsMa200, marketCap, avgVolume, dividendYield

const SIMILARITY_THRESHOLD = 15;  // within 15% = in line (yellow)
const BAD_THRESHOLD = 40;         // beyond 40% = significant (red)

/**
 * Returns a Tailwind color class for the match metric value.
 * Green = match is better than template
 * Yellow = match is roughly in line with template
 * Red = match is worse than template
 */
export function getMetricColor(key, templateVal, matchVal) {
  if (templateVal == null || matchVal == null) return 'text-slate-600';
  if (templateVal === 0 && matchVal === 0) return 'text-yellow-400';

  const denom = Math.max(Math.abs(templateVal), Math.abs(matchVal), 0.01);
  const pctDiff = Math.abs(matchVal - templateVal) / denom * 100;

  // For directional metrics, determine if match is better or worse
  if (HIGHER_IS_BETTER.has(key)) {
    if (matchVal > templateVal) {
      // Match is better — green if meaningfully better, yellow if close
      return pctDiff <= SIMILARITY_THRESHOLD ? 'text-yellow-400' : 'text-green-400';
    } else {
      // Match is worse
      return pctDiff <= SIMILARITY_THRESHOLD ? 'text-yellow-400' : 'text-red-400';
    }
  }

  if (LOWER_IS_BETTER.has(key)) {
    if (matchVal < templateVal) {
      // Match is better (lower)
      return pctDiff <= SIMILARITY_THRESHOLD ? 'text-yellow-400' : 'text-green-400';
    } else {
      // Match is worse (higher)
      return pctDiff <= SIMILARITY_THRESHOLD ? 'text-yellow-400' : 'text-red-400';
    }
  }

  // Neutral metrics — color by similarity only
  if (pctDiff <= SIMILARITY_THRESHOLD) return 'text-green-400';
  if (pctDiff <= BAD_THRESHOLD) return 'text-yellow-400';
  return 'text-red-400';
}
