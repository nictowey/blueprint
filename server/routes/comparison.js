const express = require('express');
const router = express.Router();
const fmp = require('../services/fmp');
const {
  sumQuarters,
  validTtmWindow,
  computeMargins,
  computeGrowth,
  computeValuation,
  computeReturns,
  computeHealth,
  computeTechnicals,
} = require('../services/financials');
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

  // Sequential calls to respect FMP rate limits (300 calls/min on Starter plan)
  const profileData = await fmp.getProfile(ticker, false);
  const incomeData  = await fmp.getIncomeStatements(ticker, 16, false, 'quarter');
  const balanceData = await fmp.getBalanceSheet(ticker, 4, false, 'quarter');
  const cashFlowData = await fmp.getCashFlowStatement(ticker, 4, false, 'quarter');
  const historical  = await fmp.getHistoricalPrices(ticker, fromDate, toDate, false);

  const incomeQ = (incomeData || []).sort((a, b) => new Date(b.date) - new Date(a.date));
  const ttmQ = incomeQ.slice(0, 4);
  const priorTtmQ = incomeQ.slice(4, 8);
  const ttm3yrAgoQ = incomeQ.slice(12, 16);
  const ttm = validTtmWindow(ttmQ) ? sumQuarters(ttmQ) : null;
  const priorTtm = validTtmWindow(priorTtmQ) ? sumQuarters(priorTtmQ) : null;
  const ttm3yrAgo = validTtmWindow(ttm3yrAgoQ) ? sumQuarters(ttm3yrAgoQ) : null;

  // --- Growth ---
  const { revenueGrowthYoY, revenueGrowth3yr, epsGrowthYoY } = computeGrowth(ttm, priorTtm, ttm3yrAgo);

  // --- Balance sheet (latest quarterly) ---
  const balance = Array.isArray(balanceData) && balanceData.length > 0 ? balanceData[0] : null;
  const equity = balance?.totalStockholdersEquity ?? null;
  const totalAssets = balance?.totalAssets ?? null;
  const totalCurrentAssets = balance?.totalCurrentAssets ?? null;
  const totalCurrentLiabilities = balance?.totalCurrentLiabilities ?? null;
  const totalDebt = balance?.totalDebt ?? null;
  const cash = balance?.cashAndCashEquivalents ?? null;

  // --- Cash flow TTM (sum 4 quarters — must have all 4 for accuracy) ---
  const cfQuarters = Array.isArray(cashFlowData) ? [...cashFlowData].sort((a, b) => new Date(b.date) - new Date(a.date)) : [];
  const cfTtmQ = cfQuarters.slice(0, 4);
  const cfTtmValid = validTtmWindow(cfTtmQ);
  const ttmFCF = cfTtmValid
    ? cfTtmQ.reduce((s, q) => s + (q.freeCashFlow ?? 0), 0)
    : null;
  const ttmOperatingCF = cfTtmValid
    ? cfTtmQ.reduce((s, q) => s + (q.operatingCashFlow ?? 0), 0)
    : null;

  // --- Historical prices & technicals ---
  const hist = Array.isArray(historical) ? historical : [];
  const oldestFirst = [...hist].reverse();
  const closes = oldestFirst.map(d => d.close).filter(c => c != null);
  const currentPrice = hist[0]?.close ?? null;
  const volumes = oldestFirst.map(d => d.volume).filter(v => v != null && v > 0);

  const { rsi14, pctBelowHigh, priceVsMa50, priceVsMa200, relativeVolume } =
    computeTechnicals({ pricesAsc: closes, currentPrice, volumes });

  // --- Computed ratios ---
  const sharesOut = ttm?.sharesOut ?? null;
  const price = currentPrice;
  const computedMarketCap = (price != null && sharesOut != null) ? price * sharesOut : null;
  const ev = (computedMarketCap != null && totalDebt != null && cash != null)
    ? computedMarketCap + totalDebt - cash : null;

  const { peRatio, priceToBook, priceToSales, evToEBITDA, evToRevenue, earningsYield, pegRatio } =
    computeValuation({ price, ttm, equity, computedMarketCap, ev, epsGrowthYoY });
  const { grossMargin, operatingMargin, netMargin, ebitdaMargin } = computeMargins(ttm);
  const { returnOnEquity, returnOnAssets, returnOnCapital } =
    computeReturns({ ttm, equity, totalAssets, totalDebt, cash });
  const { currentRatio, debtToEquity, interestCoverage, netDebtToEBITDA, freeCashFlowYield } =
    computeHealth({ ttm, totalCurrentAssets, totalCurrentLiabilities, totalDebt, equity, cash, ttmFCF, computedMarketCap });
  const dividendYield = profileData?.lastDiv && price > 0 ? profileData.lastDiv / price : null;

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
          date: cachedMatch.lastEnriched
            ? new Date(cachedMatch.lastEnriched).toISOString().slice(0, 10)
            : new Date().toISOString().slice(0, 10),
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
    const profileOptions = { weights: profile.weights, sectorStats };
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
