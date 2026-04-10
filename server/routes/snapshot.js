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
  // For shares, use the most recent quarter's diluted share count
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

  // Calculate how many quarterly periods we need from FMP.
  // We need quarters going back to (snapshotDate - 4 years) for:
  //   - TTM: 4 quarters before snapshot date
  //   - Prior TTM: 4 more quarters before that (for YoY growth)
  //   - 3yr CAGR: 16 quarters before snapshot date
  // FMP returns the most recent N quarters, so we need enough to reach the snapshot date.
  const now = new Date();
  const snapDate = new Date(date);
  const yearsBack = Math.max(0, (now.getTime() - snapDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  // Need ~4 quarters per year of lookback, plus 16 for the snapshot's own 4-year window
  const incomeLimit = Math.max(20, Math.ceil((yearsBack + 4) * 4) + 4);
  const balanceCashLimit = Math.max(8, Math.ceil((yearsBack + 1) * 4) + 4);
  const annualLimit = Math.max(4, Math.ceil(yearsBack + 4) + 1);

  try {
    const [profileData, incomeData, histData, shortData, balanceSheetData, cashFlowData, balanceSheetAnnualData, cashFlowAnnualData] =
      await Promise.allSettled([
        fmp.getProfile(sym, false),
        fmp.getIncomeStatements(sym, incomeLimit, false, 'quarter'),
        fmp.getHistoricalPrices(sym, fromStr, date, false),
        fmp.getShortInterest(sym, false),
        fmp.getBalanceSheet(sym, balanceCashLimit, false, 'quarter'),
        fmp.getCashFlowStatement(sym, balanceCashLimit, false, 'quarter'),
        // Annual fallbacks for balance sheet / cash flow — quarterly only covers
        // the most recent few quarters, which may not reach the snapshot date.
        fmp.getBalanceSheet(sym, annualLimit, false),
        fmp.getCashFlowStatement(sym, annualLimit, false),
      ]);

    const profile    = profileData.status    === 'fulfilled' ? profileData.value    : {};
    const income     = incomeData.status     === 'fulfilled' ? incomeData.value     : [];
    const historical = histData.status       === 'fulfilled' ? histData.value       : [];
    const shortRaw   = shortData.status      === 'fulfilled' ? shortData.value      : null;
    const balanceSheetQ = balanceSheetData.status  === 'fulfilled' ? balanceSheetData.value  : [];
    const cashFlowStmtQ = cashFlowData.status      === 'fulfilled' ? cashFlowData.value      : [];
    const balanceSheetA = balanceSheetAnnualData.status === 'fulfilled' ? balanceSheetAnnualData.value : [];
    const cashFlowStmtA = cashFlowAnnualData.status    === 'fulfilled' ? cashFlowAnnualData.value    : [];
    // Merge quarterly + annual, dedupe by date, prefer quarterly if same date
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

    // Data freshness: the most recent quarter-end date included in the TTM window.
    // This tells the user what financial period the snapshot is actually based on,
    // since quarterly filings lag by 45-60 days after the quarter ends.
    const mostRecentQuarterDate = ttmIncomeQ[0]?.date ?? null;
    const ttmQuarterCount = ttmIncomeQ.length;

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

    // --- Balance sheet & cash flow from most recent quarter ---
    const curBalance = balanceQuarters[0] || null;
    const curCashFlow = cashFlowQuarters[0] || null;

    // --- Price ---
    const price = findPrice(historical, date);

    // --- Technical indicators (price-based) ---
    // Filter historical to only include prices on or before the snapshot date,
    // then sort ascending for moving average and RSI calculations.
    const histFiltered = [...historical]
      .filter(h => new Date(h.date) <= new Date(date))
      .sort((a, b) => new Date(a.date) - new Date(b.date));
    const pricesAsc = histFiltered.map(h => h.close);
    const rsi14 = computeRSI(pricesAsc.slice(-30));

    // 52-week high: use only the last 252 trading days (≈1 year) before the
    // snapshot date. Previously this used the entire historical array, which
    // could include prices from before the 52-week window if FMP returned extra data.
    const prices52w = pricesAsc.slice(-252);
    const high52w = prices52w.length > 0 ? Math.max(...prices52w) : null;
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
    if (pricesAsc.length >= 200) {
      const ma200 = pricesAsc.slice(-200).reduce((s, v) => s + v, 0) / 200;
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

    // TTM free cash flow — sum 4 most recent quarters (single quarter would be ~4x too low)
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

    const result = {
      ticker: sym,
      companyName: profile.companyName || sym,
      sector: profile.sector || null,
      date,
      price,
      ttmRevenue: ttm ? ttm.revenue : null,
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
      revenueGrowthYoY,
      revenueGrowth3yr,
      epsGrowthYoY,
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
      rsi14,
      pctBelowHigh,
      priceVsMa50,
      priceVsMa200,
      beta:              profile?.beta ?? null,
      avgVolume:         profile?.volAvg ?? profile?.averageVolume ?? null,
      // Overview
      marketCap:         computedMarketCap ?? null,
      shortInterestPct:  shortRaw?.shortInterestPercent ?? null,
      // Data freshness metadata
      dataAsOf:          mostRecentQuarterDate,
      ttmQuarters:       ttmQuarterCount,
    };
    snapshotCache.set(cacheKey, { data: result, ts: Date.now() });
    res.json(result);
  } catch (err) {
    console.error('[snapshot] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch snapshot data' });
  }
});

