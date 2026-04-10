const express = require('express');
const router = express.Router();
const { getCache, isReady } = require('../services/universe');
const { findMatches, MATCH_METRICS } = require('../services/matcher');
const { snapshotCache, SNAPSHOT_CACHE_TTL } = require('./snapshot');
const { getProfile, applyHardFilters, DEFAULT_PROFILE } = require('../services/matchProfiles');

router.get('/', async (req, res) => {
  const { ticker, date, sector, profile: profileKey } = req.query;
  if (!ticker || !date)
    return res.status(400).json({ error: 'ticker and date are required' });

  if (!isReady())
    return res.status(503).json({ error: 'Stock universe cache is still loading. Please try again in a moment.' });

  const sym = ticker.toUpperCase();

  // Resolve the match profile (defaults to growth_breakout)
  const profile = getProfile(profileKey || DEFAULT_PROFILE);

  // Prefer snapshot cache (full-precision values) over URL params (truncated).
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
    // Fallback: parse from URL query params (first visit before snapshot is cached)
    snapshot = { ticker: sym };
    for (const metric of MATCH_METRICS) {
      const val = req.query[metric];
      snapshot[metric] = val !== undefined && val !== '' ? parseFloat(val) : null;
    }
    snapshot.sector = req.query.sector || null;
    snapshot.companyName = req.query.companyName || sym;
  }

  try {
    let universe = getCache();

    // Optional sector filter — only match against stocks in the same sector
    if (sector) {
      const filtered = new Map();
      for (const [key, stock] of universe) {
        if (stock.sector === sector) filtered.set(key, stock);
      }
      universe = filtered;
    }

    // Apply profile hard filters (e.g., value_inflection requires P/E > 0 and <= 35)
    universe = applyHardFilters(universe, profile.hardFilters);

    const profileOptions = {
      weights: profile.weights,
      sectorBonus: profile.sectorBonus,
    };

    const matches = findMatches(snapshot, universe, 10, profileOptions);
    res.json(matches);
  } catch (err) {
    console.error('[matches] Error:', err.message);
    res.status(500).json({ error: 'Failed to find matches' });
  }
});

module.exports = router;
