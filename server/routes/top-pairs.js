const express = require('express');
const router = express.Router();
const { getCache, isReady } = require('../services/universe');
const { findMatches, MATCH_METRICS, isSameCompany } = require('../services/matcher');

let cachedResult = null;
let lastComputed = 0;
const CACHE_TTL = 30 * 60 * 1000; // recompute every 30 min

function computeTopPairs(limit = 20) {
  const cache = getCache();
  if (cache.size < 10) return [];

  const stocks = Array.from(cache.values());

  // For each stock, find its best matches (grab a few to skip same-company pairs)
  const seen = new Set();
  const pairs = [];

  for (const stock of stocks) {
    const matches = findMatches(stock, cache, 5);

    for (const match of matches) {
      // Skip same-company share classes (uses improved detection from matcher)
      if (isSameCompany(stock.ticker, match.ticker, stock.companyName, match.companyName)) continue;

      // Dedupe: A↔B same as B↔A
      const pairKey = [stock.ticker, match.ticker].sort().join(':');
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      pairs.push({
        stockA: {
          ticker: stock.ticker,
          companyName: stock.companyName,
          sector: stock.sector,
          price: stock.price,
          marketCap: stock.marketCap,
        },
        stockB: {
          ticker: match.ticker,
          companyName: match.companyName,
          sector: match.sector,
          price: match.price,
          marketCap: match.marketCap,
        },
        matchScore: match.matchScore,
        metricsCompared: match.metricsCompared,
        topMatches: match.topMatches,
      });
      break; // only take the first non-same-company match per stock
    }
  }

  pairs.sort((a, b) => b.matchScore - a.matchScore);
  return pairs.slice(0, limit);
}

router.get('/', (req, res) => {
  if (!isReady()) {
    return res.status(503).json({ error: 'Universe cache not ready' });
  }

  const now = Date.now();
  if (!cachedResult || now - lastComputed > CACHE_TTL) {
    cachedResult = computeTopPairs(20);
    lastComputed = now;
  }

  res.json(cachedResult);
});

module.exports = router;
