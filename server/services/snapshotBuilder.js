/**
 * Shared snapshot-building logic.
 *
 * Produces a point-in-time financial snapshot for a ticker at a given date.
 * Used by the /api/snapshot route and the track-record backtest system.
 *
 * All financial data is filtered to only include periods on or before the
 * snapshot date, so the result reflects what was known AT that point in time.
 */
const fmp = require('./fmp');
const { computeRSI } = require('./rsi');

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

/**
 * Build a point-in-time snapshot for a ticker at a given date.
 * Makes FMP API calls to fetch historical financials and prices.
 *
 * @param {string} ticker - Stock symbol
 * @param {string} date - Snapshot date (YYYY-MM-DD)
 * @param {boolean} [throttle=true] - Whether to enforce FMP rate limiting
 * @returns {Object|null} - Snapshot object or null if insufficient data
 */
async function buildSnapshot(ticker, date, throttle = true) {
  const sym = ticker.toUpperCase();

  // Fetch 1 year of prices before snapshot date for 52w high + RSI window
  const fromDate = new Date(date);
  fromDate.setFullYear(fromDate.getFullYear() - 1);
  const fromStr = fromDate.toISOString().slice(0, 10);

  // Calculate how many quarterly periods we need from FMP
  const now = new Date();
  const snapDate = new Date(date);
  const yearsBack = Math.max(0, (now.getTime() - snapDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  const incomeLimit = Math.max(20, Math.ceil((yearsBack + 4) * 4) + 4);
  const balanceCashLimit = Math.max(8, Math.ceil((yearsBack + 1) * 4) + 4);
  const annualLimit = Math.max(4, Math.ceil(yearsBack + 4) + 1);

  const [profileData, incomeData, histData, balanceSheetData, cashFlowData, balanceSheetAnnualData, cashFlowAnnualData] =
    await Promise.allSettled([
      fmp.getProfile(sym, throttle),
      fmp.getIncomeStatements(sym, incomeLimit, throttle, 'quarter'),
      fmp.getHistoricalPrices(sym, fromStr, date, throttle),
      fmp.getBalanceSheet(sym, balanceCashLimit, throttle, 'quarter'),
      fmp.getCashFlowStatement(sym, balanceCashLimit, throttle, 'quarter'),
      fmp.getBalanceSheet(sym, annualLimit, throttle),
      fmp.getCashFlowStatement(sym, annualLimit, throttle),
    ]);

  const profile     = profileData.status    === 'fulfilled' ? profileData.value    : {};
  const income      = incomeData.status     === 'fulfilled' ? incomeData.value     : [];
  const historical  = histData.status       === 'fulfilled' ? histData.value       : [];
  const balanceSheetQ = balanceSheetData.status  === 'fulfilled' ? balanceSheetData.value  : [];
  const cashFlowStmtQ = cashFlowData.status      === 'fulfilled' ? cashFlowData.value      : [];
  const balanceSheetA = balanceSheetAnnualData.status === 'fulfilled' ? balanceSheetAnnualData.value : [];
  const cashFlowStmtA = cashFlowAnnualData.status    === 'fulfilled' ? cashFlowAnnualData.value    : [];

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

  // Validate that 4 quarters actually span a ~12-month window
  function validTtmWindow(quarters) {
    if (quarters.length < 4) return false;
    const newest = new Date(quarters[0].date);
    const oldest = new Date(quarters[3].date);
    const spanMonths = (newest - oldest) / (30.44 * 24 * 60 * 60 * 1000);
    return spanMonths >= 8 && spanMonths <= 15;
  }
  const ttm = validTtmWindow(ttmIncomeQ) ? sumQuarters(ttmIncomeQ) : null;
  const priorTtm = validTtmWindow(priorTtmIncomeQ) ? sumQuarters(priorTtmIncomeQ) : null;

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

  const ttm3yrAgoQ = incomeQuarters.slice(12, 16);
  const ttm3yrAgo = validTtmWindow(ttm3yrAgoQ) ? sumQuarters(ttm3yrAgoQ) : null;
  let revenueGrowth3yr = null;
  // Both current and 3yr-ago TTM revenue must be positive for CAGR to be meaningful
  if (ttm && ttm.revenue > 0 && ttm3yrAgo && ttm3yrAgo.revenue > 0) {
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
  if (!price) return null; // Can't build snapshot without a price

  // --- Technical indicators ---
  const histFiltered = [...historical]
    .filter(h => new Date(h.date) <= new Date(date))
    .sort((a, b) => new Date(a.date) - new Date(b.date));
  const pricesAsc = histFiltered.map(h => h.close);
  const rsi14 = computeRSI(pricesAsc.slice(-30));

  const prices52w = pricesAsc.slice(-252);
  const high52w = prices52w.length >= 200 ? Math.max(...prices52w) : null;
  const pctBelowHigh =
    price != null && high52w != null && high52w > 0
      ? ((high52w - price) / high52w) * 100
      : null;

  let priceVsMa50 = null;
  let priceVsMa200 = null;
  if (pricesAsc.length >= 50) {
    const ma50 = pricesAsc.slice(-50).reduce((s, v) => s + v, 0) / 50;
    if (ma50 > 0) priceVsMa50 = ((price - ma50) / ma50) * 100;
  }
  if (pricesAsc.length >= 200) {
    const ma200 = pricesAsc.slice(-200).reduce((s, v) => s + v, 0) / 200;
    if (ma200 > 0) priceVsMa200 = ((price - ma200) / ma200) * 100;
  }

  // Volume profile
  let relativeVolume = null;
  const volumes = histFiltered.map(h => h.volume).filter(v => v != null && v > 0);
  if (volumes.length >= 50) {
    const vol50 = volumes.slice(-50).reduce((s, v) => s + v, 0) / 50;
    const vol5 = volumes.slice(-5).reduce((s, v) => s + v, 0) / Math.min(5, volumes.slice(-5).length);
    if (vol50 > 0) relativeVolume = vol5 / vol50;
  }

  // --- Computed ratios ---
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
    : null;

  const computedMarketCap = (price != null && sharesOut != null) ? price * sharesOut : null;
  const ev = computedMarketCap != null
    ? computedMarketCap + (totalDebt ?? 0) - (cash ?? 0) : null;

  // Valuation
  const peRatio = (price > 0 && ttm?.eps > 0) ? price / ttm.eps : null;
  const priceToSales = (computedMarketCap > 0 && ttm?.revenue > 0) ? computedMarketCap / ttm.revenue : null;
  const priceToBook = (computedMarketCap > 0 && equity > 0) ? computedMarketCap / equity : null;
  const evToEBITDA = (ev != null && ttm?.ebitda > 0) ? ev / ttm.ebitda : null;
  const evToRevenue = (ev != null && ttm?.revenue > 0) ? ev / ttm.revenue : null;
  const pegRatio = (peRatio > 0 && epsGrowthYoY > 0) ? peRatio / (epsGrowthYoY * 100) : null;

  // Returns — require positive equity/assets to avoid nonsensical negative ratios
  const returnOnEquity = (ttm && equity != null && equity > 0) ? ttm.netIncome / equity : null;
  const returnOnAssets = (ttm && totalAssets != null && totalAssets > 0) ? ttm.netIncome / totalAssets : null;
  const investedCapital = (equity != null && totalDebt != null && cash != null) ? equity + totalDebt - cash : null;
  const returnOnCapital = (ttm && investedCapital != null && investedCapital > 0)
    ? ttm.operatingIncome / investedCapital : null;

  // Financial Health
  const currentRatio = (totalCurrentAssets != null && totalCurrentLiabilities != null && totalCurrentLiabilities > 0)
    ? totalCurrentAssets / totalCurrentLiabilities : null;
  const debtToEquity = (totalDebt != null && equity != null && equity > 0) ? totalDebt / equity : null;
  const interestCoverage = (ttm && ttm.interestExpense != null && ttm.interestExpense !== 0)
    ? ttm.operatingIncome / Math.abs(ttm.interestExpense) : null;
  const netDebtToEBITDA = (totalDebt != null && cash != null && ttm?.ebitda > 0) ? (totalDebt - cash) / ttm.ebitda : null;
  const freeCashFlowYield = (ttmFCF != null && computedMarketCap > 0) ? ttmFCF / computedMarketCap : null;

  return {
    ticker: sym,
    companyName: profile?.companyName || sym,
    sector: profile?.sector || null,
    date,
    price,
    ttmRevenue: ttm ? ttm.revenue : null,
    // Valuation
    peRatio:           peRatio ?? null,
    priceToBook:       priceToBook ?? null,
    priceToSales:      priceToSales ?? null,
    evToEBITDA:        evToEBITDA ?? null,
    evToRevenue:       evToRevenue ?? null,
    pegRatio:          pegRatio ?? null,
    // Profitability
    grossMargin,
    operatingMargin,
    netMargin,
    ebitdaMargin,
    returnOnEquity:    returnOnEquity ?? null,
    returnOnAssets:    returnOnAssets ?? null,
    returnOnCapital:   returnOnCapital ?? null,
    // Growth
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
    // Technical
    rsi14,
    pctBelowHigh,
    priceVsMa50,
    priceVsMa200,
    beta:              profile?.beta ?? null,
    relativeVolume:    relativeVolume,
    // Size
    marketCap:         computedMarketCap ?? null,
    // Metadata
    dataAsOf:          mostRecentQuarterDate,
    ttmQuarters:       ttmQuarterCount,
  };
}

module.exports = { buildSnapshot, periodsOnOrBefore, sumQuarters, findPrice };
