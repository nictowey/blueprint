const express = require('express');
const router = express.Router();
const fmp = require('../services/fmp');
const { computeRSI } = require('../services/rsi');
const { getCache } = require('../services/universe');

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

// Build current (present-day) metrics for a match ticker using TTM endpoints
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
    const ma200 = pricesAsc.reduce((s, v) => s + v, 0) / pricesAsc.length;
    if (currentPrice != null && ma200 > 0) priceVsMa200 = ((currentPrice - ma200) / ma200) * 100;
  }

  const rev0 = income0.revenue;
  return {
    ticker,
    companyName:       profile?.companyName || ticker,
    sector:            profile?.sector || null,
    date:              new Date().toISOString().slice(0, 10),
    price:             currentPrice,
    // Valuation — from ratios-ttm
    peRatio:           ttmRatios.priceToEarningsRatioTTM ?? null,
    priceToBook:       ttmRatios.priceToBookRatioTTM ?? null,
    priceToSales:      ttmRatios.priceToSalesRatioTTM ?? null,
    evToEBITDA:        ttmMetrics.evToEBITDATTM ?? null,
    evToRevenue:       ttmMetrics.evToSalesTTM ?? null,
    pegRatio:          ttmRatios.priceToEarningsGrowthRatioTTM ?? null,
    earningsYield:     ttmMetrics.earningsYieldTTM ?? null,
    // Profitability — calculated from income + ratios-ttm
    grossMargin:       rev0 ? (income0.grossProfit / rev0) : (ttmRatios.grossProfitMarginTTM ?? null),
    operatingMargin:   rev0 ? (income0.operatingIncome / rev0) : (ttmRatios.operatingProfitMarginTTM ?? null),
    netMargin:         rev0 ? (income0.netIncome / rev0) : (ttmRatios.netProfitMarginTTM ?? null),
    ebitdaMargin:      rev0 ? (income0.ebitda / rev0) : (ttmRatios.ebitdaMarginTTM ?? null),
    returnOnEquity:    ttmMetrics.returnOnEquityTTM ?? null,
    returnOnAssets:    ttmMetrics.returnOnAssetsTTM ?? null,
    returnOnCapital:   ttmMetrics.returnOnInvestedCapitalTTM ?? null,
    // Growth
    revenueGrowthYoY, revenueGrowth3yr, epsGrowthYoY,
    eps:               income0.eps ?? null,
    // Financial Health — from ratios-ttm + key-metrics-ttm
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
    avgVolume:         profile?.averageVolume ?? null,
    // Overview — key-metrics-ttm uses 'marketCap' not 'marketCapTTM'
    marketCap:         ttmMetrics.marketCap ?? null,
    shortInterestPct:  null,
  };
}

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

  const afterDate = new Date(date);
  afterDate.setMonth(afterDate.getMonth() + 18);
  const sparklineEnd = afterDate.toISOString().slice(0, 10) < new Date().toISOString().slice(0, 10)
    ? afterDate.toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  try {
    const fromDate = new Date(date);
    fromDate.setFullYear(fromDate.getFullYear() - 1);
    const fromStr = fromDate.toISOString().slice(0, 10);

    // Use cached universe entry for match ticker if available — saves 7 FMP calls
    const cachedMatch = getCache().get(matchSym);
    const matchMetricsPromise = cachedMatch
      ? Promise.resolve({
          ...cachedMatch,
          date: new Date().toISOString().slice(0, 10),
          shortInterestPct: null,
        })
      : buildCurrentMetrics(matchSym);

    const [profileData, incomeData, metricsData, ratiosData, histData, shortData,
           sparklineData, matchData, templateBalanceData, templateCashFlowData] =
      await Promise.allSettled([
        fmp.getProfile(sym, false),
        fmp.getIncomeStatements(sym, 10, false),
        fmp.getKeyMetricsAnnual(sym, false),
        fmp.getRatiosAnnual(sym, false),
        fmp.getHistoricalPrices(sym, fromStr, date, false),
        fmp.getShortInterest(sym, false),
        fmp.getHistoricalPrices(sym, date, sparklineEnd, false),
        matchMetricsPromise,
        fmp.getBalanceSheet(sym, 4, false),
        fmp.getCashFlowStatement(sym, 4, false),
      ]);

    const profile         = profileData.status         === 'fulfilled' ? profileData.value         : {};
    const income          = incomeData.status           === 'fulfilled' ? incomeData.value           : [];
    const metrics         = metricsData.status          === 'fulfilled' ? metricsData.value          : [];
    const ratios          = ratiosData.status           === 'fulfilled' ? ratiosData.value           : [];
    const historical      = histData.status             === 'fulfilled' ? histData.value             : [];
    const shortRaw        = shortData.status            === 'fulfilled' ? shortData.value            : null;
    const sparklineRaw    = sparklineData.status        === 'fulfilled' ? sparklineData.value        : [];
    const matchMetrics    = matchData.status            === 'fulfilled' ? matchData.value            : {};
    const templateBalance = templateBalanceData.status  === 'fulfilled' ? templateBalanceData.value  : [];
    const templateCashFlow= templateCashFlowData.status === 'fulfilled' ? templateCashFlowData.value : [];

    const curIncome   = findPeriodOnOrBefore(income, date);
    const curMetrics  = findPeriodOnOrBefore(metrics, date);
    const curRatios   = findPeriodOnOrBefore(ratios, date);
    const curBalance  = findPeriodOnOrBefore(templateBalance, date);
    const curCashFlow = findPeriodOnOrBefore(templateCashFlow, date);

    const priorIncome = curIncome
      ? income.find(p => p.date !== curIncome.date && new Date(p.date) < new Date(curIncome.date))
      : null;

    let revenueGrowthYoY = null;
    if (curIncome?.revenue != null && priorIncome?.revenue && priorIncome.revenue !== 0)
      revenueGrowthYoY = (curIncome.revenue - priorIncome.revenue) / Math.abs(priorIncome.revenue);

    const income3yrAgo = curIncome
      ? income.filter(p => new Date(p.date) < new Date(curIncome.date))
               .sort((a, b) => new Date(b.date) - new Date(a.date))[2] || null
      : null;
    let revenueGrowth3yr = null;
    if (curIncome?.revenue != null && income3yrAgo?.revenue && income3yrAgo.revenue !== 0)
      revenueGrowth3yr = Math.pow(curIncome.revenue / income3yrAgo.revenue, 1 / 3) - 1;

    let epsGrowthYoY = null;
    if (curIncome?.eps != null && priorIncome?.eps && priorIncome.eps !== 0)
      epsGrowthYoY = (curIncome.eps - priorIncome.eps) / Math.abs(priorIncome.eps);

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
      const ma200 = pricesAsc.reduce((s, v) => s + v, 0) / pricesAsc.length;
      if (price != null && ma200 > 0) priceVsMa200 = ((price - ma200) / ma200) * 100;
    }

    const rev = curIncome?.revenue;
    const template = {
      ticker: sym,
      companyName:       profile.companyName || sym,
      sector:            profile.sector || null,
      date, price,
      // Valuation — from /ratios (annual, period-matched)
      peRatio:           curRatios?.priceToEarningsRatio ?? null,
      priceToBook:       curRatios?.priceToBookRatio ?? null,
      priceToSales:      curRatios?.priceToSalesRatio ?? null,
      evToEBITDA:        curMetrics?.evToEBITDA ?? null,
      evToRevenue:       curMetrics?.evToSales ?? null,
      pegRatio:          curRatios?.priceToEarningsGrowthRatio ?? null,
      earningsYield:     curMetrics?.earningsYield ?? null,
      // Profitability — calculated from income statement
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
      rsi14, pctBelowHigh, priceVsMa50, priceVsMa200,
      beta:              profile?.beta ?? null,
      avgVolume:         profile?.averageVolume ?? null,
      // Overview
      marketCap:         curMetrics?.marketCap ?? null,
      shortInterestPct:  shortRaw?.shortInterestPercent ?? null,
    };

    const sparkline = [...sparklineRaw]
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map(h => ({ date: h.date, price: h.close }));

    let sparklineGainPct = null;
    if (sparkline.length >= 2) {
      const start = sparkline[0].price;
      const end = sparkline[sparkline.length - 1].price;
      if (start > 0) sparklineGainPct = ((end - start) / start) * 100;
    }

    res.json({ template, match: matchMetrics, sparkline, sparklineGainPct });
  } catch (err) {
    console.error('[comparison] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch comparison data' });
  }
});

module.exports = router;
