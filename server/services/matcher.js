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

// ---------- Metric classification for specialized similarity functions ----------

// Valuation ratios: use log-scale comparison (can span 5x–50x+ ranges)
const RATIO_METRICS = new Set([
  'peRatio', 'priceToBook', 'priceToSales', 'evToEBITDA', 'evToRevenue', 'pegRatio',
  'currentRatio', 'interestCoverage',
]);

// Margin / percentage metrics: bounded roughly -1 to +1, use absolute diff
const MARGIN_METRICS = new Set([
  'grossMargin', 'operatingMargin', 'netMargin', 'ebitdaMargin',
  'returnOnEquity', 'returnOnAssets', 'returnOnCapital',
  'earningsYield', 'freeCashFlowYield',
]);

// Growth rates: can swing wildly (-100% to +500%), use dampened comparison
const GROWTH_METRICS = new Set([
  'revenueGrowthYoY', 'revenueGrowth3yr', 'epsGrowthYoY',
]);

// Technical indicators with known bounded ranges
const TECHNICAL_BOUNDED = new Set([
  'rsi14',        // 0-100
  'pctBelowHigh', // 0-100
]);

// Technical indicators expressed as % vs moving average
const TECHNICAL_PCT = new Set([
  'priceVsMa50', 'priceVsMa200',
]);

const MIN_OVERLAP_RATIO = 0.6;
const EPSILON = 0.01;
const SECTOR_MATCH_BONUS = 0.06; // 6% bonus for same-sector matches

Object.freeze(MATCH_METRICS);

// ---------- Same-company detection ----------

// Extended suffix stripping for share classes, warrants, units, preferred, etc.
function baseTicker(t) {
  return t
    .replace(/\.(A|B|C|V|K|P)$/i, '')        // BRK.A, MKC.V → BRK, MKC
    .replace(/-(A|B|C|WS|WT|U|V|P|R|W|UN)$/i, '') // SPAC-A, FOO-WS → SPAC, FOO
    .replace(/[LP]$/i, '');                    // GOOGL → GOOG, preferred
}

// Common dual-class tickers where the base-ticker approach fails (ZG/Z, FOX/FOXA, etc.)
// Map each variant to a canonical company ID
const DUAL_CLASS_MAP = {
  'GOOG': 'GOOG', 'GOOGL': 'GOOG',
  'Z': 'Z', 'ZG': 'Z',
  'FOX': 'FOX', 'FOXA': 'FOX',
  'LBRDK': 'LBRDK', 'LBRDA': 'LBRDK',
  'NWS': 'NWS', 'NWSA': 'NWS',
  'DISCA': 'DISCA', 'DISCB': 'DISCA', 'DISCK': 'DISCA',
  'VIACA': 'VIACA', 'VIACB': 'VIACA',
  'BF-A': 'BF', 'BF-B': 'BF', 'BF.A': 'BF', 'BF.B': 'BF',
  'MOG-A': 'MOG', 'MOG-B': 'MOG', 'MOG.A': 'MOG', 'MOG.B': 'MOG',
  'LSXMA': 'LSXMA', 'LSXMK': 'LSXMA',
  'HEI': 'HEI', 'HEI-A': 'HEI', 'HEI.A': 'HEI',
  'LEN': 'LEN', 'LEN-B': 'LEN', 'LEN.B': 'LEN',
  'MKC': 'MKC', 'MKC-V': 'MKC', 'MKC.V': 'MKC',
  'UA': 'UA', 'UAA': 'UA',
  // Rebrands / restructurings
  'MSTR': 'MSTR', 'STRK': 'MSTR',
  // Parent / subsidiary / bond tickers
  'CMCSA': 'CMCSA', 'CCZ': 'CMCSA',
  'SO': 'SO', 'SOJC': 'SO', 'SOJD': 'SO', 'SOJE': 'SO',
  'ETR': 'ETR', 'ELC': 'ETR',
  'RGA': 'RGA', 'RZB': 'RGA', 'RZC': 'RGA',
  'FHN': 'FHN', 'FHN-A': 'FHN', 'FHN-B': 'FHN', 'FHN-C': 'FHN', 'FHN-D': 'FHN', 'FHN-E': 'FHN',
};

