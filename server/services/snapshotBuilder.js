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
const {
  sumQuarters,
  validTtmWindow,
  computeMargins,
  computeGrowth,
  computeValuation,
  computeReturns,
  computeHealth,
  computeTechnicals,
} = require('./financials');

// Filter periods on or before targetDate, sorted newest-first
function periodsOnOrBefore(periods, targetDate) {
  const target = new Date(targetDate);
  return periods
    .filter(p => new Date(p.date) <= target)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
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

  // Sequential calls to respect FMP rate limits (300 calls/min on Starter plan).
  // Each call uses the throttle parameter for inter-call delay during cache builds.
  async function safeFmpCall(fn) {
    try { return await fn(); } catch { return null; }
  }

  const profile       = await safeFmpCall(() => fmp.getProfile(sym, throttle)) || {};
  const income        = await safeFmpCall(() => fmp.getIncomeStatements(sym, incomeLimit, throttle, 'quarter')) || [];
  const historical    = await safeFmpCall(() => fmp.getHistoricalPrices(sym, fromStr, date, throttle)) || [];
  const balanceSheetQ = await safeFmpCall(() => fmp.getBalanceSheet(sym, balanceCashLimit, throttle, 'quarter')) || [];
  const cashFlowStmtQ = await safeFmpCall(() => fmp.getCashFlowStatement(sym, balanceCashLimit, throttle, 'quarter')) || [];
  const balanceSheetA = await safeFmpCall(() => fmp.getBalanceSheet(sym, annualLimit, throttle)) || [];
  const cashFlowStmtA = await safeFmpCall(() => fmp.getCashFlowStatement(sym, annualLimit, throttle)) || [];

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

  const ttm = validTtmWindow(ttmIncomeQ) ? sumQuarters(ttmIncomeQ) : null;
  const priorTtm = validTtmWindow(priorTtmIncomeQ) ? sumQuarters(priorTtmIncomeQ) : null;

  const mostRecentQuarterDate = ttmIncomeQ[0]?.date ?? null;
  const ttmQuarterCount = ttmIncomeQ.length;

  // --- Margins from TTM ---
  const { grossMargin, operatingMargin, netMargin, ebitdaMargin } = computeMargins(ttm);

  // --- Growth: TTM vs prior-year TTM ---
  const ttm3yrAgoQ = incomeQuarters.slice(12, 16);
  const ttm3yrAgo = validTtmWindow(ttm3yrAgoQ) ? sumQuarters(ttm3yrAgoQ) : null;
  const { revenueGrowthYoY, revenueGrowth3yr, epsGrowthYoY } = computeGrowth(ttm, priorTtm, ttm3yrAgo);

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
  const volumes = histFiltered.map(h => h.volume).filter(v => v != null && v > 0);
  const { rsi14, pctBelowHigh, priceVsMa50, priceVsMa200, relativeVolume } =
    computeTechnicals({ pricesAsc, currentPrice: price, volumes });

  // --- Computed ratios ---
  const sharesOut = ttm?.sharesOut ?? null;
  const equity = curBalance?.totalStockholdersEquity ?? null;
  const totalAssets = curBalance?.totalAssets ?? null;
  const totalCurrentAssets = curBalance?.totalCurrentAssets ?? null;
  const totalCurrentLiabilities = curBalance?.totalCurrentLiabilities ?? null;
  const totalDebt = curBalance?.totalDebt ?? null;
  const cash = curBalance?.cashAndCashEquivalents ?? null;

  const ttmCashFlowQ = cashFlowQuarters.slice(0, 4);
  const cfTtmValid = validTtmWindow(ttmCashFlowQ);
  const ttmFCF = cfTtmValid
    ? ttmCashFlowQ.reduce((s, q) => s + (q.freeCashFlow ?? 0), 0)
    : null;
  const ttmOperatingCashFlow = cfTtmValid
    ? ttmCashFlowQ.reduce((s, q) => s + (q.operatingCashFlow ?? 0), 0)
    : null;

  const computedMarketCap = (price != null && sharesOut != null) ? price * sharesOut : null;
  const ev = (computedMarketCap != null && totalDebt != null && cash != null)
    ? computedMarketCap + totalDebt - cash : null;

  // Valuation
  const { peRatio, priceToBook, priceToSales, evToEBITDA, evToRevenue, earningsYield, pegRatio } =
    computeValuation({ price, ttm, equity, computedMarketCap, ev, epsGrowthYoY });

  // Returns
  const { returnOnEquity, returnOnAssets, returnOnCapital } =
    computeReturns({ ttm, equity, totalAssets, totalDebt, cash });

  // Financial Health
  const { currentRatio, debtToEquity, interestCoverage, netDebtToEBITDA, freeCashFlowYield } =
    computeHealth({ ttm, totalCurrentAssets, totalCurrentLiabilities, totalDebt, equity, cash, ttmFCF, computedMarketCap });

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
    earningsYield:     earningsYield ?? null,
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
    totalCash:         cash,
    totalDebt:         totalDebt,
    freeCashFlow:      ttmFCF,
    operatingCashFlow: ttmOperatingCashFlow,
    // Technical
    rsi14,
    pctBelowHigh,
    priceVsMa50,
    priceVsMa200,
    beta:              profile?.beta ?? null,
    avgVolume:         profile?.volAvg ?? profile?.averageVolume ?? null,
    relativeVolume:    relativeVolume,
    // Size
    marketCap:         computedMarketCap ?? null,
    // Metadata
    dataAsOf:          mostRecentQuarterDate,
    ttmQuarters:       ttmQuarterCount,
    // Data provenance — quarterly figures behind key TTM metrics
    ttmBreakdown: ttmIncomeQ.length >= 4 ? ttmIncomeQ.slice(0, 4).map(q => ({
      date: q.date,
      revenue: q.revenue,
      eps: q.eps,
    })) : null,
    priorTtmRevenue: priorTtm ? priorTtm.revenue : null,
  };
}

module.exports = { buildSnapshot, periodsOnOrBefore, sumQuarters, findPrice };
