#!/usr/bin/env node

/**
 * CLI script for generating honest pre-computed backtest proof results —
 * multi-engine edition.
 *
 * Loops over ENGINES_TO_BACKTEST for each test case and, for each case,
 * also runs a seeded random-ticker control group so per-engine returns are
 * compared against a neutral baseline (not just SPY).
 *
 * catalystDriven is intentionally excluded from historical backtesting:
 * `server/services/catalystSnapshot.js` fetches current FMP data (last 90
 * days from today, not from the test-case date), so any historical scoring
 * would leak future information. See the `disclaimers` array in the output
 * JSON for the user-visible note.
 *
 * Usage:
 *   node server/scripts/run-proof.js [--profile growth_breakout] [--resume]
 *
 * Requires: FMP_API_KEY, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { getBenchmarkReturns } = require('../services/backtest');
const { getProfile, DEFAULT_PROFILE } = require('../services/matchProfiles');
const { DEFAULT_TEST_CASES } = require('../services/validation');
const { _test: { spearmanCorrelation } } = require('../services/validation');
const {
  runProofForEngine,
  runProofForRandom,
  BACKTEST_SAFE_ENGINES,
} = require('../services/proof/runProofForEngine');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TOP_N = 10;
const RANDOM_SAMPLE_SIZE = 10;
const REDIS_PROOF_KEY = 'proof_results';
const REDIS_PROOF_TTL = 2592000; // 30 days
const CACHE_DIR = path.join(__dirname, '..', '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'proof-results.json');

// Which engines to run per test case. Order matters only for log output.
const ENGINES_TO_BACKTEST = ['templateMatch', 'momentumBreakout', 'ensembleConsensus'];

const DISCLAIMERS = [
  'Backtests use historical fundamentals reconstructed at the template date via Financial Modeling Prep data.',
  'Match candidates drawn from current stock universe. Companies delisted or acquired between the template date and today are not included, which may overstate results.',
  'catalystDriven is intentionally excluded from historical backtests: catalystSnapshot fetches current FMP data (last 90 days from today), so historical scoring would peek ahead. Catalyst signals are evaluated live only.',
  'ensembleConsensus runs over templateMatch + momentumBreakout in the backtest (catalyst engine excluded for walk-forward safety).',
  'Random control group: uniformly sampled tickers from the same market-cap band as the template, with a seeded RNG for reproducibility.',
  'Past performance does not guarantee future results.',
  'Not financial advice.',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getArg(args, flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

function round2(v) {
  return v == null ? null : Math.round(v * 100) / 100;
}

function round4(v) {
  return v == null ? null : Math.round(v * 10000) / 10000;
}

// ---------------------------------------------------------------------------
// Redis helpers
// ---------------------------------------------------------------------------

async function loadUniverseFromRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN required');

  const res = await fetch(`${url}/get/universe_cache`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (!json.result) throw new Error('No universe_cache found in Redis');

  const entries = JSON.parse(json.result);
  const universe = new Map(entries);
  return universe;
}

async function saveProofToRedis(data) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    console.warn('[proof] No Redis credentials — skipping Redis save');
    return;
  }

  try {
    await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['SET', REDIS_PROOF_KEY, JSON.stringify(data), 'EX', String(REDIS_PROOF_TTL)]),
    });
    console.log('[proof] Saved to Redis (30-day TTL)');
  } catch (err) {
    console.warn(`[proof] Failed to save to Redis: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Local file helpers
// ---------------------------------------------------------------------------

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function saveLocal(data) {
  ensureCacheDir();
  fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
}

function loadLocal() {
  if (!fs.existsSync(CACHE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Aggregate stats — now per-engine
// ---------------------------------------------------------------------------

function aggregateMatchesForPeriod(matches, period) {
  const rets = matches
    .map(m => m.forwardReturns?.[period])
    .filter(r => r != null);
  if (rets.length === 0) return null;

  const avg = rets.reduce((s, r) => s + r, 0) / rets.length;
  const sorted = [...rets].sort((a, b) => a - b);
  const median = sorted.length % 2 === 0
    ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
    : sorted[Math.floor(sorted.length / 2)];
  const winners = rets.filter(r => r > 0).length;
  const winRate = Math.round((winners / rets.length) * 100);

  return { avg, median, winRate, count: rets.length };
}

function computePerEngineAggregate(cases, engineKey) {
  const periods = ['1m', '3m', '6m', '12m'];
  const periodStats = {};
  const scorePairs = { '1m': [], '3m': [], '6m': [], '12m': [] };
  let totalMatches = 0;
  let completedCases = 0;

  for (const period of periods) {
    const perCase = [];
    let hitRateNumerator = 0;
    let hitRateDenominator = 0;

    for (const cs of cases) {
      const engineResult = engineKey === 'random'
        ? cs.random
        : cs.engines?.[engineKey];
      if (!engineResult || engineResult.status !== 'completed') continue;
      const matches = engineResult.matches || [];
      if (matches.length === 0) continue;

      const stats = aggregateMatchesForPeriod(matches, period);
      if (!stats) continue;

      const benchReturn = cs.benchmark?.[period];
      perCase.push({ ...stats, benchmark: benchReturn });

      // Hit-rate vs benchmark: count per-match "beat benchmark" across all cases
      if (benchReturn != null) {
        for (const m of matches) {
          const r = m.forwardReturns?.[period];
          if (r == null) continue;
          hitRateDenominator += 1;
          if (r > benchReturn) hitRateNumerator += 1;
        }
      }

      // Score-return pairs for correlation (only for ranking engines)
      if (engineKey !== 'random') {
        for (const m of matches) {
          const r = m.forwardReturns?.[period];
          if (r != null && m.matchScore != null) scorePairs[period].push({ score: m.matchScore, ret: r });
        }
      }

      if (period === '1m') {
        totalMatches += matches.length;
        completedCases += 1;
      }
    }

    if (perCase.length === 0) {
      periodStats[period] = null;
      continue;
    }

    const avgReturn = perCase.reduce((s, c) => s + c.avg, 0) / perCase.length;
    const medianReturn = perCase.reduce((s, c) => s + c.median, 0) / perCase.length;
    const benchmarks = perCase.filter(c => c.benchmark != null);
    const benchmarkReturn = benchmarks.length > 0
      ? benchmarks.reduce((s, c) => s + c.benchmark, 0) / benchmarks.length
      : null;
    const avgWinRate = perCase.reduce((s, c) => s + c.winRate, 0) / perCase.length;

    periodStats[period] = {
      avgReturn: round2(avgReturn),
      medianReturn: round2(medianReturn),
      benchmarkReturn: round2(benchmarkReturn),
      alpha: benchmarkReturn != null ? round2(avgReturn - benchmarkReturn) : null,
      winRate: Math.round(avgWinRate),
      hitRateVsBenchmark: hitRateDenominator > 0 ? Math.round((hitRateNumerator / hitRateDenominator) * 100) : null,
      // maxDrawdownPct is computed per-match at run time (needs daily series);
      // for Phase 5a we leave null on the aggregate output — a future fixture
      // regeneration can enable `withSeries: true` on getForwardReturns if
      // we decide the memory cost is worth it.
      maxDrawdownPct: null,
      caseCount: perCase.length,
    };
  }

  const correlation = {};
  for (const period of periods) {
    const pairs = scorePairs[period];
    if (engineKey === 'random') {
      correlation[period] = { rho: null, pairs: 0 };
    } else if (pairs.length >= 10) {
      const rho = spearmanCorrelation(pairs.map(p => p.score), pairs.map(p => p.ret));
      correlation[period] = { rho: round4(rho), pairs: pairs.length };
    } else {
      correlation[period] = { rho: null, pairs: pairs.length };
    }
  }

  return {
    periods: periodStats,
    correlation,
    totalMatches,
    totalCases: completedCases,
  };
}

function computeAggregate(cases) {
  const engineKeys = [...ENGINES_TO_BACKTEST, 'random'];
  const engines = {};
  let totalMatches = 0;
  let totalCases = 0;

  for (const key of engineKeys) {
    engines[key] = computePerEngineAggregate(cases, key);
    totalMatches += engines[key].totalMatches;
    totalCases = Math.max(totalCases, engines[key].totalCases);
  }

  return { engines, totalMatches, totalCases };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const profile = getArg(args, '--profile') || DEFAULT_PROFILE;
  const resume = hasFlag(args, '--resume');

  console.log('='.repeat(70));
  console.log('  Blueprint Proof Generator (multi-engine)');
  console.log('='.repeat(70));
  console.log(`  Profile        : ${profile} (templateMatch only)`);
  console.log(`  Cases          : ${DEFAULT_TEST_CASES.length}`);
  console.log(`  Engines        : ${ENGINES_TO_BACKTEST.join(', ')}`);
  console.log(`  Random sample  : ${RANDOM_SAMPLE_SIZE}`);
  console.log(`  Top N / engine : ${TOP_N}`);
  console.log(`  Resume         : ${resume}`);
  console.log('='.repeat(70));
  console.log();

  // Validate env
  if (!process.env.FMP_API_KEY) {
    console.error('ERROR: FMP_API_KEY is required');
    process.exit(1);
  }

  // Load profile (only templateMatch uses it)
  const profileConfig = getProfile(profile);
  if (!profileConfig) {
    console.error(`ERROR: Unknown profile "${profile}"`);
    process.exit(1);
  }

  // Per-engine options. `profile` flows into templateMatch only; other
  // engines ignore it.
  const engineOptionsFor = (engineKey) => {
    if (engineKey === 'templateMatch') {
      return { weights: profileConfig.weights };
    }
    return {};
  };

  // Load universe from Redis
  console.log('Loading universe from Redis...');
  const universe = await loadUniverseFromRedis();
  console.log(`Universe loaded: ${universe.size} stocks\n`);

  // Load existing results for --resume
  let existingCases = [];
  if (resume) {
    const existing = loadLocal();
    if (existing?.version === 2 && Array.isArray(existing.cases)) {
      existingCases = existing.cases;
      console.log(`Resuming: ${existingCases.length} cases found on disk\n`);
    } else if (existing) {
      console.log('Existing fixture is v1; not reusing (run without --resume to regenerate)\n');
    }
  }

  // Build the output structure incrementally
  const output = {
    version: 2,
    generatedAt: new Date().toISOString(),
    profile,
    engines: ENGINES_TO_BACKTEST,
    cases: [...existingCases],
    aggregate: null,
    disclaimers: DISCLAIMERS,
  };

  const completedKeys = new Set(existingCases.map(c => `${c.templateTicker}:${c.templateDate}`));

  for (let i = 0; i < DEFAULT_TEST_CASES.length; i++) {
    const tc = DEFAULT_TEST_CASES[i];
    const key = `${tc.ticker}:${tc.date}`;

    if (completedKeys.has(key)) {
      console.log(`[${i + 1}/${DEFAULT_TEST_CASES.length}] ${tc.ticker} (${tc.date}) — SKIPPED (already completed)`);
      continue;
    }

    console.log(`[${i + 1}/${DEFAULT_TEST_CASES.length}] ${tc.ticker} (${tc.date}) — ${tc.label}`);

    const caseBlock = {
      templateTicker: tc.ticker,
      templateDate: tc.date,
      templateCompanyName: tc.ticker,
      templateSector: '',
      candidatesScanned: 0,
      engines: {},
      random: null,
      benchmark: null,
    };

    // Run each engine
    for (const engineKey of ENGINES_TO_BACKTEST) {
      if (!BACKTEST_SAFE_ENGINES.has(engineKey)) {
        caseBlock.engines[engineKey] = {
          status: 'skipped',
          reason: 'engine not backtest-safe',
          matches: [],
        };
        continue;
      }
      try {
        const result = await runProofForEngine({
          engineKey,
          testCase: tc,
          universe,
          options: { topN: TOP_N, engineOptions: engineOptionsFor(engineKey) },
          onProgress: msg => console.log(msg),
        });
        caseBlock.engines[engineKey] = {
          status: result.status,
          reason: result.reason,
          matches: result.matches,
          snapshotsBuilt: result.snapshotsBuilt ?? null,
        };
        if (result.templateCompanyName && !caseBlock.templateCompanyName) {
          caseBlock.templateCompanyName = result.templateCompanyName;
        }
        if (result.templateCompanyName) caseBlock.templateCompanyName = result.templateCompanyName;
        if (result.templateSector) caseBlock.templateSector = result.templateSector;
        if (result.candidatesScanned) caseBlock.candidatesScanned = result.candidatesScanned;
        console.log(`  => [${engineKey}] ${result.status}: ${result.matches?.length ?? 0} matches`);
      } catch (err) {
        console.error(`  ERROR on ${tc.ticker}/${engineKey}: ${err.message}`);
        caseBlock.engines[engineKey] = {
          status: 'error',
          reason: err.message,
          matches: [],
        };
      }
    }

    // Random control group
    try {
      const randomResult = await runProofForRandom({
        testCase: tc,
        universe,
        sampleSize: RANDOM_SAMPLE_SIZE,
        onProgress: msg => console.log(msg),
      });
      caseBlock.random = {
        status: randomResult.status,
        reason: randomResult.reason,
        matches: randomResult.matches,
        seed: randomResult.seed,
      };
      if (!caseBlock.templateCompanyName || caseBlock.templateCompanyName === tc.ticker) {
        caseBlock.templateCompanyName = randomResult.templateCompanyName || caseBlock.templateCompanyName;
      }
      if (!caseBlock.templateSector && randomResult.templateSector) {
        caseBlock.templateSector = randomResult.templateSector;
      }
      if (!caseBlock.candidatesScanned && randomResult.candidatesScanned) {
        caseBlock.candidatesScanned = randomResult.candidatesScanned;
      }
      console.log(`  => [random] ${randomResult.status}: ${randomResult.matches?.length ?? 0} picks`);
    } catch (err) {
      console.error(`  ERROR on ${tc.ticker}/random: ${err.message}`);
      caseBlock.random = {
        status: 'error',
        reason: err.message,
        matches: [],
      };
    }

    // SPY benchmark (once per case, shared across engines)
    try {
      const spy = await getBenchmarkReturns(tc.date);
      if (spy?.returns) {
        caseBlock.benchmark = {
          '1m': spy.returns['1m']?.returnPct ?? null,
          '3m': spy.returns['3m']?.returnPct ?? null,
          '6m': spy.returns['6m']?.returnPct ?? null,
          '12m': spy.returns['12m']?.returnPct ?? null,
        };
      }
    } catch (err) {
      console.warn(`  WARNING: Failed to fetch SPY benchmark: ${err.message}`);
    }

    output.cases.push(caseBlock);
    completedKeys.add(key);

    // Incremental save after each case (crash recovery)
    output.generatedAt = new Date().toISOString();
    output.aggregate = computeAggregate(output.cases);
    saveLocal(output);

    console.log();
  }

  // Final aggregate
  output.generatedAt = new Date().toISOString();
  output.aggregate = computeAggregate(output.cases);

  saveLocal(output);
  console.log(`\nResults saved to: ${CACHE_FILE}`);

  await saveProofToRedis(output);

  printSummary(output);
}

// ---------------------------------------------------------------------------
// Summary output
// ---------------------------------------------------------------------------

function printSummary(output) {
  const agg = output.aggregate;
  if (!agg) {
    console.log('\nNo aggregate data to display.');
    return;
  }

  for (const engineKey of [...ENGINES_TO_BACKTEST, 'random']) {
    const engineAgg = agg.engines[engineKey];
    if (!engineAgg) continue;

    console.log('\n' + '='.repeat(70));
    console.log(`  ${engineKey.toUpperCase()}`);
    console.log('='.repeat(70));
    console.log('  Period | Avg Return | Median     | SPY Avg    | Alpha      | Win%  | HitRateVsSPY | Cases');
    console.log('  ' + '-'.repeat(98));

    for (const period of ['1m', '3m', '6m', '12m']) {
      const s = engineAgg.periods[period];
      if (!s) {
        console.log(`  ${period.padEnd(6)} |   N/A      |   N/A      |   N/A      |   N/A      |  N/A  |     N/A      | 0`);
        continue;
      }
      console.log(
        `  ${period.padEnd(6)} |` +
        ` ${fmt(s.avgReturn).padStart(10)} |` +
        ` ${fmt(s.medianReturn).padStart(10)} |` +
        ` ${fmt(s.benchmarkReturn).padStart(10)} |` +
        ` ${fmt(s.alpha).padStart(10)} |` +
        ` ${String(s.winRate != null ? s.winRate + '%' : 'N/A').padStart(5)} |` +
        ` ${String(s.hitRateVsBenchmark != null ? s.hitRateVsBenchmark + '%' : 'N/A').padStart(11)}  |` +
        ` ${s.caseCount}`
      );
    }

    if (engineKey !== 'random') {
      console.log('\n  Score-Return correlation (Spearman):');
      for (const period of ['1m', '3m', '6m', '12m']) {
        const c = engineAgg.correlation[period];
        if (!c) continue;
        const rhoStr = c.rho != null ? c.rho.toFixed(4) : '    N/A ';
        console.log(`    ${period.padEnd(4)} rho=${rhoStr} pairs=${c.pairs}`);
      }
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(`  Total matches: ${agg.totalMatches} across ${agg.totalCases} cases`);
  console.log('='.repeat(70));
}

function fmt(v) {
  if (v == null) return '  N/A  ';
  const sign = v >= 0 ? '+' : '';
  return (sign + v.toFixed(2) + '%').padStart(9);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

if (require.main === module) {
  main().catch(err => {
    console.error('Proof generation failed:', err);
    process.exit(1);
  });
}

module.exports = {
  _test: {
    computeAggregate,
    computePerEngineAggregate,
    aggregateMatchesForPeriod,
    ENGINES_TO_BACKTEST,
  },
};
