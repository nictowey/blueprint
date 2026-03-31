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
  const [profile, ttm, income, hist] = await Promise.all([
    fmp.getProfile(ticker),
    fmp.getKeyMetricsTTM(ticker),
    fmp.getIncomeStatements(ticker, 2),
    fmp.getHistoricalPrices(ticker,
      new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10),
      new Date().toISOString().slice(0, 10)
    ),
  ]);

  const income0 = income[0] || {};
  const income1 = income[1] || {};
  const grossMargin = income0.grossProfitRatio ?? null;
  let revenueGrowthYoY = null;
  if (income0.revenue != null && income1.revenue && income1.revenue !== 0) {
    revenueGrowthYoY = (income0.revenue - income1.revenue) / Math.abs(income1.revenue);
  }

  const pricesAsc = [...hist].reverse().map(h => h.close);
  const rsi14 = computeRSI(pricesAsc.slice(-30));
  const currentPrice = hist[0]?.close ?? null;
  const high52w = hist.length > 0 ? hist.reduce((m, h) => Math.max(m, h.close), -Infinity) : null;
  const pctBelowHigh =
    currentPrice != null && high52w != null && high52w > 0
      ? ((high52w - currentPrice) / high52w) * 100
      : null;

  return {
    ticker,
    companyName: profile?.companyName || ticker,
    sector: profile?.sector || null,
    date: new Date().toISOString().slice(0, 10),
    price: currentPrice,
    peRatio: ttm.peRatioTTM ?? null,
    priceToSales: ttm.priceToSalesRatioTTM ?? null,
    revenueGrowthYoY,
    grossMargin,
    rsi14,
    pctBelowHigh,
    marketCap: ttm.marketCapTTM ?? null,
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

    const [profileData, incomeData, metricsData, histData, shortData, sparklineData, matchData] =
      await Promise.allSettled([
        fmp.getProfile(sym),
        fmp.getIncomeStatements(sym),
        fmp.getKeyMetricsAnnual(sym),
        fmp.getHistoricalPrices(sym, fromStr, date),
        fmp.getShortInterest(sym),
        fmp.getHistoricalPrices(sym, date, sparklineEnd),
        buildCurrentMetrics(matchSym),
      ]);

    const profile = profileData.status === 'fulfilled' ? profileData.value : {};
    const income = incomeData.status === 'fulfilled' ? incomeData.value : [];
    const metrics = metricsData.status === 'fulfilled' ? metricsData.value : [];
    const historical = histData.status === 'fulfilled' ? histData.value : [];
    const shortRaw = shortData.status === 'fulfilled' ? shortData.value : null;
    const sparklineRaw = sparklineData.status === 'fulfilled' ? sparklineData.value : [];
    const matchMetrics = matchData.status === 'fulfilled' ? matchData.value : {};

    const curIncome = findPeriodOnOrBefore(income, date);
    const curMetrics = findPeriodOnOrBefore(metrics, date);
    const priorIncome = curIncome
      ? income.find(p => p.date !== curIncome.date && new Date(p.date) < new Date(curIncome.date))
      : null;

    let revenueGrowthYoY = null;
    if (curIncome?.revenue != null && priorIncome?.revenue && priorIncome.revenue !== 0) {
      revenueGrowthYoY = (curIncome.revenue - priorIncome.revenue) / Math.abs(priorIncome.revenue);
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

    const template = {
      ticker: sym,
      companyName: profile.companyName || sym,
      sector: profile.sector || null,
      date,
      price,
      peRatio: curMetrics?.peRatio ?? null,
      priceToSales: curMetrics?.priceToSalesRatio ?? null,
      revenueGrowthYoY,
      grossMargin: curIncome?.grossProfitRatio ?? null,
      rsi14,
      pctBelowHigh,
      marketCap: curMetrics?.marketCap ?? null,
      shortInterestPct: shortRaw?.shortInterestPercent ?? null,
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