// --- Date range endpoint ---
// Returns the earliest date a ticker has enough financial data to produce a
// meaningful snapshot (needs at least 8 quarterly income statements for TTM + YoY).
const dateRangeCache = new Map();
const DATE_RANGE_CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

router.get('/date-range', async (req, res) => {
  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: 'ticker is required' });
  if (!/^[A-Z0-9.]{1,10}$/i.test(ticker))
    return res.status(400).json({ error: 'invalid ticker format' });

  const sym = ticker.toUpperCase();
  const cached = dateRangeCache.get(sym);
  if (cached && Date.now() - cached.ts < DATE_RANGE_CACHE_TTL) {
    return res.json(cached.data);
  }

  try {
    // Fetch quarterly income statements with a large limit to find the full history
    // Also fetch historical price data to find the earliest trading date
    const [incomeResult, priceResult] = await Promise.allSettled([
      fmp.getIncomeStatements(sym, 200, false, 'quarter'),
      fmp.getHistoricalPrices(sym, '1980-01-01', new Date().toISOString().slice(0, 10), false),
    ]);

    const income = incomeResult.status === 'fulfilled' ? incomeResult.value : [];
    const prices = priceResult.status === 'fulfilled' ? priceResult.value : [];

    // For a valid snapshot we need at least 8 quarterly income statements
    // (4 for TTM + 4 for prior year to compute YoY growth).
    // The earliest valid date is the filing date of the 8th oldest quarter.
    const sortedIncome = [...income].sort((a, b) => new Date(a.date) - new Date(b.date));

    let earliestSnapshotDate = null;
    if (sortedIncome.length >= 8) {
      // The 8th quarter (index 7) is the earliest where we have TTM + prior TTM
      // But the snapshot date should be AFTER this quarter's period end
      earliestSnapshotDate = sortedIncome[7].date;
    } else if (sortedIncome.length >= 4) {
      // Can compute TTM but not YoY growth — still somewhat useful
      earliestSnapshotDate = sortedIncome[3].date;
    }

    // Earliest price date
    const sortedPrices = [...prices].sort((a, b) => new Date(a.date) - new Date(b.date));
    const earliestPriceDate = sortedPrices.length > 0 ? sortedPrices[0].date : null;

    // The effective earliest date is the later of: earliest financial data, earliest price data
    let earliestDate = earliestSnapshotDate;
    if (earliestDate && earliestPriceDate && new Date(earliestPriceDate) > new Date(earliestDate)) {
      earliestDate = earliestPriceDate;
    }
    if (!earliestDate && earliestPriceDate) {
      earliestDate = earliestPriceDate;
    }

    // Latest valid date is today (or most recent trading day)
    const latestDate = new Date().toISOString().slice(0, 10);

    const result = {
      ticker: sym,
      earliestDate,
      latestDate,
      quarterCount: sortedIncome.length,
      priceHistoryStart: earliestPriceDate,
      // If fewer than 8 quarters, warn about limited data
      hasFullData: sortedIncome.length >= 8,
      message: sortedIncome.length < 4
        ? `${sym} has insufficient financial data (only ${sortedIncome.length} quarters available)`
        : sortedIncome.length < 8
          ? `${sym} has limited data — YoY growth metrics won't be available before ${sortedIncome.length >= 4 ? sortedIncome[3].date : 'N/A'}`
          : null,
    };

    dateRangeCache.set(sym, { data: result, ts: Date.now() });
    res.json(result);
  } catch (err) {
    console.error('[snapshot/date-range] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch date range' });
  }
});

module.exports = router;
module.exports.snapshotCache = snapshotCache;
module.exports.SNAPSHOT_CACHE_TTL = SNAPSHOT_CACHE_TTL;
