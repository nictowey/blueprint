/**
 * Shared financial calculation functions.
 *
 * Extracted from snapshotBuilder.js, universe.js, and comparison.js to
 * eliminate triple-duplicated formulas. Every function here is a pure
 * computation — no FMP calls, no side effects.
 */
const { computeRSI } = require('./rsi');

// ---------------------------------------------------------------------------
// TTM helpers
// ---------------------------------------------------------------------------

/**
 * Sum flow metrics across an array of quarterly income-statement periods.
 *
 * @param {Object[]} quarters - Quarterly periods (newest-first)
 * @returns {{ revenue, grossProfit, operatingIncome, netIncome, ebitda, eps, interestExpense, sharesOut }}
 */
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

/**
 * Validate that 4 quarters span a ~12-month window (8-15 months).
 * Prevents summing misaligned quarters when a period is missing.
 *
 * @param {Object[]} quarters - Exactly 4 quarterly periods, newest-first
 * @returns {boolean}
 */
function validTtmWindow(quarters) {
  if (quarters.length < 4) return false;
  const newest = new Date(quarters[0].date);
  const oldest = new Date(quarters[3].date);
  const spanMonths = (newest - oldest) / (30.44 * 24 * 60 * 60 * 1000);
  return spanMonths >= 8 && spanMonths <= 15;
}

// ---------------------------------------------------------------------------
// Margins
// ---------------------------------------------------------------------------

/**
 * Compute profitability margins from TTM aggregates.
 *
 * @param {Object|null} ttm - Output of sumQuarters()
 * @returns {{ grossMargin, operatingMargin, netMargin, ebitdaMargin }}
 */
function computeMargins(ttm) {
  const hasRevenue = ttm && ttm.revenue;
  return {
    grossMargin:     hasRevenue ? ttm.grossProfit / ttm.revenue : null,
    operatingMargin: hasRevenue ? ttm.operatingIncome / ttm.revenue : null,
    netMargin:       hasRevenue ? ttm.netIncome / ttm.revenue : null,
    ebitdaMargin:    hasRevenue ? ttm.ebitda / ttm.revenue : null,
  };
}

// ---------------------------------------------------------------------------
// Growth
// ---------------------------------------------------------------------------

/**
 * Compute growth rates from TTM windows.
 *
 * @param {Object|null} ttm - Current TTM (sumQuarters output)
 * @param {Object|null} priorTtm - Prior-year TTM (sumQuarters output)
 * @param {Object|null} ttm3yrAgo - TTM from 3 years ago (sumQuarters output)
 * @returns {{ revenueGrowthYoY, revenueGrowth3yr, epsGrowthYoY }}
 */
function computeGrowth(ttm, priorTtm, ttm3yrAgo) {
  let revenueGrowthYoY = null;
  if (ttm && priorTtm && priorTtm.revenue !== 0) {
    revenueGrowthYoY = (ttm.revenue - priorTtm.revenue) / Math.abs(priorTtm.revenue);
  }

  let revenueGrowth3yr = null;
  // Both current and 3yr-ago TTM revenue must be positive for CAGR to be meaningful
  if (ttm && ttm.revenue > 0 && ttm3yrAgo && ttm3yrAgo.revenue > 0) {
    revenueGrowth3yr = Math.pow(ttm.revenue / ttm3yrAgo.revenue, 1 / 3) - 1;
  }

  let epsGrowthYoY = null;
  if (ttm && priorTtm && priorTtm.eps !== 0) {
    epsGrowthYoY = (ttm.eps - priorTtm.eps) / Math.abs(priorTtm.eps);
  }

  return { revenueGrowthYoY, revenueGrowth3yr, epsGrowthYoY };
}

// ---------------------------------------------------------------------------
// Valuation
// ---------------------------------------------------------------------------

/**
 * Compute valuation ratios.
 *
 * @param {Object} params
 * @param {number|null} params.price
 * @param {Object|null} params.ttm - sumQuarters output
 * @param {number|null} params.equity - totalStockholdersEquity
 * @param {number|null} params.computedMarketCap
 * @param {number|null} params.ev - Enterprise value
 * @param {number|null} params.epsGrowthYoY
 * @returns {{ peRatio, priceToBook, priceToSales, evToEBITDA, evToRevenue, earningsYield, pegRatio }}
 */
function computeValuation({ price, ttm, equity, computedMarketCap, ev, epsGrowthYoY }) {
  const peRatio      = (price > 0 && ttm?.eps > 0) ? price / ttm.eps : null;
  const priceToSales = (computedMarketCap > 0 && ttm?.revenue > 0) ? computedMarketCap / ttm.revenue : null;
  const priceToBook  = (computedMarketCap > 0 && equity > 0) ? computedMarketCap / equity : null;
  const evToEBITDA   = (ev != null && ttm?.ebitda > 0) ? ev / ttm.ebitda : null;
  const evToRevenue  = (ev != null && ttm?.revenue > 0) ? ev / ttm.revenue : null;
  const earningsYield = (price > 0 && ttm) ? ttm.eps / price : null;
  const pegRatio     = (peRatio > 0 && epsGrowthYoY > 0) ? peRatio / (epsGrowthYoY * 100) : null;

  return { peRatio, priceToBook, priceToSales, evToEBITDA, evToRevenue, earningsYield, pegRatio };
}

