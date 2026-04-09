# TTM Data Alignment + Transparent Scoring Rewrite

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the matching algorithm trustworthy by aligning snapshot and universe data to the same TTM basis, and replacing opaque normalization with direct percentage difference scoring.

**Architecture:** The snapshot route is rewritten to fetch quarterly financial data and reconstruct TTM values as of the snapshot date. The matcher is rewritten to use direct percentage difference instead of median/IQR + tanh normalization. Sector is removed from scoring and added as an optional filter on the matches route.

**Tech Stack:** Node.js, Express, Jest, FMP API (Financial Modeling Prep)

---

### Task 1: Rewrite matcher.js — direct percentage difference scoring

The matcher is the core of the system. Rewrite it first so all subsequent changes build on the new scoring foundation.

**Files:**
- Modify: `server/services/matcher.js` (full rewrite of scoring logic)
- Modify: `server/tests/matcher.test.js` (rewrite tests for new behavior)

- [ ] **Step 1: Write failing tests for new percentage difference scoring**

Replace the entire contents of `server/tests/matcher.test.js` with:

```js
const { findMatches, MATCH_METRICS } = require('../services/matcher');

const makeStock = (ticker, overrides = {}) => ({
  ticker,
  companyName: `${ticker} Corp`,
  sector: 'Technology',
  price: 100,
  peRatio: 20,
  priceToBook: 3.0,
  priceToSales: 2.5,
  evToEBITDA: 12.0,
  evToRevenue: 3.0,
  pegRatio: 1.5,
  earningsYield: 0.05,
  grossMargin: 0.5,
  operatingMargin: 0.2,
  netMargin: 0.15,
  ebitdaMargin: 0.25,
  returnOnEquity: 0.18,
  returnOnAssets: 0.1,
  returnOnCapital: 0.14,
  revenueGrowthYoY: 0.2,
  revenueGrowth3yr: 0.18,
  epsGrowthYoY: 0.22,
  currentRatio: 1.8,
  debtToEquity: 0.5,
  interestCoverage: 8.0,
  netDebtToEBITDA: 1.2,
  freeCashFlowYield: 0.04,
  rsi14: 50,
  pctBelowHigh: 10,
  priceVsMa50: 2.0,
  priceVsMa200: 8.0,
  marketCap: 10_000_000_000,
  ...overrides,
});

describe('findMatches — basic behavior', () => {
  const snapshot = makeStock('TMPL');

  test('returns at most 10 results', () => {
    const universe = new Map();
    for (let i = 0; i < 20; i++) universe.set(`STK${i}`, makeStock(`STK${i}`));
    const results = findMatches(snapshot, universe);
    expect(results.length).toBeLessThanOrEqual(10);
  });

  test('results are sorted by matchScore descending', () => {
    const universe = new Map();
    for (let i = 0; i < 15; i++) {
      universe.set(`STK${i}`, makeStock(`STK${i}`, { peRatio: 20 + i * 3 }));
    }
    const results = findMatches(snapshot, universe);
    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].matchScore).toBeGreaterThanOrEqual(results[i + 1].matchScore);
    }
  });

  test('excludes the snapshot ticker from results', () => {
    const universe = new Map();
    universe.set('TMPL', makeStock('TMPL'));
    universe.set('OTHER', makeStock('OTHER', { peRatio: 25 }));
    const results = findMatches(snapshot, universe);
    expect(results.find(r => r.ticker === 'TMPL')).toBeUndefined();
  });

  test('each result has required shape', () => {
    const universe = new Map();
    universe.set('A', makeStock('A'));
    const results = findMatches(snapshot, universe);
    expect(results[0]).toMatchObject({
      ticker: expect.any(String),
      companyName: expect.any(String),
      sector: expect.any(String),
      price: expect.any(Number),
      matchScore: expect.any(Number),
      metricsCompared: expect.any(Number),
      topMatches: expect.any(Array),
      topDifferences: expect.any(Array),
    });
  });

  test('does not throw when metrics are null', () => {
    const universe = new Map();
    universe.set('SPARSE', makeStock('SPARSE', { peRatio: null, rsi14: null, grossMargin: null }));
    expect(() => findMatches(snapshot, universe)).not.toThrow();
  });

  test('returns empty when snapshot has fewer than 4 metrics', () => {
    const sparse = { ticker: 'TMPL', peRatio: 20, grossMargin: 0.5, rsi14: 50 };
    const universe = new Map();
    universe.set('A', makeStock('A'));
    expect(findMatches(sparse, universe)).toEqual([]);
  });
});

describe('findMatches — percentage difference scoring', () => {
  test('identical stock scores 100', () => {
    const snapshot = makeStock('SNAP');
    const universe = new Map();
    universe.set('TWIN', makeStock('TWIN'));
    const results = findMatches(snapshot, universe);
    expect(results[0].matchScore).toBe(100);
  });

  test('stock with 10% higher P/E scores lower than identical stock', () => {
    const snapshot = makeStock('SNAP');
    const universe = new Map();
    universe.set('TWIN', makeStock('TWIN'));
    universe.set('CLOSE', makeStock('CLOSE', { peRatio: 22 })); // 10% higher
    const results = findMatches(snapshot, universe);
    const twin = results.find(r => r.ticker === 'TWIN');
    const close = results.find(r => r.ticker === 'CLOSE');
    expect(twin.matchScore).toBeGreaterThan(close.matchScore);
  });

  test('stock with doubled P/E scores much lower', () => {
    const snapshot = makeStock('SNAP', { peRatio: 50 });
    const universe = new Map();
    universe.set('CLOSE', makeStock('CLOSE', { peRatio: 55 }));  // 10% off
    universe.set('FAR', makeStock('FAR', { peRatio: 100 }));     // 50% off
    const results = findMatches(snapshot, universe);
    const close = results.find(r => r.ticker === 'CLOSE');
    const far = results.find(r => r.ticker === 'FAR');
    expect(close.matchScore).toBeGreaterThan(far.matchScore);
    // With old tanh, both would compress to ~99% similar. Now they must differ meaningfully.
    expect(close.matchScore - far.matchScore).toBeGreaterThanOrEqual(1);
  });

  test('sector does NOT affect scoring', () => {
    const snapshot = makeStock('SNAP', { sector: 'Technology' });
    const universe = new Map();
    universe.set('SAME', makeStock('SAME', { sector: 'Technology' }));
    universe.set('DIFF', makeStock('DIFF', { sector: 'Healthcare' }));
    const results = findMatches(snapshot, universe);
    const same = results.find(r => r.ticker === 'SAME');
    const diff = results.find(r => r.ticker === 'DIFF');
    // Identical metrics, different sector — scores should be equal
    expect(same.matchScore).toBe(diff.matchScore);
  });

  test('marketCap uses log-scale comparison', () => {
    // $10B vs $20B (2x) should be more similar than $10B vs $100B (10x)
    const snapshot = makeStock('SNAP', { marketCap: 10_000_000_000 });
    const universe = new Map();
    universe.set('DOUBLE', makeStock('DOUBLE', { marketCap: 20_000_000_000 }));
    universe.set('TENFOLD', makeStock('TENFOLD', { marketCap: 100_000_000_000 }));
    const results = findMatches(snapshot, universe);
    const dbl = results.find(r => r.ticker === 'DOUBLE');
    const tenX = results.find(r => r.ticker === 'TENFOLD');
    expect(dbl.matchScore).toBeGreaterThan(tenX.matchScore);
  });

  test('metricsCompared equals number of metrics with data on both sides', () => {
    const snapshot = makeStock('SNAP');
    const universe = new Map();
    universe.set('SPARSE', makeStock('SPARSE', { peRatio: null, grossMargin: null, rsi14: null }));
    const results = findMatches(snapshot, universe);
    expect(results[0].metricsCompared).toBe(24);
  });

  test('overlap penalty reduces score for sparse matches', () => {
    const snapshot = makeStock('SNAP');
    const universe = new Map();
    universe.set('FULL', makeStock('FULL'));
    universe.set('SPARSE', makeStock('SPARSE', {
      peRatio: null, priceToBook: null, priceToSales: null,
      evToEBITDA: null, evToRevenue: null, pegRatio: null,
      earningsYield: null, rsi14: null, pctBelowHigh: null,
    }));
    const results = findMatches(snapshot, universe);
    const full = results.find(r => r.ticker === 'FULL');
    const sparse = results.find(r => r.ticker === 'SPARSE');
    expect(full.matchScore).toBeGreaterThan(sparse.matchScore);
  });

  test('filters out stocks below 60% overlap', () => {
    const snapshot = makeStock('SNAP');
    const universe = new Map();
    // Stock with only 8 of 27 metrics (< 30% overlap) — should be excluded
    universe.set('TOOSPARSE', {
      ticker: 'TOOSPARSE', companyName: 'Too Sparse', sector: 'Tech', price: 100,
      peRatio: 20, grossMargin: 0.5, revenueGrowthYoY: 0.2, rsi14: 50,
      currentRatio: 1.8, debtToEquity: 0.5, netMargin: 0.15, operatingMargin: 0.2,
    });
    const results = findMatches(snapshot, universe);
    expect(results.find(r => r.ticker === 'TOOSPARSE')).toBeUndefined();
  });

  test('opposite sign values score 0% similarity for that metric', () => {
    const snapshot = makeStock('SNAP', { revenueGrowthYoY: 0.30 });
    const universe = new Map();
    universe.set('NEG', makeStock('NEG', { revenueGrowthYoY: -0.30 }));
    const results = findMatches(snapshot, universe);
    const neg = results.find(r => r.ticker === 'NEG');
    // revenueGrowthYoY should appear in topDifferences
    expect(neg.topDifferences).toContain('revenueGrowthYoY');
  });
});

describe('findMatches — MATCH_METRICS', () => {
  test('marketCap is included in MATCH_METRICS', () => {
    expect(MATCH_METRICS).toContain('marketCap');
  });

  test('MATCH_METRICS has 27 entries', () => {
    expect(MATCH_METRICS).toHaveLength(27);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx jest tests/matcher.test.js --verbose 2>&1 | tail -30`

