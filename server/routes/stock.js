/**
 * Stock detail endpoints.
 *
 * GET /api/stock/:ticker/engine-scores
 *   Runs the three template-free engines on the universe and returns
 *   score + rank + top signals per engine for one ticker. Zero FMP I/O —
 *   everything reads from the in-memory universe cache. LRU-cached for 60s
 *   to dampen re-rank cost when a user flicks between detail pages.
 */

const express = require('express');
const router = express.Router();
const universe = require('../services/universe');
const { getEngine } = require('../services/algorithms');

const TTL_MS = 60 * 1000;
const cache = new Map(); // ticker → { ts, payload }

function clearCache() { cache.clear(); }

/**
 * Locate a ticker in an engine's ranked output. Returns the result object + rank
 * (1-indexed) when found, or null otherwise. `results` is already sorted.
 */
function locate(ticker, results) {
  for (let i = 0; i < results.length; i++) {
    if (results[i].ticker === ticker) return { result: results[i], rank: i + 1 };
  }
  return null;
}

function buildEngineEntry(ticker, results) {
  const hit = locate(ticker, results);
  if (!hit) {
    return {
      score: null,
      rank: null,
      totalRanked: results.length,
      insufficientData: true,
      coverageLevel: 'sparse',
    };
  }
  const { result, rank } = hit;
  return {
    score: result.matchScore,
    rank,
    totalRanked: results.length,
    topSignals: result.topMatches || [],
    weakSignals: result.topDifferences || [],
    coverageLevel: result.confidence?.level || 'sparse',
  };
}

function buildEnsembleEntry(ticker, results) {
  const hit = locate(ticker, results);
  if (!hit) {
    return {
      score: null,
      rank: null,
      totalRanked: results.length,
      insufficientData: true,
    };
  }
  const { result, rank } = hit;
  return {
    score: result.matchScore,
    rank,
    totalRanked: results.length,
    consensusEngines: result.consensusEngines,
    totalEngines: result.totalMetrics, // ensembleConsensus overloads totalMetrics with engines-compared
  };
}

router.get('/:ticker', (req, res) => {
  const rawTicker = req.params.ticker || '';
  if (!/^[A-Z0-9.]{1,10}$/i.test(rawTicker)) {
    return res.status(404).json({});
  }
  const ticker = rawTicker.toUpperCase();
  if (!universe.isReady()) return res.status(404).json({});
  const cacheMap = universe.getCache();
  const stock = cacheMap.get(ticker);
  if (!stock) return res.status(404).json({});
  res.json(stock);
});

router.get('/:ticker/engine-scores', (req, res) => {
  const rawTicker = req.params.ticker || '';
  if (!/^[A-Z0-9.]{1,10}$/i.test(rawTicker)) {
    return res.status(404).json({});
  }
  const ticker = rawTicker.toUpperCase();

  if (!universe.isReady()) return res.status(404).json({});
  const cacheMap = universe.getCache();
  if (!cacheMap.has(ticker)) return res.status(404).json({});

  const cached = cache.get(ticker);
  if (cached && Date.now() - cached.ts < TTL_MS) {
    return res.json(cached.payload);
  }

  const momentum = getEngine('momentumBreakout');
  const catalyst = getEngine('catalystDriven');
  const ensemble = getEngine('ensembleConsensus');
  const n = cacheMap.size;

  const momentumResults = momentum.rank({ universe: cacheMap, topN: n });
  const catalystResults = catalyst.rank({ universe: cacheMap, topN: n });
  const ensembleResults = ensemble.rank({ universe: cacheMap, topN: n });

  const payload = {
    ticker,
    asOf: new Date().toISOString().slice(0, 10),
    engines: {
      momentumBreakout:  buildEngineEntry(ticker, momentumResults),
      catalystDriven:    buildEngineEntry(ticker, catalystResults),
      ensembleConsensus: buildEnsembleEntry(ticker, ensembleResults),
    },
  };

  cache.set(ticker, { ts: Date.now(), payload });
  res.json(payload);
});

module.exports = router;
module.exports._clearCache = clearCache;
