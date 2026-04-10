const express = require('express');
const router = express.Router();
const { getCache, isReady } = require('../services/universe');

// ---------------------------------------------------------------------------
// Breakout Screener — scores every stock on how well its current
// fundamentals and technicals match what investors look for in
// pre-breakout setups. No comparison to other companies; this is
// a standalone signal-based scoring system.
//
// Each signal is scored 0-1 and weighted. The final breakout score
// is a weighted average normalized to 0-100.
// ---------------------------------------------------------------------------

// ---------- Signal scoring functions ----------
// Each returns { score: 0-1, signal: string label, value: display value }

/**
 * Revenue Growth YoY — The #1 breakout signal.
 * >30% = strong, >15% = good, >5% = moderate, <0 = weak
 */
function scoreRevenueGrowth(stock) {
  const v = stock.revenueGrowthYoY;
  if (v == null || !isFinite(v)) return null;
  const pct = v * 100;
  let score;
  if (pct >= 40) score = 1.0;
  else if (pct >= 25) score = 0.85 + (pct - 25) / 15 * 0.15;
  else if (pct >= 15) score = 0.65 + (pct - 15) / 10 * 0.20;
  else if (pct >= 5) score = 0.35 + (pct - 5) / 10 * 0.30;
  else if (pct >= 0) score = 0.15 + (pct / 5) * 0.20;
  else score = Math.max(0, 0.15 + pct / 50 * 0.15); // negative growth
  return { score, signal: 'Revenue Growth', value: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%` };
}

/**
 * EPS Growth YoY — Earnings acceleration confirms operating leverage.
 * >50% = excellent, >20% = strong, >0 = positive
 */
function scoreEpsGrowth(stock) {
  const v = stock.epsGrowthYoY;
  if (v == null || !isFinite(v)) return null;
  const pct = v * 100;
  let score;
  if (pct >= 60) score = 1.0;
  else if (pct >= 30) score = 0.75 + (pct - 30) / 30 * 0.25;
  else if (pct >= 15) score = 0.55 + (pct - 15) / 15 * 0.20;
  else if (pct >= 0) score = 0.25 + (pct / 15) * 0.30;
  else score = Math.max(0, 0.20 + pct / 100 * 0.20);
  return { score, signal: 'EPS Growth', value: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%` };
}

/**
 * Revenue 3yr CAGR — Sustained growth track record (not a one-quarter wonder).
 */
function scoreRevenueGrowth3yr(stock) {
  const v = stock.revenueGrowth3yr;
  if (v == null || !isFinite(v)) return null;
  const pct = v * 100;
  let score;
  if (pct >= 25) score = 1.0;
  else if (pct >= 15) score = 0.75 + (pct - 15) / 10 * 0.25;
  else if (pct >= 8) score = 0.50 + (pct - 8) / 7 * 0.25;
  else if (pct >= 0) score = 0.20 + (pct / 8) * 0.30;
  else score = Math.max(0, 0.10);
  return { score, signal: '3yr Rev CAGR', value: `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%` };
}

/**
 * PEG Ratio — Growth relative to valuation. <1 = undervalued grower, 1-2 = fair, >3 = expensive.
 * Only meaningful when P/E and growth are both positive.
 */
function scorePEG(stock) {
  const v = stock.pegRatio;
  if (v == null || !isFinite(v) || v <= 0) return null;
  let score;
  if (v <= 0.5) score = 1.0;
  else if (v <= 1.0) score = 0.80 + (1.0 - v) / 0.5 * 0.20;
  else if (v <= 1.5) score = 0.60 + (1.5 - v) / 0.5 * 0.20;
  else if (v <= 2.5) score = 0.30 + (2.5 - v) / 1.0 * 0.30;
  else if (v <= 4.0) score = 0.10 + (4.0 - v) / 1.5 * 0.20;
  else score = 0.05;
  return { score, signal: 'PEG Ratio', value: v.toFixed(2) };
}

/**
 * Operating Margin — Business quality and operating leverage.
 * >20% = strong, >10% = healthy, <0 = unprofitable
 */
