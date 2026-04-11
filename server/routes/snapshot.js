const express = require('express');
const router = express.Router();
const fmp = require('../services/fmp');
const { buildSnapshot } = require('../services/snapshotBuilder');

const snapshotCache = new Map();
const SNAPSHOT_CACHE_TTL = 24 * 60 * 60 * 1000;

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

  try {
    const snapshot = await buildSnapshot(sym, date, false);
    if (!snapshot) {
      return res.status(404).json({ error: `No price data available for ${sym} on ${date}` });
    }

    // Add short interest (not part of core snapshot builder)
    let shortInterestPct = null;
    try {
      const shortRaw = await fmp.getShortInterest(sym, false);
      shortInterestPct = shortRaw?.shortInterestPercent ?? null;
    } catch { /* non-critical */ }

    const result = {
      ...snapshot,
      shortInterestPct,
      dividendYield: null,
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
