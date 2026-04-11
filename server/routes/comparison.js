const express = require('express');
const router = express.Router();
const fmp = require('../services/fmp');
const { computeRSI } = require('../services/rsi');
const { getCache } = require('../services/universe');
const { calculateSimilarity, MATCH_METRICS } = require('../services/matcher');
const { computeSectorStats } = require('../services/sectorStats');
const { snapshotCache, SNAPSHOT_CACHE_TTL } = require('./snapshot');
const { getProfile, DEFAULT_PROFILE, PROFILE_KEYS } = require('../services/matchProfiles');
const { buildSnapshot } = require('../services/snapshotBuilder');

// Template side is historical/immutable; match side updates every ~10 min with
// the incremental refresh cycle — use matching TTL.
const comparisonCache = new Map();
const COMPARISON_CACHE_TTL = 10 * 60 * 1000;

// ========================================================================
// Historical template — delegates to snapshotBuilder for financial data,
// adds comparison-specific short interest and sparkline.
// ========================================================================
async function fetchTemplate(sym, date) {
  const snapCacheKey = `${sym}:${date}`;
  const snapCached = snapshotCache.get(snapCacheKey);

  let template;
  if (snapCached && Date.now() - snapCached.ts < SNAPSHOT_CACHE_TTL) {
    template = snapCached.data;
  } else {
    template = await buildSnapshot(sym, date, false);
    if (!template) {
      template = { ticker: sym, companyName: sym, sector: null, date, price: null };
    }
  }

  // Add short interest (comparison-specific, not part of buildSnapshot)
  let shortInterestPct = null;
  try {
    const shortRaw = await fmp.getShortInterest(sym, false);
    shortInterestPct = shortRaw?.shortInterestPercent ?? null;
  } catch { /* non-critical */ }
  template.shortInterestPct = shortInterestPct;

  // Sparkline: 18 months after snapshot date, capped at today
  const afterDate = new Date(date);
  afterDate.setMonth(afterDate.getMonth() + 18);
  const sparklineEnd = afterDate.toISOString().slice(0, 10) < new Date().toISOString().slice(0, 10)
    ? afterDate.toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  let sparkline = [];
  let sparklineGainPct = null;
  try {
    const sparkRaw = await fmp.getHistoricalPrices(sym, date, sparklineEnd, false);
    sparkline = [...sparkRaw]
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map(h => ({ date: h.date, price: h.close }));
    if (sparkline.length >= 2) {
      const start = sparkline[0].price;
      const end = sparkline[sparkline.length - 1].price;
      if (start > 0) sparklineGainPct = ((end - start) / start) * 100;
    }
  } catch (err) {
    console.error(`[comparison] Sparkline fetch failed for ${sym}:`, err.message);
  }

  return { template, sparkline, sparklineGainPct };
}