function scoreOperatingMargin(stock) {
  const v = stock.operatingMargin;
  if (v == null || !isFinite(v)) return null;
  const pct = v * 100;
  let score;
  if (pct >= 25) score = 1.0;
  else if (pct >= 15) score = 0.75 + (pct - 15) / 10 * 0.25;
  else if (pct >= 8) score = 0.50 + (pct - 8) / 7 * 0.25;
  else if (pct >= 0) score = 0.20 + (pct / 8) * 0.30;
  else score = Math.max(0, 0.10 + pct / 30 * 0.10);
  return { score, signal: 'Op Margin', value: `${pct.toFixed(1)}%` };
}

/**
 * ROE — Capital efficiency. >20% = excellent, >12% = good.
 */
function scoreROE(stock) {
  const v = stock.returnOnEquity;
  if (v == null || !isFinite(v)) return null;
  const pct = v * 100;
  let score;
  if (pct >= 25) score = 1.0;
  else if (pct >= 15) score = 0.70 + (pct - 15) / 10 * 0.30;
  else if (pct >= 8) score = 0.40 + (pct - 8) / 7 * 0.30;
  else if (pct >= 0) score = 0.15 + (pct / 8) * 0.25;
  else score = 0.05;
  return { score, signal: 'ROE', value: `${pct.toFixed(1)}%` };
}

/**
 * FCF Yield — Real cash generation. >5% = great, >2% = healthy.
 */
function scoreFCFYield(stock) {
  const v = stock.freeCashFlowYield;
  if (v == null || !isFinite(v)) return null;
  const pct = v * 100;
  let score;
  if (pct >= 8) score = 1.0;
  else if (pct >= 5) score = 0.75 + (pct - 5) / 3 * 0.25;
  else if (pct >= 2) score = 0.50 + (pct - 2) / 3 * 0.25;
  else if (pct >= 0) score = 0.20 + (pct / 2) * 0.30;
  else score = Math.max(0, 0.05);
  return { score, signal: 'FCF Yield', value: `${pct.toFixed(1)}%` };
}

/**
 * RSI(14) — Momentum. 50-70 = strong momentum, not overbought.
 * Breakout setups tend to be in the 55-75 zone.
 */
function scoreRSI(stock) {
  const v = stock.rsi14;
  if (v == null || !isFinite(v)) return null;
  let score;
  if (v >= 55 && v <= 70) score = 1.0;        // sweet spot
  else if (v >= 50 && v < 55) score = 0.80;   // building momentum
  else if (v > 70 && v <= 75) score = 0.70;   // hot but manageable
  else if (v >= 40 && v < 50) score = 0.50;   // neutral
  else if (v > 75 && v <= 80) score = 0.40;   // overbought risk
  else if (v > 80) score = 0.20;              // extended
  else if (v >= 30 && v < 40) score = 0.30;   // weak
  else score = 0.10;                           // oversold
  return { score, signal: 'RSI', value: v.toFixed(0) };
}

/**
 * % Below 52w High — Consolidating near highs = breakout setup.
 * 0-5% below = right at high, 5-15% = healthy pullback, >30% = broken trend
 */
function scorePctBelowHigh(stock) {
  const v = stock.pctBelowHigh;
  if (v == null || !isFinite(v)) return null;
  let score;
  if (v <= 5) score = 1.0;           // at or near highs
  else if (v <= 10) score = 0.85;    // minor pullback
  else if (v <= 15) score = 0.65;    // healthy consolidation
  else if (v <= 25) score = 0.40;    // correction territory
  else if (v <= 40) score = 0.15;    // significant damage
  else score = 0.05;                 // broken
  return { score, signal: 'Near 52w High', value: `${v.toFixed(1)}% below` };
}

/**
 * Price vs 200MA — Institutional trend. Above = uptrend.
 * 0-15% above = confirmed trend, >30% = extended
 */
function scorePriceVsMa200(stock) {
  const v = stock.priceVsMa200;
  if (v == null || !isFinite(v)) return null;
  let score;
  if (v >= 5 && v <= 20) score = 1.0;         // healthy uptrend
  else if (v > 20 && v <= 35) score = 0.75;   // strong but extended
  else if (v >= 0 && v < 5) score = 0.65;     // just above — potential inflection
  else if (v > 35 && v <= 50) score = 0.50;   // very extended
  else if (v > 50) score = 0.25;              // parabolic
  else if (v >= -10 && v < 0) score = 0.35;   // slightly below — watch
  else score = 0.10;                           // deeply below
  return { score, signal: 'vs 200MA', value: `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` };
}