Expected: Several tests fail (especially "identical stock scores 100", "sector does NOT affect scoring", and the percentage difference tests) because the old normalization-based algorithm is still in place.

- [ ] **Step 3: Rewrite matcher.js with direct percentage difference**

Replace the entire contents of `server/services/matcher.js` with:

```js
const MATCH_METRICS = [
  // Valuation
  'peRatio', 'priceToBook', 'priceToSales', 'evToEBITDA', 'evToRevenue', 'pegRatio', 'earningsYield',
  // Profitability
  'grossMargin', 'operatingMargin', 'netMargin', 'ebitdaMargin',
  'returnOnEquity', 'returnOnAssets', 'returnOnCapital',
  // Growth
  'revenueGrowthYoY', 'revenueGrowth3yr', 'epsGrowthYoY',
  // Financial Health
  'currentRatio', 'debtToEquity', 'interestCoverage', 'netDebtToEBITDA', 'freeCashFlowYield',
  // Size
  'marketCap',
  // Technical
  'rsi14', 'pctBelowHigh', 'priceVsMa50', 'priceVsMa200',
];

const METRIC_WEIGHTS = {
  // Valuation
  peRatio: 1.5, priceToBook: 1.0, priceToSales: 1.0,
  evToEBITDA: 1.5, evToRevenue: 1.0, pegRatio: 1.5, earningsYield: 1.0,
  // Profitability
  grossMargin: 1.5, operatingMargin: 2.0, netMargin: 1.5, ebitdaMargin: 1.0,
  returnOnEquity: 2.0, returnOnAssets: 1.5, returnOnCapital: 1.5,
  // Growth — highest weight
  revenueGrowthYoY: 2.5, revenueGrowth3yr: 2.5, epsGrowthYoY: 2.0,
  // Financial Health
  currentRatio: 1.0, debtToEquity: 1.5, interestCoverage: 1.0,
  netDebtToEBITDA: 1.5, freeCashFlowYield: 1.5,
  // Size
  marketCap: 1.5,
  // Technical — lower weight
  rsi14: 0.5, pctBelowHigh: 0.5, priceVsMa50: 0.5, priceVsMa200: 0.5,
};

const MIN_OVERLAP_RATIO = 0.6;
const EPSILON = 0.01;

Object.freeze(MATCH_METRICS);

function metricSimilarity(metric, snapVal, stockVal) {
  if (snapVal == null || stockVal == null || !isFinite(snapVal) || !isFinite(stockVal)) {
    return null;
  }

  // Market cap: use log-scale comparison since values span orders of magnitude
  if (metric === 'marketCap') {
    if (snapVal <= 0 || stockVal <= 0) return null;
    const logSnap = Math.log10(snapVal);
    const logStock = Math.log10(stockVal);
    const diff = Math.abs(logSnap - logStock) / Math.max(Math.abs(logSnap), Math.abs(logStock));
    return Math.max(0, 1 - diff);
  }

  // Direct percentage difference for all other metrics
  const denominator = Math.max(Math.abs(snapVal), Math.abs(stockVal), EPSILON);
  const diff = Math.abs(snapVal - stockVal) / denominator;
  return Math.max(0, 1 - diff);
}

function calculateSimilarity(snapshot, stock, snapshotPopulatedCount) {
  let score = 0;
  let totalWeight = 0;
  let overlapCount = 0;
  const metricScores = [];

  for (const metric of MATCH_METRICS) {
    const weight = METRIC_WEIGHTS[metric] ?? 1.0;
    const similarity = metricSimilarity(metric, snapshot[metric], stock[metric]);

    if (similarity === null) continue;

    overlapCount++;
    score += similarity * weight;
    totalWeight += weight;
    metricScores.push({ metric, similarity });
  }

  if (totalWeight === 0) {
    return { score: 0, metricScores: [], overlapCount: 0, overlapRatio: 0 };
  }

  let baseScore = (score / totalWeight) * 100;

  const overlapRatio = snapshotPopulatedCount > 0
    ? overlapCount / snapshotPopulatedCount
    : 0;
  baseScore *= Math.sqrt(overlapRatio);

  const finalScore = Math.max(0, Math.min(100, baseScore));
  return { score: finalScore, metricScores, overlapCount, overlapRatio };
}

function findMatches(snapshot, universe, limit = 10) {
  if (!snapshot || universe.size === 0) return [];

  const snapshotPopulatedCount = MATCH_METRICS.reduce((count, metric) => {
    const v = snapshot[metric];
    return (v != null && isFinite(v)) ? count + 1 : count;
  }, 0);

  if (snapshotPopulatedCount < 4) return [];

  const allStocks = Array.from(universe.values());

  const results = allStocks
    .filter(stock => stock.ticker !== snapshot.ticker)
    .map(stock => {
      const { score, metricScores, overlapCount, overlapRatio } =
        calculateSimilarity(snapshot, stock, snapshotPopulatedCount);

      const ranked = [...metricScores].sort((a, b) => b.similarity - a.similarity);
      const topMatches = ranked.slice(0, 3).map(m => m.metric);
      const topDifferences = ranked.slice(-3).reverse().map(m => m.metric);

      return {
        ...stock,
        _rawScore: score,
        _overlapRatio: overlapRatio,
        matchScore: Math.round(score),
        metricsCompared: overlapCount,
        topMatches,
        topDifferences,
      };
    })
    .filter(r => r._overlapRatio >= MIN_OVERLAP_RATIO)
    .sort((a, b) => b._rawScore - a._rawScore)
    .slice(0, limit)
    .map(({ _rawScore, _overlapRatio, ...rest }) => rest);

  return results;
}

module.exports = { findMatches, MATCH_METRICS };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx jest tests/matcher.test.js --verbose 2>&1 | tail -40`

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/services/matcher.js server/tests/matcher.test.js
git commit -m "feat: rewrite matcher with direct percentage difference scoring

