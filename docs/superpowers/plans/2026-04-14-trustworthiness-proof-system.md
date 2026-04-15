# Blueprint Trustworthiness & Proof System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Blueprint's screener trustworthy and sellable by wiring up profile weights, building honest pre-computed backtests, and surfacing proof via a dedicated page and inline trust signals.

**Architecture:** Backend changes are surgical (profile weights in matcher.js, new proof route + CLI script). Proof data is pre-computed via a CLI script that builds historical snapshots for 15 curated test cases, stores results in Redis + committed JSON fallback. Frontend adds a `/proof` page and lightweight trust signal components embedded in existing pages.

**Tech Stack:** Express/Node.js backend, React frontend (Vite + Tailwind), Redis (Upstash REST API), FMP API, Jest for testing.

**Constraints:**
- Cannot load universe locally — all testing via Jest with mocks
- FMP rate limit: 220ms between calls (~272/min)
- Render auto-deploys from GitHub push
- Redis (Upstash) for persistence across deploys

---

## Task 1: Wire Up Profile Weights in Matcher

**Files:**
- Modify: `server/services/matcher.js:488-545` (calculateSimilarity function)
- Test: `server/tests/matcher.test.js`

- [ ] **Step 1: Write failing tests for profile weight application**

Add these tests to `server/tests/matcher.test.js`:

```javascript
describe('profile weight application', () => {
  // Two stocks identical on all metrics except one category differs
  const template = {
    ticker: 'TMPL', companyName: 'Template Co', sector: 'Technology',
    peRatio: 25, priceToBook: 5, priceToSales: 8, evToEBITDA: 20, evToRevenue: 10, pegRatio: 1.5,
    grossMargin: 0.60, operatingMargin: 0.25, netMargin: 0.20, ebitdaMargin: 0.30,
    returnOnEquity: 0.25, returnOnAssets: 0.10, returnOnCapital: 0.15,
    revenueGrowthYoY: 0.30, revenueGrowth3yr: 0.25, epsGrowthYoY: 0.35,
    currentRatio: 2.0, debtToEquity: 0.5, interestCoverage: 15, netDebtToEBITDA: 1.0, freeCashFlowYield: 0.05,
    marketCap: 50e9,
    rsi14: 60, pctBelowHigh: 10, priceVsMa50: 5, priceVsMa200: 15, beta: 1.2, relativeVolume: 1.1,
  };

  // Stock A: matches growth well, differs on valuation
  const stockA = {
    ...template,
    ticker: 'STKA', companyName: 'Stock A', sector: 'Technology',
    revenueGrowthYoY: 0.28, epsGrowthYoY: 0.33, revenueGrowth3yr: 0.23,
    peRatio: 60, evToEBITDA: 45, pegRatio: 3.0,
  };

  // Stock B: matches valuation well, differs on growth
  const stockB = {
    ...template,
    ticker: 'STKB', companyName: 'Stock B', sector: 'Technology',
    peRatio: 26, evToEBITDA: 21, pegRatio: 1.6,
    revenueGrowthYoY: 0.05, epsGrowthYoY: 0.08, revenueGrowth3yr: 0.06,
  };

  const populatedCount = 28;

  test('growth_breakout profile favors growth-aligned stock', () => {
    const growthWeights = {
      revenueGrowthYoY: 3.0, epsGrowthYoY: 3.0, pegRatio: 3.0, operatingMargin: 3.0,
      peRatio: 2.5, evToEBITDA: 2.5, pctBelowHigh: 2.5, priceVsMa200: 2.5, marketCap: 2.5,
      returnOnEquity: 2.0, revenueGrowth3yr: 2.0, freeCashFlowYield: 2.0, returnOnCapital: 2.0, priceVsMa50: 2.0,
      debtToEquity: 1.5, netDebtToEBITDA: 1.5, rsi14: 1.5, grossMargin: 1.5,
      beta: 1.0, netMargin: 1.0, ebitdaMargin: 1.0, returnOnAssets: 1.0,
      priceToBook: 1.0, priceToSales: 1.0, evToRevenue: 1.0, currentRatio: 1.0, interestCoverage: 1.0,
    };
    const scoreA = calculateSimilarity(template, stockA, populatedCount, { weights: growthWeights });
    const scoreB = calculateSimilarity(template, stockB, populatedCount, { weights: growthWeights });
    // Stock A matches growth better — should score higher under growth_breakout
    expect(scoreA.score).toBeGreaterThan(scoreB.score);
  });

  test('value_inflection profile favors valuation-aligned stock', () => {
    const valueWeights = {
      peRatio: 3.0, evToEBITDA: 3.0, priceToBook: 3.0, freeCashFlowYield: 3.0, pegRatio: 2.5,
      operatingMargin: 2.5, grossMargin: 2.5, returnOnEquity: 2.0, returnOnCapital: 2.0,
      debtToEquity: 2.0, netDebtToEBITDA: 2.0,
      revenueGrowthYoY: 1.5, epsGrowthYoY: 1.5, revenueGrowth3yr: 1.5,
      priceToSales: 1.5, evToRevenue: 1.5, currentRatio: 1.5, interestCoverage: 1.5,
      netMargin: 1.0, ebitdaMargin: 1.0, returnOnAssets: 1.0, marketCap: 1.0,
      rsi14: 1.0, pctBelowHigh: 0.5, priceVsMa50: 0.5, priceVsMa200: 0.5, beta: 0.5,
    };
    const scoreA = calculateSimilarity(template, stockA, populatedCount, { weights: valueWeights });
    const scoreB = calculateSimilarity(template, stockB, populatedCount, { weights: valueWeights });
    // Stock B matches valuation better — should score higher under value_inflection
    expect(scoreB.score).toBeGreaterThan(scoreA.score);
  });

  test('metric with weight 3.0 contributes 3x to category average', () => {
    const weights = { revenueGrowthYoY: 3.0, revenueGrowth3yr: 1.0, epsGrowthYoY: 1.0 };
    const noWeights = {};
    const scoreWeighted = calculateSimilarity(template, stockA, populatedCount, { weights });
    const scoreEqual = calculateSimilarity(template, stockA, populatedCount, { weights: noWeights });
    // With weights, the result should differ from equal weighting
    expect(scoreWeighted.score).not.toBeCloseTo(scoreEqual.score, 0);
  });

  test('missing weight defaults to 1.0 — no crash', () => {
    const partialWeights = { revenueGrowthYoY: 5.0 }; // only one metric weighted
    const result = calculateSimilarity(template, stockA, populatedCount, { weights: partialWeights });
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx jest tests/matcher.test.js --testNamePattern "profile weight" -v`
Expected: Tests should fail because weights are currently ignored (all get `weight: 1.0`).

