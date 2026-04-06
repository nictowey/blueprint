const express = require('express');
const router = express.Router();
const fmp = require('../services/fmp');
const { computeRSI } = require('../services/rsi');

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

// Build a snapshot-shaped object from live TTM metrics + profile
async function buildCurrentMetrics(ticker) {
  const [profile, ttm, income, hist, balance, cashFlow] = await Promise.all([
    fmp.getProfile(ticker),
    fmp.getKeyMetricsTTM(ticker),
    fmp.getIncomeStatements(ticker, 4),
    fmp.getHistoricalPrices(ticker,
      new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10),
      new Date().toISOString().slice(0, 10)
    ),
    fmp.getBalanceSheet(ticker, 1),
    fmp.getCashFlowStatement(ticker, 1),
  ]);

  const income0 = income[0] || {};
  const income1 = income[1] || {};
  const income3 = income[3] || {};

  let revenueGrowthYoY = null;
  if (income0.revenue != null && income1.revenue && income1.revenue !== 0) {
    revenueGrowthYoY = (income0.revenue - income1.revenue) / Math.abs(income1.revenue);
  }
  let revenueGrowth3yr = null;
  if (income0.revenue != null && income3.revenue && income3.revenue !== 0) {
    revenueGrowth3yr = Math.pow(income0.revenue / income3.revenue, 1 / 3) - 1;
  }
  let epsGrowthYoY = null;
  if (income0.eps != null && income1.eps && income1.eps !== 0) {
    epsGrowthYoY = (income0.eps - income1.eps) / Math.abs(income1.eps);
  }

  const pricesAsc = [...hist].reverse().map(h => h.close);
  const rsi14 = computeRSI(pricesAsc.slice(-30));
  const currentPrice = hist[0]?.close ?? null;
  const high52w = hist.length > 0 ? hist.reduce((m, h) => Math.max(m, h.close), -Infinity) : null;
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
  if (pricesAsc.length > 0) {
    const ma200 = pricesAsc.reduce((s, v) => s + v, 0) / pricesAsc.length;
    if (currentPrice != null && ma200 > 0) priceVsMa200 = ((currentPrice - ma200) / ma200) * 100;
  }

  const bal = Array.isArray(balance) ? balance[0] || {} : {};
  const cf  = Array.isArray(cashFlow) ? cashFlow[0] || {} : {};

  return {
    ticker,
    companyName:      profile?.companyName || ticker,
    sector:           profile?.sector || null,
    date:             new Date().toISOString().slice(0, 10),
    price:            currentPrice,
    // Valuation
    peRatio:          ttm.peRatioTTM ?? null,
    priceToBook:      ttm.pbRatioTTM ?? null,
    priceToSales:     ttm.priceToSalesRatioTTM ?? null,
    evToEBITDA:       ttm.evToEBITDATTM ?? null,
    evToRevenue:      ttm.evToRevenueTTM ?? null,
    pegRatio:         ttm.pegRatioTTM ?? null,
    earningsYield:    ttm.earningsYieldTTM ?? null,
    // Profitability
    grossMargin:      income0.grossProfitRatio ?? null,
    operatingMargin:  income0.operatingIncomeRatio ?? null,
    netMargin:        income0.netIncomeRatio ?? null,
    ebitdaMargin:     income0.ebitdaratio ?? null,
    returnOnEquity:   ttm.returnOnEquityTTM ?? null,
    returnOnAssets:   ttm.returnOnAssetsTTM ?? null,
    returnOnCapital:  ttm.roicTTM ?? null,
    // Growth
    revenueGrowthYoY,
    revenueGrowth3yr,
    epsGrowthYoY,
    eps:              income0.eps ?? null,
    // Financial Health
    currentRatio:     ttm.currentRatioTTM ?? null,
    debtToEquity:     ttm.debtToEquityTTM ?? null,
    interestCoverage: ttm.interestCoverageTTM ?? null,
    netDebtToEBITDA:  ttm.netDebtToEBITDATTM ?? null,
    freeCashFlowYield:ttm.freeCashFlowYieldTTM ?? null,
    dividendYield:    ttm.dividendYieldPercentageTTM ?? null,
    totalCash:        bal.cashAndCashEquivalents ?? null,
    totalDebt:        bal.totalDebt ?? null,
    freeCashFlow:     cf.freeCashFlow ?? null,
    operatingCashFlow:cf.operatingCashFlow ?? null,
    // Technical
    rsi14,
    pctBelowHigh,
    priceVsMa50,
    priceVsMa200,
    beta:             profile?.beta ?? null,
    avgVolume:        profile?.volAvg ?? null,
    // Overview
    marketCap:        ttm.marketCapTTM ?? null,
    shortInterestPct: null,
  };
}

