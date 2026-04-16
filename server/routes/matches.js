const express = require('express');
const router = express.Router();
const { getCache, isReady } = require('../services/universe');
const { MATCH_METRICS } = require('../services/matcher');
const { snapshotCache, SNAPSHOT_CACHE_TTL } = require('./snapshot');
const { getProfile, applyHardFilters, DEFAULT_PROFILE, PROFILE_KEYS } = require('../services/matchProfiles');
const { getEngine, isValidEngineKey, DEFAULT_ENGINE } = require('../services/algorithms');

// Build a template snapshot from the snapshot cache or URL query params.
// Extracted for reuse across engines that optionally accept a template
// (e.g. ensembleConsensus, which runs template-free by default but includes
// templateMatch as a third lens when ticker+date are provided).
function buildTemplateSnapshot(sym, date, query) {
  const snapCacheKey = `${sym}:${date}`;
  const snapCached = snapshotCache.get(snapCacheKey);
  const snapshot = { ticker: sym };
  if (snapCached && Date.now() - snapCached.ts < SNAPSHOT_CACHE_TTL) {
    for (const metric of MATCH_METRICS) {
      snapshot[metric] = snapCached.data[metric] ?? null;
    }
    snapshot.sector = snapCached.data.sector ?? null;
    snapshot.companyName = snapCached.data.companyName ?? sym;
  } else {
    for (const metric of MATCH_METRICS) {
      const val = query[metric];
      snapshot[metric] = val !== undefined && val !== '' ? parseFloat(val) : null;
    }
    snapshot.sector = query.sector || null;
    snapshot.companyName = query.companyName || sym;
  }
  return snapshot;
}

router.get('/', async (req, res) => {
  const { ticker, date, sector, profile: profileKey, algo: algoKey } = req.query;

  // Validate algo up front so we know whether ticker/date are required
  if (algoKey !== undefined && !isValidEngineKey(algoKey))
    return res.status(400).json({ error: 'invalid algo value' });
  const engine = getEngine(algoKey || DEFAULT_ENGINE);

  // Template-dependent engines need ticker+date; template-free engines don't
  if (engine.requiresTemplate) {
    if (!ticker || !date)
      return res.status(400).json({ error: 'ticker and date are required' });
    if (!/^[A-Z0-9.]{1,10}$/i.test(ticker))
      return res.status(400).json({ error: 'invalid ticker format' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date).getTime()))
      return res.status(400).json({ error: 'invalid date format, expected YYYY-MM-DD' });
  }
  // Ensemble is template-OPTIONAL: template-free by default, but if the caller
  // supplies ticker+date we validate them so we can build a template for the
  // templateMatch component engine.
  const ensembleWithTemplate = engine.key === 'ensembleConsensus' && ticker && date;
  if (ensembleWithTemplate) {
    if (!/^[A-Z0-9.]{1,10}$/i.test(ticker))
      return res.status(400).json({ error: 'invalid ticker format' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date).getTime()))
      return res.status(400).json({ error: 'invalid date format, expected YYYY-MM-DD' });
  }
  if (sector && sector.length > 50)
    return res.status(400).json({ error: 'invalid sector value' });

  if (!isReady())
    return res.status(503).json({ error: 'Stock universe cache is still loading. Please try again in a moment.' });

  try {
    let universe = getCache();

    // Optional sector filter — applies to all engines
    if (sector) {
      const filtered = new Map();
      for (const [key, stock] of universe) {
        if (stock.sector === sector) filtered.set(key, stock);
      }
      universe = filtered;
    }

    if (engine.requiresTemplate) {
      const sym = ticker.toUpperCase();

      // Validate and resolve the match profile (defaults to growth_breakout)
      const resolvedProfileKey = profileKey && PROFILE_KEYS.includes(profileKey) ? profileKey : DEFAULT_PROFILE;
      const profile = getProfile(resolvedProfileKey);

      const snapshot = buildTemplateSnapshot(sym, date, req.query);

      // Apply profile hard filters (e.g., value_inflection requires P/E > 0 and <= 35)
      universe = applyHardFilters(universe, profile.hardFilters);

      const matches = engine.rank({
        template: snapshot,
        universe,
        topN: 10,
        options: { weights: profile.weights },
      });
      return res.json(matches);
    }

    // Template-free engine (e.g. momentumBreakout, ensembleConsensus).
    // For ensembleConsensus specifically, build a template if ticker+date were
    // provided so the templateMatch component engine joins the ensemble.
    const rankArgs = { universe, topN: 10, options: {} };
    if (ensembleWithTemplate) {
      const sym = ticker.toUpperCase();
      const resolvedProfileKey = profileKey && PROFILE_KEYS.includes(profileKey) ? profileKey : DEFAULT_PROFILE;
      const profile = getProfile(resolvedProfileKey);
      rankArgs.template = buildTemplateSnapshot(sym, date, req.query);
      rankArgs.universe = applyHardFilters(universe, profile.hardFilters);
    }
    const matches = engine.rank(rankArgs);
    return res.json(matches);
  } catch (err) {
    console.error('[matches] Error:', err.message);
    res.status(500).json({ error: 'Failed to find matches' });
  }
});

module.exports = router;