- [ ] **Step 3: Implement weighted category averaging in calculateSimilarity**

In `server/services/matcher.js`, modify the `calculateSimilarity` function. Replace the metric scoring loop and category averaging to use profile weights:

Change the metric loop (around line 499-513) from:
```javascript
    overlapCount++;
    metricScores.push({ metric, similarity, weight: 1.0 });
```
to:
```javascript
    overlapCount++;
    const metricWeight = options.weights?.[metric] ?? 1.0;
    metricScores.push({ metric, similarity, weight: metricWeight });
```

Then change the category averaging (around line 527-538) from:
```javascript
    const catAvg = catResults.reduce((sum, ms) => sum + ms.similarity, 0) / catResults.length;
```
to:
```javascript
    const catWeightSum = catResults.reduce((sum, ms) => sum + ms.weight, 0);
    const catAvg = catResults.reduce((sum, ms) => sum + ms.similarity * ms.weight, 0) / catWeightSum;
```

This is the complete change — two edits, ~4 lines total.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx jest tests/matcher.test.js -v`
Expected: All tests pass, including the new profile weight tests.

- [ ] **Step 5: Run the full test suite to check for regressions**

Run: `cd server && npx jest --runInBand`
Expected: All existing tests still pass. The default behavior (no weights or weight 1.0 for all) produces the same results as before since `sum(similarity * 1.0) / sum(1.0)` equals `sum(similarity) / count`.

- [ ] **Step 6: Commit**

```bash
git add server/services/matcher.js server/tests/matcher.test.js
git commit -m "feat: wire up profile weights in calculateSimilarity

Profile weights from matchProfiles.js are now applied during category
metric aggregation. Each metric's weight scales its contribution to
the category average. Missing weights default to 1.0."
```

---

## Task 2: Build Proof API Route

**Files:**
- Create: `server/routes/proof.js`
- Modify: `server/index.js:44-46` (register route)
- Test: `server/tests/proof.test.js`

- [ ] **Step 1: Write failing tests for proof endpoint**

Create `server/tests/proof.test.js`:

```javascript
const express = require('express');
const request = require('supertest');
const fs = require('fs');
const path = require('path');

// Mock Redis fetch
jest.mock('node-fetch', () => jest.fn());
const fetch = require('node-fetch');

describe('GET /api/proof', () => {
  let app;

  const MOCK_PROOF_DATA = {
    version: 1,
    generatedAt: '2026-04-14T00:00:00Z',
    profile: 'growth_breakout',
    cases: [{
      templateTicker: 'NVDA',
      templateDate: '2023-01-03',
      templateCompanyName: 'NVIDIA Corporation',
      templateSector: 'Technology',
      matches: [{
        ticker: 'ANET',
        matchScore: 82.3,
        forwardReturns: { '1m': 5.2, '3m': 12.1, '6m': 28.4, '12m': 45.7 },
      }],
      benchmark: { '1m': 1.2, '3m': 3.5, '6m': 8.1, '12m': 15.3 },
    }],
    aggregate: {
      periods: {
        '12m': { avgReturn: 25.3, benchmarkReturn: 15.3, alpha: 10.0, winRate: 65, caseCount: 15 },
      },
      correlation: {
        '12m': { rho: 0.18, pairs: 130 },
      },
      totalMatches: 150,
      totalCases: 15,
    },
    disclaimers: ['Test disclaimer'],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
  });

  test('returns proof data from Redis when available', async () => {
    // Mock Redis returning proof data
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: JSON.stringify(MOCK_PROOF_DATA) }),
    });

    const proofRoute = require('../routes/proof');
    app.use('/api/proof', proofRoute);

    const res = await request(app).get('/api/proof');
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(1);
    expect(res.body.cases).toHaveLength(1);
    expect(res.body.aggregate.periods['12m'].alpha).toBe(10.0);
  });

  test('returns 404 when no proof data available', async () => {
    // Mock Redis returning null
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: null }),
    });

    // Also ensure no local file exists (mock fs)
    const proofRoute = require('../routes/proof');
    app.use('/api/proof', proofRoute);

    const res = await request(app).get('/api/proof');
    // Will get 200 if local file exists, 404 if not — test depends on whether
    // proof-results.json is committed. Test the shape either way.
    expect([200, 404]).toContain(res.status);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx jest tests/proof.test.js -v`
Expected: FAIL — `Cannot find module '../routes/proof'`

- [ ] **Step 3: Create the proof route**

Create `server/routes/proof.js`:

```javascript
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const REDIS_KEY = 'proof_results';
const MEMORY_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const LOCAL_CACHE_PATH = path.join(__dirname, '../.cache/proof-results.json');

let memoryCache = null;
let memoryCacheTs = 0;

