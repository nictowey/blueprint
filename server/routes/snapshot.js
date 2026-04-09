const express = require('express');
const router = express.Router();
const fmp = require('../services/fmp');
const { computeRSI } = require('../services/rsi');

const snapshotCache = new Map();
const SNAPSHOT_CACHE_TTL = 24 * 60 * 60 * 1000;

// Filter periods on or before targetDate, sorted newest-first
function periodsOnOrBefore(periods, targetDate) {
  const target = new Date(targetDate);
  return periods
    .filter(p => new Date(p.date) <= target)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

// Sum flow metrics across an array of quarterly periods
function sumQuarters(quarters) {
  const sum = (field) => quarters.reduce((s, q) => s + (q[field] ?? 0), 0);
  return {
    revenue: sum('revenue'),
    grossProfit: sum('grossProfit'),
    operatingIncome: sum('operatingIncome'),
    netIncome: sum('netIncome'),
    ebitda: sum('ebitda'),
    eps: sum('eps'),
  };
}

// Find price on or before targetDate from newest-first historical array
function findPrice(historical, targetDate) {
  const target = new Date(targetDate);
  const entry = historical.find(h => new Date(h.date) <= target);
  return entry ? entry.close : null;
}

router.get('/', async (req, res) => {
  const { ticker, date } = req.query;
  if (!ticker || !date) {
    return res.status(400).json({ error: 'ticker and date are required' });
  }
  if (!/^[A-Z0-9.]{1,10}$/i.test(ticker)) {
    return res.status(400).json({ error: 'invalid ticker format' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date).getTime())) {
    return res.status(400).json({ error: 'invalid date format, expected YYYY-MM-DD' });
  }

  const sym = ticker.toUpperCase();
  const cacheKey = `${sym}:${date}`;
  const cached = snapshotCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < SNAPSHOT_CACHE_TTL) {
    return res.json(cached.data);
  }

  // Fetch 1 year of prices before snapshot date for 52w high + RSI window
  const fromDate = new Date(date);
  fromDate.setFullYear(fromDate.getFullYear() - 1);
  const fromStr = fromDate.toISOString().slice(0, 10);

  try {
    const [profileData, incomeData, metricsData, ratiosData, histData, shortData, balanceSheetData, cashFlowData] =
      await Promise.allSettled([
        fmp.getProfile(sym, false),
        fmp.getIncomeStatements(sym, 20, false, 'quarter'),
        fmp.getKeyMetricsAnnual(sym, false, 'quarter', 20),
        fmp.getRatiosAnnual(sym, false, 'quarter', 20),
        fmp.getHistoricalPrices(sym, fromStr, date, false),
        fmp.getShortInterest(sym, false),
        fmp.getBalanceSheet(sym, 8, false, 'quarter'),
        fmp.getCashFlowStatement(sym, 8, false, 'quarter'),
      ]);

    const profile    = profileData.status    === 'fulfilled' ? profileData.value    : {};
    const income     = incomeData.status     === 'fulfilled' ? incomeData.value     : [];
    const metrics    = metricsData.status    === 'fulfilled' ? metricsData.value    : [];
    const ratios     = ratiosData.status     === 'fulfilled' ? ratiosData.value     : [];
    const historical = histData.status       === 'fulfilled' ? histData.value       : [];
    const shortRaw   = shortData.status      === 'fulfilled' ? shortData.value      : null;
    const balanceSheet  = balanceSheetData.status  === 'fulfilled' ? balanceSheetData.value  : [];
    const cashFlowStmt  = cashFlowData.status      === 'fulfilled' ? cashFlowData.value      : [];

    // --- Quarterly periods on or before snapshot date ---
    const incomeQuarters = periodsOnOrBefore(income, date);
    const metricsQuarters = periodsOnOrBefore(metrics, date);
    const ratiosQuarters = periodsOnOrBefore(ratios, date);
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

    // Revenue 3yr CAGR: need TTM from ~3 years ago
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

    // --- Valuation & return ratios from most recent quarterly key-metrics/ratios ---
    const curMetrics = metricsQuarters[0] || null;
    const curRatios = ratiosQuarters[0] || null;

    // --- Balance sheet & cash flow from most recent quarter ---
    const curBalance = balanceQuarters[0] || null;
    const curCashFlow = cashFlowQuarters[0] || null;

    // --- Price ---
    const price = findPrice(historical, date);

    // --- Technical indicators (unchanged — price-based) ---
    const pricesAsc = [...historical]
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .filter(h => new Date(h.date) <= new Date(date))
      .map(h => h.close);
    const rsi14 = computeRSI(pricesAsc.slice(-30));

    const high52w = historical.length > 0 ? Math.max(...historical.map(h => h.close)) : null;
    const pctBelowHigh =
      price != null && high52w != null && high52w > 0
        ? ((high52w - price) / high52w) * 100
        : null;

    let priceVsMa50 = null;
    let priceVsMa200 = null;
    if (pricesAsc.length >= 50) {
      const ma50 = pricesAsc.slice(-50).reduce((s, v) => s + v, 0) / 50;
      if (price != null && ma50 > 0) priceVsMa50 = ((price - ma50) / ma50) * 100;
    }
    if (pricesAsc.length > 0) {
      const window200 = pricesAsc.slice(-200);
      const ma200 = window200.reduce((s, v) => s + v, 0) / window200.length;
      if (price != null && ma200 > 0) priceVsMa200 = ((price - ma200) / ma200) * 100;
    }

    const result = {
      ticker: sym,
      companyName: profile.companyName || sym,
      sector: profile.sector || null,
      date,
      price,
      ttmRevenue: ttm ? ttm.revenue : null,
      // Valuation — from most recent quarterly metrics/ratios
      peRatio:           curRatios?.priceToEarningsRatio ?? null,
      priceToBook:       curRatios?.priceToBookRatio ?? null,
      priceToSales:      curRatios?.priceToSalesRatio ?? null,
      evToEBITDA:        curMetrics?.evToEBITDA ?? null,
      evToRevenue:       curMetrics?.evToSales ?? null,
      pegRatio:          curRatios?.priceToEarningsGrowthRatio ?? null,
      earningsYield:     curMetrics?.earningsYield ?? null,
      // Profitability — TTM margins
      grossMargin,
      operatingMargin,
      netMargin,
      ebitdaMargin,
      returnOnEquity:    curMetrics?.returnOnEquity ?? null,
      returnOnAssets:    curMetrics?.returnOnAssets ?? null,
      returnOnCapital:   curMetrics?.returnOnInvestedCapital ?? null,
      // Growth — TTM vs prior-year TTM
      revenueGrowthYoY,
      revenueGrowth3yr,
      epsGrowthYoY,
      eps:               ttm ? ttm.eps : null,
      // Financial Health
      currentRatio:      curRatios?.currentRatio ?? curMetrics?.currentRatio ?? null,
      debtToEquity:      curRatios?.debtToEquityRatio ?? null,
      interestCoverage:  curRatios?.interestCoverageRatio ?? null,
      netDebtToEBITDA:   curMetrics?.netDebtToEBITDA ?? null,
      freeCashFlowYield: curMetrics?.freeCashFlowYield ?? null,
      dividendYield:     curRatios?.dividendYield ?? null,
      totalCash:         curBalance?.cashAndCashEquivalents ?? null,
      totalDebt:         curBalance?.totalDebt ?? null,
      freeCashFlow:      curCashFlow?.freeCashFlow ?? null,
      operatingCashFlow: curCashFlow?.operatingCashFlow ?? null,
      // Technical
      rsi14,
      pctBelowHigh,
      priceVsMa50,
      priceVsMa200,
      beta:              profile?.beta ?? null,
      avgVolume:         profile?.volAvg ?? profile?.averageVolume ?? null,
      // Overview
      marketCap:         curMetrics?.marketCap ?? null,
      shortInterestPct:  shortRaw?.shortInterestPercent ?? null,
    };
    snapshotCache.set(cacheKey, { data: result, ts: Date.now() });
    res.json(result);
  } catch (err) {
    console.error('[snapshot] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch snapshot data' });
  }
});

module.exports = router;
