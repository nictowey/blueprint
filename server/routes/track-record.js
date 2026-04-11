/**
 * /api/track-record
 *
 * Returns historical backtest summaries for canonical breakout examples.
 * Uses point-in-time snapshots to build proper historical comparisons:
 *   1. Template snapshot: what the breakout stock looked like AT its breakout date
 *   2. Universe: current stocks (limitation — see methodology note)
 *   3. Forward returns: actual price changes measured from the breakout date
 *
 * Results are lazily computed on first request and cached for 24 hours.
 * If the universe isn't ready yet, returns 202 (try again later).
 */
const express = require('express');
const router = express.Router();
const { isReady, getCache } = require('../services/universe');
const { findMatches } = require('../services/matcher');
const { getProfile, applyHardFilters, DEFAULT_PROFILE } = require('../services/matchProfiles');
const { runBacktest } = require('../services/backtest');
const { buildSnapshot } = require('../services/snapshotBuilder');

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

async function computeTrackRecord() {
  if (computing) return;
  computing = true;

  try {
    const results = [];
    const profile = getProfile(DEFAULT_PROFILE);

    for (const breakout of CANONICAL_BREAKOUTS) {
      try {
        // Build a proper point-in-time snapshot using historical financial data.
        // This fetches quarterly income statements, balance sheets, prices etc.
        // filtered to only data available ON OR BEFORE the breakout date.
        console.log(`[track-record] Building point-in-time snapshot for ${breakout.ticker} @ ${breakout.date}...`);
        const snapshot = await buildSnapshot(breakout.ticker, breakout.date, true);
        if (!snapshot) {
          console.warn(`[track-record] Could not build snapshot for ${breakout.ticker} @ ${breakout.date}`);
          continue;
        }

        // Get the current universe for comparison candidates.
        // NOTE: This compares the historical template against today's universe,
        // not what the universe looked like at the breakout date. A true backtest
        // would require historical snapshots for all ~3000+ stocks, which isn't
        // feasible with current API limits. The forward returns ARE measured from
        // the actual breakout date, so those numbers are real.
        let universe = getCache();
        universe = applyHardFilters(universe, profile.hardFilters);

        const matches = findMatches(snapshot, universe, 10, {
          weights: profile.weights,
          sectorBonus: profile.sectorBonus,
        });

        if (matches.length === 0) continue;

        // Run backtest — fetches actual forward returns from the breakout date
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
          alpha12m:     summary['12m']?.avgVsBenchmark ?? null,
          benchmarkReturn12m: summary['12m']?.benchmarkReturn ?? null,
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
  return res.status(202).json({ message: 'Computing historical backtest — check back in ~60 seconds.' });
});

module.exports = router;
