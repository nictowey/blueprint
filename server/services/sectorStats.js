/**
 * Compute sector median values for all match metrics.
 * Used for sector-relative scoring: instead of comparing raw values,
 * compare how each stock deviates from its sector median.
 */

const METRICS_FOR_SECTOR = [
  'peRatio', 'priceToBook', 'priceToSales', 'evToEBITDA', 'evToRevenue', 'pegRatio',
  'grossMargin', 'operatingMargin', 'netMargin', 'ebitdaMargin',
  'returnOnEquity', 'returnOnAssets', 'returnOnCapital',
  'revenueGrowthYoY', 'revenueGrowth3yr', 'epsGrowthYoY',
  'currentRatio', 'debtToEquity', 'interestCoverage', 'netDebtToEBITDA', 'freeCashFlowYield',
  'marketCap',
  'rsi14', 'pctBelowHigh', 'priceVsMa50', 'priceVsMa200', 'beta',
];

// Cache: { sector -> { metric -> { median, q25, q75, count } } }
let sectorMedianCache = {};
let lastComputed = 0;
const RECOMPUTE_INTERVAL = 10 * 60 * 1000; // 10 minutes

function median(arr) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function percentile(arr, p) {
  if (arr.length === 0) return null;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (idx - lower) * (sorted[upper] - sorted[lower]);
}

/**
 * Compute sector statistics from the universe cache.
 * @param {Map} universe - the stock universe map
 */
function computeSectorStats(universe) {
  const now = Date.now();
  if (now - lastComputed < RECOMPUTE_INTERVAL && Object.keys(sectorMedianCache).length > 0) {
    return sectorMedianCache;
  }

  const sectorBuckets = {};

  for (const stock of universe.values()) {
    const sector = stock.sector;
    if (!sector) continue;

    if (!sectorBuckets[sector]) {
      sectorBuckets[sector] = {};
      for (const m of METRICS_FOR_SECTOR) sectorBuckets[sector][m] = [];
    }

    for (const m of METRICS_FOR_SECTOR) {
      const val = stock[m];
      if (val != null && isFinite(val)) {
        sectorBuckets[sector][m].push(val);
      }
    }
  }

  const result = {};
  for (const [sector, metrics] of Object.entries(sectorBuckets)) {
    result[sector] = {};
    for (const m of METRICS_FOR_SECTOR) {
      const values = metrics[m];
      if (values.length < 5) {
        // Not enough data for meaningful sector stats
        result[sector][m] = null;
        continue;
      }
      result[sector][m] = {
        median: median(values),
        q25: percentile(values, 25),
        q75: percentile(values, 75),
        count: values.length,
      };
    }
  }

  sectorMedianCache = result;
  lastComputed = now;
  console.log(`[sectorStats] Computed medians for ${Object.keys(result).length} sectors`);
  return result;
}

/**
 * Get the sector-relative z-score for a metric value.
 * Returns how many IQR units the value is from the sector median.
 * Null if sector stats unavailable.
 */
function sectorZScore(value, sectorStats, metric) {
  if (value == null || !isFinite(value)) return null;
  const stats = sectorStats?.[metric];
  if (!stats) return null;

  const iqr = stats.q75 - stats.q25;
  // If IQR is near-zero, sector has no meaningful spread — return null
  // instead of 0 (which would falsely claim "perfectly aligned with sector").
  if (iqr < 0.001) return null;

  return (value - stats.median) / iqr;
}

/**
 * Get sector stats for a specific sector.
 */
function getSectorStats(universe, sector) {
  const allStats = computeSectorStats(universe);
  return allStats[sector] || null;
}

module.exports = {
  computeSectorStats,
  sectorZScore,
  getSectorStats,
  METRICS_FOR_SECTOR,
};