Replace median/IQR + tanh normalization with direct percentage difference.
Remove sector from scoring. Add log-scale comparison for marketCap."
```

---

### Task 2: Add sector filter to matches route

**Files:**
- Modify: `server/routes/matches.js`
- Modify: `server/tests/matches.test.js`

- [ ] **Step 1: Write failing test for sector filter**

Replace the entire contents of `server/tests/matches.test.js` with:

```js
jest.mock('../services/universe');
const universe = require('../services/universe');
const request = require('supertest');
const app = require('../index');

const makeStock = (ticker, overrides = {}) => ({
  ticker,
  companyName: `${ticker} Corp`,
  sector: 'Technology',
  price: 150,
  peRatio: 25,
  priceToBook: 3.0,
  priceToSales: 2.5,
  evToEBITDA: 12.0,
  evToRevenue: 3.0,
  pegRatio: 1.5,
  earningsYield: 0.05,
  grossMargin: 0.6,
  operatingMargin: 0.2,
  netMargin: 0.15,
  ebitdaMargin: 0.25,
  returnOnEquity: 0.18,
  returnOnAssets: 0.1,
  returnOnCapital: 0.14,
  revenueGrowthYoY: 0.2,
  revenueGrowth3yr: 0.18,
  epsGrowthYoY: 0.22,
  currentRatio: 1.8,
  debtToEquity: 0.5,
  interestCoverage: 8.0,
  netDebtToEBITDA: 1.2,
  freeCashFlowYield: 0.04,
  marketCap: 20_000_000_000,
  rsi14: 55,
  pctBelowHigh: 8,
  priceVsMa50: 2.0,
  priceVsMa200: 8.0,
  ...overrides,
});

const mockUniverse = new Map();
for (let i = 0; i < 10; i++) mockUniverse.set(`TECH${i}`, makeStock(`TECH${i}`));
for (let i = 0; i < 5; i++) mockUniverse.set(`HLTH${i}`, makeStock(`HLTH${i}`, { sector: 'Healthcare' }));

beforeEach(() => {
  universe.isReady.mockReturnValue(true);
  universe.getCache.mockReturnValue(mockUniverse);
});

