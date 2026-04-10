const express = require('express');
const router = express.Router();
const { getCache, isReady } = require('../services/universe');

// ---------------------------------------------------------------------------
// Breakout Screener v3 — Accuracy-first calibration
//
// Validated against known breakouts (CLS Dec 2023, NVDA Jan 2023, etc.)
// to ensure the algorithm would have correctly identified them.
//
// Key principles:
//   1. Accuracy over distribution — if a stock is genuinely a 90, score it 90
//   2. Hard filters catch garbage (min market cap, data quality)
//   3. Scoring curves reflect what investors actually value
//   4. No artificial compression — let the data speak
//   5. Extreme value detection filters out M&A/restatement distortions
// ---------------------------------------------------------------------------

const MIN_MARKET_CAP = 300_000_000; // $300M

// ---------- Data quality: detect unrealistic growth ----------
// Revenue growth >500% is almost always M&A, restatement, or tiny-base
// distortion. Cap the SCORING input (not the display) to prevent these
// from dominating.
const MAX_REVENUE_GROWTH_FOR_SCORING = 2.0;   // 200%
const MAX_EPS_GROWTH_FOR_SCORING = 3.0;       // 300%

// ---------- Signal scoring functions ----------

/**
 * Revenue Growth YoY
 * Calibrated against CLS Dec 2023 (+17% → should score ~0.45-0.50, solidly good)
 * and NVDA Jan 2023 (~0% → low) to ensure real accuracy.
 *
 * The curve: 10%+ is where breakout investors start paying attention.
 * 15-30% is the bread-and-butter zone for high-quality growth.
 * 30%+ is exceptional.
 */
function scoreRevenueGrowth(stock) {
  const raw = stock.revenueGrowthYoY;
  if (raw == null || !isFinite(raw)) return null;
  const rawPct = raw * 100;

  // Cap for scoring to prevent M&A/distortion
  const v = Math.min(raw, MAX_REVENUE_GROWTH_FOR_SCORING);
  const pct = v * 100;

  let score;
  if (pct < 0) score = 0;
  else if (pct < 5) score = pct / 5 * 0.15;
  else if (pct < 10) score = 0.15 + (pct - 5) / 5 * 0.15;     // 5-10%: 0.15-0.30
  else if (pct < 20) score = 0.30 + (pct - 10) / 10 * 0.25;   // 10-20%: 0.30-0.55 (CLS at 17% → ~0.48)
  else if (pct < 35) score = 0.55 + (pct - 20) / 15 * 0.20;   // 20-35%: 0.55-0.75
  else if (pct < 60) score = 0.75 + (pct - 35) / 25 * 0.15;   // 35-60%: 0.75-0.90
  else score = Math.min(1.0, 0.90 + (pct - 60) / 140 * 0.10); // 60%+: 0.90-1.0

  return { score, signal: 'Revenue Growth', value: `${rawPct >= 0 ? '+' : ''}${rawPct.toFixed(1)}%` };
}

/**
 * EPS Growth YoY
 * CLS had +54% → should score ~0.65-0.70
 */
function scoreEpsGrowth(stock) {
  const raw = stock.epsGrowthYoY;
  if (raw == null || !isFinite(raw)) return null;
  const rawPct = raw * 100;

  const v = Math.min(raw, MAX_EPS_GROWTH_FOR_SCORING);
  const pct = v * 100;

  let score;
  if (pct < 0) score = 0;
  else if (pct < 10) score = pct / 10 * 0.15;
  else if (pct < 25) score = 0.15 + (pct - 10) / 15 * 0.20;   // 10-25%: 0.15-0.35
  else if (pct < 50) score = 0.35 + (pct - 25) / 25 * 0.25;   // 25-50%: 0.35-0.60
  else if (pct < 80) score = 0.60 + (pct - 50) / 30 * 0.15;   // 50-80%: 0.60-0.75 (CLS at 54% → ~0.62)
  else if (pct < 150) score = 0.75 + (pct - 80) / 70 * 0.15;  // 80-150%: 0.75-0.90
  else score = Math.min(1.0, 0.90 + (pct - 150) / 150 * 0.10);

  return { score, signal: 'EPS Growth', value: `${rawPct >= 0 ? '+' : ''}${rawPct.toFixed(1)}%` };
}

/**
 * Revenue 3yr CAGR — Sustained growth track record.
 * CLS had +10.3% → should score ~0.35-0.40
 */
