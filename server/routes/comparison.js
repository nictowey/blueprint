const express = require('express');
const router = express.Router();
const fmp = require('../services/fmp');
const { computeRSI } = require('../services/rsi');
const { getCache } = require('../services/universe');
const { calculateSimilarity, MATCH_METRICS } = require('../services/matcher');
const { snapshotCache, SNAPSHOT_CACHE_TTL } = require('./snapshot');

// Template side is historical/immutable; match side updates every ~10 min with
// the incremental refresh cycle — use matching TTL.
const comparisonCache = new Map();
const COMPARISON_CACHE_TTL = 10 * 60 * 1000;

function findPeriodOnOrBefore(periods, targetDate) {
  const target = new Date(targetDate);
  return periods
    .filter(p => new Date(p.date) <= target)
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;
}

function findPrice(historical, targetDate) {
  const target = new Date(targetDate);
  const entry = historical.find(h => new Date(h.date) <= target);
  return entry ? entry.close : null;
}

// ========================================================================
// Historical template — all data for the snapshot ticker at the given date
// ========================================================================
// Sum flow metrics across an array of quarterly periods
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

function periodsOnOrBefore(periods, targetDate) {
  const target = new Date(targetDate);
  return periods
    .filter(p => new Date(p.date) <= target)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

async function fetchTemplate(sym, date) {
  // --- Reuse snapshot cache so match list and comparison detail produce identical scores ---
  const snapCacheKey = `${sym}:${date}`;
  const snapCached = snapshotCache.get(snapCacheKey);
  if (snapCached && Date.now() - snapCached.ts < SNAPSHOT_CACHE_TTL) {
    // Snapshot endpoint already computed this — reuse it for the template,
    // but we still need the sparkline which isn't part of the snapshot.
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
    return { template: snapCached.data, sparkline, sparklineGainPct };
  }

  // --- No snapshot cache hit — full FMP fetch (fallback) ---
  const fromDate = new Date(date);
  fromDate.setFullYear(fromDate.getFullYear() - 1);
  const fromStr = fromDate.toISOString().slice(0, 10);

  // Sparkline window: 18 months after snapshot date, capped at today
  const afterDate = new Date(date);
  afterDate.setMonth(afterDate.getMonth() + 18);
  const sparklineEnd = afterDate.toISOString().slice(0, 10) < new Date().toISOString().slice(0, 10)
    ? afterDate.toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const [profileR, incomeR, histR, shortR, balanceSheetR, cashFlowR, balanceSheetAnnualR, cashFlowAnnualR, sparklineR] =
    await Promise.allSettled([
      fmp.getProfile(sym, false),
      fmp.getIncomeStatements(sym, 20, false, 'quarter'),
      fmp.getHistoricalPrices(sym, fromStr, date, false),
      fmp.getShortInterest(sym, false),
      fmp.getBalanceSheet(sym, 8, false, 'quarter'),
      fmp.getCashFlowStatement(sym, 8, false, 'quarter'),
      fmp.getBalanceSheet(sym, 4, false),
      fmp.getCashFlowStatement(sym, 4, false),
      fmp.getHistoricalPrices(sym, date, sparklineEnd, false),
    ]);

  const profile    = profileR.status  === 'fulfilled' ? profileR.value  : {};
  const income     = incomeR.status   === 'fulfilled' ? incomeR.value   : [];
  const historical = histR.status     === 'fulfilled' ? histR.value     : [];
  const shortRaw   = shortR.status    === 'fulfilled' ? shortR.value    : null;
  const balanceSheetQ = balanceSheetR.status  === 'fulfilled' ? balanceSheetR.value  : [];
  const cashFlowStmtQ = cashFlowR.status      === 'fulfilled' ? cashFlowR.value      : [];
  const balanceSheetA = balanceSheetAnnualR.status === 'fulfilled' ? balanceSheetAnnualR.value : [];
  const cashFlowStmtA = cashFlowAnnualR.status    === 'fulfilled' ? cashFlowAnnualR.value    : [];
  const sparkRaw   = sparklineR.status === 'fulfilled' ? sparklineR.value : [];

  // Merge quarterly + annual, dedupe by date, prefer quarterly
  const balanceSheet = [...balanceSheetQ, ...balanceSheetA.filter(a => !balanceSheetQ.some(q => q.date === a.date))];
  const cashFlowStmt = [...cashFlowStmtQ, ...cashFlowStmtA.filter(a => !cashFlowStmtQ.some(q => q.date === a.date))];

  // --- Quarterly periods on or before snapshot date ---
  const incomeQuarters = periodsOnOrBefore(income, date);
  const balanceQuarters = periodsOnOrBefore(balanceSheet, date);
  const cashFlowQuarters = periodsOnOrBefore(cashFlowStmt, date);

  // --- TTM from 4 most recent quarters ---
  const ttmIncomeQ = incomeQuarters.slice(0, 4);
  const priorTtmIncomeQ = incomeQuarters.slice(4, 8);
  const ttm = ttmIncomeQ.length >= 4 ? sumQuarters(ttmIncomeQ) : null;
  const priorTtm = priorTtmIncomeQ.length >= 4 ? sumQuarters(priorTtmIncomeQ) : null;

  // --- Margins from TTM ---
  const grossMargin     = ttm && ttm.revenue ? ttm.grossProfit / ttm.revenue : null;
  const operatingMargin = ttm && ttm.revenue ? ttm.operatingIncome / ttm.revenue : null;
  const netMargin       = ttm && ttm.revenue ? ttm.netIncome / ttm.revenue : null;
  const ebitdaMargin    = ttm && ttm.revenue ? ttm.ebitda / ttm.revenue : null;

  // --- Growth: TTM vs prior-year TTM ---
  let revenueGrowthYoY = null;
  if (ttm && priorTtm && priorTtm.revenue !== 0) {
    revenueGrowthYoY = (ttm.revenue - priorTtm.revenue) / Math.abs(priorTtm.revenue);
  }

  const ttm3yrAgoQ = incomeQuarters.slice(12, 16);
  const ttm3yrAgo = ttm3yrAgoQ.length >= 4 ? sumQuarters(ttm3yrAgoQ) : null;
  let revenueGrowth3yr = null;
  if (ttm && ttm3yrAgo && ttm3yrAgo.revenue > 0) {
    revenueGrowth3yr = Math.pow(ttm.revenue / ttm3yrAgo.revenue, 1 / 3) - 1;
  }

  let epsGrowthYoY = null;
  if (ttm && priorTtm && priorTtm.eps !== 0) {
    epsGrowthYoY = (ttm.eps - priorTtm.eps) / Math.abs(priorTtm.eps);
  }

  // --- Balance sheet & cash flow from most recent quarter ---
  const curBalance = balanceQuarters[0] || null;
  const curCashFlow = cashFlowQuarters[0] || null;

  // --- Price ---
  const price = findPrice(historical, date);

  // --- Technical indicators ---
  const pricesAsc = [...historical]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .filter(h => new Date(h.date) <= new Date(date))
    .map(h => h.close);

  const rsi14 = computeRSI(pricesAsc.slice(-30));
  const high52w = historical.length > 0
    ? historical.reduce((m, h) => Math.max(m, h.close), -Infinity) : null;
  const pctBelowHigh = price != null && high52w != null && high52w > 0
    ? ((high52w - price) / high52w) * 100 : null;

  let priceVsMa50 = null, priceVsMa200 = null;
  if (pricesAsc.length >= 50) {
    const ma50 = pricesAsc.slice(-50).reduce((s, v) => s + v, 0) / 50;
    if (price != null && ma50 > 0) priceVsMa50 = ((price - ma50) / ma50) * 100;
  }
  if (pricesAsc.length > 0) {
    const window200 = pricesAsc.slice(-200);
    const ma200 = window200.reduce((s, v) => s + v, 0) / window200.length;
    if (price != null && ma200 > 0) priceVsMa200 = ((price - ma200) / ma200) * 100;
  }

  // --- Computed valuation, return, and financial health ratios ---
  const sharesOut = ttm?.sharesOut ?? null;
  const equity = curBalance?.totalStockholdersEquity ?? null;
  const totalAssets = curBalance?.totalAssets ?? null;
  const totalCurrentAssets = curBalance?.totalCurrentAssets ?? null;
  const totalCurrentLiabilities = curBalance?.totalCurrentLiabilities ?? null;
  const totalDebt = curBalance?.totalDebt ?? null;
  const cash = curBalance?.cashAndCashEquivalents ?? null;

  const ttmCashFlowQ = cashFlowQuarters.slice(0, 4);
  const ttmFCF = ttmCashFlowQ.length >= 4
    ? ttmCashFlowQ.reduce((s, q) => s + (q.freeCashFlow ?? 0), 0)
    : (cashFlowQuarters[0]?.freeCashFlow ?? null);

  const computedMarketCap = (price != null && sharesOut != null) ? price * sharesOut : null;
  const ev = (computedMarketCap != null && totalDebt != null && cash != null)
    ? computedMarketCap + totalDebt - cash : null;

  // Valuation
  const peRatio = (price > 0 && ttm?.eps > 0) ? price / ttm.eps : null;
  const priceToSales = (computedMarketCap > 0 && ttm?.revenue > 0) ? computedMarketCap / ttm.revenue : null;
  const priceToBook = (computedMarketCap > 0 && equity > 0) ? computedMarketCap / equity : null;
  const evToEBITDA = (ev != null && ttm?.ebitda > 0) ? ev / ttm.ebitda : null;
  const evToRevenue = (ev != null && ttm?.revenue > 0) ? ev / ttm.revenue : null;
  const earningsYield = (price > 0 && ttm) ? ttm.eps / price : null;
  const pegRatio = (peRatio > 0 && epsGrowthYoY > 0) ? peRatio / (epsGrowthYoY * 100) : null;

  // Returns
  const returnOnEquity = (ttm && equity != null && equity !== 0) ? ttm.netIncome / equity : null;
  const returnOnAssets = (ttm && totalAssets != null && totalAssets !== 0) ? ttm.netIncome / totalAssets : null;
  const returnOnCapital = (ttm && equity != null && totalDebt != null && cash != null && (equity + totalDebt - cash) !== 0)
    ? ttm.operatingIncome / (equity + totalDebt - cash) : null;

  // Financial Health
  const currentRatio = (totalCurrentAssets != null && totalCurrentLiabilities != null && totalCurrentLiabilities !== 0)
    ? totalCurrentAssets / totalCurrentLiabilities : null;
  const debtToEquity = (totalDebt != null && equity != null && equity !== 0) ? totalDebt / equity : null;
  const interestCoverage = (ttm && ttm.interestExpense != null && ttm.interestExpense !== 0)
    ? ttm.operatingIncome / Math.abs(ttm.interestExpense) : null;
  const netDebtToEBITDA = (totalDebt != null && cash != null && ttm?.ebitda > 0) ? (totalDebt - cash) / ttm.ebitda : null;
  const freeCashFlowYield = (ttmFCF != null && computedMarketCap > 0) ? ttmFCF / computedMarketCap : null;

  const template = {
    ticker:            sym,
    companyName:       profile.companyName || sym,
    sector:            profile.sector || null,
    date,
    price,
    // Valuation — computed from price + TTM + balance sheet
    peRatio:           peRatio ?? null,
    priceToBook:       priceToBook ?? null,
    priceToSales:      priceToSales ?? null,
    evToEBITDA:        evToEBITDA ?? null,
    evToRevenue:       evToRevenue ?? null,
    pegRatio:          pegRatio ?? null,
    earningsYield:     earningsYield ?? null,
    // Profitability — TTM margins
    grossMargin,
    operatingMargin,
    netMargin,
    ebitdaMargin,
    returnOnEquity:    returnOnEquity ?? null,
    returnOnAssets:    returnOnAssets ?? null,
    returnOnCapital:   returnOnCapital ?? null,
    // Growth — TTM vs prior-year TTM
    revenueGrowthYoY, revenueGrowth3yr, epsGrowthYoY,
    eps:               ttm ? ttm.eps : null,
    // Financial Health
    currentRatio:      currentRatio ?? null,
    debtToEquity:      debtToEquity ?? null,
    interestCoverage:  interestCoverage ?? null,
    netDebtToEBITDA:   netDebtToEBITDA ?? null,
    freeCashFlowYield: freeCashFlowYield ?? null,
    dividendYield:     null,
    totalCash:         cash,
    totalDebt:         totalDebt,
    freeCashFlow:      curCashFlow?.freeCashFlow ?? null,
    operatingCashFlow: curCashFlow?.operatingCashFlow ?? null,
    // Technical
    rsi14, pctBelowHigh, priceVsMa50, priceVsMa200,
    beta:              profile?.beta ?? null,
    avgVolume:         profile?.volAvg ?? profile?.averageVolume ?? null,
    // Overview
    marketCap:         computedMarketCap ?? null,
    shortInterestPct:  shortRaw?.shortInterestPercent ?? null,
  };

  // Post-snapshot sparkline (18 months forward)
  const sparkline = [...sparkRaw]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .map(h => ({ date: h.date, price: h.close }));

  let sparklineGainPct = null;
  if (sparkline.length >= 2) {
    const start = sparkline[0].price;
    const end = sparkline[sparkline.length - 1].price;
    if (start > 0) sparklineGainPct = ((end - start) / start) * 100;
  }

  return { template, sparkline, sparklineGainPct };
}

// ========================================================================
// Match current metrics — TTM-based, for present-day match ticker
// (used only when the match ticker is NOT in the universe cache)
// ========================================================================
async function buildCurrentMetrics(ticker) {
  const [profile, ttmMetrics, ttmRatios, income, hist, balance, cashFlow] = await Promise.all([
    fmp.getProfile(ticker, false),
    fmp.getKeyMetricsTTM(ticker, false),
    fmp.getRatiosTTM(ticker, false),
    fmp.getIncomeStatements(ticker, 4, false),
    fmp.getHistoricalPrices(ticker,
      new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10),
      new Date().toISOString().slice(0, 10),
      false
    ),
    fmp.getBalanceSheet(ticker, 2, false),
    fmp.getCashFlowStatement(ticker, 2, false),
  ]);

  const income0 = income[0] || {};
  const income1 = income[1] || {};
  const income3 = income[3] || {};
  const bal = Array.isArray(balance) ? balance[0] || {} : {};
  const cf  = Array.isArray(cashFlow) ? cashFlow[0] || {} : {};

  let revenueGrowthYoY = null;
  if (income0.revenue != null && income1.revenue && income1.revenue !== 0)
    revenueGrowthYoY = (income0.revenue - income1.revenue) / Math.abs(income1.revenue);

  let revenueGrowth3yr = null;
  if (income0.revenue != null && income3.revenue && income3.revenue !== 0)
    revenueGrowth3yr = Math.pow(income0.revenue / income3.revenue, 1 / 3) - 1;

  let epsGrowthYoY = null;
  if (income0.eps != null && income1.eps && income1.eps !== 0)
    epsGrowthYoY = (income0.eps - income1.eps) / Math.abs(income1.eps);

  const pricesAsc = [...hist].reverse().map(h => h.close);
  const currentPrice = hist[0]?.close ?? null;
  const high52w = hist.length > 0 ? hist.reduce((m, h) => Math.max(m, h.close), -Infinity) : null;
  const pctBelowHigh = currentPrice != null && high52w > 0
    ? ((high52w - currentPrice) / high52w) * 100 : null;
  const rsi14 = computeRSI(pricesAsc.slice(-30));

  let priceVsMa50 = null, priceVsMa200 = null;
  if (pricesAsc.length >= 50) {
    const ma50 = pricesAsc.slice(-50).reduce((s, v) => s + v, 0) / 50;
    if (currentPrice != null && ma50 > 0) priceVsMa50 = ((currentPrice - ma50) / ma50) * 100;
  }
  if (pricesAsc.length > 0) {
    const window200 = pricesAsc.slice(-200);
    const ma200 = window200.reduce((s, v) => s + v, 0) / window200.length;
    if (currentPrice != null && ma200 > 0) priceVsMa200 = ((currentPrice - ma200) / ma200) * 100;
  }

  const rev0 = income0.revenue;
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
    // Profitability — prefer TTM ratios, fall back to annual-income-derived
    grossMargin:       ttmRatios.grossProfitMarginTTM ?? (rev0 ? (income0.grossProfit / rev0) : null),
    operatingMargin:   ttmRatios.operatingProfitMarginTTM ?? (rev0 ? (income0.operatingIncome / rev0) : null),
    netMargin:         ttmRatios.netProfitMarginTTM ?? (rev0 ? (income0.netIncome / rev0) : null),
    ebitdaMargin:      ttmRatios.ebitdaMarginTTM ?? (rev0 ? (income0.ebitda / rev0) : null),
    returnOnEquity:    ttmMetrics.returnOnEquityTTM ?? null,
    returnOnAssets:    ttmMetrics.returnOnAssetsTTM ?? null,
    returnOnCapital:   ttmMetrics.returnOnInvestedCapitalTTM ?? null,
    // Growth
    revenueGrowthYoY, revenueGrowth3yr, epsGrowthYoY,
    eps:               income0.eps ?? null,
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
  const { ticker, date, matchTicker } = req.query;
  if (!ticker || !date || !matchTicker)
    return res.status(400).json({ error: 'ticker, date, and matchTicker are required' });
  if (!/^[A-Z0-9.]{1,10}$/i.test(ticker) || !/^[A-Z0-9.]{1,10}$/i.test(matchTicker))
    return res.status(400).json({ error: 'invalid ticker format' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date).getTime()))
    return res.status(400).json({ error: 'invalid date format, expected YYYY-MM-DD' });

  const sym = ticker.toUpperCase();
  const matchSym = matchTicker.toUpperCase();
  const cacheKey = `${sym}:${date}:${matchSym}`;
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
    const similarity = calculateSimilarity(templateResult.template, matchMetrics, snapshotPopulatedCount);

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
