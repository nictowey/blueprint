const express = require('express');
const router = express.Router();
const fmp = require('../services/fmp');
const { computeRSI } = require('../services/rsi');

// Historical snapshots are immutable — cache indefinitely (24h TTL is conservative)
const snapshotCache = new Map();
const SNAPSHOT_CACHE_TTL = 24 * 60 * 60 * 1000;

// Find the most recent period whose date falls on or before targetDate
function findPeriodOnOrBefore(periods, targetDate) {
  const target = new Date(targetDate);
  return periods
    .filter(p => new Date(p.date) <= target)
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;
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
        fmp.getIncomeStatements(sym, 8, false),
        fmp.getKeyMetricsAnnual(sym, false),
        fmp.getRatiosAnnual(sym, false),
        fmp.getHistoricalPrices(sym, fromStr, date, false),
        fmp.getShortInterest(sym, false),
        fmp.getBalanceSheet(sym, 4, false),
        fmp.getCashFlowStatement(sym, 4, false),
      ]);

    const profile    = profileData.status    === 'fulfilled' ? profileData.value    : {};
    const income     = incomeData.status     === 'fulfilled' ? incomeData.value     : [];
    const metrics    = metricsData.status    === 'fulfilled' ? metricsData.value    : [];
    const ratios     = ratiosData.status     === 'fulfilled' ? ratiosData.value     : [];
    const historical = histData.status       === 'fulfilled' ? histData.value       : [];
    const shortRaw   = shortData.status      === 'fulfilled' ? shortData.value      : null;
    const balanceSheet  = balanceSheetData.status  === 'fulfilled' ? balanceSheetData.value  : [];
    const cashFlowStmt  = cashFlowData.status      === 'fulfilled' ? cashFlowData.value      : [];

    // Annual period on or before snapshot date
    const curIncome  = findPeriodOnOrBefore(income, date);
    const curMetrics = findPeriodOnOrBefore(metrics, date);
    const curRatios  = findPeriodOnOrBefore(ratios, date);
    const curBalance = findPeriodOnOrBefore(balanceSheet, date);
    const curCashFlow = findPeriodOnOrBefore(cashFlowStmt, date);

    // Prior income statement for revenue growth
    const priorIncome = curIncome
      ? income.find(p => p.date !== curIncome.date && new Date(p.date) < new Date(curIncome.date))
      : null;

    // Revenue growth YoY
    let revenueGrowthYoY = null;
    if (curIncome?.revenue != null && priorIncome?.revenue && priorIncome.revenue !== 0) {
      revenueGrowthYoY = (curIncome.revenue - priorIncome.revenue) / Math.abs(priorIncome.revenue);
    }

    // Revenue 3yr CAGR
    const income3yrAgo = curIncome
      ? income
          .filter(p => new Date(p.date) < new Date(curIncome.date))
          .sort((a, b) => new Date(b.date) - new Date(a.date))[2] || null
      : null;
    let revenueGrowth3yr = null;
    if (curIncome?.revenue != null && income3yrAgo?.revenue && income3yrAgo.revenue !== 0) {
      revenueGrowth3yr = Math.pow(curIncome.revenue / income3yrAgo.revenue, 1 / 3) - 1;
    }

    // EPS growth YoY
    let epsGrowthYoY = null;
    if (curIncome?.eps != null && priorIncome?.eps && priorIncome.eps !== 0) {
      epsGrowthYoY = (curIncome.eps - priorIncome.eps) / Math.abs(priorIncome.eps);
    }

    // Margins — calculated from income statement raw fields
    const grossMargin     = curIncome?.revenue ? (curIncome.grossProfit / curIncome.revenue) : null;
    const operatingMargin = curIncome?.revenue ? (curIncome.operatingIncome / curIncome.revenue) : null;
    const netMargin       = curIncome?.revenue ? (curIncome.netIncome / curIncome.revenue) : null;
    const ebitdaMargin    = curIncome?.revenue ? (curIncome.ebitda / curIncome.revenue) : null;

    // Price on snapshot date (newest-first historical array)
    const price = findPrice(historical, date);

    // RSI: oldest-first, last 30 prices on or before snapshot date
    const pricesAsc = [...historical]
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .filter(h => new Date(h.date) <= new Date(date))
      .map(h => h.close);
    const rsi14 = computeRSI(pricesAsc.slice(-30));

    // 52-week high
    const high52w = historical.length > 0 ? Math.max(...historical.map(h => h.close)) : null;
    const pctBelowHigh =
      price != null && high52w != null && high52w > 0
        ? ((high52w - price) / high52w) * 100
        : null;

    // Moving averages
    let priceVsMa50 = null;
    let priceVsMa200 = null;
    if (pricesAsc.length >= 50) {
      const ma50 = pricesAsc.slice(-50).reduce((s, v) => s + v, 0) / 50;
      if (price != null && ma50 > 0) priceVsMa50 = ((price - ma50) / ma50) * 100;
    }
    if (pricesAsc.length > 0) {
      const ma200 = pricesAsc.reduce((s, v) => s + v, 0) / pricesAsc.length;
      if (price != null && ma200 > 0) priceVsMa200 = ((price - ma200) / ma200) * 100;
    }

    const result = {
      ticker: sym,
      companyName: profile.companyName || sym,
      sector: profile.sector || null,
      date,
      price,
      // Valuation — from /ratios
      peRatio:           curRatios?.priceToEarningsRatio ?? null,
      priceToBook:       curRatios?.priceToBookRatio ?? null,
      priceToSales:      curRatios?.priceToSalesRatio ?? null,
      evToEBITDA:        curMetrics?.evToEBITDA ?? null,
      evToRevenue:       curMetrics?.evToSales ?? null,
      pegRatio:          curRatios?.priceToEarningsGrowthRatio ?? null,
      earningsYield:     curMetrics?.earningsYield ?? null,
      // Profitability — margins calculated from income statement
      grossMargin,
      operatingMargin,
      netMargin,
      ebitdaMargin,
      returnOnEquity:    curMetrics?.returnOnEquity ?? null,
      returnOnAssets:    curMetrics?.returnOnAssets ?? null,
      returnOnCapital:   curMetrics?.returnOnInvestedCapital ?? null,
      // Growth
      revenueGrowthYoY,
      revenueGrowth3yr,
      epsGrowthYoY,
      eps:               curIncome?.eps ?? null,
      // Financial Health — from /ratios
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