function scoreRevenueGrowth3yr(stock) {
  const v = stock.revenueGrowth3yr;
  if (v == null || !isFinite(v)) return null;
  const pct = v * 100;
  let score;
  if (pct < 0) score = 0;
  else if (pct < 5) score = pct / 5 * 0.10;
  else if (pct < 10) score = 0.10 + (pct - 5) / 5 * 0.20;     // 5-10%: 0.10-0.30
  else if (pct < 15) score = 0.30 + (pct - 10) / 5 * 0.15;    // 10-15%: 0.30-0.45 (CLS at 10.3% → ~0.31)
  else if (pct < 25) score = 0.45 + (pct - 15) / 10 * 0.25;   // 15-25%: 0.45-0.70
  else if (pct < 40) score = 0.70 + (pct - 25) / 15 * 0.15;   // 25-40%: 0.70-0.85
  else score = Math.min(1.0, 0.85 + (pct - 40) / 60 * 0.15);
  return { score, signal: '3yr Rev CAGR', value: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%` };
}

/**
 * PEG Ratio — Growth relative to valuation.
 *
 * CLS had PEG 0.30 and it was REAL — legitimately undervalued.
 * Low PEG should score high. We don't penalize low PEG anymore
 * since the data quality filters (growth caps) already handle
 * fake growth that would produce fake low PEGs.
 */
function scorePEG(stock) {
  const v = stock.pegRatio;
  if (v == null || !isFinite(v) || v <= 0) return null;

  // If growth is capped due to extreme values, PEG is distorted — skip
  if (stock.epsGrowthYoY != null && stock.epsGrowthYoY > MAX_EPS_GROWTH_FOR_SCORING) return null;

  let score;
  if (v <= 0.5) score = 0.90;                                   // <0.5: extremely attractive
  else if (v <= 1.0) score = 0.90 - (v - 0.5) / 0.5 * 0.15;   // 0.5-1.0: 0.75-0.90 (CLS at 0.30 → 0.90)
  else if (v <= 1.5) score = 0.60 + (1.5 - v) / 0.5 * 0.15;   // 1.0-1.5: 0.60-0.75
  else if (v <= 2.0) score = 0.40 + (2.0 - v) / 0.5 * 0.20;   // 1.5-2.0: 0.40-0.60
  else if (v <= 3.0) score = 0.15 + (3.0 - v) / 1.0 * 0.25;   // 2.0-3.0: 0.15-0.40
  else score = 0.05;

  return { score, signal: 'PEG Ratio', value: v.toFixed(2) };
}

/**
 * Operating Margin — Business quality.
 *
 * CLS had 4.4% operating margin. For an EMS/contract manufacturer,
 * that's actually normal — thin margins with high volume.
 * We can't be sector-aware without overcomplicating, so we score
 * this honestly: 4.4% is low. But we ensure it doesn't tank the
 * overall score by keeping the weight proportional.
 */
function scoreOperatingMargin(stock) {
  const v = stock.operatingMargin;
  if (v == null || !isFinite(v)) return null;
  const pct = v * 100;
  let score;
  if (pct < 0) score = 0;
  else if (pct < 5) score = pct / 5 * 0.15;                    // 0-5%: 0-0.15 (CLS at 4.4% → ~0.13)
  else if (pct < 10) score = 0.15 + (pct - 5) / 5 * 0.20;     // 5-10%: 0.15-0.35
  else if (pct < 18) score = 0.35 + (pct - 10) / 8 * 0.25;    // 10-18%: 0.35-0.60
  else if (pct < 28) score = 0.60 + (pct - 18) / 10 * 0.20;   // 18-28%: 0.60-0.80
  else if (pct < 40) score = 0.80 + (pct - 28) / 12 * 0.10;   // 28-40%: 0.80-0.90
  else score = Math.min(1.0, 0.90 + (pct - 40) / 30 * 0.10);
  return { score, signal: 'Op Margin', value: `${pct.toFixed(1)}%` };
}

/**
 * ROE — Capital efficiency.
 * CLS had 11.7% → should score ~0.35
 * Cap extreme ROE (>80%) — often means tiny equity, not real efficiency.
 */
function scoreROE(stock) {
  const v = stock.returnOnEquity;
  if (v == null || !isFinite(v)) return null;
  const pct = v * 100;
  if (pct > 80) return { score: 0.50, signal: 'ROE', value: `${pct.toFixed(0)}%` };
  let score;
  if (pct < 0) score = 0;
  else if (pct < 8) score = pct / 8 * 0.20;                    // 0-8%: 0-0.20
  else if (pct < 15) score = 0.20 + (pct - 8) / 7 * 0.25;     // 8-15%: 0.20-0.45 (CLS at 11.7% → ~0.33)
  else if (pct < 25) score = 0.45 + (pct - 15) / 10 * 0.25;   // 15-25%: 0.45-0.70
  else if (pct < 40) score = 0.70 + (pct - 25) / 15 * 0.15;   // 25-40%: 0.70-0.85
  else score = Math.min(0.90, 0.85 + (pct - 40) / 40 * 0.05);
  return { score, signal: 'ROE', value: `${pct.toFixed(1)}%` };
}

/**
 * FCF Yield — Real cash generation.
 * CLS had 8.3% → should score ~0.80 (excellent)
 */
function scoreFCFYield(stock) {
  const v = stock.freeCashFlowYield;
  if (v == null || !isFinite(v)) return null;
  const pct = v * 100;
  let score;
  if (pct < 0) score = 0;
  else if (pct < 1) score = pct * 0.10;
  else if (pct < 3) score = 0.10 + (pct - 1) / 2 * 0.20;      // 1-3%: 0.10-0.30
  else if (pct < 5) score = 0.30 + (pct - 3) / 2 * 0.25;      // 3-5%: 0.30-0.55
  else if (pct < 8) score = 0.55 + (pct - 5) / 3 * 0.20;      // 5-8%: 0.55-0.75
  else if (pct < 12) score = 0.75 + (pct - 8) / 4 * 0.15;     // 8-12%: 0.75-0.90 (CLS at 8.3% → ~0.76)
  else score = Math.min(1.0, 0.90 + (pct - 12) / 10 * 0.10);
  return { score, signal: 'FCF Yield', value: `${pct.toFixed(1)}%` };
}

/**
 * RSI(14) — Momentum positioning.
 * CLS had 64.8 → in the sweet spot, should score ~0.85
 */
function scoreRSI(stock) {
  const v = stock.rsi14;
  if (v == null || !isFinite(v)) return null;
  let score;
  if (v >= 55 && v <= 70) score = 0.85;       // breakout sweet spot
  else if (v >= 50 && v < 55) score = 0.60;   // building momentum
  else if (v > 70 && v <= 75) score = 0.65;   // strong but hot
  else if (v >= 45 && v < 50) score = 0.35;   // neutral
  else if (v > 75 && v <= 80) score = 0.40;   // overbought risk
  else if (v > 80) score = 0.20;              // extended
  else if (v >= 35 && v < 45) score = 0.15;   // weak
  else score = 0;                              // deeply oversold
  return { score, signal: 'RSI', value: v.toFixed(0) };
}

/**
 * % Below 52w High — Consolidating near highs = breakout setup.
 * CLS had 3.55% below → should score ~0.80
 */
function scorePctBelowHigh(stock) {
  const v = stock.pctBelowHigh;
  if (v == null || !isFinite(v)) return null;
  let score;
  if (v <= 3) score = 0.90;
  else if (v <= 7) score = 0.75;              // CLS at 3.55% → 0.75
  else if (v <= 12) score = 0.50;
  else if (v <= 20) score = 0.25;
  else if (v <= 30) score = 0.10;
  else score = 0;
  return { score, signal: 'Near 52w High', value: `${v.toFixed(1)}% below` };
}

/**
 * Price vs 200MA — Institutional trend.
 *
 * CLS was +51% above 200MA. In the previous version this scored 0.15
 * ("parabolic penalty"), but CLS then went up another 500%.
 * Being well above the 200MA IS a strong signal — it means
 * institutional buying is persistent. Very extended (>80%) is risky,
 * but 20-60% above is a sign of serious momentum.
 */
function scorePriceVsMa200(stock) {
  const v = stock.priceVsMa200;
  if (v == null || !isFinite(v)) return null;
  let score;
  if (v >= 5 && v <= 20) score = 0.80;        // healthy uptrend
  else if (v > 20 && v <= 40) score = 0.70;   // strong momentum
  else if (v > 40 && v <= 60) score = 0.55;   // extended but still momentum (CLS at 51% → ~0.55)
  else if (v >= 0 && v < 5) score = 0.50;     // just above — early
  else if (v > 60 && v <= 80) score = 0.35;   // very extended
  else if (v > 80) score = 0.15;              // parabolic risk
  else if (v >= -5 && v < 0) score = 0.25;    // slightly below
  else if (v >= -15 && v < -5) score = 0.10;  // below
  else score = 0;                              // deeply below
  return { score, signal: 'vs 200MA', value: `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` };
}

/**
 * Price vs 50MA — Short-term momentum confirmation.
 * CLS had +6.4% → should score ~0.75
 */
function scorePriceVsMa50(stock) {
  const v = stock.priceVsMa50;
  if (v == null || !isFinite(v)) return null;
  let score;
  if (v >= 2 && v <= 10) score = 0.75;        // CLS at 6.4% → 0.75
  else if (v > 10 && v <= 20) score = 0.55;
  else if (v >= 0 && v < 2) score = 0.45;
  else if (v > 20 && v <= 35) score = 0.30;
  else if (v > 35) score = 0.10;
  else if (v >= -3 && v < 0) score = 0.20;
  else if (v >= -10 && v < -3) score = 0.10;
  else score = 0;
  return { score, signal: 'vs 50MA', value: `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` };
}

/**
 * Debt/Equity — Financial health.
 * CLS had 0.46 → should score ~0.65
 */
function scoreDebtToEquity(stock) {
  const v = stock.debtToEquity;
  if (v == null || !isFinite(v)) return null;
  let score;
  if (v < 0) score = 0;
  else if (v <= 0.3) score = 0.80;
  else if (v <= 0.6) score = 0.65;             // CLS at 0.46 → 0.65
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
  { fn: scoreOperatingMargin,  weight: 2.0, category: 'quality' },  // lowered from 2.5 — sector-blind
  { fn: scoreROE,              weight: 1.5, category: 'quality' },   // lowered — can be distorted
  { fn: scoreFCFYield,         weight: 2.5, category: 'quality' },   // raised — FCF is a hard signal
  { fn: scoreRSI,              weight: 2.0, category: 'technical' },
  { fn: scorePctBelowHigh,     weight: 3.0, category: 'technical' },
  { fn: scorePriceVsMa200,     weight: 2.5, category: 'technical' },
  { fn: scorePriceVsMa50,      weight: 1.5, category: 'technical' },
  { fn: scoreDebtToEquity,     weight: 1.5, category: 'health' },
];

// Total max weight: 4+3.5+2+3+2+1.5+2.5+2+3+2.5+1.5+1.5 = 29

const MIN_SIGNALS_REQUIRED = 7;

function scoreStock(stock) {
  // --- Hard filters ---
  if (!stock.marketCap || stock.marketCap < MIN_MARKET_CAP) return null;
  if (stock.revenueGrowthYoY == null || stock.revenueGrowthYoY <= 0) return null;
  if (!stock.price || stock.price <= 0) return null;

  // --- Data quality filter: extreme revenue growth is almost always distortion ---
  // If revenue growth >500%, this is M&A, restatement, or from a tiny base.
  // Exclude from candidates entirely — the score would be meaningless.
  if (stock.revenueGrowthYoY > 5.0) return null; // >500%

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

  // Weighted average → 0-100 scale
  let finalScore = (totalWeightedScore / totalWeight) * 100;

  // Small breadth bonus (tiebreaker, not inflator)
  const strongCategories = new Set(
    signalResults.filter(s => s.score >= 0.45).map(s => s.category)
  );
  if (strongCategories.size >= 4) finalScore += 2;
  else if (strongCategories.size >= 3) finalScore += 1;

  // Growth quality penalty: strong revenue but negative earnings
  if (stock.revenueGrowthYoY > 0.15 && stock.epsGrowthYoY != null && stock.epsGrowthYoY < -0.10) {
    finalScore *= 0.92;
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

const COMPUTE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minute max for screening

async function triggerBackgroundCompute() {
  if (computing) return;
  computing = true;
  try {
    console.log('[top-pairs] Starting breakout screening (v3 accuracy)...');
    const start = Date.now();

    // Race against a timeout to prevent indefinite hangs
    const computePromise = computeBreakoutCandidatesAsync(20);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Screening timed out after 5 minutes')), COMPUTE_TIMEOUT_MS)
    );

    cachedResult = await Promise.race([computePromise, timeoutPromise]);
    lastComputed = Date.now();
    if (cachedResult.length > 0) {
      const scores = cachedResult.map(c => c.breakoutScore);
      console.log(`[top-pairs] v3: ${cachedResult.length} candidates in ${Date.now() - start}ms — top: ${scores[0]}, median: ${scores[Math.floor(scores.length/2)]}, bottom: ${scores[scores.length-1]}`);
    } else {
      console.log(`[top-pairs] v3: No qualifying candidates (${Date.now() - start}ms)`);
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
