/**
 * Walk-forward validation service.
 *
 * Runs historical test cases through the full matching pipeline and measures
 * whether top matches have better forward returns than SPY. Computes aggregate
 * statistics and Spearman rank correlation between match score and forward return.
 */

const { buildSnapshot } = require('./snapshotBuilder');
const { findMatches, MATCH_METRICS } = require('./matcher');
const { getProfile, applyHardFilters, DEFAULT_PROFILE } = require('./matchProfiles');
const { runBacktest } = require('./backtest');
const { getCache, isReady } = require('./universe');

// ---------------------------------------------------------------------------
// Test cases: curated historical breakout setups with dates >= 12 months ago
// ---------------------------------------------------------------------------

const DEFAULT_TEST_CASES = [
  { ticker: 'NVDA', date: '2023-01-03', label: 'Pre-AI breakout' },
  { ticker: 'SMCI', date: '2023-06-01', label: 'AI infrastructure' },
  { ticker: 'AVGO', date: '2023-06-01', label: 'Semiconductor broadening' },
  { ticker: 'META', date: '2022-11-01', label: 'Post-selloff recovery' },
  { ticker: 'UBER', date: '2023-01-03', label: 'Profitability inflection' },
  { ticker: 'PLTR', date: '2023-05-01', label: 'AI analytics breakout' },
  { ticker: 'VST',  date: '2023-06-01', label: 'Energy/data center' },
  { ticker: 'ANET', date: '2023-06-01', label: 'Networking infrastructure' },
  { ticker: 'GE',   date: '2023-01-03', label: 'Industrial turnaround' },
  { ticker: 'CRWD', date: '2023-01-03', label: 'Cybersecurity growth' },
  { ticker: 'LLY',  date: '2023-01-03', label: 'GLP-1 pharma breakout' },
  { ticker: 'AXON', date: '2023-06-01', label: 'Defense tech' },
  { ticker: 'APP',  date: '2024-01-02', label: 'Ad-tech breakout' },
  { ticker: 'TOST', date: '2024-01-02', label: 'Restaurant SaaS' },
  { ticker: 'HOOD', date: '2024-01-02', label: 'Fintech recovery' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function round2(v) {
  return v == null ? null : Math.round(v * 100) / 100;
}

function round4(v) {
  return v == null ? null : Math.round(v * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// Core validation runner
// ---------------------------------------------------------------------------

/**
 * Run walk-forward validation across a set of historical test cases.
 *
 * @param {Object}   opts
 * @param {Array}    opts.testCases   - Array of { ticker, date, label }
 * @param {string}   opts.profile     - Match profile key
 * @param {number}   opts.topN        - Number of top matches to evaluate
 * @param {Function} opts.onProgress  - Callback for progress messages
 * @returns {Object} Validation results with aggregate stats and correlation
 */
async function runValidation({
  testCases = DEFAULT_TEST_CASES,
  profile = DEFAULT_PROFILE,
  topN = 10,
  onProgress = () => {},
} = {}) {
  const profileConfig = getProfile(profile);
  const weights = profileConfig?.weights ?? {};
  const hardFilters = profileConfig?.hardFilters ?? [];

  if (!isReady()) {
    throw new Error('Universe cache is not ready. Start the cache before running validation.');
  }

  const cases = [];
  const rawMatchReturns = []; // { matchScore, returnPct, period } for correlation
  let completedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    onProgress(`[${i + 1}/${testCases.length}] Processing ${tc.ticker} (${tc.date}) — ${tc.label}`);

    try {
      // 1. Build point-in-time snapshot
      const snapshot = await buildSnapshot(tc.ticker, tc.date);
      if (!snapshot) {
        onProgress(`  Skipped ${tc.ticker}: no snapshot data`);
        cases.push({ ...tc, status: 'skipped', reason: 'No snapshot data' });
        skippedCount++;
        continue;
      }

      // 2. Extract MATCH_METRICS from snapshot into template
      const template = {};
      for (const metric of MATCH_METRICS) {
        if (snapshot[metric] != null) {
          template[metric] = snapshot[metric];
        }
      }

      // 3. Find matches
      let universe = getCache();
      if (hardFilters.length > 0) {
        universe = applyHardFilters(universe, hardFilters);
      }
      const matches = findMatches(template, universe, topN, { weights });

      if (matches.length === 0) {
        onProgress(`  Skipped ${tc.ticker}: no matches found`);
        cases.push({ ...tc, status: 'skipped', reason: 'No matches found' });
        skippedCount++;
        continue;
      }

      // 4. Run backtest on matches
      const backtest = await runBacktest(matches, tc.date);

      // 5. Collect score-return pairs for correlation
      for (const result of backtest.results) {
        if (!result.returns) continue;
        for (const period of ['1m', '3m', '6m', '12m']) {
          const ret = result.returns[period]?.returnPct;
          if (ret != null && result.matchScore != null) {
            rawMatchReturns.push({
              matchScore: result.matchScore,
              returnPct: ret,
              period,
            });
          }
        }
      }

      // 6. Store case result
      cases.push({
        ...tc,
        status: 'completed',
        matchCount: matches.length,
        summary: backtest.summary,
        benchmark: backtest.benchmark,
      });
      completedCount++;
      onProgress(`  Completed ${tc.ticker}: ${matches.length} matches evaluated`);

    } catch (err) {
      onProgress(`  Error on ${tc.ticker}: ${err.message}`);
      cases.push({ ...tc, status: 'error', error: err.message });
      errorCount++;
    }
  }

  onProgress(`Validation complete: ${completedCount} completed, ${skippedCount} skipped, ${errorCount} errors`);

  return {
    profile,
    topN,
    testCaseCount: testCases.length,
    completedCount,
    skippedCount,
    errorCount,
    survivorshipBiasWarning:
      'Matches are drawn from the CURRENT universe, which only includes stocks that still exist today. ' +
      'This creates survivorship bias — real-time results may differ because delisted or acquired companies ' +
      'would have been in the candidate pool at the historical date.',
    aggregate: computeAggregate(cases),
    correlation: computeCorrelation(rawMatchReturns),
    cases,
    rawMatchReturns,
  };
}

// ---------------------------------------------------------------------------
// Aggregate statistics across all completed cases
// ---------------------------------------------------------------------------

/**
 * For each period (1m, 3m, 6m, 12m), average the avgReturn, benchmarkReturn,
 * and winRate across all completed cases. Compute alpha = avgReturn - avgBenchmarkReturn.
 */
function computeAggregate(caseResults) {
  const completed = caseResults.filter(c => c.status === 'completed' && c.summary);
  if (completed.length === 0) return null;

  const periods = ['1m', '3m', '6m', '12m'];
  const aggregate = {};

  for (const period of periods) {
    const periodData = completed
      .map(c => c.summary[period])
      .filter(s => s != null);

    if (periodData.length === 0) {
      aggregate[period] = null;
      continue;
    }

    const avgReturn = periodData.reduce((s, d) => s + d.avgReturn, 0) / periodData.length;
    const benchmarks = periodData.filter(d => d.benchmarkReturn != null);
    const avgBenchmarkReturn = benchmarks.length > 0
      ? benchmarks.reduce((s, d) => s + d.benchmarkReturn, 0) / benchmarks.length
      : null;
    const avgWinRate = periodData.reduce((s, d) => s + d.winRate, 0) / periodData.length;

    aggregate[period] = {
      avgReturn: round2(avgReturn),
      avgBenchmarkReturn: round2(avgBenchmarkReturn),
      alpha: avgBenchmarkReturn != null ? round2(avgReturn - avgBenchmarkReturn) : null,
      avgWinRate: round2(avgWinRate),
      caseCount: periodData.length,
    };
  }

  return aggregate;
}

// ---------------------------------------------------------------------------
// Correlation: Spearman rank correlation between match score and forward return
// ---------------------------------------------------------------------------

/**
 * For each period, filter pairs by period, require >= 10 pairs, compute
 * Spearman rank correlation.
 */
function computeCorrelation(matchReturns) {
  if (!matchReturns || matchReturns.length === 0) return null;

  const periods = ['1m', '3m', '6m', '12m'];
  const correlation = {};

  for (const period of periods) {
    const pairs = matchReturns.filter(p => p.period === period);

    if (pairs.length < 10) {
      correlation[period] = { n: pairs.length, rho: null, note: 'Insufficient data (need >= 10 pairs)' };
      continue;
    }

    const scores = pairs.map(p => p.matchScore);
    const returns = pairs.map(p => p.returnPct);
    const rho = spearmanCorrelation(scores, returns);

    correlation[period] = {
      n: pairs.length,
      rho: round4(rho),
    };
  }

  return correlation;
}

// ---------------------------------------------------------------------------
// Spearman rank correlation
// ---------------------------------------------------------------------------

/**
 * Compute Spearman rho: convert both arrays to ranks (average rank for ties),
 * then Pearson correlation on the ranks.
 */
function spearmanCorrelation(x, y) {
  if (x.length !== y.length || x.length < 2) return null;

  const rankX = toRanks(x);
  const rankY = toRanks(y);

  // Pearson correlation on ranks
  const n = rankX.length;
  const meanX = rankX.reduce((s, v) => s + v, 0) / n;
  const meanY = rankY.reduce((s, v) => s + v, 0) / n;

  let num = 0;
  let denX = 0;
  let denY = 0;

  for (let i = 0; i < n; i++) {
    const dx = rankX[i] - meanX;
    const dy = rankY[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }

  const den = Math.sqrt(denX * denY);
  if (den === 0) return 0;

  return num / den;
}

/**
 * Convert values to 1-based ranks with average rank for ties.
 */
function toRanks(arr) {
  const indexed = arr.map((val, i) => ({ val, i }));
  indexed.sort((a, b) => a.val - b.val);

  const ranks = new Array(arr.length);
  let pos = 0;

  while (pos < indexed.length) {
    // Find the run of tied values
    let end = pos + 1;
    while (end < indexed.length && indexed[end].val === indexed[pos].val) {
      end++;
    }

    // Average rank for the tied group (1-based)
    const avgRank = (pos + 1 + end) / 2;
    for (let j = pos; j < end; j++) {
      ranks[indexed[j].i] = avgRank;
    }

    pos = end;
  }

  return ranks;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  runValidation,
  DEFAULT_TEST_CASES,
  _test: { spearmanCorrelation, toRanks, computeAggregate, computeCorrelation },
};
