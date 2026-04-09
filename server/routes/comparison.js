const express = require('express');
const router = express.Router();
const fmp = require('../services/fmp');
const { computeRSI } = require('../services/rsi');
const { getCache } = require('../services/universe');

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
async function fetchTemplate(sym, date) {
  const fromDate = new Date(date);
  fromDate.setFullYear(fromDate.getFullYear() - 1);
  const fromStr = fromDate.toISOString().slice(0, 10);

  // Sparkline window: 18 months after snapshot date, capped at today
  const afterDate = new Date(date);
  afterDate.setMonth(afterDate.getMonth() + 18);
  const sparklineEnd = afterDate.toISOString().slice(0, 10) < new Date().toISOString().slice(0, 10)
    ? afterDate.toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const [profileR, incomeR, metricsR, ratiosR, histR, shortR, balanceR, cashFlowR, sparklineR] =
    await Promise.allSettled([
      fmp.getProfile(sym, false),
      fmp.getIncomeStatements(sym, 10, false),
      fmp.getKeyMetricsAnnual(sym, false),
      fmp.getRatiosAnnual(sym, false),
      fmp.getHistoricalPrices(sym, fromStr, date, false),
      fmp.getShortInterest(sym, false),
      fmp.getBalanceSheet(sym, 4, false),
      fmp.getCashFlowStatement(sym, 4, false),
      fmp.getHistoricalPrices(sym, date, sparklineEnd, false),
    ]);

  const profile    = profileR.status  === 'fulfilled' ? profileR.value  : {};
  const income     = incomeR.status   === 'fulfilled' ? incomeR.value   : [];
  const metrics    = metricsR.status  === 'fulfilled' ? metricsR.value  : [];
  const ratios     = ratiosR.status   === 'fulfilled' ? ratiosR.value   : [];
  const historical = histR.status     === 'fulfilled' ? histR.value     : [];
  const shortRaw   = shortR.status    === 'fulfilled' ? shortR.value    : null;
  const balance    = balanceR.status  === 'fulfilled' ? balanceR.value  : [];
  const cashFlow   = cashFlowR.status === 'fulfilled' ? cashFlowR.value : [];
  const sparkRaw   = sparklineR.status === 'fulfilled' ? sparklineR.value : [];

  const curIncome   = findPeriodOnOrBefore(income, date);
  const curMetrics  = findPeriodOnOrBefore(metrics, date);
  const curRatios   = findPeriodOnOrBefore(ratios, date);
  const curBalance  = findPeriodOnOrBefore(balance, date);
  const curCashFlow = findPeriodOnOrBefore(cashFlow, date);

  // Revenue growth YoY
  const priorIncome = curIncome
    ? income.find(p => p.date !== curIncome.date && new Date(p.date) < new Date(curIncome.date))
    : null;

  let revenueGrowthYoY = null;
  if (curIncome?.revenue != null && priorIncome?.revenue && priorIncome.revenue !== 0) {
    revenueGrowthYoY = (curIncome.revenue - priorIncome.revenue) / Math.abs(priorIncome.revenue);
  }

  // 3-year revenue CAGR
  const income3yrAgo = curIncome
    ? income.filter(p => new Date(p.date) < new Date(curIncome.date))
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

  // Price at snapshot date and prior-year technical window
  const price = findPrice(historical, date);
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

  const rev = curIncome?.revenue;
  const template = {
    ticker:            sym,
    companyName:       profile.companyName || sym,
    sector:            profile.sector || null,
    date,
    price,
    // Valuation
    peRatio:           curRatios?.priceToEarningsRatio ?? null,
    priceToBook:       curRatios?.priceToBookRatio ?? null,
    priceToSales:      curRatios?.priceToSalesRatio ?? null,
    evToEBITDA:        curMetrics?.evToEBITDA ?? null,
    evToRevenue:       curMetrics?.evToSales ?? null,
    pegRatio:          curRatios?.priceToEarningsGrowthRatio ?? null,
    earningsYield:     curMetrics?.earningsYield ?? null,
    // Profitability — calculated from income statement raw fields
    grossMargin:       rev ? (curIncome.grossProfit / rev) : null,
    operatingMargin:   rev ? (curIncome.operatingIncome / rev) : null,
    netMargin:         rev ? (curIncome.netIncome / rev) : null,
    ebitdaMargin:      rev ? (curIncome.ebitda / rev) : null,
    returnOnEquity:    curMetrics?.returnOnEquity ?? null,
    returnOnAssets:    curMetrics?.returnOnAssets ?? null,
    returnOnCapital:   curMetrics?.returnOnInvestedCapital ?? null,
    // Growth
    revenueGrowthYoY, revenueGrowth3yr, epsGrowthYoY,
    eps:               curIncome?.eps ?? null,
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
    rsi14, pctBelowHigh, priceVsMa50, priceVsMa200,
    beta:              profile?.beta ?? null,
    avgVolume:         profile?.averageVolume ?? null,
    // Overview
    marketCap:         curMetrics?.marketCap ?? null,
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
  'peRatio', 'priceToBook', 'priceToSales', 'evToEBITDA', 'evToRevenue', 'pegRatio', 'earningsYield',
  'grossMargin', 'operatingMargin', 'netMargin', 'ebitdaMargin',
  'returnOnEquity', 'returnOnAssets', 'returnOnCapital',
  'revenueGrowthYoY', 'revenueGrowth3yr', 'epsGrowthYoY',
  'currentRatio', 'debtToEquity', 'interestCoverage', 'netDebtToEBITDA', 'freeCashFlowYield',
  'rsi14', 'pctBelowHigh', 'priceVsMa50', 'priceVsMa200',
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

    const result = {
      template: templateResult.template,
      match: matchMetrics,
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
