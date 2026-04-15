#!/usr/bin/env node

/**
 * CLI script for generating honest pre-computed backtest proof results.
 *
 * Builds historical snapshots for 15 curated test cases, scores candidates
 * from the universe, fetches forward returns, and computes aggregate stats.
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
const { buildSnapshot } = require('../services/snapshotBuilder');
const { calculateSimilarity, MATCH_METRICS, isSameCompany } = require('../services/matcher');
const { getForwardReturns, getBenchmarkReturns } = require('../services/backtest');
const { getProfile, DEFAULT_PROFILE } = require('../services/matchProfiles');
const { DEFAULT_TEST_CASES } = require('../services/validation');
const { _test: { spearmanCorrelation } } = require('../services/validation');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CANDIDATE_BATCH_SIZE = 5;
const TOP_N = 10;
const REDIS_PROOF_KEY = 'proof_results';
const REDIS_PROOF_TTL = 2592000; // 30 days
const CACHE_DIR = path.join(__dirname, '..', '.cache');
const CACHE_FILE = path.join(CACHE_DIR, 'proof-results.json');

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
// Pre-filter candidates from universe by market cap and positive revenue
// ---------------------------------------------------------------------------

function preFilterCandidates(universe, templateSnapshot) {
  const templateMcap = templateSnapshot.marketCap;
  if (!templateMcap || templateMcap <= 0) {
    // No market cap filter — just require positive revenue
    const filtered = new Map();
    for (const [ticker, stock] of universe) {
      if (stock.revenueGrowthYoY != null) filtered.set(ticker, stock);
    }
    return filtered;
  }

  // First pass: 0.1x–10x market cap + positive revenue
  let filtered = new Map();
  const loTight = templateMcap * 0.1;
  const hiTight = templateMcap * 10;

  for (const [ticker, stock] of universe) {
    const mcap = stock.marketCap;
    if (mcap && mcap >= loTight && mcap <= hiTight && stock.revenueGrowthYoY != null) {
      filtered.set(ticker, stock);
    }
  }

  // Widen if too few candidates
  if (filtered.size < 50) {
    filtered = new Map();
    const loWide = templateMcap * 0.01;
    const hiWide = templateMcap * 100;
    for (const [ticker, stock] of universe) {
      const mcap = stock.marketCap;
      if (mcap && mcap >= loWide && mcap <= hiWide && stock.revenueGrowthYoY != null) {
        filtered.set(ticker, stock);
      }
    }
  }

  return filtered;
}

// ---------------------------------------------------------------------------
// Process a single test case
// ---------------------------------------------------------------------------

async function processCase(tc, universe, profileConfig, onProgress) {
  const weights = profileConfig?.weights ?? {};

  // 1. Build template snapshot at historical date
  onProgress(`  Building template snapshot for ${tc.ticker} @ ${tc.date}...`);
  const templateSnapshot = await buildSnapshot(tc.ticker, tc.date, true);

  if (!templateSnapshot) {
    onProgress(`  SKIP: No snapshot data for ${tc.ticker}`);
    return { ...tc, status: 'skipped', reason: 'No snapshot data' };
  }

  // 2. Pre-filter candidates
  const candidates = preFilterCandidates(universe, templateSnapshot);
  onProgress(`  ${candidates.size} candidates after market-cap + revenue filter`);

  // 3. Extract template metrics and count populated fields
  const template = {};
  let populatedCount = 0;
  for (const metric of MATCH_METRICS) {
    if (templateSnapshot[metric] != null && isFinite(templateSnapshot[metric])) {
      template[metric] = templateSnapshot[metric];
      populatedCount++;
    }
  }
  // Copy identifying fields
  template.ticker = templateSnapshot.ticker;
  template.companyName = templateSnapshot.companyName;
  template.sector = templateSnapshot.sector;

  if (populatedCount < 4) {
    onProgress(`  SKIP: Only ${populatedCount} metrics populated`);
    return { ...tc, status: 'skipped', reason: `Only ${populatedCount} metrics` };
  }

  // 4. Build historical snapshots for candidates and score them (batched)
  const candidateTickers = Array.from(candidates.keys()).filter(
    t => !isSameCompany(t, tc.ticker, candidates.get(t)?.companyName, templateSnapshot.companyName)
  );

  const scored = [];
  let snapshotsBuilt = 0;

  for (let i = 0; i < candidateTickers.length; i += CANDIDATE_BATCH_SIZE) {
    const batch = candidateTickers.slice(i, i + CANDIDATE_BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map(t => buildSnapshot(t, tc.date, true))
    );

    for (let j = 0; j < batch.length; j++) {
      const result = batchResults[j];
      if (result.status !== 'fulfilled' || !result.value) continue;

      snapshotsBuilt++;
      const snap = result.value;
      const sim = calculateSimilarity(template, snap, populatedCount, { weights });

      if (sim.score > 0 && sim.overlapCount >= 4) {
        scored.push({
          ticker: snap.ticker || batch[j],
          companyName: snap.companyName || '',
          sector: snap.sector || '',
          matchScore: Math.round(sim.score * 10) / 10,
          categoryScores: sim.categoryScores,
          overlapCount: sim.overlapCount,
        });
      }
    }

    if (i + CANDIDATE_BATCH_SIZE < candidateTickers.length) {
      onProgress(`  ... ${Math.min(i + CANDIDATE_BATCH_SIZE, candidateTickers.length)}/${candidateTickers.length} candidates scored`);
    }
  }

  // 5. Sort by score and take top N
  scored.sort((a, b) => b.matchScore - a.matchScore);
  const topMatches = scored.slice(0, TOP_N);

  onProgress(`  ${snapshotsBuilt} snapshots built, ${scored.length} scored, top ${topMatches.length} selected`);

  if (topMatches.length === 0) {
    return {
      templateTicker: tc.ticker,
      templateDate: tc.date,
      templateCompanyName: templateSnapshot.companyName || tc.ticker,
      templateSector: templateSnapshot.sector || '',
      status: 'completed',
      candidatesScanned: candidates.size,
      snapshotsBuilt,
      matches: [],
      benchmark: null,
    };
  }

  // 6. Fetch forward returns for top matches (batched)
  onProgress(`  Fetching forward returns for ${topMatches.length} matches...`);
  for (let i = 0; i < topMatches.length; i += CANDIDATE_BATCH_SIZE) {
    const batch = topMatches.slice(i, i + CANDIDATE_BATCH_SIZE);
    const returnResults = await Promise.allSettled(
      batch.map(m => getForwardReturns(m.ticker, tc.date))
    );

    for (let j = 0; j < batch.length; j++) {
      const result = returnResults[j];
      if (result.status === 'fulfilled' && result.value) {
        const r = result.value.returns;
        batch[j].forwardReturns = {
          '1m': r['1m']?.returnPct ?? null,
          '3m': r['3m']?.returnPct ?? null,
          '6m': r['6m']?.returnPct ?? null,
          '12m': r['12m']?.returnPct ?? null,
        };
      } else {
        batch[j].forwardReturns = { '1m': null, '3m': null, '6m': null, '12m': null };
      }
    }
  }

  // 7. Fetch SPY benchmark returns
  onProgress(`  Fetching SPY benchmark...`);
  let benchmark = { '1m': null, '3m': null, '6m': null, '12m': null };
  try {
    const spy = await getBenchmarkReturns(tc.date);
    if (spy?.returns) {
      benchmark = {
        '1m': spy.returns['1m']?.returnPct ?? null,
        '3m': spy.returns['3m']?.returnPct ?? null,
        '6m': spy.returns['6m']?.returnPct ?? null,
        '12m': spy.returns['12m']?.returnPct ?? null,
      };
    }
  } catch {
    onProgress(`  WARNING: Failed to fetch SPY benchmark`);
  }

  return {
    templateTicker: tc.ticker,
    templateDate: tc.date,
    templateCompanyName: templateSnapshot.companyName || tc.ticker,
    templateSector: templateSnapshot.sector || '',
    status: 'completed',
    candidatesScanned: candidates.size,
    snapshotsBuilt,
    matches: topMatches,
    benchmark,
  };
}

// ---------------------------------------------------------------------------
// Aggregate statistics
// ---------------------------------------------------------------------------

function computeAggregateStats(cases) {
  const periods = ['1m', '3m', '6m', '12m'];
  const completedCases = cases.filter(c => c.status === 'completed' && c.matches?.length > 0);

  const periodStats = {};
  const correlationData = {};

  for (const period of periods) {
    const caseReturns = [];
    const scorePairs = [];

    for (const cs of completedCases) {
      const returns = cs.matches
        .map(m => m.forwardReturns?.[period])
        .filter(r => r != null);

      if (returns.length === 0) continue;

      const avg = returns.reduce((s, r) => s + r, 0) / returns.length;
      const winners = returns.filter(r => r > 0).length;
      const winRate = Math.round((winners / returns.length) * 100);

      caseReturns.push({
        avgReturn: avg,
        benchmark: cs.benchmark?.[period],
        winRate,
      });

      // Collect score-return pairs for correlation
      for (const m of cs.matches) {
        const ret = m.forwardReturns?.[period];
        if (ret != null && m.matchScore != null) {
          scorePairs.push({ score: m.matchScore, ret });
        }
      }
    }

    if (caseReturns.length > 0) {
      const avgReturn = caseReturns.reduce((s, c) => s + c.avgReturn, 0) / caseReturns.length;
      const benchmarks = caseReturns.filter(c => c.benchmark != null);
      const benchmarkReturn = benchmarks.length > 0
        ? benchmarks.reduce((s, c) => s + c.benchmark, 0) / benchmarks.length
        : null;
      const avgWinRate = caseReturns.reduce((s, c) => s + c.winRate, 0) / caseReturns.length;

      periodStats[period] = {
        avgReturn: round2(avgReturn),
        benchmarkReturn: round2(benchmarkReturn),
        alpha: benchmarkReturn != null ? round2(avgReturn - benchmarkReturn) : null,
        winRate: Math.round(avgWinRate),
        caseCount: caseReturns.length,
      };
    }

    // Correlation
    if (scorePairs.length >= 10) {
      const scores = scorePairs.map(p => p.score);
      const rets = scorePairs.map(p => p.ret);
      const rho = spearmanCorrelation(scores, rets);
      correlationData[period] = { rho: round4(rho), pairs: scorePairs.length };
    } else {
      correlationData[period] = { rho: null, pairs: scorePairs.length };
    }
  }

  const totalMatches = completedCases.reduce((s, c) => s + c.matches.length, 0);

  return {
    periods: periodStats,
    correlation: correlationData,
    totalMatches,
    totalCases: completedCases.length,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const profile = getArg(args, '--profile') || DEFAULT_PROFILE;
  const resume = hasFlag(args, '--resume');

  console.log('='.repeat(70));
  console.log('  Blueprint Proof Generator');
  console.log('='.repeat(70));
  console.log(`  Profile : ${profile}`);
  console.log(`  Cases   : ${DEFAULT_TEST_CASES.length}`);
  console.log(`  Top N   : ${TOP_N}`);
  console.log(`  Resume  : ${resume}`);
  console.log('='.repeat(70));
  console.log();

  // Validate env
  if (!process.env.FMP_API_KEY) {
    console.error('ERROR: FMP_API_KEY is required');
    process.exit(1);
  }

  // Load profile
  const profileConfig = getProfile(profile);
  if (!profileConfig) {
    console.error(`ERROR: Unknown profile "${profile}"`);
    process.exit(1);
  }

  // Load universe from Redis
  console.log('Loading universe from Redis...');
  const universe = await loadUniverseFromRedis();
  console.log(`Universe loaded: ${universe.size} stocks\n`);

  // Load existing results for --resume
  let existingCases = [];
  if (resume) {
    const existing = loadLocal();
    if (existing?.cases) {
      existingCases = existing.cases.filter(c => c.status === 'completed');
      console.log(`Resuming: ${existingCases.length} completed cases found on disk\n`);
    }
  }

  // Build the output structure incrementally
  const output = {
    version: 1,
    generatedAt: new Date().toISOString(),
    profile,
    cases: [...existingCases],
    aggregate: null,
    disclaimers: [
      'Backtests use historical fundamentals reconstructed at the template date via Financial Modeling Prep data.',
      'Match candidates drawn from current stock universe. Companies delisted or acquired between the template date and today are not included, which may overstate results.',
      'Past performance does not guarantee future results.',
      'Not financial advice.',
    ],
  };

  // Process each test case
  const completedTickers = new Set(existingCases.map(c => `${c.templateTicker}:${c.templateDate}`));

  for (let i = 0; i < DEFAULT_TEST_CASES.length; i++) {
    const tc = DEFAULT_TEST_CASES[i];
    const key = `${tc.ticker}:${tc.date}`;

    if (completedTickers.has(key)) {
      console.log(`[${i + 1}/${DEFAULT_TEST_CASES.length}] ${tc.ticker} (${tc.date}) — SKIPPED (already completed)`);
      continue;
    }

    console.log(`[${i + 1}/${DEFAULT_TEST_CASES.length}] ${tc.ticker} (${tc.date}) — ${tc.label}`);

    try {
      const caseResult = await processCase(tc, universe, profileConfig, msg => console.log(msg));

      output.cases.push(caseResult);
      completedTickers.add(key);

      const matchCount = caseResult.matches?.length ?? 0;
      console.log(`  => ${caseResult.status}: ${matchCount} matches\n`);

      // Incremental save after each case (crash recovery)
      output.generatedAt = new Date().toISOString();
      output.aggregate = computeAggregateStats(output.cases);
      saveLocal(output);

    } catch (err) {
      console.error(`  ERROR on ${tc.ticker}: ${err.message}\n`);
      output.cases.push({
        templateTicker: tc.ticker,
        templateDate: tc.date,
        templateCompanyName: tc.ticker,
        templateSector: '',
        status: 'error',
        error: err.message,
        matches: [],
        benchmark: null,
      });
      saveLocal(output);
    }
  }

  // Final aggregate computation
  output.generatedAt = new Date().toISOString();
  output.aggregate = computeAggregateStats(output.cases);

  // Save to local file and Redis
  saveLocal(output);
  console.log(`\nResults saved to: ${CACHE_FILE}`);

  await saveProofToRedis(output);

  // Print summary
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

  console.log('\n' + '='.repeat(70));
  console.log('  AGGREGATE RESULTS');
  console.log('='.repeat(70));
  console.log('  Period | Matches Avg | SPY Avg    | Alpha      | Win Rate | Cases');
  console.log('  ' + '-'.repeat(66));

  for (const period of ['1m', '3m', '6m', '12m']) {
    const s = agg.periods[period];
    if (!s) {
      console.log(`  ${period.padEnd(6)} |   N/A       |   N/A      |   N/A      |   N/A    | 0`);
      continue;
    }
    console.log(
      `  ${period.padEnd(6)} |` +
      ` ${fmt(s.avgReturn).padStart(11)} |` +
      ` ${fmt(s.benchmarkReturn).padStart(10)} |` +
      ` ${fmt(s.alpha).padStart(10)} |` +
      ` ${String(s.winRate != null ? s.winRate + '%' : 'N/A').padStart(8)} |` +
      ` ${s.caseCount}`
    );
  }

  console.log('\n' + '-'.repeat(70));
  console.log('  SCORE-RETURN CORRELATION (Spearman)');
  console.log('-'.repeat(70));
  console.log('  Period | rho      | Pairs');
  console.log('  ' + '-'.repeat(30));

  for (const period of ['1m', '3m', '6m', '12m']) {
    const c = agg.correlation[period];
    if (!c) continue;
    const rhoStr = c.rho != null ? c.rho.toFixed(4).padStart(8) : '     N/A';
    console.log(`  ${period.padEnd(6)} | ${rhoStr} | ${c.pairs}`);
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

main().catch(err => {
  console.error('Proof generation failed:', err);
  process.exit(1);
});
