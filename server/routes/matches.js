const express = require('express');
const router = express.Router();
const { getCache, isReady } = require('../services/universe');
const { findMatches } = require('../services/matcher');

router.get('/', async (req, res) => {
  const { ticker, date } = req.query;
  if (!ticker || !date) {
    return res.status(400).json({ error: 'ticker and date are required' });
  }

  if (!isReady()) {
    return res.status(503).json({ error: 'Stock universe cache is still loading. Please try again in a moment.' });
  }

  // Build a minimal snapshot from query params to run matching
  // The snapshot metrics come from the client (passed via the actual snapshot data).
  // This route expects the snapshot metrics as query params.
  const snapshot = {
    ticker: ticker.toUpperCase(),
    peRatio: req.query.peRatio ? parseFloat(req.query.peRatio) : null,
    revenueGrowthYoY: req.query.revenueGrowthYoY ? parseFloat(req.query.revenueGrowthYoY) : null,
    grossMargin: req.query.grossMargin ? parseFloat(req.query.grossMargin) : null,
    marketCap: req.query.marketCap ? parseFloat(req.query.marketCap) : null,
    rsi14: req.query.rsi14 ? parseFloat(req.query.rsi14) : null,
    pctBelowHigh: req.query.pctBelowHigh ? parseFloat(req.query.pctBelowHigh) : null,
  };

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