router.get('/', async (req, res) => {
  const { ticker, date, matchTicker } = req.query;
  if (!ticker || !date || !matchTicker) {
    return res.status(400).json({ error: 'ticker, date, and matchTicker are required' });
  }

  if (!/^[A-Z0-9.]{1,10}$/i.test(ticker) || !/^[A-Z0-9.]{1,10}$/i.test(matchTicker)) {
    return res.status(400).json({ error: 'invalid ticker format' });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date).getTime())) {
    return res.status(400).json({ error: 'invalid date format, expected YYYY-MM-DD' });
  }

  const sym = ticker.toUpperCase();
  const matchSym = matchTicker.toUpperCase();

  // Date 18 months after snapshot for sparkline
  const afterDate = new Date(date);
  afterDate.setMonth(afterDate.getMonth() + 18);
  const afterStr = afterDate.toISOString().slice(0, 10);
  const todayStr = new Date().toISOString().slice(0, 10);
  const sparklineEnd = afterStr < todayStr ? afterStr : todayStr;

  try {
    const fromDate = new Date(date);
    fromDate.setFullYear(fromDate.getFullYear() - 1);
    const fromStr = fromDate.toISOString().slice(0, 10);

    const [profileData, incomeData, metricsData, histData, shortData, sparklineData, matchData,
           templateBalanceData, templateCashFlowData] =
      await Promise.allSettled([
        fmp.getProfile(sym),
        fmp.getIncomeStatements(sym, 10),
        fmp.getKeyMetricsAnnual(sym),
        fmp.getHistoricalPrices(sym, fromStr, date),
        fmp.getShortInterest(sym),
        fmp.getHistoricalPrices(sym, date, sparklineEnd),
        buildCurrentMetrics(matchSym),
        fmp.getBalanceSheet(sym),
        fmp.getCashFlowStatement(sym),
      ]);

    const profile = profileData.status === 'fulfilled' ? profileData.value : {};
    const income = incomeData.status === 'fulfilled' ? incomeData.value : [];
    const metrics = metricsData.status === 'fulfilled' ? metricsData.value : [];
    const historical = histData.status === 'fulfilled' ? histData.value : [];
    const shortRaw = shortData.status === 'fulfilled' ? shortData.value : null;
    const sparklineRaw = sparklineData.status === 'fulfilled' ? sparklineData.value : [];
    const matchMetrics = matchData.status === 'fulfilled' ? matchData.value : {};
    const templateBalance = templateBalanceData.status === 'fulfilled' ? templateBalanceData.value : [];
    const templateCashFlow = templateCashFlowData.status === 'fulfilled' ? templateCashFlowData.value : [];
    const curBalance = findPeriodOnOrBefore(templateBalance, date);
    const curCashFlow = findPeriodOnOrBefore(templateCashFlow, date);

    const curIncome = findPeriodOnOrBefore(income, date);
    const curMetrics = findPeriodOnOrBefore(metrics, date);
    const priorIncome = curIncome
      ? income.find(p => p.date !== curIncome.date && new Date(p.date) < new Date(curIncome.date))
      : null;

    let revenueGrowthYoY = null;
    if (curIncome?.revenue != null && priorIncome?.revenue && priorIncome.revenue !== 0) {
      revenueGrowthYoY = (curIncome.revenue - priorIncome.revenue) / Math.abs(priorIncome.revenue);
    }
    const income3yrAgo = curIncome
      ? income
          .filter(p => new Date(p.date) < new Date(curIncome.date))
          .sort((a, b) => new Date(b.date) - new Date(a.date))[2] || null
      : null;
    let revenueGrowth3yr = null;
    if (curIncome?.revenue != null && income3yrAgo?.revenue && income3yrAgo.revenue !== 0) {
      revenueGrowth3yr = Math.pow(curIncome.revenue / income3yrAgo.revenue, 1 / 3) - 1;
    }
    let epsGrowthYoY = null;
    if (curIncome?.eps != null && priorIncome?.eps && priorIncome.eps !== 0) {
      epsGrowthYoY = (curIncome.eps - priorIncome.eps) / Math.abs(priorIncome.eps);
    }

    const price = findPrice(historical, date);
    const pricesAsc = [...historical]
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .filter(h => new Date(h.date) <= new Date(date))
      .map(h => h.close);
    const rsi14 = computeRSI(pricesAsc.slice(-30));
    const high52w = historical.length > 0 ? historical.reduce((m, h) => Math.max(m, h.close), -Infinity) : null;
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
      const ma200 = pricesAsc.reduce((s, v) => s + v, 0) / pricesAsc.length;
      if (price != null && ma200 > 0) priceVsMa200 = ((price - ma200) / ma200) * 100;
    }

    const template = {
      ticker: sym,
      companyName: profile.companyName || sym,
      sector: profile.sector || null,
      date,
      price,
      // Valuation
      peRatio:           curMetrics?.peRatio ?? null,
      priceToBook:       curMetrics?.pbRatio ?? null,
      priceToSales:      curMetrics?.priceToSalesRatio ?? null,
      evToEBITDA:        curMetrics?.evToEbitda ?? null,
      evToRevenue:       curMetrics?.evToRevenue ?? null,
      pegRatio:          curMetrics?.pegRatio ?? null,
      earningsYield:     curMetrics?.earningsYield ?? null,
      // Profitability
      grossMargin:       curIncome?.grossProfitRatio ?? null,
      operatingMargin:   curIncome?.operatingIncomeRatio ?? null,
      netMargin:         curIncome?.netIncomeRatio ?? null,
      ebitdaMargin:      curIncome?.ebitdaratio ?? null,
      returnOnEquity:    curMetrics?.returnOnEquity ?? null,
      returnOnAssets:    curMetrics?.returnOnAssets ?? null,
      returnOnCapital:   curMetrics?.roic ?? null,
      // Growth
      revenueGrowthYoY,
      revenueGrowth3yr,
      epsGrowthYoY,
      eps:               curIncome?.eps ?? null,
      // Financial Health
      currentRatio:      curMetrics?.currentRatio ?? null,
      debtToEquity:      curMetrics?.debtToEquity ?? null,
      interestCoverage:  curMetrics?.interestCoverage ?? null,
      netDebtToEBITDA:   curMetrics?.netDebtToEBITDA ?? null,
      freeCashFlowYield: curMetrics?.freeCashFlowYield ?? null,
      dividendYield:     curMetrics?.dividendYield ?? null,
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
      avgVolume:         profile?.volAvg ?? null,
      // Overview
      marketCap:         curMetrics?.marketCap ?? null,
      shortInterestPct:  shortRaw?.shortInterestPercent ?? null,
    };

    // Sparkline: oldest first, from snapshot date onward
    const sparkline = [...sparklineRaw]
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map(h => ({ date: h.date, price: h.close }));

    // Gain/loss % over sparkline period
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