// ========================================================================
// Match current metrics — TTM-based, for present-day match ticker
// (used only when the match ticker is NOT in the universe cache)
// ========================================================================
async function buildCurrentMetrics(ticker) {
  const fromDate = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const toDate = new Date().toISOString().slice(0, 10);

  const [profileData, incomeData, balanceData, cashFlowData, historical] = await Promise.all([
    fmp.getProfile(ticker, false),
    fmp.getIncomeStatements(ticker, 16, false, 'quarter'),
    fmp.getBalanceSheet(ticker, 1, false, 'quarter'),
    fmp.getCashFlowStatement(ticker, 4, false, 'quarter'),
    fmp.getHistoricalPrices(ticker, fromDate, toDate, false),
  ]);

  // --- sumQuarters: identical to universe.js ---
  function sumQuarters(quarters) {
    const sum = (field) => quarters.reduce((s, q) => s + (q[field] ?? 0), 0);
    const sharesOut = quarters[0]?.weightedAverageShsOutDil ?? null;
    return {
      revenue: sum('revenue'),
      grossProfit: sum('grossProfit'),
      operatingIncome: sum('operatingIncome'),
      netIncome: sum('netIncome'),
      ebitda: sum('ebitda'),
      eps: sum('eps'),
      interestExpense: sum('interestExpense'),
      sharesOut,
    };
  }
  function validTtmWindow(quarters) {
    if (quarters.length < 4) return false;
    const newest = new Date(quarters[0].date);
    const oldest = new Date(quarters[3].date);
    const spanMonths = (newest - oldest) / (30.44 * 24 * 60 * 60 * 1000);
    return spanMonths >= 8 && spanMonths <= 15;
  }

  const incomeQ = incomeData || [];
  const ttmQ = incomeQ.slice(0, 4);
  const priorTtmQ = incomeQ.slice(4, 8);
  const ttm3yrAgoQ = incomeQ.slice(12, 16);
  const ttm = validTtmWindow(ttmQ) ? sumQuarters(ttmQ) : null;
  const priorTtm = validTtmWindow(priorTtmQ) ? sumQuarters(priorTtmQ) : null;
  const ttm3yrAgo = validTtmWindow(ttm3yrAgoQ) ? sumQuarters(ttm3yrAgoQ) : null;

  // --- Growth: TTM vs prior-year TTM (same as universe.js) ---
  let revenueGrowthYoY = null;
  if (ttm && priorTtm && priorTtm.revenue !== 0)
    revenueGrowthYoY = (ttm.revenue - priorTtm.revenue) / Math.abs(priorTtm.revenue);

  let revenueGrowth3yr = null;
  if (ttm && ttm.revenue > 0 && ttm3yrAgo && ttm3yrAgo.revenue > 0)
    revenueGrowth3yr = Math.pow(ttm.revenue / ttm3yrAgo.revenue, 1 / 3) - 1;

  let epsGrowthYoY = null;
  if (ttm && priorTtm && priorTtm.eps !== 0)
    epsGrowthYoY = (ttm.eps - priorTtm.eps) / Math.abs(priorTtm.eps);

  // --- Balance sheet (latest quarterly) ---
  const balance = Array.isArray(balanceData) && balanceData.length > 0 ? balanceData[0] : null;
  const equity = balance?.totalStockholdersEquity ?? null;
  const totalAssets = balance?.totalAssets ?? null;
  const totalCurrentAssets = balance?.totalCurrentAssets ?? null;
  const totalCurrentLiabilities = balance?.totalCurrentLiabilities ?? null;
  const totalDebt = balance?.totalDebt ?? null;
  const cash = balance?.cashAndCashEquivalents ?? null;

  // --- Cash flow TTM (sum 4 quarters — must have all 4 for accuracy) ---
  const cfQuarters = Array.isArray(cashFlowData) ? cashFlowData : [];
  const ttmFCF = cfQuarters.length >= 4
    ? cfQuarters.slice(0, 4).reduce((s, q) => s + (q.freeCashFlow ?? 0), 0)
    : null;
  const ttmOperatingCF = cfQuarters.length >= 4
    ? cfQuarters.slice(0, 4).reduce((s, q) => s + (q.operatingCashFlow ?? 0), 0)
    : null;

  // --- Historical prices & technicals ---
  const hist = Array.isArray(historical) ? historical : [];
  const oldestFirst = [...hist].reverse();
  const closes = oldestFirst.map(d => d.close).filter(c => c != null);
  const currentPrice = hist[0]?.close ?? null;

  const rsi14 = computeRSI(closes.slice(-30));

  const closes52w = closes.slice(-252);
  const high52w = closes52w.length >= 200 ? Math.max(...closes52w) : null;
  const pctBelowHigh = currentPrice != null && high52w > 0
    ? ((high52w - currentPrice) / high52w) * 100 : null;

  let priceVsMa50 = null, priceVsMa200 = null;
  if (closes.length >= 50) {
    const ma50 = closes.slice(-50).reduce((s, v) => s + v, 0) / 50;
    if (currentPrice != null && ma50 > 0) priceVsMa50 = ((currentPrice - ma50) / ma50) * 100;
  }
  if (closes.length >= 200) {
    const ma200 = closes.slice(-200).reduce((s, v) => s + v, 0) / 200;
    if (currentPrice != null && ma200 > 0) priceVsMa200 = ((currentPrice - ma200) / ma200) * 100;
  }

  // --- Relative volume (5-day avg / 50-day avg, same as universe.js) ---
  let relativeVolume = null;
  const volumes = oldestFirst.map(d => d.volume).filter(v => v != null && v > 0);
  if (volumes.length >= 50) {
    const vol50 = volumes.slice(-50).reduce((s, v) => s + v, 0) / 50;
    const vol5 = volumes.slice(-5).reduce((s, v) => s + v, 0) / Math.min(5, volumes.slice(-5).length);
    if (vol50 > 0) relativeVolume = vol5 / vol50;
  }

  // --- Computed ratios (same formulas as universe.js enrichStock) ---
  const sharesOut = ttm?.sharesOut ?? null;
  const price = currentPrice;
  const computedMarketCap = (price != null && sharesOut != null) ? price * sharesOut : null;
  // EV: only when all three components are non-null
  const ev = (computedMarketCap != null && totalDebt != null && cash != null)
    ? computedMarketCap + totalDebt - cash : null;

  // Valuation
  const peRatio      = (price > 0 && ttm?.eps > 0) ? price / ttm.eps : null;
  const priceToSales = (computedMarketCap > 0 && ttm?.revenue > 0) ? computedMarketCap / ttm.revenue : null;
  const priceToBook  = (computedMarketCap > 0 && equity > 0) ? computedMarketCap / equity : null;
  const evToEBITDA   = (ev != null && ttm?.ebitda > 0) ? ev / ttm.ebitda : null;
  const evToRevenue  = (ev != null && ttm?.revenue > 0) ? ev / ttm.revenue : null;
  const earningsYield = (price > 0 && ttm) ? ttm.eps / price : null;
  const pegRatio     = (peRatio > 0 && epsGrowthYoY > 0) ? peRatio / (epsGrowthYoY * 100) : null;

  // Margins
  const grossMargin     = ttm && ttm.revenue ? ttm.grossProfit / ttm.revenue : null;
  const operatingMargin = ttm && ttm.revenue ? ttm.operatingIncome / ttm.revenue : null;
  const netMargin       = ttm && ttm.revenue ? ttm.netIncome / ttm.revenue : null;
  const ebitdaMargin    = ttm && ttm.revenue ? ttm.ebitda / ttm.revenue : null;

  // Returns — require positive denominator
  const returnOnEquity  = (ttm && equity != null && equity > 0) ? ttm.netIncome / equity : null;
  const returnOnAssets  = (ttm && totalAssets != null && totalAssets > 0) ? ttm.netIncome / totalAssets : null;
  const investedCapital = (equity != null && totalDebt != null && cash != null) ? equity + totalDebt - cash : null;
  const returnOnCapital = (ttm && investedCapital != null && investedCapital > 0)
    ? ttm.operatingIncome / investedCapital : null;

  // Financial Health
  const currentRatio     = (totalCurrentAssets != null && totalCurrentLiabilities != null && totalCurrentLiabilities > 0)
    ? totalCurrentAssets / totalCurrentLiabilities : null;
  const debtToEquity     = (totalDebt != null && equity != null && equity > 0) ? totalDebt / equity : null;
  const interestCoverage = (ttm && ttm.interestExpense != null && ttm.interestExpense !== 0)
    ? ttm.operatingIncome / Math.abs(ttm.interestExpense) : null;
  const netDebtToEBITDA  = (totalDebt != null && cash != null && ttm?.ebitda > 0) ? (totalDebt - cash) / ttm.ebitda : null;
  const freeCashFlowYield = (ttmFCF != null && computedMarketCap > 0) ? ttmFCF / computedMarketCap : null;
  const dividendYield    = profileData?.lastDiv && price > 0 ? profileData.lastDiv / price : null;

  return {
    ticker,
    companyName:       profileData?.companyName || ticker,
    sector:            profileData?.sector || null,
    date:              new Date().toISOString().slice(0, 10),
    price:             currentPrice,
    // Valuation
    peRatio, priceToBook, priceToSales, evToEBITDA, evToRevenue, pegRatio, earningsYield,
    // Profitability
    grossMargin, operatingMargin, netMargin, ebitdaMargin,
    returnOnEquity, returnOnAssets, returnOnCapital,
    // Growth
    revenueGrowthYoY, revenueGrowth3yr, epsGrowthYoY,
    eps: ttm ? ttm.eps : null,
    // Financial Health
    currentRatio, debtToEquity, interestCoverage, netDebtToEBITDA, freeCashFlowYield, dividendYield,
    totalCash:         cash,
    totalDebt,
    freeCashFlow:      ttmFCF,
    operatingCashFlow: ttmOperatingCF,
    // Technical
    rsi14, pctBelowHigh, priceVsMa50, priceVsMa200,
    beta:              profileData?.beta ?? null,
    avgVolume:         profileData?.averageVolume ?? null,
    relativeVolume,
    // Overview
    marketCap:         computedMarketCap,
    shortInterestPct:  null,
  };
}