/**
 * Price vs 50MA — Short-term momentum confirmation.
 */
function scorePriceVsMa50(stock) {
  const v = stock.priceVsMa50;
  if (v == null || !isFinite(v)) return null;
  let score;
  if (v >= 2 && v <= 10) score = 1.0;
  else if (v > 10 && v <= 20) score = 0.75;
  else if (v >= 0 && v < 2) score = 0.60;
  else if (v > 20) score = 0.40;
  else if (v >= -5 && v < 0) score = 0.35;
  else score = 0.10;
  return { score, signal: 'vs 50MA', value: `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` };
}

/**
 * Debt/Equity — Financial health. <0.5 = conservative, >2 = leveraged.
 */
function scoreDebtToEquity(stock) {
  const v = stock.debtToEquity;
  if (v == null || !isFinite(v)) return null;
  let score;
  if (v < 0) score = 0.10;             // negative equity
  else if (v <= 0.3) score = 1.0;      // very conservative
  else if (v <= 0.7) score = 0.80;
  else if (v <= 1.0) score = 0.60;
  else if (v <= 1.5) score = 0.40;
  else if (v <= 2.5) score = 0.20;
  else score = 0.10;
  return { score, signal: 'Debt/Equity', value: v.toFixed(2) };
}

// ---------- Master breakout scoring ----------

const SIGNALS = [
  // Growth (heaviest weight — this is what drives breakouts)
  { fn: scoreRevenueGrowth,    weight: 4.0, category: 'growth' },
  { fn: scoreEpsGrowth,        weight: 3.5, category: 'growth' },
  { fn: scoreRevenueGrowth3yr, weight: 2.0, category: 'growth' },

  // Valuation vs Growth (is the growth priced in yet?)
  { fn: scorePEG,              weight: 3.0, category: 'valuation' },

  // Profitability & Quality (business economics)
  { fn: scoreOperatingMargin,  weight: 2.5, category: 'quality' },
  { fn: scoreROE,              weight: 2.0, category: 'quality' },
  { fn: scoreFCFYield,         weight: 2.0, category: 'quality' },

  // Technical Setup (momentum & position)
  { fn: scoreRSI,              weight: 2.5, category: 'technical' },
  { fn: scorePctBelowHigh,     weight: 3.0, category: 'technical' },
  { fn: scorePriceVsMa200,     weight: 2.5, category: 'technical' },
  { fn: scorePriceVsMa50,      weight: 1.5, category: 'technical' },

  // Financial Health (risk guardrails)
  { fn: scoreDebtToEquity,     weight: 1.5, category: 'health' },
];

const MIN_SIGNALS_REQUIRED = 7; // Need at least 7 of 12 signals to score

function scoreStock(stock) {
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

  // Normalize to 0-100
  const rawScore = (totalWeightedScore / totalWeight) * 100;

  // Bonus: reward stocks that score well across multiple categories
  const categories = new Set(signalResults.filter(s => s.score >= 0.6).map(s => s.category));
  const diversityBonus = categories.size >= 4 ? 3 : categories.size >= 3 ? 1.5 : 0;

  const finalScore = Math.min(99, Math.max(0, rawScore + diversityBonus));

  // Sort signals by weighted contribution for display
  signalResults.sort((a, b) => b.contribution - a.contribution);

  return {
    breakoutScore: Math.round(finalScore * 10) / 10,
    signalCount: signalResults.length,
    topSignals: signalResults.slice(0, 5), // top 5 strongest signals
    weakSignals: signalResults.filter(s => s.score < 0.3).slice(0, 3), // key weaknesses
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
const BATCH_SIZE = 50; // Process 50 stocks per tick (simple scoring, not N² comparison)

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
    console.log('[top-pairs] Starting breakout candidate scoring...');
    const start = Date.now();
    cachedResult = await computeBreakoutCandidatesAsync(20);
    lastComputed = Date.now();
    console.log(`[top-pairs] Scored ${cachedResult.length} breakout candidates in ${Date.now() - start}ms`);
  } catch (err) {
    console.error('[top-pairs] Breakout scoring failed:', err.message);
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
  return res.status(202).json({ computing: true, message: 'Scoring breakout candidates, check back shortly.' });
});

module.exports = router;