describe('GET /api/matches', () => {
  test('returns 400 when ticker or date missing', async () => {
    const res = await request(app).get('/api/matches');
    expect(res.status).toBe(400);
  });

  test('returns 503 when cache not ready', async () => {
    universe.isReady.mockReturnValue(false);
    const res = await request(app).get('/api/matches?ticker=NVDA&date=2019-06-15');
    expect(res.status).toBe(503);
  });

  test('returns array of up to 10 match results', async () => {
    const res = await request(app).get('/api/matches?ticker=NVDA&date=2019-06-15&peRatio=25&grossMargin=0.6&revenueGrowthYoY=0.2&rsi14=55');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeLessThanOrEqual(10);
  });

  test('each result has matchScore, topMatches, topDifferences', async () => {
    const res = await request(app).get('/api/matches?ticker=NVDA&date=2019-06-15&peRatio=25&grossMargin=0.6&revenueGrowthYoY=0.2&rsi14=55');
    for (const item of res.body) {
      expect(typeof item.matchScore).toBe('number');
      expect(Array.isArray(item.topMatches)).toBe(true);
      expect(Array.isArray(item.topDifferences)).toBe(true);
    }
  });

  test('sector filter returns only matching sector stocks', async () => {
    const res = await request(app).get('/api/matches?ticker=NVDA&date=2019-06-15&peRatio=25&grossMargin=0.6&revenueGrowthYoY=0.2&rsi14=55&sector=Healthcare');
    expect(res.status).toBe(200);
    for (const item of res.body) {
      expect(item.sector).toBe('Healthcare');
    }
  });

  test('without sector filter returns all sectors', async () => {
    const res = await request(app).get('/api/matches?ticker=NVDA&date=2019-06-15&peRatio=25&grossMargin=0.6&revenueGrowthYoY=0.2&rsi14=55');
    expect(res.status).toBe(200);
    const sectors = new Set(res.body.map(r => r.sector));
    expect(sectors.size).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run tests to verify sector filter test fails**

Run: `cd server && npx jest tests/matches.test.js --verbose 2>&1 | tail -20`

Expected: The "sector filter returns only matching sector stocks" test fails.

- [ ] **Step 3: Add sector filter to matches route**

Replace the entire contents of `server/routes/matches.js` with:

```js
const express = require('express');
const router = express.Router();
const { getCache, isReady } = require('../services/universe');
const { findMatches, MATCH_METRICS } = require('../services/matcher');

router.get('/', async (req, res) => {
  const { ticker, date, sector } = req.query;
  if (!ticker || !date)
    return res.status(400).json({ error: 'ticker and date are required' });

  if (!isReady())
    return res.status(503).json({ error: 'Stock universe cache is still loading. Please try again in a moment.' });

  const snapshot = { ticker: ticker.toUpperCase() };
  for (const metric of MATCH_METRICS) {
    const val = req.query[metric];
    snapshot[metric] = val !== undefined && val !== '' ? parseFloat(val) : null;
  }

  try {
    let universe = getCache();

    // Optional sector filter — only match against stocks in the same sector
    if (sector) {
      const filtered = new Map();
      for (const [key, stock] of universe) {
        if (stock.sector === sector) filtered.set(key, stock);
      }
      universe = filtered;
    }

    const matches = findMatches(snapshot, universe);
    res.json(matches);
  } catch (err) {
    console.error('[matches] Error:', err.message);
    res.status(500).json({ error: 'Failed to find matches' });
  }
});

module.exports = router;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx jest tests/matches.test.js --verbose 2>&1 | tail -20`

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/routes/matches.js server/tests/matches.test.js
git commit -m "feat: add optional sector filter to matches endpoint

Sector is now a filter (query param), not a scoring factor.
Pass ?sector=Technology to restrict matches to that sector."
```

---

### Task 3: Add period parameter to FMP API functions

**Files:**
- Modify: `server/services/fmp.js`

- [ ] **Step 1: Update FMP functions to accept period parameter**

In `server/services/fmp.js`, make the following changes:

**Change `getIncomeStatements`** (line 91-94) from:
```js
async function getIncomeStatements(ticker, limit = 10, throttle = true) {
  const data = await fmpGet(`/income-statement`, { symbol: ticker, period: 'annual', limit }, throttle);
  return Array.isArray(data) ? data : [];
}
```
to:
```js
async function getIncomeStatements(ticker, limit = 10, throttle = true, period = 'annual') {
  const data = await fmpGet(`/income-statement`, { symbol: ticker, period, limit }, throttle);
  return Array.isArray(data) ? data : [];
}
```

**Change `getKeyMetricsAnnual`** (line 96-99) from:
```js
async function getKeyMetricsAnnual(ticker, throttle = true) {
  const data = await fmpGet(`/key-metrics`, { symbol: ticker, period: 'annual', limit: 15 }, throttle);
  return Array.isArray(data) ? data : [];
}
```
to:
```js
async function getKeyMetricsAnnual(ticker, throttle = true, period = 'annual', limit = 15) {
  const data = await fmpGet(`/key-metrics`, { symbol: ticker, period, limit }, throttle);
  return Array.isArray(data) ? data : [];
}
```

**Change `getRatiosAnnual`** (line 101-104) from:
```js
async function getRatiosAnnual(ticker, throttle = true) {
  const data = await fmpGet(`/ratios`, { symbol: ticker, period: 'annual', limit: 10 }, throttle);
  return Array.isArray(data) ? data : [];
}
```
to:
```js
async function getRatiosAnnual(ticker, throttle = true, period = 'annual', limit = 10) {
  const data = await fmpGet(`/ratios`, { symbol: ticker, period, limit }, throttle);
  return Array.isArray(data) ? data : [];
}
```

**Change `getBalanceSheet`** (line 118-121) from:
```js
async function getBalanceSheet(ticker, limit = 1, throttle = true) {
  const data = await fmpGet(`/balance-sheet-statement`, { symbol: ticker, period: 'annual', limit }, throttle);
  return Array.isArray(data) ? data : [];
}
```
to:
```js
async function getBalanceSheet(ticker, limit = 1, throttle = true, period = 'annual') {
  const data = await fmpGet(`/balance-sheet-statement`, { symbol: ticker, period, limit }, throttle);
  return Array.isArray(data) ? data : [];
}
```

**Change `getCashFlowStatement`** (line 123-126) from:
```js
async function getCashFlowStatement(ticker, limit = 1, throttle = true) {
  const data = await fmpGet(`/cash-flow-statement`, { symbol: ticker, period: 'annual', limit }, throttle);
  return Array.isArray(data) ? data : [];
}
```
to:
```js
async function getCashFlowStatement(ticker, limit = 1, throttle = true, period = 'annual') {
  const data = await fmpGet(`/cash-flow-statement`, { symbol: ticker, period, limit }, throttle);
  return Array.isArray(data) ? data : [];
}
```

- [ ] **Step 2: Verify existing callers still work (all pass 'annual' by default)**

Run: `cd server && npx jest --verbose 2>&1 | tail -30`

Expected: All existing tests pass. The default `period = 'annual'` preserves existing behavior for all callers (universe.js, snapshot.js).

- [ ] **Step 3: Commit**

```bash
git add server/services/fmp.js
git commit -m "feat: add period parameter to FMP financial data functions

All functions default to 'annual' for backwards compatibility.
Pass 'quarter' to fetch quarterly data for TTM construction."
```

---

### Task 4: Rewrite snapshot.js to use quarterly TTM data

This is the most complex task. The snapshot route must fetch quarterly data and reconstruct TTM values.

**Files:**
- Modify: `server/routes/snapshot.js` (major rewrite)
- Modify: `server/tests/snapshot.test.js` (update mocks for quarterly data)

- [ ] **Step 1: Write failing tests for quarterly TTM snapshot**

Replace the entire contents of `server/tests/snapshot.test.js` with:

```js
jest.mock('../services/fmp');
const fmp = require('../services/fmp');
const request = require('supertest');
const app = require('../index');

// 8 quarters of income data, newest first — simulating FY ending Jan
const mockQuarterlyIncome = [
  { date: '2023-10-29', revenue: 18120e6, grossProfit: 13400e6, operatingIncome: 10417e6, netIncome: 9243e6, ebitda: 11200e6, eps: 3.71 },
  { date: '2023-07-30', revenue: 13507e6, grossProfit: 9462e6,  operatingIncome: 6800e6,  netIncome: 6188e6,  ebitda: 7500e6,  eps: 2.48 },
  { date: '2023-04-30', revenue: 7192e6,  grossProfit: 4648e6,  operatingIncome: 2903e6,  netIncome: 2043e6,  ebitda: 3200e6,  eps: 0.82 },
  { date: '2023-01-29', revenue: 6051e6,  grossProfit: 3833e6,  operatingIncome: 1769e6,  netIncome: 1414e6,  ebitda: 2100e6,  eps: 0.57 },
  { date: '2022-10-30', revenue: 5931e6,  grossProfit: 3177e6,  operatingIncome: 601e6,   netIncome: 680e6,   ebitda: 1200e6,  eps: 0.27 },
  { date: '2022-07-31', revenue: 6704e6,  grossProfit: 2915e6,  operatingIncome: 499e6,   netIncome: 656e6,   ebitda: 1100e6,  eps: 0.26 },
  { date: '2022-04-30', revenue: 8288e6,  grossProfit: 5431e6,  operatingIncome: 3052e6,  netIncome: 1618e6,  ebitda: 3500e6,  eps: 0.64 },
  { date: '2022-01-30', revenue: 7643e6,  grossProfit: 4980e6,  operatingIncome: 2970e6,  netIncome: 3003e6,  ebitda: 3400e6,  eps: 1.18 },
];

// Quarterly key metrics
const mockQuarterlyMetrics = [
  { date: '2023-10-29', evToEBITDA: 60.5, evToSales: 30.2, earningsYield: 0.02, returnOnEquity: 0.91, returnOnAssets: 0.35, returnOnInvestedCapital: 0.50, netDebtToEBITDA: -0.5, freeCashFlowYield: 0.015, marketCap: 1200e9, currentRatio: 4.17 },
  { date: '2023-07-30', evToEBITDA: 55.0, evToSales: 25.0, earningsYield: 0.025, returnOnEquity: 0.70, returnOnAssets: 0.30, returnOnInvestedCapital: 0.40, netDebtToEBITDA: -0.3, freeCashFlowYield: 0.018, marketCap: 1100e9, currentRatio: 3.50 },
  { date: '2023-04-30', evToEBITDA: 100.0, evToSales: 20.0, earningsYield: 0.01, returnOnEquity: 0.30, returnOnAssets: 0.12, returnOnInvestedCapital: 0.18, netDebtToEBITDA: 0.5, freeCashFlowYield: 0.010, marketCap: 700e9, currentRatio: 3.00 },
  { date: '2023-01-29', evToEBITDA: 120.0, evToSales: 18.0, earningsYield: 0.008, returnOnEquity: 0.20, returnOnAssets: 0.10, returnOnInvestedCapital: 0.15, netDebtToEBITDA: 1.0, freeCashFlowYield: 0.008, marketCap: 400e9, currentRatio: 2.80 },
];

// Quarterly ratios
const mockQuarterlyRatios = [
  { date: '2023-10-29', priceToEarningsRatio: 65.0, priceToBookRatio: 40.0, priceToSalesRatio: 28.0, priceToEarningsGrowthRatio: 1.2, interestCoverageRatio: 100, debtToEquityRatio: 0.41, currentRatio: 4.17 },
  { date: '2023-07-30', priceToEarningsRatio: 60.0, priceToBookRatio: 35.0, priceToSalesRatio: 25.0, priceToEarningsGrowthRatio: 1.5, interestCoverageRatio: 80, debtToEquityRatio: 0.50, currentRatio: 3.50 },
  { date: '2023-04-30', priceToEarningsRatio: 150.0, priceToBookRatio: 25.0, priceToSalesRatio: 20.0, priceToEarningsGrowthRatio: 3.0, interestCoverageRatio: 50, debtToEquityRatio: 0.55, currentRatio: 3.00 },
  { date: '2023-01-29', priceToEarningsRatio: 200.0, priceToBookRatio: 20.0, priceToSalesRatio: 18.0, priceToEarningsGrowthRatio: 5.0, interestCoverageRatio: 30, debtToEquityRatio: 0.60, currentRatio: 2.80 },
];

const mockProfile = { companyName: 'NVIDIA Corp', sector: 'Technology', beta: 1.7, volAvg: 50000000 };

const mockQuarterlyBalance = [
  { date: '2023-10-29', cashAndCashEquivalents: 18280e6, totalDebt: 11056e6 },
  { date: '2023-07-30', cashAndCashEquivalents: 16023e6, totalDebt: 11056e6 },
];

const mockQuarterlyCashFlow = [
  { date: '2023-10-29', freeCashFlow: 7500e6, operatingCashFlow: 7800e6 },
  { date: '2023-07-30', freeCashFlow: 6300e6, operatingCashFlow: 6500e6 },
];

// 40 prices around 2023-12-15, newest first
const mockHistorical = Array.from({ length: 250 }, (_, i) => ({
  date: new Date(Date.UTC(2023, 11, 15) - i * 86400000).toISOString().slice(0, 10),
  close: 480 + Math.sin(i / 10) * 20,
}));

beforeEach(() => {
  fmp.getProfile.mockResolvedValue(mockProfile);
  fmp.getIncomeStatements.mockResolvedValue(mockQuarterlyIncome);
  fmp.getKeyMetricsAnnual.mockResolvedValue(mockQuarterlyMetrics);
  fmp.getRatiosAnnual.mockResolvedValue(mockQuarterlyRatios);
  fmp.getHistoricalPrices.mockResolvedValue(mockHistorical);
  fmp.getShortInterest.mockResolvedValue(null);
  fmp.getBalanceSheet.mockResolvedValue(mockQuarterlyBalance);
  fmp.getCashFlowStatement.mockResolvedValue(mockQuarterlyCashFlow);
});

describe('GET /api/snapshot — TTM construction', () => {
  test('returns 400 when ticker or date missing', async () => {
    const res = await request(app).get('/api/snapshot');
    expect(res.status).toBe(400);
  });

  test('returns snapshot with correct shape', async () => {
    const res = await request(app).get('/api/snapshot?ticker=NVDA&date=2023-12-15');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ticker: 'NVDA',
      companyName: 'NVIDIA Corp',
      sector: 'Technology',
      date: '2023-12-15',
    });
    expect(typeof res.body.price).toBe('number');
  });

  test('revenue is TTM sum of 4 most recent quarters before snapshot date', async () => {
    const res = await request(app).get('/api/snapshot?ticker=NVDA&date=2023-12-15');
    // Quarters on or before 2023-12-15: 2023-10-29, 2023-07-30, 2023-04-30, 2023-01-29
    // TTM revenue = 18120 + 13507 + 7192 + 6051 = 44870 (millions)
    expect(res.body.ttmRevenue).toBeCloseTo(44870e6, -6);
  });

  test('margins are computed from TTM sums', async () => {
    const res = await request(app).get('/api/snapshot?ticker=NVDA&date=2023-12-15');
    // TTM grossProfit = 13400 + 9462 + 4648 + 3833 = 31343
    // TTM revenue = 44870
    // grossMargin = 31343 / 44870 ≈ 0.6986
    expect(res.body.grossMargin).toBeCloseTo(0.6986, 3);
  });

  test('revenue growth YoY compares TTM vs prior-year TTM', async () => {
    const res = await request(app).get('/api/snapshot?ticker=NVDA&date=2023-12-15');
    // Current TTM revenue (Q ending 2023-10 through 2023-01): 44870M
    // Prior TTM revenue (Q ending 2022-10 through 2022-01): 5931 + 6704 + 8288 + 7643 = 28566M
    // Growth = (44870 - 28566) / 28566 ≈ 0.5706
    expect(res.body.revenueGrowthYoY).toBeCloseTo(0.5706, 2);
  });

  test('valuation ratios come from most recent quarterly key-metrics/ratios', async () => {
    const res = await request(app).get('/api/snapshot?ticker=NVDA&date=2023-12-15');
    // Most recent quarter on or before 2023-12-15 is 2023-10-29
    expect(res.body.evToEBITDA).toBe(60.5);
    expect(res.body.peRatio).toBe(65.0);
    expect(res.body.priceToBook).toBe(40.0);
  });

  test('balance sheet uses most recent quarter', async () => {
    const res = await request(app).get('/api/snapshot?ticker=NVDA&date=2023-12-15');
    expect(res.body.totalCash).toBe(18280e6);
    expect(res.body.totalDebt).toBe(11056e6);
  });

  test('null fields when no quarterly data available', async () => {
    fmp.getIncomeStatements.mockResolvedValue([]);
    fmp.getKeyMetricsAnnual.mockResolvedValue([]);
    fmp.getRatiosAnnual.mockResolvedValue([]);
    const res = await request(app).get('/api/snapshot?ticker=AAPL&date=2023-12-15');
    expect(res.status).toBe(200);
    expect(res.body.peRatio).toBeNull();
    expect(res.body.grossMargin).toBeNull();
    expect(res.body.revenueGrowthYoY).toBeNull();
  });

  test('technical metrics are computed from price history', async () => {
    const res = await request(app).get('/api/snapshot?ticker=NVDA&date=2023-12-15');
    expect(typeof res.body.rsi14).toBe('number');
    expect(typeof res.body.pctBelowHigh).toBe('number');
    expect(typeof res.body.priceVsMa50).toBe('number');
    expect(typeof res.body.priceVsMa200).toBe('number');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd server && npx jest tests/snapshot.test.js --verbose 2>&1 | tail -30`

Expected: Tests fail because snapshot.js still uses annual data and doesn't produce TTM fields.

- [ ] **Step 3: Rewrite snapshot.js to use quarterly TTM data**

Replace the entire contents of `server/routes/snapshot.js` with:

```js
const express = require('express');
const router = express.Router();
const fmp = require('../services/fmp');
const { computeRSI } = require('../services/rsi');

const snapshotCache = new Map();
const SNAPSHOT_CACHE_TTL = 24 * 60 * 60 * 1000;

// Filter periods on or before targetDate, sorted newest-first
function periodsOnOrBefore(periods, targetDate) {
  const target = new Date(targetDate);
  return periods
    .filter(p => new Date(p.date) <= target)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

// Sum flow metrics across an array of quarterly periods
function sumQuarters(quarters) {
  const sum = (field) => quarters.reduce((s, q) => s + (q[field] ?? 0), 0);
  return {
    revenue: sum('revenue'),
    grossProfit: sum('grossProfit'),
    operatingIncome: sum('operatingIncome'),
    netIncome: sum('netIncome'),
    ebitda: sum('ebitda'),
    eps: sum('eps'),
  };
}

// Find price on or before targetDate from newest-first historical array
function findPrice(historical, targetDate) {
  const target = new Date(targetDate);
  const entry = historical.find(h => new Date(h.date) <= target);
  return entry ? entry.close : null;
}

router.get('/', async (req, res) => {
  const { ticker, date } = req.query;
  if (!ticker || !date) {
    return res.status(400).json({ error: 'ticker and date are required' });
  }
  if (!/^[A-Z0-9.]{1,10}$/i.test(ticker)) {
    return res.status(400).json({ error: 'invalid ticker format' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date).getTime())) {
    return res.status(400).json({ error: 'invalid date format, expected YYYY-MM-DD' });
  }

  const sym = ticker.toUpperCase();
  const cacheKey = `${sym}:${date}`;
  const cached = snapshotCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < SNAPSHOT_CACHE_TTL) {
    return res.json(cached.data);
  }

  // Fetch 1 year of prices before snapshot date for 52w high + RSI window
  const fromDate = new Date(date);
  fromDate.setFullYear(fromDate.getFullYear() - 1);
  const fromStr = fromDate.toISOString().slice(0, 10);

  try {
    const [profileData, incomeData, metricsData, ratiosData, histData, shortData, balanceSheetData, cashFlowData] =
      await Promise.allSettled([
        fmp.getProfile(sym, false),
        fmp.getIncomeStatements(sym, 20, false, 'quarter'),
        fmp.getKeyMetricsAnnual(sym, false, 'quarter', 20),
        fmp.getRatiosAnnual(sym, false, 'quarter', 20),
        fmp.getHistoricalPrices(sym, fromStr, date, false),
        fmp.getShortInterest(sym, false),
        fmp.getBalanceSheet(sym, 8, false, 'quarter'),
        fmp.getCashFlowStatement(sym, 8, false, 'quarter'),
      ]);

    const profile    = profileData.status    === 'fulfilled' ? profileData.value    : {};
    const income     = incomeData.status     === 'fulfilled' ? incomeData.value     : [];
    const metrics    = metricsData.status    === 'fulfilled' ? metricsData.value    : [];
    const ratios     = ratiosData.status     === 'fulfilled' ? ratiosData.value     : [];
    const historical = histData.status       === 'fulfilled' ? histData.value       : [];
    const shortRaw   = shortData.status      === 'fulfilled' ? shortData.value      : null;
    const balanceSheet  = balanceSheetData.status  === 'fulfilled' ? balanceSheetData.value  : [];
    const cashFlowStmt  = cashFlowData.status      === 'fulfilled' ? cashFlowData.value      : [];

    // --- Quarterly periods on or before snapshot date ---
    const incomeQuarters = periodsOnOrBefore(income, date);
    const metricsQuarters = periodsOnOrBefore(metrics, date);
    const ratiosQuarters = periodsOnOrBefore(ratios, date);
    const balanceQuarters = periodsOnOrBefore(balanceSheet, date);
    const cashFlowQuarters = periodsOnOrBefore(cashFlowStmt, date);

    // --- TTM from 4 most recent quarters ---
    const ttmIncomeQ = incomeQuarters.slice(0, 4);
    const priorTtmIncomeQ = incomeQuarters.slice(4, 8);

    const ttm = ttmIncomeQ.length >= 4 ? sumQuarters(ttmIncomeQ) : null;
    const priorTtm = priorTtmIncomeQ.length >= 4 ? sumQuarters(priorTtmIncomeQ) : null;

    // --- Margins from TTM ---
    const grossMargin     = ttm && ttm.revenue ? ttm.grossProfit / ttm.revenue : null;
    const operatingMargin = ttm && ttm.revenue ? ttm.operatingIncome / ttm.revenue : null;
    const netMargin       = ttm && ttm.revenue ? ttm.netIncome / ttm.revenue : null;
    const ebitdaMargin    = ttm && ttm.revenue ? ttm.ebitda / ttm.revenue : null;

    // --- Growth: TTM vs prior-year TTM ---
    let revenueGrowthYoY = null;
    if (ttm && priorTtm && priorTtm.revenue !== 0) {
      revenueGrowthYoY = (ttm.revenue - priorTtm.revenue) / Math.abs(priorTtm.revenue);
    }

    // Revenue 3yr CAGR: need TTM from ~3 years ago
    const ttm3yrAgoQ = incomeQuarters.slice(12, 16);
    const ttm3yrAgo = ttm3yrAgoQ.length >= 4 ? sumQuarters(ttm3yrAgoQ) : null;
    let revenueGrowth3yr = null;
    if (ttm && ttm3yrAgo && ttm3yrAgo.revenue > 0) {
      revenueGrowth3yr = Math.pow(ttm.revenue / ttm3yrAgo.revenue, 1 / 3) - 1;
    }

    let epsGrowthYoY = null;
    if (ttm && priorTtm && priorTtm.eps !== 0) {
      epsGrowthYoY = (ttm.eps - priorTtm.eps) / Math.abs(priorTtm.eps);
    }

    // --- Valuation & return ratios from most recent quarterly key-metrics/ratios ---
    const curMetrics = metricsQuarters[0] || null;
    const curRatios = ratiosQuarters[0] || null;

    // --- Balance sheet & cash flow from most recent quarter ---
    const curBalance = balanceQuarters[0] || null;
    const curCashFlow = cashFlowQuarters[0] || null;

    // --- Price ---
    const price = findPrice(historical, date);

    // --- Technical indicators (unchanged — price-based) ---
    const pricesAsc = [...historical]
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .filter(h => new Date(h.date) <= new Date(date))
      .map(h => h.close);
    const rsi14 = computeRSI(pricesAsc.slice(-30));

    const high52w = historical.length > 0 ? Math.max(...historical.map(h => h.close)) : null;
    const pctBelowHigh =
      price != null && high52w != null && high52w > 0
        ? ((high52w - price) / high52w) * 100
        : null;

    let priceVsMa50 = null;
    let priceVsMa200 = null;
    if (pricesAsc.length >= 50) {
      const ma50 = pricesAsc.slice(-50).reduce((s, v) => s + v, 0) / 50;
      if (price != null && ma50 > 0) priceVsMa50 = ((price - ma50) / ma50) * 100;
    }
    if (pricesAsc.length > 0) {
      const window200 = pricesAsc.slice(-200);
      const ma200 = window200.reduce((s, v) => s + v, 0) / window200.length;
      if (price != null && ma200 > 0) priceVsMa200 = ((price - ma200) / ma200) * 100;
    }

    const result = {
      ticker: sym,
      companyName: profile.companyName || sym,
      sector: profile.sector || null,
      date,
      price,
      // TTM revenue (for display/debugging — not a match metric)
      ttmRevenue: ttm ? ttm.revenue : null,
      // Valuation — from most recent quarterly metrics/ratios
      peRatio:           curRatios?.priceToEarningsRatio ?? null,
      priceToBook:       curRatios?.priceToBookRatio ?? null,
      priceToSales:      curRatios?.priceToSalesRatio ?? null,
      evToEBITDA:        curMetrics?.evToEBITDA ?? null,
      evToRevenue:       curMetrics?.evToSales ?? null,
      pegRatio:          curRatios?.priceToEarningsGrowthRatio ?? null,
      earningsYield:     curMetrics?.earningsYield ?? null,
      // Profitability — TTM margins
      grossMargin,
      operatingMargin,
      netMargin,
      ebitdaMargin,
      returnOnEquity:    curMetrics?.returnOnEquity ?? null,
      returnOnAssets:    curMetrics?.returnOnAssets ?? null,
      returnOnCapital:   curMetrics?.returnOnInvestedCapital ?? null,
      // Growth — TTM vs prior-year TTM
      revenueGrowthYoY,
      revenueGrowth3yr,
      epsGrowthYoY,
      eps:               ttm ? ttm.eps : null,
      // Financial Health
      currentRatio:      curRatios?.currentRatio ?? curMetrics?.currentRatio ?? null,
      debtToEquity:      curRatios?.debtToEquityRatio ?? null,
      interestCoverage:  curRatios?.interestCoverageRatio ?? null,
      netDebtToEBITDA:   curMetrics?.netDebtToEBITDA ?? null,
      freeCashFlowYield: curMetrics?.freeCashFlowYield ?? null,
      dividendYield:     curRatios?.dividendYield ?? null,
      totalCash:         curBalance?.cashAndCashEquivalents ?? null,
      totalDebt:         curBalance?.totalDebt ?? null,
      freeCashFlow:      curCashFlow?.freeCashFlow ?? null,
      operatingCashFlow: curCashFlow?.operatingCashFlow ?? null,
      // Technical
      rsi14,
      pctBelowHigh,
      priceVsMa50,
      priceVsMa200,
      beta:              profile?.beta ?? null,
      avgVolume:         profile?.volAvg ?? profile?.averageVolume ?? null,
      // Overview
      marketCap:         curMetrics?.marketCap ?? null,
      shortInterestPct:  shortRaw?.shortInterestPercent ?? null,
    };
    snapshotCache.set(cacheKey, { data: result, ts: Date.now() });
    res.json(result);
  } catch (err) {
    console.error('[snapshot] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch snapshot data' });
  }
});

module.exports = router;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd server && npx jest tests/snapshot.test.js --verbose 2>&1 | tail -30`

Expected: All tests pass.

- [ ] **Step 5: Run full test suite**

Run: `cd server && npx jest --verbose 2>&1 | tail -40`

Expected: All tests pass across all test files.

- [ ] **Step 6: Commit**

```bash
git add server/routes/snapshot.js server/tests/snapshot.test.js
git commit -m "feat: rewrite snapshot to use quarterly TTM data

Fetch quarterly financial data and reconstruct trailing twelve months
as of the snapshot date. Margins computed from TTM sums. Growth
computed by comparing current TTM vs prior-year TTM. Valuation ratios
from most recent quarterly key-metrics/ratios."
```

---

### Task 5: Fix frontend MATCH_METRICS to include marketCap

The client-side MATCH_METRICS list (26 items) is missing `marketCap` that the server expects (27 items). This means marketCap is never sent as a query param and never matched.

**Files:**
- Modify: `client/src/pages/MatchResults.jsx`

- [ ] **Step 1: Add marketCap to the frontend MATCH_METRICS list**

In `client/src/pages/MatchResults.jsx`, change lines 13-20 from:

```js
const MATCH_METRICS = [
  'peRatio', 'priceToBook', 'priceToSales', 'evToEBITDA', 'evToRevenue', 'pegRatio', 'earningsYield',
  'grossMargin', 'operatingMargin', 'netMargin', 'ebitdaMargin',
  'returnOnEquity', 'returnOnAssets', 'returnOnCapital',
  'revenueGrowthYoY', 'revenueGrowth3yr', 'epsGrowthYoY',
  'currentRatio', 'debtToEquity', 'interestCoverage', 'netDebtToEBITDA', 'freeCashFlowYield',
  'rsi14', 'pctBelowHigh', 'priceVsMa50', 'priceVsMa200',
];
```

to:

```js
const MATCH_METRICS = [
  'peRatio', 'priceToBook', 'priceToSales', 'evToEBITDA', 'evToRevenue', 'pegRatio', 'earningsYield',
  'grossMargin', 'operatingMargin', 'netMargin', 'ebitdaMargin',
  'returnOnEquity', 'returnOnAssets', 'returnOnCapital',
  'revenueGrowthYoY', 'revenueGrowth3yr', 'epsGrowthYoY',
  'currentRatio', 'debtToEquity', 'interestCoverage', 'netDebtToEBITDA', 'freeCashFlowYield',
  'marketCap',
  'rsi14', 'pctBelowHigh', 'priceVsMa50', 'priceVsMa200',
];
```

- [ ] **Step 2: Commit**

```bash
git add client/src/pages/MatchResults.jsx
git commit -m "fix: add marketCap to frontend MATCH_METRICS list

Was missing from the 26-item client list, so marketCap was never
sent as a query param and never compared during matching."
```

---

### Task 6: End-to-end validation

Start the server and test with real data to verify the TTM snapshot and scoring produce trustworthy results.

**Files:** None (manual validation)

- [ ] **Step 1: Run the full test suite one final time**

Run: `cd server && npx jest --verbose 2>&1`

Expected: All tests pass.

- [ ] **Step 2: Start the server and test snapshot endpoint**

Run: `cd server && node -e "
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fmp = require('./services/fmp');

(async () => {
  // Quick validation: fetch NVDA quarterly income and verify TTM construction
  const income = await fmp.getIncomeStatements('NVDA', 20, false, 'quarter');
  const target = new Date('2023-12-15');
  const valid = income
    .filter(p => new Date(p.date) <= target)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  console.log('Quarters on or before 2023-12-15:');
  valid.slice(0, 4).forEach(q => console.log('  ', q.date, 'rev:', (q.revenue / 1e6).toFixed(0) + 'M'));

  const ttmRev = valid.slice(0, 4).reduce((s, q) => s + (q.revenue || 0), 0);
  console.log('TTM Revenue:', (ttmRev / 1e9).toFixed(1) + 'B');

  const priorRev = valid.slice(4, 8).reduce((s, q) => s + (q.revenue || 0), 0);
  console.log('Prior TTM Revenue:', (priorRev / 1e9).toFixed(1) + 'B');
  console.log('Revenue Growth YoY:', ((ttmRev - priorRev) / priorRev * 100).toFixed(1) + '%');
})();
" 2>&1`

Expected: Output shows 4 quarters summed to a TTM revenue figure, with a reasonable YoY growth rate.

- [ ] **Step 3: Commit a validation note (optional)**

If everything looks good, no commit needed. If any issues were found and fixed, commit the fixes.
