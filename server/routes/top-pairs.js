const express = require('express');
const router = express.Router();
const { getCache, isReady } = require('../services/universe');
const { findMatches, MATCH_METRICS, isSameCompany } = require('../services/matcher');

let cachedResult = null;
let lastComputed = 0;
let computing = false;
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

// Background pre-computation — run after universe is ready
function triggerBackgroundCompute() {
  if (computing) return;
  computing = true;
  // Use setImmediate to avoid blocking the event loop during startup
  setImmediate(() => {
    try {
      console.log('[top-pairs] Starting background computation...');
      const start = Date.now();
      cachedResult = computeTopPairs(20);
      lastComputed = Date.now();
      console.log(`[top-pairs] Computed ${cachedResult.length} pairs in ${Date.now() - start}ms`);
    } catch (err) {
      console.error('[top-pairs] Background computation failed:', err.message);
    } finally {
      computing = false;
    }
  });
}

// Poll for universe readiness and trigger pre-computation
let bootPollRef = setInterval(() => {
  if (isReady() && !cachedResult && !computing) {
    clearInterval(bootPollRef);
    triggerBackgroundCompute();
  }
}, 5000);

router.get('/', (req, res) => {
  if (!isReady()) {
    return res.status(503).json({ error: 'Universe cache not ready' });
  }

  // If we have a cached result, serve it immediately
  if (cachedResult) {
    // Trigger background refresh if stale
    const now = Date.now();
    if (now - lastComputed > CACHE_TTL && !computing) {
      triggerBackgroundCompute();
    }
    return res.json(cachedResult);
  }

  // No cached result yet — if not computing, start it; return 202 to signal "processing"
  if (!computing) {
    triggerBackgroundCompute();
  }
  return res.status(202).json({ computing: true, message: 'Top pairs are being calculated, check back shortly.' });
});

module.exports = router;
