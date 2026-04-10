const express = require('express');
const router = express.Router();
const { getCache, isReady } = require('../services/universe');
const { findMatches, MATCH_METRICS, isSameCompany } = require('../services/matcher');

let cachedResult = null;
let lastComputed = 0;
let computing = false;
const CACHE_TTL = 30 * 60 * 1000; // recompute every 30 min
const BATCH_SIZE = 50; // Process 50 stocks per event loop tick

/**
 * Chunked top-pairs computation — processes BATCH_SIZE stocks per tick
 * so the event loop stays responsive for snapshot/match requests.
 */
function computeTopPairsAsync(limit = 20) {
  return new Promise((resolve) => {
    const cache = getCache();
    if (cache.size < 10) return resolve([]);

    const stocks = Array.from(cache.values());
    const seen = new Set();
    const pairs = [];
    let idx = 0;

    function processBatch() {
      const end = Math.min(idx + BATCH_SIZE, stocks.length);

      for (; idx < end; idx++) {
        const stock = stocks[idx];
        const matches = findMatches(stock, cache, 5);

        for (const match of matches) {
          if (isSameCompany(stock.ticker, match.ticker, stock.companyName, match.companyName)) continue;

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
          break;
        }
      }

      if (idx < stocks.length) {
        // Yield to event loop, then continue
        setImmediate(processBatch);
      } else {
        // Done — sort and return top results
        pairs.sort((a, b) => b.matchScore - a.matchScore);
        resolve(pairs.slice(0, limit));
      }
    }

    processBatch();
  });
}

// Background pre-computation — run after universe is ready
async function triggerBackgroundCompute() {
  if (computing) return;
  computing = true;
  try {
    console.log('[top-pairs] Starting background computation...');
    const start = Date.now();
    cachedResult = await computeTopPairsAsync(20);
    lastComputed = Date.now();
    console.log(`[top-pairs] Computed ${cachedResult.length} pairs in ${Date.now() - start}ms`);
  } catch (err) {
    console.error('[top-pairs] Background computation failed:', err.message);
  } finally {
    computing = false;
  }
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
