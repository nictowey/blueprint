const express = require('express');
const router = express.Router();
const { getCache, isReady } = require('../services/universe');

// ---------------------------------------------------------------------------
// Breakout Screener v2 — Strict calibration
//
// Scores every stock on the criteria real investors use to identify
// pre-breakout setups. Designed for distribution:
//   - Most stocks: 30-50 (average, not breakout material)
//   - Good setups:  55-65 (worth watching)
//   - Strong:       65-75 (high conviction watchlist)
//   - Exceptional:  75-85 (rare, genuine breakout setup)
//   - 85+:          Extremely rare, near-perfect profile
//
// Key design principles:
//   1. Zero score for bad values (no free points)
//   2. Steep curves — only truly exceptional metrics score >0.8
//   3. Growth gate — must show real growth to qualify
//   4. Minimum market cap — illiquid micro-caps excluded
//   5. Data quality checks — extreme values penalized
// ---------------------------------------------------------------------------

// Minimum market cap to qualify (filter out illiquid micro-caps)
const MIN_MARKET_CAP = 300_000_000; // $300M — excludes illiquid micro-caps but keeps small-caps

// ---------- Signal scoring functions ----------
// Each returns { score: 0-1, signal: string, value: string } or null

/**
 * Revenue Growth YoY — The primary breakout signal.
 * Strict calibration: <5% gets 0, 5-15% is modest, 15-30% is good,
 * 30-50% is strong, 50%+ is exceptional.
 * Cap at 200% — beyond that is often M&A or tiny-base distortion.
 */
function scoreRevenueGrowth(stock) {
  const v = stock.revenueGrowthYoY;
  if (v == null || !isFinite(v)) return null;
  let pct = v * 100;

  // Cap extreme values (likely M&A, base effects, or data issues)
  if (pct > 200) pct = 200;

  let score;
  if (pct < 0) score = 0;
  else if (pct < 5) score = pct / 5 * 0.10;             // 0-5%: barely registers (0-0.10)
  else if (pct < 15) score = 0.10 + (pct - 5) / 10 * 0.20;  // 5-15%: modest (0.10-0.30)
  else if (pct < 25) score = 0.30 + (pct - 15) / 10 * 0.25;  // 15-25%: good (0.30-0.55)
  else if (pct < 40) score = 0.55 + (pct - 25) / 15 * 0.20;  // 25-40%: strong (0.55-0.75)
  else if (pct < 60) score = 0.75 + (pct - 40) / 20 * 0.15;  // 40-60%: very strong (0.75-0.90)
  else score = Math.min(1.0, 0.90 + (pct - 60) / 140 * 0.10); // 60%+: exceptional (0.90-1.0)

  return { score, signal: 'Revenue Growth', value: `${v * 100 >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%` };
}

/**
 * EPS Growth YoY — Earnings acceleration.
 * Must be meaningfully positive. Extremely high EPS growth (>200%)
 * is capped — often from near-zero base or one-time items.
 */
function scoreEpsGrowth(stock) {
  const v = stock.epsGrowthYoY;
  if (v == null || !isFinite(v)) return null;
  let pct = v * 100;

  // Cap extreme values
  if (pct > 300) pct = 300;

  let score;
  if (pct < 0) score = 0;
  else if (pct < 10) score = pct / 10 * 0.10;
  else if (pct < 25) score = 0.10 + (pct - 10) / 15 * 0.25;
  else if (pct < 50) score = 0.35 + (pct - 25) / 25 * 0.25;
  else if (pct < 80) score = 0.60 + (pct - 50) / 30 * 0.20;
  else if (pct < 150) score = 0.80 + (pct - 80) / 70 * 0.10;
  else score = Math.min(1.0, 0.90 + (pct - 150) / 150 * 0.10);

  return { score, signal: 'EPS Growth', value: `${v * 100 >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%` };
}

/**
 * Revenue 3yr CAGR — Sustained growth (not a one-quarter fluke).
 */
