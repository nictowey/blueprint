const express = require('express');
const router = express.Router();
const { getCache, isReady } = require('../services/universe');
const { findMatches, MATCH_METRICS } = require('../services/matcher');
const { snapshotCache, SNAPSHOT_CACHE_TTL } = require('./snapshot');
const { getProfile, applyHardFilters, DEFAULT_PROFILE, PROFILE_KEYS } = require('../services/matchProfiles');
const { runBacktest } = require('../services/backtest');

// In-memory cache for backtest results (expensive to compute)
const backtestCache = new Map();
const BACKTEST_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

router.get('/', async (req, res) => {
  const { ticker, date, profile: profileKey } = req.query;

  if (!ticker || !date)
    return res.status(400).json({ error: 'ticker and date are required' });
  if (!/^[A-Z0-9.]{1,10}$/i.test(ticker))
    return res.status(400).json({ error: 'invalid ticker format' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date).getTime()))
    return res.status(400).json({ error: 'invalid date format, expected YYYY-MM-DD' });

  // Backtest requires the match date to be at least 1 month in the past
  const matchDate = new Date(date);
  const oneMonthAgo = new Date();
  oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
  if (matchDate > oneMonthAgo) {
    return res.status(400).json({
      error: 'Backtest requires the snapshot date to be at least 1 month in the past so forward returns can be calculated.',
    });
  }

  if (!isReady())
    return res.status(503).json({ error: 'Stock universe cache is still loading.' });

  const sym = ticker.toUpperCase();
  const resolvedProfileKey = profileKey && PROFILE_KEYS.includes(profileKey) ? profileKey : DEFAULT_PROFILE;

  // Check cache
  const cacheKey = `${sym}:${date}:${resolvedProfileKey}`;
  const cached = backtestCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < BACKTEST_CACHE_TTL) {
    return res.json(cached.data);
  }

  try {
    // Step 1: Re-run matching as of the template date
    const profile = getProfile(resolvedProfileKey);

    const snapCacheKey = `${sym}:${date}`;
    const snapCached = snapshotCache.get(snapCacheKey);
    let snapshot;
    if (snapCached && Date.now() - snapCached.ts < SNAPSHOT_CACHE_TTL) {
      snapshot = { ticker: sym };
      for (const metric of MATCH_METRICS) {
        snapshot[metric] = snapCached.data[metric] ?? null;
      }
      snapshot.sector = snapCached.data.sector ?? null;
      snapshot.companyName = snapCached.data.companyName ?? sym;
    } else {
      // Need snapshot data — parse from query params as fallback
      snapshot = { ticker: sym };
      for (const metric of MATCH_METRICS) {
        const val = req.query[metric];
        snapshot[metric] = val !== undefined && val !== '' ? parseFloat(val) : null;
      }
      snapshot.sector = req.query.sector || null;
      snapshot.companyName = req.query.companyName || sym;
    }

    let universe = getCache();
    universe = applyHardFilters(universe, profile.hardFilters);

    const profileOptions = {
      weights: profile.weights,
      sectorBonus: profile.sectorBonus,
    };

    const matches = findMatches(snapshot, universe, 10, profileOptions);

    if (matches.length === 0) {
      return res.json({
        matchDate: date,
        templateTicker: sym,
        profile: resolvedProfileKey,
        results: [],
        benchmark: null,
        summary: {},
      });
    }

    // Step 2: Run the backtest (fetch forward returns)
    const backtestResult = await runBacktest(matches, date);

    const responseData = {
      templateTicker: sym,
      profile: resolvedProfileKey,
      ...backtestResult,
    };

    // Cache result
    backtestCache.set(cacheKey, { ts: Date.now(), data: responseData });

    res.json(responseData);
  } catch (err) {
    console.error('[backtest] Error:', err.message);
    res.status(500).json({ error: 'Backtest failed — please try again.' });
  }
});

module.exports = router;