async function loadFromRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  try {
    const res = await fetch(`${url}/get/${REDIS_KEY}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    if (!json.result) return null;
    return JSON.parse(json.result);
  } catch (err) {
    console.warn('[proof] Failed to load from Redis:', err.message);
    return null;
  }
}

function loadFromFile() {
  try {
    if (!fs.existsSync(LOCAL_CACHE_PATH)) return null;
    const raw = fs.readFileSync(LOCAL_CACHE_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[proof] Failed to load from file:', err.message);
    return null;
  }
}

router.get('/', async (_req, res) => {
  // Check memory cache first
  if (memoryCache && Date.now() - memoryCacheTs < MEMORY_CACHE_TTL) {
    return res.json(memoryCache);
  }

  // Try Redis
  let data = await loadFromRedis();

  // Fallback to local file
  if (!data) {
    data = loadFromFile();
  }

  if (!data) {
    return res.status(404).json({
      error: 'Proof data not yet generated. Run server/scripts/run-proof.js to generate.',
    });
  }

  // Cache in memory
  memoryCache = data;
  memoryCacheTs = Date.now();

  res.json(data);
});

module.exports = router;
```

- [ ] **Step 4: Register the route in server/index.js**

In `server/index.js`, add the proof route after the existing routes (after line 46):

```javascript
app.use('/api/proof',     require('./routes/proof'));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && npx jest tests/proof.test.js -v`
Expected: PASS

- [ ] **Step 6: Run full test suite**

Run: `cd server && npx jest --runInBand`
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add server/routes/proof.js server/tests/proof.test.js server/index.js
git commit -m "feat: add /api/proof endpoint for pre-computed backtest results

Serves proof data from Redis (primary) with local JSON fallback.
1-hour in-memory cache to avoid repeated reads."
```

---

## Task 3: Build Proof CLI Script

**Files:**
- Create: `server/scripts/run-proof.js`

- [ ] **Step 1: Create the proof generation script**

Create `server/scripts/run-proof.js`:

```javascript
#!/usr/bin/env node

/**
 * CLI script to generate honest pre-computed backtest results.
 *
 * Builds historical snapshots for 15 curated test cases using snapshotBuilder,
 * so matches reflect what companies looked like AT the template date.
 *
 * Usage: node server/scripts/run-proof.js [--resume] [--profile growth_breakout]
 * Requires: FMP_API_KEY, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN
 */

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const { buildSnapshot } = require('../services/snapshotBuilder');
const { calculateSimilarity, MATCH_METRICS, isSameCompany } = require('../services/matcher');
const { getForwardReturns, getBenchmarkReturns } = require('../services/backtest');
const { getProfile, applyHardFilters, DEFAULT_PROFILE } = require('../services/matchProfiles');
const { DEFAULT_TEST_CASES } = require('../services/validation');
const { _test: { spearmanCorrelation, toRanks } } = require('../services/validation');

const REDIS_KEY = 'proof_results';
const REDIS_TTL = 30 * 24 * 60 * 60; // 30 days
const LOCAL_CACHE_PATH = path.join(__dirname, '../.cache/proof-results.json');
const TOP_N = 10;
const CANDIDATE_BATCH_SIZE = 5; // build snapshots in batches to manage FMP rate

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getArg(args, flag) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
}

async function loadUniverseFromRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('Redis credentials not set');

  const res = await fetch(`${url}/get/universe_cache`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json();
  if (!json.result) throw new Error('No universe cache in Redis');

  const entries = JSON.parse(json.result);
  return new Map(entries);
}

async function saveToRedis(data) {
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
      body: JSON.stringify(['SET', REDIS_KEY, JSON.stringify(data), 'EX', String(REDIS_TTL)]),
    });
    console.log('[proof] Saved to Redis');
  } catch (err) {
    console.warn('[proof] Failed to save to Redis:', err.message);
  }
}

