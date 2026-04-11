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
  const [profile, ttmMetrics, ttmRatios, incomeQ, hist, balance, cashFlow] = await Promise.all([
    fmp.getProfile(ticker, false),
    fmp.getKeyMetricsTTM(ticker, false),
    fmp.getRatiosTTM(ticker, false),
    fmp.getIncomeStatements(ticker, 16, false, 'quarter'),
    fmp.getHistoricalPrices(ticker,
      new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10),
      new Date().toISOString().slice(0, 10),
      false
    ),
    fmp.getBalanceSheet(ticker, 2, false),
    fmp.getCashFlowStatement(ticker, 2, false),
  ]);

  const bal = Array.isArray(balance) ? balance[0] || {} : {};
  const cf  = Array.isArray(cashFlow) ? cashFlow[0] || {} : {};

  // --- TTM growth from quarterly data (consistent with universe.js / snapshot.js) ---
  function sumQuarters(quarters) {
    return {
      revenue:  quarters.reduce((s, q) => s + (q.revenue || 0), 0),
      eps:      quarters.reduce((s, q) => s + (q.epsdiluted || q.eps || 0), 0),
    };
  }
  function validTtmWindow(quarters) {
    if (quarters.length < 4) return false;
    const newest = new Date(quarters[0].date);
    const oldest = new Date(quarters[3].date);
    const spanMonths = (newest - oldest) / (30.44 * 24 * 60 * 60 * 1000);
    return spanMonths >= 8 && spanMonths <= 15;
  }

  const ttmQ = (incomeQ || []).slice(0, 4);
  const priorTtmQ = (incomeQ || []).slice(4, 8);
  const ttm3yrAgoQ = (incomeQ || []).slice(12, 16);
  const ttm = validTtmWindow(ttmQ) ? sumQuarters(ttmQ) : null;
  const priorTtm = validTtmWindow(priorTtmQ) ? sumQuarters(priorTtmQ) : null;
  const ttm3yrAgo = validTtmWindow(ttm3yrAgoQ) ? sumQuarters(ttm3yrAgoQ) : null;

  let revenueGrowthYoY = null;
  if (ttm && priorTtm && priorTtm.revenue !== 0)
    revenueGrowthYoY = (ttm.revenue - priorTtm.revenue) / Math.abs(priorTtm.revenue);

  let revenueGrowth3yr = null;
  if (ttm && ttm.revenue > 0 && ttm3yrAgo && ttm3yrAgo.revenue > 0)
    revenueGrowth3yr = Math.pow(ttm.revenue / ttm3yrAgo.revenue, 1 / 3) - 1;

  let epsGrowthYoY = null;
  if (ttm && priorTtm && priorTtm.eps !== 0)
    epsGrowthYoY = (ttm.eps - priorTtm.eps) / Math.abs(priorTtm.eps);

  const pricesAsc = [...hist].reverse().map(h => h.close);
  const currentPrice = hist[0]?.close ?? null;
  // 52-week high: use only the last 252 trading days (~1 year)
  const prices52w = pricesAsc.slice(-252);
  const high52w = prices52w.length > 0 ? Math.max(...prices52w) : null;
  const pctBelowHigh = currentPrice != null && high52w > 0
    ? ((high52w - currentPrice) / high52w) * 100 : null;
  const rsi14 = computeRSI(pricesAsc.slice(-30));

  let priceVsMa50 = null, priceVsMa200 = null;
  if (pricesAsc.length >= 50) {
    const ma50 = pricesAsc.slice(-50).reduce((s, v) => s + v, 0) / 50;
    if (currentPrice != null && ma50 > 0) priceVsMa50 = ((currentPrice - ma50) / ma50) * 100;
  }
  if (pricesAsc.length >= 200) {
    const ma200 = pricesAsc.slice(-200).reduce((s, v) => s + v, 0) / 200;
    if (currentPrice != null && ma200 > 0) priceVsMa200 = ((currentPrice - ma200) / ma200) * 100;
  }

  return {
    ticker,
    companyName:       profile?.companyName || ticker,
    sector:            profile?.sector || null,
    date:              new Date().toISOString().slice(0, 10),
    price:             currentPrice,
    // Valuation
    peRatio:           ttmRatios.priceToEarningsRatioTTM ?? null,
    priceToBook:       ttmRatios.priceToBookRatioTTM ?? null,
    priceToSales:      ttmRatios.priceToSalesRatioTTM ?? null,
    evToEBITDA:        ttmMetrics.evToEBITDATTM ?? null,
    evToRevenue:       ttmMetrics.evToSalesTTM ?? null,
    pegRatio:          ttmRatios.priceToEarningsGrowthRatioTTM ?? null,
    earningsYield:     ttmMetrics.earningsYieldTTM ?? null,
    // Profitability — prefer FMP TTM ratios
    grossMargin:       ttmRatios.grossProfitMarginTTM ?? null,
    operatingMargin:   ttmRatios.operatingProfitMarginTTM ?? null,
    netMargin:         ttmRatios.netProfitMarginTTM ?? null,
    ebitdaMargin:      ttmRatios.ebitdaMarginTTM ?? null,
    returnOnEquity:    ttmMetrics.returnOnEquityTTM ?? null,
    returnOnAssets:    ttmMetrics.returnOnAssetsTTM ?? null,
    returnOnCapital:   ttmMetrics.returnOnInvestedCapitalTTM ?? null,
    // Growth (TTM-based from quarterly data, consistent with universe.js)
    revenueGrowthYoY, revenueGrowth3yr, epsGrowthYoY,
    eps:               ttm ? ttm.eps : null,
    // Financial Health
    currentRatio:      ttmRatios.currentRatioTTM ?? ttmMetrics.currentRatioTTM ?? null,
    debtToEquity:      ttmRatios.debtToEquityRatioTTM ?? null,
    interestCoverage:  ttmRatios.interestCoverageRatioTTM ?? null,
    netDebtToEBITDA:   ttmMetrics.netDebtToEBITDATTM ?? null,
    freeCashFlowYield: ttmMetrics.freeCashFlowYieldTTM ?? null,
    dividendYield:     ttmRatios.dividendYieldTTM ?? null,
    totalCash:         bal.cashAndCashEquivalents ?? null,
    totalDebt:         bal.totalDebt ?? null,
    freeCashFlow:      cf.freeCashFlow ?? null,
    operatingCashFlow: cf.operatingCashFlow ?? null,
    // Technical
    rsi14, pctBelowHigh, priceVsMa50, priceVsMa200,
    beta:              profile?.beta ?? null,
    avgVolume:         profile?.volAvg ?? profile?.averageVolume ?? null,
    // Overview
    marketCap:         ttmMetrics.marketCap ?? null,
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
