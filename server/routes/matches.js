const express = require('express');
const router = express.Router();
const { getCache, isReady } = require('../services/universe');
const { findMatches, MATCH_METRICS } = require('../services/matcher');

router.get('/', async (req, res) => {
  const { ticker, date } = req.query;
  if (!ticker || !date)
    return res.status(400).json({ error: 'ticker and date are required' });

  if (!isReady())
    return res.status(503).json({ error: 'Stock universe cache is still loading. Please try again in a moment.' });

  // Build full snapshot from all query params so the matcher has every metric
  const snapshot = { ticker: ticker.toUpperCase() };
  for (const metric of MATCH_METRICS) {
    const val = req.query[metric];
    snapshot[metric] = val !== undefined && val !== '' ? parseFloat(val) : null;
  }

  try {
    const universe = getCache();
    const matches = findMatches(snapshot, universe);
    res.json(matches);
  } catch (err) {
    console.error('[matches] Error:', err.message);
    res.status(500).json({ error: 'Failed to find matches' });
  }
});

module.exports = router;