function isSameCompany(tickerA, tickerB, nameA, nameB) {
  if (tickerA === tickerB) return true;

  // Check base ticker stripping
  const baseA = baseTicker(tickerA);
  const baseB = baseTicker(tickerB);
  if (baseA === baseB) return true;

  // Check known dual-class map
  const canonA = DUAL_CLASS_MAP[tickerA.toUpperCase()];
  const canonB = DUAL_CLASS_MAP[tickerB.toUpperCase()];
  if (canonA && canonB && canonA === canonB) return true;

  // Name-based similarity: check if company names indicate the same parent entity
  if (nameA && nameB) {
    const cleanName = (n) => n.replace(/[,.\-()'"]/g, '').replace(/\s+/g, ' ').toLowerCase().trim();
    const cleanA = cleanName(nameA);
    const cleanB = cleanName(nameB);

    // Check if first 2 significant words match (skip "the")
    const sigWords = (s) => s.replace(/^the /, '').split(' ').filter(w => w.length > 2).slice(0, 2).join(' ');
    const sigA = sigWords(cleanA);
    const sigB = sigWords(cleanB);
    if (sigA.length > 4 && sigB.length > 4 && sigA === sigB) {
      return true;
    }

    // Check if one name's first distinctive word matches the other
    // (catches parent/subsidiary like "Entergy Corporation" / "Entergy Louisiana")
    // Skip generic words that appear across unrelated companies
    const GENERIC_WORDS = new Set([
      'american', 'national', 'first', 'united', 'general', 'international',
      'global', 'pacific', 'western', 'eastern', 'southern', 'northern',
      'central', 'federal', 'royal', 'new', 'great', 'golden', 'silver',
      'liberty', 'eagle', 'summit', 'premier', 'standard', 'advanced',
    ]);
    const firstWordA = cleanA.split(' ')[0];
    const firstWordB = cleanB.split(' ')[0];
    if (firstWordA.length > 5 && firstWordA === firstWordB && !GENERIC_WORDS.has(firstWordA)) {
      return true;
    }
  }

  return false;
}

// ---------- Metric-specific similarity functions ----------

/**
 * Ratio metrics (P/E, P/B, EV/EBITDA, etc.)
 * Use log-scale because ratios can span huge ranges (5x to 200x for P/E).
 * Both values must be positive for log comparison; if signs differ, penalize heavily.
 * Scale: 2x ratio diff ≈ 70%, 3x ≈ 52%, 5x ≈ 30%, 10x ≈ 0%
 */
function ratioSimilarity(snapVal, stockVal) {
  // If signs differ (one profitable, one not), very different
  if ((snapVal > 0) !== (stockVal > 0)) {
    // Small similarity if both near zero
    const absSnap = Math.abs(snapVal);
    const absStock = Math.abs(stockVal);
    if (absSnap < 2 && absStock < 2) return 0.3;
    return 0.05;
  }

  const absSnap = Math.abs(snapVal);
  const absStock = Math.abs(stockVal);

  // Guard against zero/tiny values
  if (absSnap < EPSILON && absStock < EPSILON) return 1.0;
  if (absSnap < EPSILON || absStock < EPSILON) return 0.1;

  const logDiff = Math.abs(Math.log10(absSnap) - Math.log10(absStock));
  return Math.max(0, 1 - logDiff);
}

/**
 * Margin / percentage metrics (gross margin, ROE, etc.)
 * These are typically -1 to +1 (or -100% to +100%), use absolute difference.
 * 10 percentage points apart ≈ 90%, 30pp ≈ 70%, 50pp ≈ 50%.
 * Scale factor: 1.0 absolute difference = 0% similar.
 */
function marginSimilarity(snapVal, stockVal) {
  const diff = Math.abs(snapVal - stockVal);
  return Math.max(0, 1 - diff);
}

/**
 * Growth rates (revenue growth YoY, EPS growth, etc.)
 * Can swing from -1.0 (-100%) to +5.0 (+500%) or more.
 * Use dampened comparison: compress extreme values via atan scaling before comparing.
 * This prevents a 500% grower from being "infinitely far" from a 100% grower.
 */
function growthSimilarity(snapVal, stockVal) {
  // Compress to ~(-1.2, 1.2) range using atan scaling
  const compress = (v) => Math.atan(v * 2) / (Math.PI / 2);
  const compSnap = compress(snapVal);
  const compStock = compress(stockVal);
  const diff = Math.abs(compSnap - compStock);
  // Max possible diff in compressed space is ~2.4, normalize to 0-1
  return Math.max(0, 1 - diff / 2.0);
}

/**
 * Bounded technical indicators (RSI: 0-100, pctBelowHigh: 0-100)
 * Use absolute difference scaled to the known range.
 * 10 points apart ≈ 90%, 30 points ≈ 70%, 50 points ≈ 50%.
 */
function boundedSimilarity(snapVal, stockVal, maxRange = 100) {
  const diff = Math.abs(snapVal - stockVal);
  return Math.max(0, 1 - diff / maxRange);
}

/**
 * Technical percentage metrics (priceVsMa50, priceVsMa200: typically -50 to +100)
 * Use absolute difference with a reasonable scale.
 * 10% apart ≈ 80%, 25% ≈ 50%, 50% ≈ 0%.
 */
function technicalPctSimilarity(snapVal, stockVal) {
  const diff = Math.abs(snapVal - stockVal);
  return Math.max(0, 1 - diff / 50);
}

/**
 * Market cap: log-scale comparison (same as before, well-calibrated)
 */
function marketCapSimilarity(snapVal, stockVal) {
  if (snapVal <= 0 || stockVal <= 0) return null;
  const logDiff = Math.abs(Math.log10(snapVal) - Math.log10(stockVal));
  return Math.max(0, 1 - logDiff);
}

/**
 * Beta: absolute difference with scale factor.
 * Beta typically 0.5-2.5; 0.5 apart ≈ 67%, 1.0 apart ≈ 33%.
 */
function betaSimilarity(snapVal, stockVal) {
  const diff = Math.abs(snapVal - stockVal);
  return Math.max(0, 1 - diff / 1.5);
}

/**
 * Debt-to-equity: can range from 0 to 10+. Use log-scale for positive values,
 * special handling for negative equity.
 */
function debtToEquitySimilarity(snapVal, stockVal) {
  // Negative equity (both negative) — both distressed
  if (snapVal < 0 && stockVal < 0) return 0.7;
  // One negative, one positive — very different
  if ((snapVal < 0) !== (stockVal < 0)) return 0.1;
  // Both positive — use log scale
  const safeSnap = Math.max(snapVal, 0.01);
  const safeStock = Math.max(stockVal, 0.01);
  const logDiff = Math.abs(Math.log10(safeSnap) - Math.log10(safeStock));
  return Math.max(0, 1 - logDiff);
}

// ---------- Master similarity dispatcher ----------

function metricSimilarity(metric, snapVal, stockVal) {
  if (snapVal == null || stockVal == null || !isFinite(snapVal) || !isFinite(stockVal)) {
    return null;
  }

  if (metric === 'marketCap') return marketCapSimilarity(snapVal, stockVal);
  if (metric === 'beta') return betaSimilarity(snapVal, stockVal);
  if (metric === 'debtToEquity') return debtToEquitySimilarity(snapVal, stockVal);
  if (metric === 'netDebtToEBITDA') return debtToEquitySimilarity(snapVal, stockVal);
  if (RATIO_METRICS.has(metric)) return ratioSimilarity(snapVal, stockVal);
  if (MARGIN_METRICS.has(metric)) return marginSimilarity(snapVal, stockVal);
  if (GROWTH_METRICS.has(metric)) return growthSimilarity(snapVal, stockVal);
  if (TECHNICAL_BOUNDED.has(metric)) return boundedSimilarity(snapVal, stockVal, 100);
  if (TECHNICAL_PCT.has(metric)) return technicalPctSimilarity(snapVal, stockVal);

  // Fallback: generic percentage difference
  const denominator = Math.max(Math.abs(snapVal), Math.abs(stockVal), EPSILON);
  const diff = Math.abs(snapVal - stockVal) / denominator;
  return Math.max(0, 1 - diff);
}

// ---------- Growth quality check ----------
// Penalizes matches where EPS growth is high but revenue growth diverges in direction
// from the snapshot. This catches "earnings recovery" companies that aren't
// truly growing the top line the way the template company was.

function growthQualityPenalty(snapshot, stock) {
  const snapRevG = snapshot.revenueGrowthYoY;
  const snapEpsG = snapshot.epsGrowthYoY;
  const stockRevG = stock.revenueGrowthYoY;
  const stockEpsG = stock.epsGrowthYoY;

  // Only apply if both have growth data
  if (snapRevG == null || snapEpsG == null || stockRevG == null || stockEpsG == null) return 1.0;
  if (!isFinite(snapRevG) || !isFinite(snapEpsG) || !isFinite(stockRevG) || !isFinite(stockEpsG)) return 1.0;

  let penalty = 1.0;

  // If snapshot has positive revenue growth but match has negative (or vice versa),
  // apply a penalty proportional to how different the directions are.
  // e.g., CLS had +17% rev growth; a match with -6% rev growth is directionally wrong.
  if (snapRevG > 0.05 && stockRevG < -0.02) {
    penalty *= 0.94; // 6% penalty for revenue direction mismatch
  } else if (snapRevG < -0.02 && stockRevG > 0.05) {
    penalty *= 0.94;
  }

  // If snapshot had balanced growth (both rev & EPS positive), reward matches that also
  // have balanced growth; penalize those with extreme EPS growth but declining revenue
  // (likely cost-cutting or one-time gains, not sustainable breakout growth)
  if (snapRevG > 0.05 && snapEpsG > 0.10) {
    // Snapshot is a "quality grower" — revenue up AND eps up
    if (stockRevG < 0 && stockEpsG > 1.0) {
      // Match has declining revenue but extreme EPS growth (>100%) — likely recovery, not breakout
      penalty *= 0.90; // 10% penalty
    } else if (stockRevG > 0.03 && stockEpsG > 0.05) {
      // Match also has balanced growth — small reward
      penalty *= 1.03; // 3% bonus
    }
  }

  return penalty;
}

// ---------- Core similarity scoring ----------

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
    metricScores.push({ metric, similarity, weight });
  }

  if (totalWeight === 0) {
    return { score: 0, metricScores: [], overlapCount: 0, overlapRatio: 0 };
  }

  let baseScore = (score / totalWeight) * 100;

  // Overlap penalty: penalize matches with sparse data coverage
  const overlapRatio = snapshotPopulatedCount > 0
    ? overlapCount / snapshotPopulatedCount
    : 0;
  baseScore *= Math.sqrt(overlapRatio);

  // Growth quality adjustment: penalize/reward based on growth profile alignment
  baseScore *= growthQualityPenalty(snapshot, stock);

  // Sector match bonus: same-sector matches get a boost since breakout patterns
  // are more comparable within the same sector/industry.
  if (snapshot.sector && stock.sector && snapshot.sector === stock.sector) {
    baseScore *= (1 + SECTOR_MATCH_BONUS);
  }

  const finalScore = Math.max(0, Math.min(99, baseScore));
  return { score: finalScore, metricScores, overlapCount, overlapRatio };
}