function scoreRevenueGrowth3yr(stock) {
  const v = stock.revenueGrowth3yr;
  if (v == null || !isFinite(v)) return null;
  const pct = v * 100;
  let score;
  if (pct < 3) score = 0;
  else if (pct < 8) score = (pct - 3) / 5 * 0.15;
  else if (pct < 15) score = 0.15 + (pct - 8) / 7 * 0.25;
  else if (pct < 25) score = 0.40 + (pct - 15) / 10 * 0.30;
  else if (pct < 40) score = 0.70 + (pct - 25) / 15 * 0.20;
  else score = Math.min(1.0, 0.90 + (pct - 40) / 60 * 0.10);
  return { score, signal: '3yr Rev CAGR', value: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%` };
}

/**
 * PEG Ratio — Growth relative to valuation.
 * Only valid when positive and within a reasonable range.
 * PEG <0.3 is suspicious (often data quality), penalize.
 * Sweet spot: 0.5-1.5
 */
function scorePEG(stock) {
  const v = stock.pegRatio;
  if (v == null || !isFinite(v) || v <= 0) return null;

  let score;
  if (v < 0.3) score = 0.40;         // suspiciously low — likely data issue
  else if (v < 0.5) score = 0.70;    // very attractive if real
  else if (v < 1.0) score = 0.85 - (v - 0.5) / 0.5 * 0.05; // 0.5-1.0: sweet spot (0.80-0.85)
  else if (v < 1.5) score = 0.65 - (v - 1.0) / 0.5 * 0.10; // 1.0-1.5: fair (0.55-0.65)
  else if (v < 2.0) score = 0.45 - (v - 1.5) / 0.5 * 0.15; // 1.5-2.0: getting expensive (0.30-0.45)
  else if (v < 3.0) score = 0.20 - (v - 2.0) / 1.0 * 0.10; // 2.0-3.0: expensive (0.10-0.20)
  else score = 0.05;                  // >3.0: growth fully priced in

  return { score, signal: 'PEG Ratio', value: v.toFixed(2) };
}

/**
 * Operating Margin — Business quality.
 * Must be positive for a real breakout candidate.
 */
function scoreOperatingMargin(stock) {
  const v = stock.operatingMargin;
  if (v == null || !isFinite(v)) return null;
  const pct = v * 100;
  let score;
  if (pct < 0) score = 0;
  else if (pct < 5) score = pct / 5 * 0.10;
  else if (pct < 10) score = 0.10 + (pct - 5) / 5 * 0.20;
  else if (pct < 18) score = 0.30 + (pct - 10) / 8 * 0.25;
  else if (pct < 28) score = 0.55 + (pct - 18) / 10 * 0.20;
  else if (pct < 40) score = 0.75 + (pct - 28) / 12 * 0.15;
  else score = Math.min(1.0, 0.90 + (pct - 40) / 30 * 0.10);
  return { score, signal: 'Op Margin', value: `${pct.toFixed(1)}%` };
}

/**
 * ROE — Capital efficiency. Negative or <5% = bad.
 */
function scoreROE(stock) {
  const v = stock.returnOnEquity;
  if (v == null || !isFinite(v)) return null;
  const pct = v * 100;
  // Cap absurd ROE (>100% usually means tiny equity, not efficiency)
  if (pct > 100) return { score: 0.40, signal: 'ROE', value: `${pct.toFixed(0)}%` };
  let score;
  if (pct < 0) score = 0;
  else if (pct < 8) score = pct / 8 * 0.15;
  else if (pct < 15) score = 0.15 + (pct - 8) / 7 * 0.30;
  else if (pct < 25) score = 0.45 + (pct - 15) / 10 * 0.25;
  else if (pct < 40) score = 0.70 + (pct - 25) / 15 * 0.15;
  else score = Math.min(0.90, 0.85 + (pct - 40) / 60 * 0.05); // cap at 0.90
  return { score, signal: 'ROE', value: `${pct.toFixed(1)}%` };
}

/**
 * FCF Yield — Real cash generation.
 */
function scoreFCFYield(stock) {
  const v = stock.freeCashFlowYield;
  if (v == null || !isFinite(v)) return null;
  const pct = v * 100;
  let score;
  if (pct < 0) score = 0;
  else if (pct < 1) score = pct * 0.10;
  else if (pct < 3) score = 0.10 + (pct - 1) / 2 * 0.25;
  else if (pct < 5) score = 0.35 + (pct - 3) / 2 * 0.25;
  else if (pct < 8) score = 0.60 + (pct - 5) / 3 * 0.20;
  else score = Math.min(0.90, 0.80 + (pct - 8) / 10 * 0.10);
  return { score, signal: 'FCF Yield', value: `${pct.toFixed(1)}%` };
}

/**
 * RSI(14) — Momentum positioning.
 * Breakout sweet spot: 55-70 (strong momentum, not overbought).
 * Much tighter scoring — average RSI ~50 should score low.
 */
function scoreRSI(stock) {
  const v = stock.rsi14;
  if (v == null || !isFinite(v)) return null;
  let score;
  if (v >= 58 && v <= 68) score = 0.85;       // sweet spot
  else if (v >= 55 && v < 58) score = 0.70;
  else if (v > 68 && v <= 72) score = 0.65;
  else if (v >= 50 && v < 55) score = 0.40;   // neutral — not a signal
  else if (v > 72 && v <= 78) score = 0.35;   // overbought risk
  else if (v >= 45 && v < 50) score = 0.20;
  else if (v > 78) score = 0.10;              // extended
  else score = 0;                              // weak/oversold
  return { score, signal: 'RSI', value: v.toFixed(0) };
}

/**
 * % Below 52w High — Consolidating near highs.
 * Strict: only within 10% counts. >20% = not a breakout setup.
 */
function scorePctBelowHigh(stock) {
  const v = stock.pctBelowHigh;
  if (v == null || !isFinite(v)) return null;
  let score;
  if (v <= 3) score = 0.90;          // at highs
  else if (v <= 7) score = 0.70;     // minor pullback
  else if (v <= 12) score = 0.45;    // moderate pullback
  else if (v <= 20) score = 0.20;    // correction
  else if (v <= 30) score = 0.05;    // breakdown
  else score = 0;                    // broken trend
  return { score, signal: 'Near 52w High', value: `${v.toFixed(1)}% below` };
}

/**
 * Price vs 200MA — Institutional trend direction.
 * Above is good, but >40% above is overextended.
 */
function scorePriceVsMa200(stock) {
  const v = stock.priceVsMa200;
  if (v == null || !isFinite(v)) return null;
  let score;
  if (v >= 5 && v <= 15) score = 0.80;        // healthy uptrend
  else if (v > 15 && v <= 25) score = 0.60;   // strong
  else if (v >= 0 && v < 5) score = 0.50;     // just above — early
  else if (v > 25 && v <= 40) score = 0.35;   // extended
  else if (v > 40) score = 0.15;              // parabolic
  else if (v >= -5 && v < 0) score = 0.20;    // slightly below
  else score = 0;                              // below trend
  return { score, signal: 'vs 200MA', value: `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` };
}

/**
 * Price vs 50MA — Short-term momentum.
 */
function scorePriceVsMa50(stock) {
  const v = stock.priceVsMa50;
  if (v == null || !isFinite(v)) return null;
  let score;
  if (v >= 2 && v <= 8) score = 0.75;
  else if (v > 8 && v <= 15) score = 0.55;
  else if (v >= 0 && v < 2) score = 0.40;
  else if (v > 15 && v <= 25) score = 0.25;
  else if (v > 25) score = 0.10;
  else if (v >= -3 && v < 0) score = 0.15;
  else score = 0;
  return { score, signal: 'vs 50MA', value: `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` };
}

/**
 * Debt/Equity — Financial health guardrail.
 */
function scoreDebtToEquity(stock) {
  const v = stock.debtToEquity;
  if (v == null || !isFinite(v)) return null;
  let score;
  if (v < 0) score = 0;
  else if (v <= 0.3) score = 0.80;
  else if (v <= 0.6) score = 0.65;
  else if (v <= 1.0) score = 0.45;
  else if (v <= 1.5) score = 0.25;
  else if (v <= 2.5) score = 0.10;
  else score = 0;
  return { score, signal: 'Debt/Equity', value: v.toFixed(2) };
}

// ---------- Master scoring ----------

const SIGNALS = [
  { fn: scoreRevenueGrowth,    weight: 4.0, category: 'growth' },
  { fn: scoreEpsGrowth,        weight: 3.5, category: 'growth' },
  { fn: scoreRevenueGrowth3yr, weight: 2.0, category: 'growth' },
  { fn: scorePEG,              weight: 3.0, category: 'valuation' },
  { fn: scoreOperatingMargin,  weight: 2.5, category: 'quality' },
  { fn: scoreROE,              weight: 2.0, category: 'quality' },
  { fn: scoreFCFYield,         weight: 2.0, category: 'quality' },
  { fn: scoreRSI,              weight: 2.0, category: 'technical' },
  { fn: scorePctBelowHigh,     weight: 3.0, category: 'technical' },
  { fn: scorePriceVsMa200,     weight: 2.5, category: 'technical' },
  { fn: scorePriceVsMa50,      weight: 1.5, category: 'technical' },
  { fn: scoreDebtToEquity,     weight: 1.5, category: 'health' },
];

const MIN_SIGNALS_REQUIRED = 8;

function scoreStock(stock) {
  // --- Hard filters ---
  // Must have minimum market cap
  if (!stock.marketCap || stock.marketCap < MIN_MARKET_CAP) return null;

  // Must have positive revenue growth — this is non-negotiable for breakouts
  if (stock.revenueGrowthYoY == null || stock.revenueGrowthYoY <= 0) return null;

  // Must have positive price (sanity check)
  if (!stock.price || stock.price <= 0) return null;

  let totalWeightedScore = 0;
  let totalWeight = 0;
  const signalResults = [];

  for (const { fn, weight, category } of SIGNALS) {
    const result = fn(stock);
    if (!result) continue;

    totalWeightedScore += result.score * weight;
    totalWeight += weight;
    signalResults.push({
      ...result,
      weight,
      category,
      contribution: result.score * weight,
    });
  }

  if (signalResults.length < MIN_SIGNALS_REQUIRED) return null;

  // Raw weighted average (0-1 scale)
  const rawAvg = totalWeightedScore / totalWeight;

  // Apply compression curve to spread the distribution.
  // This maps the 0-1 average to a 0-100 score where:
  //   0.3 avg → ~30 score (below average)
  //   0.5 avg → ~50 score (average)
  //   0.6 avg → ~60 score (good)
  //   0.7 avg → ~70 score (strong)
  //   0.8 avg → ~80 score (exceptional)
  //   0.9 avg → ~88 score (near-perfect)
  // The slight power compression makes high scores harder to achieve.
  const compressed = Math.pow(rawAvg, 1.15);
  let finalScore = compressed * 100;

  // Small bonus for breadth: scoring well across 4+ categories
  // (not enough to inflate scores, just a tiebreaker)
  const strongCategories = new Set(
    signalResults.filter(s => s.score >= 0.5).map(s => s.category)
  );
  if (strongCategories.size >= 4) finalScore += 1.5;
  else if (strongCategories.size >= 3) finalScore += 0.5;

  // Growth quality penalty: if revenue growth is strong but EPS is negative,
  // the company may not have operating leverage yet
  if (stock.revenueGrowthYoY > 0.15 && stock.epsGrowthYoY != null && stock.epsGrowthYoY < -0.10) {
    finalScore *= 0.90; // 10% penalty
  }

  finalScore = Math.min(99, Math.max(0, finalScore));

  signalResults.sort((a, b) => b.contribution - a.contribution);

  return {
    breakoutScore: Math.round(finalScore * 10) / 10,
    signalCount: signalResults.length,
    topSignals: signalResults.slice(0, 5),
    weakSignals: signalResults.filter(s => s.score <= 0.15).slice(0, 3),
    categoryScores: {
      growth: avgCategory(signalResults, 'growth'),
      valuation: avgCategory(signalResults, 'valuation'),
      quality: avgCategory(signalResults, 'quality'),
      technical: avgCategory(signalResults, 'technical'),
      health: avgCategory(signalResults, 'health'),
    },
  };
}

function avgCategory(signals, category) {
  const catSignals = signals.filter(s => s.category === category);
  if (catSignals.length === 0) return null;
  const avg = catSignals.reduce((s, r) => s + r.score, 0) / catSignals.length;
  return Math.round(avg * 100);
}

// ---------------------------------------------------------------------------
// Computation & caching
// ---------------------------------------------------------------------------
let cachedResult = null;
let lastComputed = 0;
let computing = false;
const CACHE_TTL = 30 * 60 * 1000;
const BATCH_SIZE = 50;

function computeBreakoutCandidatesAsync(limit = 20) {
  return new Promise((resolve) => {
    const cache = getCache();
    if (cache.size < 10) return resolve([]);

    const stocks = Array.from(cache.values());
    const scored = [];
    let idx = 0;

    function processBatch() {
      const end = Math.min(idx + BATCH_SIZE, stocks.length);

      for (; idx < end; idx++) {
        const stock = stocks[idx];
        const result = scoreStock(stock);
        if (!result) continue;

        scored.push({
          candidate: {
            ticker: stock.ticker,
            companyName: stock.companyName,
            sector: stock.sector,
            price: stock.price,
            marketCap: stock.marketCap,
          },
          breakoutScore: result.breakoutScore,
          signalCount: result.signalCount,
          topSignals: result.topSignals,
          weakSignals: result.weakSignals,
          categoryScores: result.categoryScores,
        });
      }

      if (idx < stocks.length) {
        setImmediate(processBatch);
      } else {
        scored.sort((a, b) => b.breakoutScore - a.breakoutScore);
        resolve(scored.slice(0, limit));
      }
    }

    processBatch();
  });
}

async function triggerBackgroundCompute() {
  if (computing) return;
  computing = true;
  try {
    console.log('[top-pairs] Starting breakout screening (v2 strict)...');
    const start = Date.now();
    cachedResult = await computeBreakoutCandidatesAsync(20);
    lastComputed = Date.now();
    if (cachedResult.length > 0) {
      const scores = cachedResult.map(c => c.breakoutScore);
      console.log(`[top-pairs] Screened ${cachedResult.length} candidates in ${Date.now() - start}ms — top: ${scores[0]}, median: ${scores[Math.floor(scores.length/2)]}, bottom: ${scores[scores.length-1]}`);
    } else {
      console.log(`[top-pairs] No qualifying candidates found in ${Date.now() - start}ms`);
    }
  } catch (err) {
    console.error('[top-pairs] Breakout screening failed:', err.message);
  } finally {
    computing = false;
  }
}

let bootPollRef = setInterval(() => {
  if (isReady() && !cachedResult && !computing) {
    clearInterval(bootPollRef);
    triggerBackgroundCompute();
  }
}, 5000);

router.get('/', (req, res) => {
  if (!isReady()) {
    return res.status(503).json({ error: 'Universe cache not ready' });
  }

  if (cachedResult) {
    const now = Date.now();
    if (now - lastComputed > CACHE_TTL && !computing) {
      triggerBackgroundCompute();
    }
    return res.json(cachedResult);
  }

  if (!computing) {
    triggerBackgroundCompute();
  }
  return res.status(202).json({ computing: true, message: 'Screening for breakout candidates, check back shortly.' });
});

module.exports = router;