// ---------------------------------------------------------------------------
// Returns
// ---------------------------------------------------------------------------

/**
 * Compute return ratios.
 *
 * @param {Object} params
 * @param {Object|null} params.ttm - sumQuarters output
 * @param {number|null} params.equity
 * @param {number|null} params.totalAssets
 * @param {number|null} params.totalDebt
 * @param {number|null} params.cash
 * @returns {{ returnOnEquity, returnOnAssets, returnOnCapital }}
 */
function computeReturns({ ttm, equity, totalAssets, totalDebt, cash }) {
  // Require positive equity/assets to avoid nonsensical negative ratios
  const returnOnEquity  = (ttm && equity != null && equity > 0) ? ttm.netIncome / equity : null;
  const returnOnAssets  = (ttm && totalAssets != null && totalAssets > 0) ? ttm.netIncome / totalAssets : null;
  const investedCapital = (equity != null && totalDebt != null && cash != null) ? equity + totalDebt - cash : null;
  const returnOnCapital = (ttm && investedCapital != null && investedCapital > 0)
    ? ttm.operatingIncome / investedCapital : null;

  return { returnOnEquity, returnOnAssets, returnOnCapital };
}

// ---------------------------------------------------------------------------
// Financial Health
// ---------------------------------------------------------------------------

/**
 * Compute financial health ratios.
 *
 * @param {Object} params
 * @param {Object|null} params.ttm - sumQuarters output
 * @param {number|null} params.totalCurrentAssets
 * @param {number|null} params.totalCurrentLiabilities
 * @param {number|null} params.totalDebt
 * @param {number|null} params.equity
 * @param {number|null} params.cash
 * @param {number|null} params.ttmFCF - TTM free cash flow
 * @param {number|null} params.computedMarketCap
 * @returns {{ currentRatio, debtToEquity, interestCoverage, netDebtToEBITDA, freeCashFlowYield }}
 */
function computeHealth({ ttm, totalCurrentAssets, totalCurrentLiabilities, totalDebt, equity, cash, ttmFCF, computedMarketCap }) {
  const currentRatio     = (totalCurrentAssets != null && totalCurrentLiabilities != null && totalCurrentLiabilities > 0)
    ? totalCurrentAssets / totalCurrentLiabilities : null;
  const debtToEquity     = (totalDebt != null && equity != null && equity > 0) ? totalDebt / equity : null;
  const interestCoverage = (ttm && ttm.interestExpense != null && ttm.interestExpense !== 0)
    ? ttm.operatingIncome / Math.abs(ttm.interestExpense) : null;
  const netDebtToEBITDA  = (totalDebt != null && cash != null && ttm?.ebitda > 0) ? (totalDebt - cash) / ttm.ebitda : null;
  const freeCashFlowYield = (ttmFCF != null && computedMarketCap > 0) ? ttmFCF / computedMarketCap : null;

  return { currentRatio, debtToEquity, interestCoverage, netDebtToEBITDA, freeCashFlowYield };
}

// ---------------------------------------------------------------------------
// Technicals
// ---------------------------------------------------------------------------

/**
 * Compute technical indicators from price/volume arrays.
 *
 * @param {Object} params
 * @param {number[]} params.pricesAsc - Daily closing prices, oldest-first
 * @param {number|null} params.currentPrice - Current/snapshot price
 * @param {number[]} [params.volumes] - Daily volumes, oldest-first (optional)
 * @returns {{ rsi14, pctBelowHigh, priceVsMa50, priceVsMa200, relativeVolume }}
 */
function computeTechnicals({ pricesAsc, currentPrice, volumes }) {
  const rsi14 = computeRSI(pricesAsc.slice(-30));

  const prices52w = pricesAsc.slice(-252);
  const high52w = prices52w.length >= 200 ? Math.max(...prices52w) : null;
  const pctBelowHigh =
    currentPrice != null && high52w != null && high52w > 0
      ? ((high52w - currentPrice) / high52w) * 100
      : null;

  let priceVsMa50 = null;
  let priceVsMa200 = null;
  if (pricesAsc.length >= 50) {
    const ma50 = pricesAsc.slice(-50).reduce((s, v) => s + v, 0) / 50;
    if (currentPrice != null && ma50 > 0) priceVsMa50 = ((currentPrice - ma50) / ma50) * 100;
  }
  if (pricesAsc.length >= 200) {
    const ma200 = pricesAsc.slice(-200).reduce((s, v) => s + v, 0) / 200;
    if (currentPrice != null && ma200 > 0) priceVsMa200 = ((currentPrice - ma200) / ma200) * 100;
  }

  let relativeVolume = null;
  if (volumes && volumes.length >= 50) {
    const vol50 = volumes.slice(-50).reduce((s, v) => s + v, 0) / 50;
    const vol5 = volumes.slice(-5).reduce((s, v) => s + v, 0) / Math.min(5, volumes.slice(-5).length);
    if (vol50 > 0) relativeVolume = vol5 / vol50;
  }

  return { rsi14, pctBelowHigh, priceVsMa50, priceVsMa200, relativeVolume };
}

module.exports = {
  sumQuarters,
  validTtmWindow,
  computeMargins,
  computeGrowth,
  computeValuation,
  computeReturns,
  computeHealth,
  computeTechnicals,
};
