const MATCH_METRICS = [
  // Valuation
  'peRatio', 'priceToBook', 'priceToSales', 'evToEBITDA', 'evToRevenue', 'pegRatio',
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
  // Volume
  'relativeVolume',
];

const { getProfile, DEFAULT_PROFILE } = require('./matchProfiles');
const { computeSectorStats, sectorZScore } = require('./sectorStats');

// Default weights — used when no profile is specified (growth_breakout)
const DEFAULT_METRIC_WEIGHTS = {
  // --- Tier 1: Core breakout signals (3.0) ---
  revenueGrowthYoY: 3.0,
  epsGrowthYoY: 3.0,
  pegRatio: 3.0,
  operatingMargin: 3.0,
  // --- Tier 2: Valuation & momentum setup (2.5) ---
  peRatio: 2.5,
  evToEBITDA: 2.5,
  pctBelowHigh: 2.5,
  priceVsMa200: 2.5,
  marketCap: 2.5,
  // --- Tier 3: Quality & risk confirmation (2.0) ---
  returnOnEquity: 2.0,
  revenueGrowth3yr: 2.0,
  freeCashFlowYield: 2.0,
  returnOnCapital: 2.0,
  priceVsMa50: 2.0,
  // --- Tier 4: Risk guardrails (1.5) ---
  debtToEquity: 1.5,
  netDebtToEBITDA: 1.5,
  rsi14: 1.5,
  grossMargin: 1.5,
  // --- Tier 5: Supporting context (1.0) ---
  beta: 1.0,
  netMargin: 1.0,
  ebitdaMargin: 1.0,
  returnOnAssets: 1.0,
  priceToBook: 1.0,
  priceToSales: 1.0,
  evToRevenue: 1.0,
  currentRatio: 1.0,
  interestCoverage: 1.0,
  relativeVolume: 1.5,
};

// Kept for backward-compat — existing code that references METRIC_WEIGHTS directly
const METRIC_WEIGHTS = DEFAULT_METRIC_WEIGHTS;

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
  'freeCashFlowYield',
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
  // Dual-class / tracking stocks
  'FWONK': 'FWON', 'FWONA': 'FWON',
  'LSXMA': 'LSXM', 'LSXMK': 'LSXM', 'LSXMB': 'LSXM',
  'BATRK': 'BATR', 'BATRA': 'BATR',
  // Parent / subsidiary / bond tickers
  'CMCSA': 'CMCSA', 'CCZ': 'CMCSA',
  'SO': 'SO', 'SOJC': 'SO', 'SOJD': 'SO', 'SOJE': 'SO',
  'ETR': 'ETR', 'ELC': 'ETR',
  'RGA': 'RGA', 'RZB': 'RGA', 'RZC': 'RGA',
  'FHN': 'FHN', 'FHN-A': 'FHN', 'FHN-B': 'FHN', 'FHN-C': 'FHN', 'FHN-D': 'FHN', 'FHN-E': 'FHN',
  'ESBA': 'ESRT', 'ESRT': 'ESRT',  // Empire State Realty
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
 * These are stored as decimals: 0.10 = 10%, 0.50 = 50%.
 *
 * Uses a hybrid approach: blends absolute pp difference with relative comparison.
 * This prevents thin-margin or low-yield metrics from appearing artificially similar
 * (e.g., 3.1% vs 0.5% FCF yield are fundamentally different even though only 2.6pp apart).
 *
 * For large margins (>15%): mostly absolute comparison (40pp scale)
 *   20% vs 15% → ~87%  (close margins)
 *   40% vs 25% → ~63%  (meaningful gap)
 * For small margins (<10%): relative comparison dominates
 *   4.4% vs 2.8% → ~64%  (57% relative gap matters)
 *   3.1% vs 0.5% → ~42%  (6x difference is huge)
 */
function marginSimilarity(snapVal, stockVal) {
  const diff = Math.abs(snapVal - stockVal);

  // Absolute component: 40pp scale (works well for mid-to-large margins)
  const absSim = Math.max(0, 1 - diff / 0.40);

  // Relative component: how different are they proportionally?
  const maxAbs = Math.max(Math.abs(snapVal), Math.abs(stockVal));
  if (maxAbs < 0.005) return absSim; // Both near zero — absolute is fine

  const relDiff = diff / maxAbs;
  const relSim = Math.max(0, 1 - relDiff);

  // Blend: when values are small, lean on relative; when large, lean on absolute
  // At 5% margin: weight is ~67% relative, 33% absolute
  // At 20% margin: weight is ~33% relative, 67% absolute
  // At 40%+ margin: weight is ~20% relative, 80% absolute
  const relWeight = Math.max(0.20, Math.min(0.80, 1 - maxAbs * 3));
  return relWeight * relSim + (1 - relWeight) * absSim;
}

