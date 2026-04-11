/**
 * /api/track-record
 *
 * Returns pre-computed backtest summaries for canonical breakout examples.
 * These prove that Blueprint's matches actually correlate with forward returns.
 *
 * Results are lazily computed on first request and cached for 24 hours.
 * If the universe isn't ready yet, returns 202 (try again later).
 */
const express = require('express');
const router = express.Router();
const { isReady, getCache } = require('../services/universe');
const { findMatches, MATCH_METRICS } = require('../services/matcher');
const { getProfile, applyHardFilters, DEFAULT_PROFILE } = require('../services/matchProfiles');
const { runBacktest } = require('../services/backtest');
const fmp = require('../services/fmp');
const { computeRSI } = require('../services/rsi');

// Canonical breakouts — the "hall of fame"
const CANONICAL_BREAKOUTS = [
  { ticker: 'CLS',  date: '2023-12-01', label: 'Celestica',   gain: '+490%' },
  { ticker: 'NVDA', date: '2023-01-03', label: 'NVIDIA',      gain: '+800%' },
  { ticker: 'META', date: '2023-02-01', label: 'Meta',         gain: '+430%' },
  { ticker: 'PLTR', date: '2023-05-01', label: 'Palantir',    gain: '+350%' },
];

// Cache for track record results
let trackRecordCache = null;
let trackRecordCacheTs = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
let computing = false;

/**
 * Build a minimal snapshot from the universe cache.
 * If the ticker is in the universe, use that data.
 * Otherwise, fall back to FMP API calls.
 */
async function buildSnapshot(ticker, date) {
  // Try universe cache first (fast path)
  const universe = getCache();
  const cached = universe.get(ticker);
  if (cached) {
    const snap = { ticker, sector: cached.sector, companyName: cached.companyName };
    for (const metric of MATCH_METRICS) snap[metric] = cached[metric] ?? null;
    return snap;
  }

  // Slow path — fetch from FMP
  try {
    const [profileData, historicalPrices] = await Promise.all([
      fmp.getCompanyProfile(ticker),
      fmp.getHistoricalPrices(ticker, date),
    ]);

    if (!profileData) return null;

    const snap = {
      ticker,
      sector: profileData.sector || null,
      companyName: profileData.companyName || ticker,
      marketCap: profileData.mktCap || null,
      beta: profileData.beta || null,
    };

    // Fill remaining metrics as null — the matcher handles missing data gracefully
    for (const metric of MATCH_METRICS) {
      if (snap[metric] === undefined) snap[metric] = null;
    }

    return snap;
  } catch {
    return null;
  }
}

async function computeTrackRecord() {
  if (computing) return;
  computing = true;

  try {
    const results = [];
    const profile = getProfile(DEFAULT_PROFILE);

    for (const breakout of CANONICAL_BREAKOUTS) {
      try {
        const snapshot = await buildSnapshot(breakout.ticker, breakout.date);
        if (!snapshot) continue;

        let universe = getCache();
        universe = applyHardFilters(universe, profile.hardFilters);

        const matches = findMatches(snapshot, universe, 10, {
          weights: profile.weights,
          sectorBonus: profile.sectorBonus,
        });

        if (matches.length === 0) continue;

        // Run backtest for forward returns
        const backtestResult = await runBacktest(matches, breakout.date);
        const summary = backtestResult.summary || {};
        const topMatch = matches[0];

        results.push({
          ticker: breakout.ticker,
          date: breakout.date,
          label: breakout.label,
          templateGain: breakout.gain,
          matchCount: matches.length,
          topMatchTicker: topMatch?.ticker,
          topMatchScore: topMatch?.matchScore,
          avgReturn1m:  summary['1m']?.avgReturn ?? null,
          avgReturn3m:  summary['3m']?.avgReturn ?? null,
          avgReturn6m:  summary['6m']?.avgReturn ?? null,
          avgReturn12m: summary['12m']?.avgReturn ?? null,
          winRate1m:    summary['1m']?.winRate ?? null,
          winRate3m:    summary['3m']?.winRate ?? null,
          winRate6m:    summary['6m']?.winRate ?? null,
          winRate12m:   summary['12m']?.winRate ?? null,
          alpha12m:     summary['12m']?.alpha ?? null,
          benchmarkReturn12m: backtestResult.benchmark?.['12m'] ?? null,
        });
      } catch (err) {
        console.warn(`[track-record] Failed for ${breakout.ticker}:`, err.message);
      }
    }

    if (results.length > 0) {
      trackRecordCache = results;
      trackRecordCacheTs = Date.now();
      console.log(`[track-record] Computed ${results.length} track record entries`);
    }
  } catch (err) {
    console.error('[track-record] Computation failed:', err.message);
  } finally {
    computing = false;
  }
}

router.get('/', async (_req, res) => {
  // Return cached if fresh
  if (trackRecordCache && Date.now() - trackRecordCacheTs < CACHE_TTL) {
    return res.json(trackRecordCache);
  }

  if (!isReady()) {
    return res.status(202).json({ message: 'Universe still loading.' });
  }

  // Return stale cache while recomputing
  if (trackRecordCache) {
    computeTrackRecord();
    return res.json(trackRecordCache);
  }

  // First request — start background computation
  computeTrackRecord();
  return res.status(202).json({ message: 'Computing track record — check back in ~60 seconds.' });
});

module.exports = router;