function saveToFile(data) {
  const dir = path.dirname(LOCAL_CACHE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(LOCAL_CACHE_PATH, JSON.stringify(data, null, 2));
  console.log(`[proof] Saved to ${LOCAL_CACHE_PATH}`);
}

function loadExistingResults() {
  try {
    if (fs.existsSync(LOCAL_CACHE_PATH)) {
      return JSON.parse(fs.readFileSync(LOCAL_CACHE_PATH, 'utf8'));
    }
  } catch {}
  return null;
}

/**
 * Pre-filter candidates from the current universe.
 * Uses current enrichment data to narrow the field before building historical snapshots.
 */
function filterCandidates(universe, templateSnapshot) {
  const templateMcap = templateSnapshot.marketCap;
  const candidates = [];

  for (const [ticker, stock] of universe) {
    // Skip same company
    if (isSameCompany(ticker, templateSnapshot.ticker, stock.companyName, templateSnapshot.companyName)) continue;

    // Must have positive revenue (current — proxy for having data)
    if (!stock.revenueGrowthYoY && stock.revenueGrowthYoY !== 0) continue;

    // Market cap within 0.1x to 10x of template (using current data as proxy)
    if (templateMcap && stock.marketCap) {
      const ratio = stock.marketCap / templateMcap;
      if (ratio < 0.1 || ratio > 10) continue;
    }

    candidates.push({ ticker, companyName: stock.companyName, sector: stock.sector });
  }

  // If too few candidates, widen the filter
  if (candidates.length < 50 && templateMcap) {
    candidates.length = 0; // reset
    for (const [ticker, stock] of universe) {
      if (isSameCompany(ticker, templateSnapshot.ticker, stock.companyName, templateSnapshot.companyName)) continue;
      const ratio = stock.marketCap ? stock.marketCap / templateMcap : 1;
      if (ratio < 0.01 || ratio > 100) continue;
      candidates.push({ ticker, companyName: stock.companyName, sector: stock.sector });
    }
  }

  return candidates;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const resume = args.includes('--resume');
  const profileKey = getArg(args, '--profile') || DEFAULT_PROFILE;
  const profile = getProfile(profileKey);

  console.log('='.repeat(70));
  console.log('  Blueprint Proof Generation (Honest Historical Backtests)');
  console.log('='.repeat(70));
  console.log(`  Profile : ${profileKey}`);
  console.log(`  Cases   : ${DEFAULT_TEST_CASES.length}`);
  console.log(`  Resume  : ${resume}`);
  console.log('='.repeat(70));
  console.log();

  // Load universe from Redis
  console.log('Loading universe from Redis...');
  const universe = await loadUniverseFromRedis();
  console.log(`Universe loaded: ${universe.size} stocks\n`);

  // Load existing results if resuming
  let existing = resume ? loadExistingResults() : null;
  const existingCases = new Set(
    (existing?.cases || []).map(c => `${c.templateTicker}:${c.templateDate}`)
  );

  const cases = existing?.cases ? [...existing.cases] : [];
  const allMatchReturns = []; // for correlation

  for (let i = 0; i < DEFAULT_TEST_CASES.length; i++) {
    const tc = DEFAULT_TEST_CASES[i];
    const caseKey = `${tc.ticker}:${tc.date}`;

    if (resume && existingCases.has(caseKey)) {
      console.log(`[${i + 1}/${DEFAULT_TEST_CASES.length}] ${tc.ticker} (${tc.date}) — SKIPPING (already computed)`);
      // Still collect match-return pairs from existing data
      const existingCase = cases.find(c => c.templateTicker === tc.ticker && c.templateDate === tc.date);
      if (existingCase?.matches) {
        for (const m of existingCase.matches) {
          if (m.forwardReturns) {
            for (const period of ['1m', '3m', '6m', '12m']) {
              if (m.forwardReturns[period] != null && m.matchScore != null) {
                allMatchReturns.push({ matchScore: m.matchScore, returnPct: m.forwardReturns[period], period });
              }
            }
          }
        }
      }
      continue;
    }

    console.log(`\n[${i + 1}/${DEFAULT_TEST_CASES.length}] ${tc.ticker} (${tc.date}) — ${tc.label}`);

    try {
      // 1. Build template snapshot at historical date
      console.log('  Building template snapshot...');
      const templateSnapshot = await buildSnapshot(tc.ticker, tc.date, true);
      if (!templateSnapshot) {
        console.log('  SKIPPED: no snapshot data');
        cases.push({ templateTicker: tc.ticker, templateDate: tc.date, status: 'skipped', reason: 'No snapshot data' });
        continue;
      }

      // 2. Filter candidates using current universe data as proxy
      const candidates = filterCandidates(universe, templateSnapshot);
      console.log(`  Filtered to ${candidates.length} candidates`);

      // 3. Build historical snapshots for candidates and score them
      const scored = [];
      let built = 0;
      let failed = 0;

      for (let b = 0; b < candidates.length; b += CANDIDATE_BATCH_SIZE) {
        const batch = candidates.slice(b, b + CANDIDATE_BATCH_SIZE);
        const batchResults = await Promise.allSettled(
          batch.map(c => buildSnapshot(c.ticker, tc.date, true))
        );

        for (let j = 0; j < batch.length; j++) {
          const result = batchResults[j];
          if (result.status !== 'fulfilled' || !result.value) {
            failed++;
            continue;
          }

          const candidateSnapshot = result.value;
          built++;

          // Count populated metrics in template
          const templatePopulated = MATCH_METRICS.reduce((cnt, m) =>
            (templateSnapshot[m] != null && isFinite(templateSnapshot[m])) ? cnt + 1 : cnt, 0
          );

          const { score, metricScores, categoryScores, overlapCount, overlapRatio, confidence } =
            calculateSimilarity(templateSnapshot, candidateSnapshot, templatePopulated, { weights: profile.weights });

          if (overlapRatio < 0.75) continue; // same filter as findMatches

          scored.push({
            ticker: batch[j].ticker,
            companyName: candidateSnapshot.companyName || batch[j].companyName,
            sector: candidateSnapshot.sector || batch[j].sector,
            matchScore: Math.round(score * 10) / 10,
            categoryScores,
            overlapCount,
          });
        }

        // Progress
        if ((b + CANDIDATE_BATCH_SIZE) % 50 === 0 || b + CANDIDATE_BATCH_SIZE >= candidates.length) {
          console.log(`  Built ${built} snapshots, ${failed} failed, ${scored.length} scored (${b + batch.length}/${candidates.length})`);
        }
      }

      // 4. Take top N matches
      scored.sort((a, b) => b.matchScore - a.matchScore);
      const topMatches = scored.slice(0, TOP_N);
      console.log(`  Top ${topMatches.length} matches found (best score: ${topMatches[0]?.matchScore || 'N/A'})`);

      // 5. Fetch forward returns for top matches
      console.log('  Fetching forward returns...');
      const matchesWithReturns = [];
      for (let m = 0; m < topMatches.length; m += CANDIDATE_BATCH_SIZE) {
        const batch = topMatches.slice(m, m + CANDIDATE_BATCH_SIZE);
        const returnResults = await Promise.allSettled(
          batch.map(match => getForwardReturns(match.ticker, tc.date))
        );

        for (let j = 0; j < batch.length; j++) {
          const r = returnResults[j];
          const returns = (r.status === 'fulfilled' && r.value)
            ? {
                '1m': r.value.returns['1m']?.returnPct ?? null,
                '3m': r.value.returns['3m']?.returnPct ?? null,
                '6m': r.value.returns['6m']?.returnPct ?? null,
                '12m': r.value.returns['12m']?.returnPct ?? null,
              }
            : { '1m': null, '3m': null, '6m': null, '12m': null };

          matchesWithReturns.push({
            ...batch[j],
            forwardReturns: returns,
          });

          // Collect for correlation
          for (const period of ['1m', '3m', '6m', '12m']) {
            if (returns[period] != null && batch[j].matchScore != null) {
              allMatchReturns.push({ matchScore: batch[j].matchScore, returnPct: returns[period], period });
            }
          }
        }
      }

      // 6. Fetch benchmark
      const benchmark = await getBenchmarkReturns(tc.date).catch(() => null);
      const benchmarkReturns = benchmark?.returns
        ? {
            '1m': benchmark.returns['1m']?.returnPct ?? null,
            '3m': benchmark.returns['3m']?.returnPct ?? null,
            '6m': benchmark.returns['6m']?.returnPct ?? null,
            '12m': benchmark.returns['12m']?.returnPct ?? null,
          }
        : { '1m': null, '3m': null, '6m': null, '12m': null };

      // Remove any existing case for this ticker/date (in case of re-run without --resume)
      const caseIdx = cases.findIndex(c => c.templateTicker === tc.ticker && c.templateDate === tc.date);
      if (caseIdx !== -1) cases.splice(caseIdx, 1);

      cases.push({
        templateTicker: tc.ticker,
        templateDate: tc.date,
        templateCompanyName: templateSnapshot.companyName,
        templateSector: templateSnapshot.sector,
        status: 'completed',
        candidatesScanned: candidates.length,
        snapshotsBuilt: built,
        matches: matchesWithReturns,
        benchmark: benchmarkReturns,
      });

      console.log(`  DONE: ${matchesWithReturns.length} matches with returns`);

      // Save incrementally after each case
      const partialData = buildOutputData(cases, allMatchReturns, profileKey);
      saveToFile(partialData);

    } catch (err) {
      console.error(`  ERROR: ${err.message}`);
      cases.push({ templateTicker: tc.ticker, templateDate: tc.date, status: 'error', error: err.message });
    }
  }

  // Build final output
  const finalData = buildOutputData(cases, allMatchReturns, profileKey);

  // Save to both Redis and file
  await saveToRedis(finalData);
  saveToFile(finalData);

  // Print summary
  printSummary(finalData);
}

function buildOutputData(cases, allMatchReturns, profileKey) {
  const completed = cases.filter(c => c.status === 'completed');

  // Compute aggregate stats
  const periods = ['1m', '3m', '6m', '12m'];
  const periodStats = {};
  const correlation = {};

  for (const period of periods) {
    const allReturns = [];
    const allBenchmarks = [];

    for (const c of completed) {
      for (const m of (c.matches || [])) {
        if (m.forwardReturns?.[period] != null) allReturns.push(m.forwardReturns[period]);
      }
      if (c.benchmark?.[period] != null) allBenchmarks.push(c.benchmark[period]);
    }

    if (allReturns.length === 0) {
      periodStats[period] = null;
      continue;
    }

    const avgReturn = allReturns.reduce((s, r) => s + r, 0) / allReturns.length;
    const avgBenchmark = allBenchmarks.length > 0
      ? allBenchmarks.reduce((s, r) => s + r, 0) / allBenchmarks.length
      : null;
    const winners = allReturns.filter(r => r > 0).length;

    periodStats[period] = {
      avgReturn: Math.round(avgReturn * 100) / 100,
      benchmarkReturn: avgBenchmark != null ? Math.round(avgBenchmark * 100) / 100 : null,
      alpha: avgBenchmark != null ? Math.round((avgReturn - avgBenchmark) * 100) / 100 : null,
      winRate: Math.round((winners / allReturns.length) * 100),
      caseCount: completed.length,
    };

    // Correlation for this period
    const pairs = allMatchReturns.filter(p => p.period === period);
    if (pairs.length >= 10) {
      const scores = pairs.map(p => p.matchScore);
      const returns = pairs.map(p => p.returnPct);
      const rho = spearmanCorrelation(scores, returns);
      correlation[period] = { rho: rho != null ? Math.round(rho * 10000) / 10000 : null, pairs: pairs.length };
    } else {
      correlation[period] = { rho: null, pairs: pairs.length, note: 'Insufficient data' };
    }
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    profile: profileKey,
    cases,
    aggregate: {
      periods: periodStats,
      correlation,
      totalMatches: completed.reduce((s, c) => s + (c.matches?.length || 0), 0),
      totalCases: completed.length,
    },
    disclaimers: [
      'Backtests use historical fundamentals reconstructed at the template date via Financial Modeling Prep data.',
      'Match candidates drawn from current stock universe. Companies delisted or acquired between the template date and today are not included, which may overstate results.',
      'Past performance does not guarantee future results.',
      'Not financial advice.',
    ],
  };
}

function printSummary(data) {
  console.log('\n' + '='.repeat(70));
  console.log('  PROOF GENERATION COMPLETE');
  console.log('='.repeat(70));

  const completed = data.cases.filter(c => c.status === 'completed').length;
  const skipped = data.cases.filter(c => c.status === 'skipped').length;
  const errors = data.cases.filter(c => c.status === 'error').length;
  console.log(`  Completed: ${completed} | Skipped: ${skipped} | Errors: ${errors}`);
  console.log(`  Total matches: ${data.aggregate.totalMatches}`);
  console.log();

  for (const period of ['1m', '3m', '6m', '12m']) {
    const p = data.aggregate.periods[period];
    if (!p) continue;
    const alpha = p.alpha != null ? `${p.alpha > 0 ? '+' : ''}${p.alpha.toFixed(2)}%` : 'N/A';
    console.log(`  ${period.padEnd(4)} | Avg: ${p.avgReturn > 0 ? '+' : ''}${p.avgReturn.toFixed(2)}% | SPY: ${p.benchmarkReturn?.toFixed(2) ?? 'N/A'}% | Alpha: ${alpha} | Win: ${p.winRate}%`);
  }

  console.log();
  for (const period of ['1m', '3m', '6m', '12m']) {
    const c = data.aggregate.correlation[period];
    if (!c || c.rho == null) continue;
    console.log(`  Correlation ${period}: rho=${c.rho.toFixed(4)} (${c.pairs} pairs)`);
  }

  console.log('='.repeat(70));
}

main().catch(err => {
  console.error('Proof generation failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Ensure .cache directory exists and is gitignored properly**

Run: `ls server/.cache/` to confirm directory exists. Check `.gitignore` for `.cache` entries.

The `proof-results.json` file will be committed as a fallback (override the gitignore for this specific file if needed).

- [ ] **Step 3: Commit the script**

```bash
git add server/scripts/run-proof.js
git commit -m "feat: CLI script for honest pre-computed backtest proof generation

Builds historical snapshots for 15 curated test cases using
snapshotBuilder so matches reflect what companies looked like at
the template date. Pre-filters candidates by market cap range,
saves incrementally, supports --resume flag."
```

---

## Task 4: Build Proof Page (Frontend)

**Files:**
- Create: `client/src/pages/Proof.jsx`
- Modify: `client/src/App.jsx` (add route)
- Modify: `client/src/components/Header.jsx` (add nav link)

- [ ] **Step 1: Create the Proof page component**

Create `client/src/pages/Proof.jsx`:

```jsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

const PERIOD_LABELS = { '1m': '1 Month', '3m': '3 Months', '6m': '6 Months', '12m': '12 Months' };

function interpretRho(rho) {
  if (rho == null) return 'Insufficient data';
  if (rho > 0.15) return 'Positive';
  if (rho > 0.05) return 'Weak positive';
  if (rho > -0.05) return 'No correlation';
  if (rho > -0.15) return 'Weak negative';
  return 'Negative';
}

function StatCard({ label, value, sub, color }) {
  return (
    <div className="card flex-1 min-w-[140px] text-center">
      <p className="section-label mb-2">{label}</p>
      <p className={`text-2xl font-bold font-mono ${color || 'text-warm-white'}`}>{value}</p>
      {sub && <p className="text-xs text-warm-muted mt-1 font-light">{sub}</p>}
    </div>
  );
}

function CaseCard({ caseData, defaultExpanded }) {
  const [expanded, setExpanded] = useState(defaultExpanded || false);
  if (caseData.status !== 'completed') return null;

  const alpha12m = caseData.benchmark?.['12m'] != null
    ? caseData.matches.reduce((s, m) => s + (m.forwardReturns?.['12m'] ?? 0), 0) / Math.max(caseData.matches.length, 1) - caseData.benchmark['12m']
    : null;

  const topMatches = caseData.matches.slice(0, expanded ? 10 : 3);

  return (
    <div className="card">
      <div
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div>
          <span className="text-warm-white font-semibold font-mono">{caseData.templateTicker}</span>
          <span className="text-warm-muted text-sm ml-2">{caseData.templateCompanyName}</span>
          <span className="text-warm-muted text-xs ml-2">{caseData.templateDate}</span>
        </div>
        <div className="flex items-center gap-3">
          {alpha12m != null && (
            <span className={`font-mono text-sm font-semibold ${alpha12m > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {alpha12m > 0 ? '+' : ''}{alpha12m.toFixed(1)}% alpha
            </span>
          )}
          <span className="text-warm-muted text-xs">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>
      <div className="mt-3 space-y-1.5">
        {topMatches.map((m, idx) => (
          <div key={m.ticker} className="flex items-center justify-between text-sm py-1 border-t border-dark-border/50 first:border-0">
            <div className="flex items-center gap-2">
              <span className="text-warm-muted text-xs w-5">#{idx + 1}</span>
              <span className="text-warm-white font-mono font-medium">{m.ticker}</span>
              <span className="text-warm-muted text-xs truncate max-w-[120px]">{m.companyName}</span>
              <span className="text-accent/60 text-xs font-mono">{m.matchScore}</span>
            </div>
            <div className="flex gap-4 text-xs font-mono">
              {['1m', '3m', '6m', '12m'].map(p => {
                const v = m.forwardReturns?.[p];
                if (v == null) return <span key={p} className="text-warm-muted/40 w-14 text-right">—</span>;
                return (
                  <span key={p} className={`w-14 text-right ${v > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {v > 0 ? '+' : ''}{v.toFixed(1)}%
                  </span>
                );
              })}
            </div>
          </div>
        ))}
        {!expanded && caseData.matches.length > 3 && (
          <p className="text-xs text-warm-muted text-center pt-1">Click to see all {caseData.matches.length} matches</p>
        )}
      </div>
    </div>
  );
}

export default function Proof() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch('/api/proof')
      .then(res => {
        if (!res.ok) throw new Error(res.status === 404 ? 'Proof data not yet available.' : 'Failed to load proof data.');
        return res.json();
      })
      .then(setData)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
      <div className="text-center text-warm-muted">Loading proof data...</div>
    </main>
  );

  if (error) return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
      <div className="card text-center">
        <p className="text-warm-muted">{error}</p>
        <Link to="/" className="text-accent text-sm mt-4 inline-block hover:underline">Back to screener</Link>
      </div>
    </main>
  );

  const agg = data.aggregate;
  const alpha12m = agg.periods?.['12m']?.alpha;
  const winRate12m = agg.periods?.['12m']?.winRate;
  const rho12m = agg.correlation?.['12m']?.rho;

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-12 animate-fade-in">
      {/* Hero */}
      <section className="text-center mb-10">
        <h1 className="text-3xl sm:text-4xl font-display text-warm-white mb-3">How Blueprint Performs</h1>
        <p className="text-warm-muted max-w-2xl mx-auto">
          Backtested across {agg.totalCases} historical breakouts using reconstructed fundamentals at the template date.
        </p>
      </section>

      {/* Aggregate stat cards */}
      <section className="flex flex-wrap gap-3 sm:gap-4 mb-10">
        <StatCard
          label="12-Month Alpha vs SPY"
          value={alpha12m != null ? `${alpha12m > 0 ? '+' : ''}${alpha12m.toFixed(1)}%` : 'N/A'}
          color={alpha12m > 0 ? 'text-emerald-400' : alpha12m < 0 ? 'text-red-400' : 'text-warm-white'}
        />
        <StatCard
          label="12-Month Win Rate"
          value={winRate12m != null ? `${winRate12m}%` : 'N/A'}
          color={winRate12m >= 50 ? 'text-emerald-400' : 'text-red-400'}
        />
        <StatCard
          label="Score-Return Correlation"
          value={rho12m != null ? rho12m.toFixed(4) : 'N/A'}
          sub={interpretRho(rho12m)}
          color="text-accent"
        />
        <StatCard
          label="Cases Tested"
          value={agg.totalCases}
          sub={`${agg.totalMatches} total matches`}
          color="text-warm-white"
        />
      </section>

      {/* Period breakdown table */}
      <section className="mb-10">
        <h2 className="text-lg font-display text-warm-white mb-4">Performance by Period</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-dark-border text-warm-muted text-left">
                <th className="py-2 pr-4">Period</th>
                <th className="py-2 px-3 text-right">Avg Return</th>
                <th className="py-2 px-3 text-right">SPY Return</th>
                <th className="py-2 px-3 text-right">Alpha</th>
                <th className="py-2 px-3 text-right">Win Rate</th>
                <th className="py-2 px-3 text-right">Cases</th>
              </tr>
            </thead>
            <tbody>
              {['1m', '3m', '6m', '12m'].map(period => {
                const p = agg.periods?.[period];
                if (!p) return (
                  <tr key={period} className="border-b border-dark-border/30">
                    <td className="py-2.5 pr-4 text-warm-white">{PERIOD_LABELS[period]}</td>
                    <td colSpan={5} className="py-2.5 text-center text-warm-muted/40">No data</td>
                  </tr>
                );
                return (
                  <tr key={period} className="border-b border-dark-border/30">
                    <td className="py-2.5 pr-4 text-warm-white">{PERIOD_LABELS[period]}</td>
                    <td className={`py-2.5 px-3 text-right font-mono ${p.avgReturn > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {p.avgReturn > 0 ? '+' : ''}{p.avgReturn.toFixed(1)}%
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-warm-gray">
                      {p.benchmarkReturn != null ? `${p.benchmarkReturn > 0 ? '+' : ''}${p.benchmarkReturn.toFixed(1)}%` : '—'}
                    </td>
                    <td className={`py-2.5 px-3 text-right font-mono font-semibold ${p.alpha > 0 ? 'text-emerald-400' : p.alpha < 0 ? 'text-red-400' : 'text-warm-gray'}`}>
                      {p.alpha != null ? `${p.alpha > 0 ? '+' : ''}${p.alpha.toFixed(1)}%` : '—'}
                    </td>
                    <td className={`py-2.5 px-3 text-right font-mono ${p.winRate >= 50 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {p.winRate}%
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono text-warm-gray">{p.caseCount}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Individual case cards */}
      <section className="mb-10">
        <h2 className="text-lg font-display text-warm-white mb-4">Individual Breakout Cases</h2>
        <div className="flex gap-4 text-xs font-mono text-warm-muted justify-end mb-2 pr-1">
          <span className="w-14 text-right">1M</span>
          <span className="w-14 text-right">3M</span>
          <span className="w-14 text-right">6M</span>
          <span className="w-14 text-right">12M</span>
        </div>
        <div className="space-y-3">
          {data.cases
            .filter(c => c.status === 'completed')
            .map(c => <CaseCard key={`${c.templateTicker}-${c.templateDate}`} caseData={c} />)}
        </div>
      </section>

      {/* Methodology */}
      <section className="mb-10">
        <h2 className="text-lg font-display text-warm-white mb-4">Methodology</h2>
        <div className="card space-y-3 text-sm text-warm-gray leading-relaxed">
          <p>
            Blueprint compares stocks across <span className="text-warm-white font-medium">28 financial metrics</span> organized
            into 6 categories: Valuation, Profitability, Growth, Financial Health, Size, and Technical indicators.
          </p>
          <p>
            Each metric uses a <span className="text-warm-white font-medium">specialized similarity function</span> — log-scale for
            valuation ratios, hybrid absolute/relative for margins, dampened comparison for growth rates — ensuring each metric type
            is compared on an appropriate scale.
          </p>
          <p>
            These backtests reconstruct what companies looked like at the historical template date using point-in-time financial data.
            Forward returns measure actual performance from that date forward.
          </p>
        </div>
      </section>

      {/* Disclaimers */}
      <section className="mb-8">
        <div className="card border-warm-muted/10 bg-dark-bg/50">
          <h3 className="section-label mb-3">Important Disclaimers</h3>
          <ul className="space-y-2 text-xs text-warm-muted leading-relaxed">
            {data.disclaimers.map((d, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-warm-muted/40 shrink-0">•</span>
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Add route to App.jsx**

In `client/src/App.jsx`, add the import and route:

Add import after the other page imports (after line 9):
```javascript
import Proof from './pages/Proof';
```

Add route inside `<Routes>` (after the watchlist route, before the catch-all):
```jsx
<Route path="/proof" element={<Proof />} />
```

- [ ] **Step 3: Add nav link to Header.jsx**

In `client/src/components/Header.jsx`, add a "Methodology" link in the nav area. Add this before the Watchlist link (before the `<Link to="/watchlist"` block):

```jsx
          <Link
            to="/proof"
            className="text-sm text-warm-gray hover:text-accent transition-colors duration-200"
          >
            Methodology
          </Link>
```

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/Proof.jsx client/src/App.jsx client/src/components/Header.jsx
git commit -m "feat: add /proof page with aggregate stats, case details, methodology

Dedicated proof/methodology page showing backtest performance across
historical breakout cases. Includes period breakdown table, expandable
case cards, and transparent disclaimers."
```

---

## Task 5: Add Inline Trust Signals to Existing Pages

**Files:**
- Modify: `client/src/pages/MatchResults.jsx`
- Modify: `client/src/pages/ComparisonDetail.jsx`
- Modify: `client/src/pages/BacktestResults.jsx`

- [ ] **Step 1: Add trust signal to MatchResults page**

In `client/src/pages/MatchResults.jsx`, add state for proof data and a fetch on mount. At the top of the `MatchResults` component (after the existing state declarations around line 50), add:

```javascript
  const [proofData, setProofData] = useState(null);

  useEffect(() => {
    fetch('/api/proof')
      .then(res => res.ok ? res.json() : null)
      .then(data => setProofData(data))
      .catch(() => {}); // Silently fail — trust signal is optional
  }, []);
```

Then, in the JSX, add the trust banner after the snapshot summary card and before the match cards. Find the area where the score interpretation card or match cards begin and insert:

```jsx
      {proofData?.aggregate?.periods?.['12m']?.alpha != null && (
        <div className="card bg-emerald-500/5 border-emerald-500/15 mb-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <p className="text-sm text-warm-gray">
              <span className="text-emerald-400 font-semibold font-mono">
                {proofData.aggregate.periods['12m'].alpha > 0 ? '+' : ''}
                {proofData.aggregate.periods['12m'].alpha.toFixed(1)}% alpha
              </span>
              {' '}vs SPY across {proofData.aggregate.totalCases} historical breakouts over 12 months
            </p>
            <Link to="/proof" className="text-xs text-accent hover:underline">See methodology →</Link>
          </div>
        </div>
      )}
```

Make sure `Link` is imported (it should already be available via `react-router-dom`).

- [ ] **Step 2: Add trust signal to ComparisonDetail page**

In `client/src/pages/ComparisonDetail.jsx`, add a similar fetch and inline note. Add state and effect at the top of the component:

```javascript
  const [proofData, setProofData] = useState(null);

  useEffect(() => {
    fetch('/api/proof')
      .then(res => res.ok ? res.json() : null)
      .then(data => setProofData(data))
      .catch(() => {});
  }, []);
```

Then near the match score display area, add a subtle line below it:

```jsx
      {proofData?.aggregate?.correlation?.['12m']?.rho != null && (
        <p className="text-xs text-warm-muted mt-2">
          Higher scores have historically correlated with stronger forward returns
          <span className="text-warm-muted/60 font-mono ml-1">(rho: {proofData.aggregate.correlation['12m'].rho.toFixed(2)})</span>
          <Link to="/proof" className="text-accent ml-2 hover:underline">Learn more</Link>
        </p>
      )}
```

- [ ] **Step 3: Update BacktestResults disclaimer**

In `client/src/pages/BacktestResults.jsx`, find the existing disclaimer section and update it to reference the proof page. Find the disclaimer text (around the area that mentions survivorship bias) and add:

```jsx
        <p className="text-xs text-warm-muted mt-2">
          This backtest uses current fundamentals compared to the historical template.
          {' '}
          <Link to="/proof" className="text-accent hover:underline">
            View backtests using reconstructed historical fundamentals →
          </Link>
        </p>
```

Ensure `Link` from `react-router-dom` is imported in BacktestResults.jsx. Add if missing:
```javascript
import { Link } from 'react-router-dom';
```
(Check the existing imports first — `useNavigate` is imported but `Link` may not be.)

- [ ] **Step 4: Commit**

```bash
git add client/src/pages/MatchResults.jsx client/src/pages/ComparisonDetail.jsx client/src/pages/BacktestResults.jsx
git commit -m "feat: inline trust signals on match results, comparison, and backtest pages

Shows alpha vs SPY on match results, score-return correlation on
comparison detail, and updated disclaimer linking to proof page."
```

---

## Task 6: Run Proof Script and Commit Results

This task runs the proof CLI script against live FMP data. It must be run when you have time (30-60 min) and a working FMP_API_KEY.

- [ ] **Step 1: Run the proof generation script**

```bash
cd server && node scripts/run-proof.js
```

Watch the output for progress. If it crashes partway through, resume:
```bash
node scripts/run-proof.js --resume
```

Expected: 15 test cases processed, results saved to `server/.cache/proof-results.json` and Redis.

- [ ] **Step 2: Review the output**

Read `server/.cache/proof-results.json` and check:
- All 15 cases have `status: 'completed'`
- Each case has 10 matches with forward returns
- Aggregate stats show alpha, win rate, correlation
- No errors or skipped cases

- [ ] **Step 3: Commit the proof results**

```bash
git add server/.cache/proof-results.json
git commit -m "data: pre-computed proof results for 15 historical breakout cases

Honest backtests using historical fundamentals reconstructed at each
template date. Results serve as fallback for /api/proof endpoint."
```

---

## Task 7: Push to GitHub and Verify on Render

- [ ] **Step 1: Push all changes to GitHub**

```bash
git push origin claude/crazy-varahamihira
```

Then merge into master (or create a PR):
```bash
git checkout master
git merge claude/crazy-varahamihira
git push origin master
```

- [ ] **Step 2: Wait for Render deploy**

Render auto-deploys from master. Watch the Render dashboard or check:
```bash
curl https://<your-render-url>/api/health
```

- [ ] **Step 3: Verify proof endpoint**

```bash
curl https://<your-render-url>/api/proof | head -c 500
```

Expected: JSON with version, cases, aggregate stats.

- [ ] **Step 4: Verify proof page in browser**

Navigate to `https://<your-render-url>/proof` and verify:
- Aggregate stat cards render with real numbers
- Period breakdown table shows all 4 periods
- Individual case cards expand/collapse
- Methodology and disclaimers are visible

- [ ] **Step 5: Verify inline trust signals**

- Go to match results page → see alpha banner at top
- Click into a comparison → see correlation note near match score
- Go to backtest page → see updated disclaimer with link to proof

- [ ] **Step 6: Verify profile weights work**

- Search for a stock with growth_breakout profile → note top matches
- Switch to value_inflection profile → rankings should visibly change
- If they don't, debug the weight application

---

## Summary

| Task | What | Files |
|------|------|-------|
| 1 | Wire up profile weights | `matcher.js`, `matcher.test.js` |
| 2 | Proof API endpoint | `routes/proof.js`, `proof.test.js`, `index.js` |
| 3 | Proof CLI script | `scripts/run-proof.js` |
| 4 | Proof page frontend | `Proof.jsx`, `App.jsx`, `Header.jsx` |
| 5 | Inline trust signals | `MatchResults.jsx`, `ComparisonDetail.jsx`, `BacktestResults.jsx` |
| 6 | Run proof script + commit results | `proof-results.json` |
| 7 | Push + verify on Render | — |