// ========================================================================
// Match sparkline — last 12 months, fetched independently
// ========================================================================
async function fetchMatchSparkline(matchSym) {
  const from = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);

  try {
    const hist = await fmp.getHistoricalPrices(matchSym, from, to, false);
    if (!Array.isArray(hist) || hist.length === 0) {
      console.warn(`[comparison] No match sparkline data for ${matchSym}`);
      return { matchSparkline: [], matchSparklineGainPct: null };
    }

    const matchSparkline = [...hist]
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map(h => ({ date: h.date, price: h.close }));

    let matchSparklineGainPct = null;
    if (matchSparkline.length >= 2) {
      const start = matchSparkline[0].price;
      const end = matchSparkline[matchSparkline.length - 1].price;
      if (start > 0) matchSparklineGainPct = ((end - start) / start) * 100;
    }

    return { matchSparkline, matchSparklineGainPct };
  } catch (err) {
    console.error(`[comparison] Match sparkline fetch failed for ${matchSym}:`, err.message);
    return { matchSparkline: [], matchSparklineGainPct: null };
  }
}

// ========================================================================
// Main route — three independent parallel tracks
// ========================================================================
const MATCH_METRIC_KEYS = [
  'peRatio', 'priceToBook', 'priceToSales', 'evToEBITDA', 'evToRevenue', 'pegRatio',
  'grossMargin', 'operatingMargin', 'netMargin', 'ebitdaMargin',
  'returnOnEquity', 'returnOnAssets', 'returnOnCapital',
  'revenueGrowthYoY', 'revenueGrowth3yr', 'epsGrowthYoY',
  'currentRatio', 'debtToEquity', 'interestCoverage', 'netDebtToEBITDA', 'freeCashFlowYield',
  'marketCap',
  'rsi14', 'pctBelowHigh', 'priceVsMa50', 'priceVsMa200', 'beta',
];