/**
 * Growth rates (revenue growth YoY, EPS growth, etc.)
 * Can swing from -1.0 (-100%) to +5.0 (+500%) or more.
 *
 * Uses absolute percentage-point difference for moderate values (the common case),
 * with relative comparison for extreme high-growth pairs so 100% vs 50% growers
 * aren't penalized as harshly as 20% vs -30%.
 *
 * Calibration (as decimal inputs):
 *   17% vs 10.5% → ~78%   (6.5pp diff — meaningful gap)
 *   17% vs 15%   → ~93%   (close)
 *   17% vs 5%    → ~60%   (significant divergence)
 *   17% vs -5%   → ~15%   (opposite directions)
 *   50% vs 40%   → ~70%   (both high-growth, relative comparison)
 */
function growthSimilarity(snapVal, stockVal) {
  // Direction penalty: opposite signs are fundamentally different stories
  const snapPos = snapVal > 0.02;
  const snapNeg = snapVal < -0.02;
  const stockPos = stockVal > 0.02;
  const stockNeg = stockVal < -0.02;

  if ((snapPos && stockNeg) || (snapNeg && stockPos)) {
    // Opposite directions — heavy penalty, small residual based on magnitude closeness
    const diff = Math.abs(snapVal - stockVal);
    return Math.max(0, 0.30 - diff * 0.5);
  }

  const diff = Math.abs(snapVal - stockVal);

  // For high-growth pairs (both > 30%), use relative comparison
  // because 100% vs 50% is more "similar" than 20% vs -10%
  if (Math.abs(snapVal) > 0.30 && Math.abs(stockVal) > 0.30) {
    const maxAbs = Math.max(Math.abs(snapVal), Math.abs(stockVal));
    const relDiff = diff / maxAbs;
    return Math.max(0, 1 - relDiff * 1.5);
  }

  // Moderate values: absolute percentage-point difference
  // Scale: 5pp ≈ 83%, 10pp ≈ 67%, 15pp ≈ 50%, 30pp ≈ 0%
  return Math.max(0, 1 - diff / 0.30);
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

/**
 * Relative volume: log-scale comparison.
 * 0.5x vs 1.0x ≈ 70%, 1.0x vs 2.0x ≈ 70%, 0.5x vs 3.0x ≈ 22%
 * Two stocks with similarly elevated/depressed volume are in similar trading regimes.
 */
function relativeVolumeSimilarity(snapVal, stockVal) {
  if (snapVal <= 0 || stockVal <= 0) return null;
  const logDiff = Math.abs(Math.log2(snapVal) - Math.log2(stockVal));
  return Math.max(0, 1 - logDiff / 2.5);
}

function metricSimilarity(metric, snapVal, stockVal) {
  if (snapVal == null || stockVal == null || !isFinite(snapVal) || !isFinite(stockVal)) {
    return null;
  }

  if (metric === 'marketCap') return marketCapSimilarity(snapVal, stockVal);
  if (metric === 'beta') return betaSimilarity(snapVal, stockVal);
  if (metric === 'relativeVolume') return relativeVolumeSimilarity(snapVal, stockVal);
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

// ---------- Sector-relative similarity ----------

/**
 * Compare two stocks' sector-relative positions.
 * If both stocks sit at the same distance from their sector median (in IQR units),
 * they have similar "sector-relative profiles" even if raw values differ.
 *
 * E.g., a tech stock with P/E 2 IQR above tech median and an industrial stock
 * P/E 2 IQR above industrial median are "similarly positioned" within their sectors.
 *
 * Returns null if sector data unavailable for either stock.
 */
function sectorRelativeSimilarity(metric, snapVal, stockVal, snapSectorStats, stockSectorStats) {
  const snapZ = sectorZScore(snapVal, snapSectorStats, metric);
  const stockZ = sectorZScore(stockVal, stockSectorStats, metric);

  if (snapZ == null || stockZ == null) return null;

  // Compare z-scores: difference of 0 = identical positioning, 2+ = very different
  const zDiff = Math.abs(snapZ - stockZ);
  return Math.max(0, 1 - zDiff / 3); // 3 IQR difference = 0% similarity
}

// ---------- Momentum composite ----------

/**
 * Compute a momentum similarity based on price trajectory.
 * Uses recentCloses (30 days) to derive short-term and medium-term momentum.
 * Two stocks with similar rate-of-change profiles are more likely to be
 * in the same phase of their price cycle.
 */
function momentumSimilarity(snapCloses, stockCloses) {
  if (!snapCloses || snapCloses.length < 20 || !stockCloses || stockCloses.length < 20) {
    return null;
  }

  // 1-week rate of change (last 5 vs 5 before)
  function roc(closes, lookback) {
    const end = closes[closes.length - 1];
    const start = closes[Math.max(0, closes.length - 1 - lookback)];
    if (!start || start === 0) return null;
    return (end - start) / start;
  }

  const snapRoc5 = roc(snapCloses, 5);
  const snapRoc20 = roc(snapCloses, 20);
  const stockRoc5 = roc(stockCloses, 5);
  const stockRoc20 = roc(stockCloses, 20);

  if (snapRoc5 == null || stockRoc5 == null || snapRoc20 == null || stockRoc20 == null) return null;

  // Compare short-term momentum (5-day ROC)
  const shortDiff = Math.abs(snapRoc5 - stockRoc5);
  const shortSim = Math.max(0, 1 - shortDiff / 0.15); // 15% ROC diff = 0%

  // Compare medium-term momentum (20-day ROC)
  const medDiff = Math.abs(snapRoc20 - stockRoc20);
  const medSim = Math.max(0, 1 - medDiff / 0.25); // 25% ROC diff = 0%

  // Blend: medium-term gets more weight (more meaningful for breakout patterns)
  return shortSim * 0.35 + medSim * 0.65;
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

function calculateSimilarity(snapshot, stock, snapshotPopulatedCount, options = {}) {
  const weights = options.weights || METRIC_WEIGHTS;
  const sectorBonus = options.sectorBonus != null ? options.sectorBonus : SECTOR_MATCH_BONUS;
  const sectorStats = options.sectorStats || null;

  // Get sector-specific stats for each stock (may be different sectors)
  const snapSectorStats = sectorStats?.[snapshot.sector] || null;
  const stockSectorStats = sectorStats?.[stock.sector] || null;

  let score = 0;
  let totalWeight = 0;
  let overlapCount = 0;
  const metricScores = [];

  for (const metric of MATCH_METRICS) {
    const weight = weights[metric] ?? 1.0;
    const rawSim = metricSimilarity(metric, snapshot[metric], stock[metric]);

    if (rawSim === null) continue;

    // Blend raw similarity with sector-relative similarity (if available)
    let similarity = rawSim;
    if (snapSectorStats && stockSectorStats) {
      const sectorSim = sectorRelativeSimilarity(metric, snapshot[metric], stock[metric], snapSectorStats, stockSectorStats);
      if (sectorSim != null) {
        // 70% raw + 30% sector-relative: raw comparison is still primary,
        // sector context refines it. Cross-sector matches benefit most.
        similarity = rawSim * 0.70 + sectorSim * 0.30;
      }
    }

    overlapCount++;
    score += similarity * weight;
    totalWeight += weight;
    metricScores.push({ metric, similarity, weight });
  }

  if (totalWeight === 0) {
    return { score: 0, metricScores: [], overlapCount: 0, overlapRatio: 0 };
  }

  let baseScore = (score / totalWeight) * 100;

  // Momentum composite: add as a bonus/penalty (up to ±3 points)
  const momSim = momentumSimilarity(snapshot.recentCloses, stock.recentCloses);
  if (momSim != null) {
    // momSim ranges 0-1; center at 0.5, so ±0.5 maps to ±3 points
    baseScore += (momSim - 0.5) * 6;
  }

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
    baseScore *= (1 + sectorBonus);
  }

  const finalScore = Math.max(0, Math.min(99, baseScore));

  // --- Confidence scoring ---
  // Measures how trustworthy/reliable the match score is
  const confidence = computeConfidence(metricScores, overlapCount, snapshotPopulatedCount, momSim, options.sectorStats, stock);

  return { score: finalScore, metricScores, overlapCount, overlapRatio, confidence };
}

/**
 * Compute a 0-100 confidence score for a match.
 * Factors:
 *   1. Data coverage (40%): what fraction of template metrics had data
 *   2. Score consistency (30%): low variance across metrics = more confident
 *   3. Momentum data available (15%): momentum signal adds confidence
 *   4. Sector stats available (15%): sector-relative scoring adds confidence
 */
function computeConfidence(metricScores, overlapCount, snapshotPopulatedCount, momSim, sectorStats, stock) {
  // 1. Data coverage: 60%+ overlap is minimum; 90%+ is excellent
  const coverageRatio = snapshotPopulatedCount > 0 ? overlapCount / snapshotPopulatedCount : 0;
  const coverageScore = Math.min(1, Math.max(0, (coverageRatio - 0.5) / 0.5)); // 50%→0, 100%→1

  // 2. Score consistency: standard deviation of per-metric similarities
  // Low std dev = metrics agree = more confident
  let consistencyScore = 0.5; // default if not enough data
  if (metricScores.length >= 5) {
    const sims = metricScores.map(m => m.similarity);
    const mean = sims.reduce((s, v) => s + v, 0) / sims.length;
    const variance = sims.reduce((s, v) => s + (v - mean) ** 2, 0) / sims.length;
    const stdDev = Math.sqrt(variance);
    // stdDev of 0 = perfect consistency (1.0), stdDev of 0.35+ = poor (0.0)
    consistencyScore = Math.max(0, 1 - stdDev / 0.35);
  }

  // 3. Momentum data: binary (available or not)
  const momentumScore = momSim != null ? 1.0 : 0.0;

  // 4. Sector stats: does this stock's sector have sector-relative data?
  const hasSectorStats = !!(sectorStats && stock.sector && sectorStats[stock.sector]);
  const sectorScore = hasSectorStats ? 1.0 : 0.0;

  // Weighted combination
  const raw = coverageScore * 0.40 + consistencyScore * 0.30 + momentumScore * 0.15 + sectorScore * 0.15;

  // Map to 0-100 and assign a label
  const score = Math.round(raw * 100);
  let level;
  if (score >= 80) level = 'high';
  else if (score >= 50) level = 'medium';
  else level = 'low';

  return { score, level, coverageRatio: Math.round(coverageRatio * 100), metricsAvailable: overlapCount };
}

// ---------- Match finding ----------

/**
 * @param {object}  snapshot  — template stock metrics
 * @param {Map}     universe  — stock universe (after any pre-filtering)
 * @param {number}  limit     — max results (default 10)
 * @param {object}  [profileOptions] — { weights, sectorBonus } from a match profile
 */
function findMatches(snapshot, universe, limit = 10, profileOptions = {}) {
  if (!snapshot || universe.size === 0) return [];

  const snapshotPopulatedCount = MATCH_METRICS.reduce((count, metric) => {
    const v = snapshot[metric];
    return (v != null && isFinite(v)) ? count + 1 : count;
  }, 0);

  if (snapshotPopulatedCount < 4) return [];

  // Compute sector stats from universe for sector-relative scoring
  const sectorStats = computeSectorStats(universe);

  const allStocks = Array.from(universe.values());

  const results = allStocks
    .filter(stock => !isSameCompany(
      stock.ticker, snapshot.ticker,
      stock.companyName, snapshot.companyName
    ))
    .map(stock => {
      const { score, metricScores, overlapCount, overlapRatio, confidence } =
        calculateSimilarity(snapshot, stock, snapshotPopulatedCount, { ...profileOptions, sectorStats });

      // Rank by weighted contribution (similarity × weight) so the most IMPORTANT
      // matching metrics surface, not just the ones with highest raw similarity.
      const rankedByContribution = [...metricScores]
        .sort((a, b) => (b.similarity * b.weight) - (a.similarity * a.weight));
      const topMatches = rankedByContribution.slice(0, 3).map(m => m.metric);

      // For differences, rank by weighted MISS (how much score was lost on this metric)
      const topMatchSet = new Set(topMatches);
      const rankedByMiss = [...metricScores]
        .sort((a, b) => ((1 - b.similarity) * b.weight) - ((1 - a.similarity) * a.weight));
      const topDifferences = rankedByMiss
        .filter(m => !topMatchSet.has(m.metric))
        .slice(0, 3)
        .map(m => m.metric);

      return {
        ...stock,
        _rawScore: score,
        _overlapRatio: overlapRatio,
        matchScore: Math.round(score * 10) / 10,
        metricsCompared: overlapCount,
        confidence,
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

module.exports = { findMatches, calculateSimilarity, MATCH_METRICS, isSameCompany, baseTicker };
