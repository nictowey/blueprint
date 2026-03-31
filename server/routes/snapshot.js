const express = require('express');
const router = express.Router();
const fmp = require('../services/fmp');
const { computeRSI } = require('../services/rsi');

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

  // Fetch 1 year of prices before snapshot date for 52w high + RSI window
  const fromDate = new Date(date);
  fromDate.setFullYear(fromDate.getFullYear() - 1);
  const fromStr = fromDate.toISOString().slice(0, 10);

  try {
    const [profileData, incomeData, metricsData, histData, shortData] = await Promise.allSettled([
      fmp.getProfile(sym),
      fmp.getIncomeStatements(sym),
      fmp.getKeyMetricsAnnual(sym),
      fmp.getHistoricalPrices(sym, fromStr, date),
      fmp.getShortInterest(sym),
    ]);

    const profile = profileData.status === 'fulfilled' ? profileData.value : {};
    const income = incomeData.status === 'fulfilled' ? incomeData.value : [];
    const metrics = metricsData.status === 'fulfilled' ? metricsData.value : [];
    const historical = histData.status === 'fulfilled' ? histData.value : [];
    const shortRaw = shortData.status === 'fulfilled' ? shortData.value : null;

    // Annual period on or before snapshot date
    const curIncome = findPeriodOnOrBefore(income, date);
    const curMetrics = findPeriodOnOrBefore(metrics, date);

    // Prior income statement for revenue growth
    const priorIncome = curIncome
      ? income.find(p => p.date !== curIncome.date && new Date(p.date) < new Date(curIncome.date))
      : null;

    // Revenue growth YoY
    let revenueGrowthYoY = null;
    if (curIncome?.revenue != null && priorIncome?.revenue && priorIncome.revenue !== 0) {
      revenueGrowthYoY = (curIncome.revenue - priorIncome.revenue) / Math.abs(priorIncome.revenue);
    }

    // Gross margin
    const grossMargin = curIncome?.grossProfitRatio ?? null;

    // Price on snapshot date (newest-first historical array)
    const price = findPrice(historical, date);

    // RSI: oldest-first, last 30 prices on or before snapshot date
    const pricesAsc = [...historical]
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .filter(h => new Date(h.date) <= new Date(date))
      .map(h => h.close);
    const rsi14 = computeRSI(pricesAsc.slice(-30));

    // 52-week high (all prices in the 1-year window)
    const high52w = historical.length > 0 ? Math.max(...historical.map(h => h.close)) : null;
    const pctBelowHigh =
      price != null && high52w != null && high52w > 0
        ? ((high52w - price) / high52w) * 100
        : null;

    res.json({
      ticker: sym,
      companyName: profile.companyName || sym,
      sector: profile.sector || null,
      date,
      price,
      peRatio: curMetrics?.peRatio ?? null,
      priceToSales: curMetrics?.priceToSalesRatio ?? null,
      revenueGrowthYoY,
      grossMargin,
      rsi14,
      pctBelowHigh,
      marketCap: curMetrics?.marketCap ?? null,
      shortInterestPct: shortRaw?.shortInterestPercent ?? null,
    });
  } catch (err) {
    console.error('[snapshot] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch snapshot data' });
  }
});

module.exports = router;