router.get('/', async (req, res) => {
  const { ticker, date, matchTicker, profile: profileKey } = req.query;
  if (!ticker || !date || !matchTicker)
    return res.status(400).json({ error: 'ticker, date, and matchTicker are required' });
  if (!/^[A-Z0-9.]{1,10}$/i.test(ticker) || !/^[A-Z0-9.]{1,10}$/i.test(matchTicker))
    return res.status(400).json({ error: 'invalid ticker format' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date).getTime()))
    return res.status(400).json({ error: 'invalid date format, expected YYYY-MM-DD' });

  const sym = ticker.toUpperCase();
  const matchSym = matchTicker.toUpperCase();
  const activeProfile = profileKey && PROFILE_KEYS.includes(profileKey) ? profileKey : DEFAULT_PROFILE;
  const profile = getProfile(activeProfile);
  // Include profile in cache key so different strategies produce distinct results
  const cacheKey = `${sym}:${date}:${matchSym}:${activeProfile}`;
  const cached = comparisonCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < COMPARISON_CACHE_TTL) {
    return res.json(cached.data);
  }

  try {
    // Use cached universe entry for match metrics when available — saves 7 FMP calls
    const cachedMatch = getCache().get(matchSym);
    const matchMetricsPromise = cachedMatch
      ? Promise.resolve({
          ...cachedMatch,
          date: new Date().toISOString().slice(0, 10),
          shortInterestPct: null,
        })
      : buildCurrentMetrics(matchSym);

    // Three independent parallel tracks — no positional coupling
    const [templateResult, matchMetrics, matchSparklineResult] = await Promise.all([
      fetchTemplate(sym, date),
      matchMetricsPromise,
      fetchMatchSparkline(matchSym),
    ]);

    // Compute match score between template and match using the core similarity engine
    const snapshotPopulatedCount = MATCH_METRICS.reduce((count, metric) => {
      const v = templateResult.template[metric];
      return (v != null && isFinite(v)) ? count + 1 : count;
    }, 0);
    const sectorStats = computeSectorStats(getCache());
    const profileOptions = { weights: profile.weights, sectorBonus: profile.sectorBonus, sectorStats };
    const similarity = calculateSimilarity(templateResult.template, matchMetrics, snapshotPopulatedCount, profileOptions);

    // Extract top matches and differences
    const rankedByContribution = [...similarity.metricScores]
      .sort((a, b) => (b.similarity * b.weight) - (a.similarity * a.weight));
    const topMatches = rankedByContribution.slice(0, 3).map(m => m.metric);
    const topMatchSet = new Set(topMatches);
    const rankedByMiss = [...similarity.metricScores]
      .sort((a, b) => ((1 - b.similarity) * b.weight) - ((1 - a.similarity) * a.weight));
    const topDifferences = rankedByMiss
      .filter(m => !topMatchSet.has(m.metric))
      .slice(0, 3)
      .map(m => m.metric);

    const result = {
      template: templateResult.template,
      match: matchMetrics,
      matchScore: Math.round(similarity.score * 10) / 10,
      metricsCompared: similarity.overlapCount,
      categoryScores: similarity.categoryScores || {},
      confidence: similarity.confidence || null,
      topMatches,
      topDifferences,
      metricScores: similarity.metricScores,
      sparkline: templateResult.sparkline,
      sparklineGainPct: templateResult.sparklineGainPct,
      matchSparkline: matchSparklineResult.matchSparkline,
      matchSparklineGainPct: matchSparklineResult.matchSparklineGainPct,
    };

    // Diagnostic: log how many match metrics are populated on each side.
    // Helps spot cases where the snapshot has sparse data that would cause noisy matching.
    const tPopulated = MATCH_METRIC_KEYS.filter(k => result.template[k] != null).length;
    const mPopulated = MATCH_METRIC_KEYS.filter(k => result.match[k] != null).length;
    console.log(`[comparison] ${sym}@${date} vs ${matchSym}: template ${tPopulated}/${MATCH_METRIC_KEYS.length}, match ${mPopulated}/${MATCH_METRIC_KEYS.length}, sparkline=${result.matchSparkline.length}pts`);
    if (tPopulated < MATCH_METRIC_KEYS.length * 0.6) {
      const missing = MATCH_METRIC_KEYS.filter(k => result.template[k] == null);
      console.log(`[comparison] Template sparse — missing: ${missing.join(', ')}`);
    }

    comparisonCache.set(cacheKey, { data: result, ts: Date.now() });
    res.json(result);
  } catch (err) {
    console.error('[comparison] Error:', err.message, err.stack);
    res.status(500).json({ error: 'Failed to fetch comparison data' });
  }
});

module.exports = router;