// ---------- Match finding ----------

function findMatches(snapshot, universe, limit = 10) {
  if (!snapshot || universe.size === 0) return [];

  const snapshotPopulatedCount = MATCH_METRICS.reduce((count, metric) => {
    const v = snapshot[metric];
    return (v != null && isFinite(v)) ? count + 1 : count;
  }, 0);

  if (snapshotPopulatedCount < 4) return [];

  const allStocks = Array.from(universe.values());
  const snapBase = baseTicker(snapshot.ticker);

  const results = allStocks
    .filter(stock => !isSameCompany(
      stock.ticker, snapshot.ticker,
      stock.companyName, snapshot.companyName
    ))
    .map(stock => {
      const { score, metricScores, overlapCount, overlapRatio } =
        calculateSimilarity(snapshot, stock, snapshotPopulatedCount);

      // Rank by weighted contribution (similarity × weight) so the most IMPORTANT
      // matching metrics surface, not just the ones with highest raw similarity.
      // This means investors see "revenueGrowthYoY, pegRatio" instead of "returnOnAssets, netMargin"
      const rankedByContribution = [...metricScores]
        .sort((a, b) => (b.similarity * b.weight) - (a.similarity * a.weight));
      const topMatches = rankedByContribution.slice(0, 3).map(m => m.metric);

      // For differences, rank by weighted MISS (how much score was lost on this metric)
      const rankedByMiss = [...metricScores]
        .sort((a, b) => ((1 - a.similarity) * a.weight) - ((1 - b.similarity) * b.weight));
      const topDifferences = rankedByMiss.slice(0, 3).map(m => m.metric);

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

module.exports = { findMatches, MATCH_METRICS, isSameCompany, baseTicker };
