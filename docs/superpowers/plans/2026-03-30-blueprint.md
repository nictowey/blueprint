# Blueprint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Blueprint — a 3-screen stock analysis web app where investors select a historical stock + date, see a fundamental/technical snapshot, and find current stocks that match that profile.

**Architecture:** Single repo with `client/` (Vite + React + Tailwind) and `server/` (Node + Express) directories, orchestrated from a root `package.json` via `concurrently`. Server maintains a 24h in-memory cache of ~300 stock fundamentals so match queries are instant. All FMP API calls are server-side only — the API key is never exposed to the client.

**Tech Stack:** React 18, React Router v6, Tailwind CSS v3, Vite, Node.js 18+, Express, node-fetch@2, cors, dotenv, Jest, Supertest, Vitest

---

## Data Shapes (Reference — used throughout)

```js
// Snapshot — returned by GET /api/snapshot, stored as template across screens
{
  ticker: "NVDA",             // string
  companyName: "NVIDIA Corp", // string
  sector: "Technology",       // string | null
  date: "2020-01-15",         // string YYYY-MM-DD
  price: 59.84,               // number | null — price on snapshot date
  peRatio: 52.3,              // number | null
  priceToSales: 18.1,         // number | null
  revenueGrowthYoY: 0.155,    // decimal (0.155 = 15.5%) | null
  grossMargin: 0.621,         // decimal (0.621 = 62.1%) | null
  rsi14: 61.4,                // number 0-100 | null
  pctBelowHigh: 8.2,          // percent (8.2 = 8.2% below 52w high) | null
  marketCap: 36700000000,     // number in USD | null
  shortInterestPct: null,     // percent | null
}

// MatchResult — one item in the GET /api/matches array
{
  ticker: "CRWD",
  companyName: "CrowdStrike Holdings",
  sector: "Technology",
  price: 289.40,
  matchScore: 91,             // integer 0-100
  topMatches: ["peRatio", "rsi14", "grossMargin"],    // 3 metric keys
  topDifferences: ["revenueGrowthYoY"],                // 1-2 metric keys
}

// ComparisonData — returned by GET /api/comparison
{
  template: Snapshot,
  match: Snapshot,            // same shape, live data for match stock
  sparkline: [{ date: "2020-01-15", price: 59.84 }],  // oldest-first
  sparklineGainPct: 847.3,    // percent gain over 18mo after snapshot date
}
```

**Metric keys** (consistent across server + client):
`peRatio`, `priceToSales`, `revenueGrowthYoY`, `grossMargin`, `rsi14`, `pctBelowHigh`, `marketCap`, `shortInterestPct`

**Matching metrics** (6 used in distance calc):
`['peRatio', 'revenueGrowthYoY', 'grossMargin', 'marketCap', 'rsi14', 'pctBelowHigh']`

---

## File Map

```
blueprint/
├── package.json                    Task 1
├── .env.example                    Task 1
├── .gitignore                      Task 1
├── README.md                       Task 22
├── server/
│   ├── package.json                Task 2
│   ├── index.js                    Task 2 (updated Task 11)
│   ├── services/
│   │   ├── fmp.js                  Task 3
│   │   ├── rsi.js                  Task 4
│   │   ├── matcher.js              Task 5
│   │   └── universe.js             Task 6
│   ├── middleware/
│   │   └── cache.js                Task 3 (in-memory TTL cache for FMP responses)
│   ├── routes/
│   │   ├── snapshot.js             Task 7
│   │   ├── search.js               Task 8
│   │   ├── matches.js              Task 9
│   │   ├── comparison.js           Task 10
│   │   └── status.js               Task 11
│   └── tests/
│       ├── rsi.test.js             Task 4
│       ├── matcher.test.js         Task 5
│       ├── snapshot.test.js        Task 7
│       └── matches.test.js         Task 9
└── client/
    ├── package.json                Task 12
    ├── vite.config.js              Task 12
    ├── tailwind.config.js          Task 12
    ├── postcss.config.js           Task 12
    ├── index.html                  Task 12
    └── src/
        ├── main.jsx                Task 12
        ├── App.jsx                 Task 13
        ├── index.css               Task 13
        ├── utils/
        │   └── format.js           Task 13
        ├── components/
        │   ├── Header.jsx          Task 13
        │   ├── TickerSearch.jsx    Task 14
        │   ├── SnapshotCard.jsx    Task 15
        │   ├── MatchCard.jsx       Task 17
        │   ├── Sparkline.jsx       Task 19
        │   └── ComparisonRow.jsx   Task 20
        └── pages/
            ├── TemplatePicker.jsx  Task 16
            ├── MatchResults.jsx    Task 18
            └── ComparisonDetail.jsx Task 21
```

---

## Task 1: Root Scaffold

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Create: `.gitignore`

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "blueprint",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "concurrently \"npm run dev --prefix server\" \"npm run dev --prefix client\"",
    "postinstall": "npm install --prefix server && npm install --prefix client"
  },
  "devDependencies": {
    "concurrently": "^8.2.2"
  }
}
```

- [ ] **Step 2: Create `.env.example`**

```
FMP_API_KEY=your_key_here
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
.env
client/node_modules/
server/node_modules/
client/dist/
.superpowers/
```

- [ ] **Step 4: Install root deps and commit**

```bash
cd /Users/nictowey/blueprint
npm install
git add package.json .env.example .gitignore
git commit -m "feat: root scaffold with concurrently"
```

Expected: `node_modules/` created, `concurrently` installed.

---

## Task 2: Server Scaffold

**Files:**
- Create: `server/package.json`
- Create: `server/index.js`

- [ ] **Step 1: Create `server/package.json`**

```json
{
  "name": "blueprint-server",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "node --watch index.js",
    "test": "jest --runInBand"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.19.2",
    "node-fetch": "^2.7.0"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "supertest": "^7.0.0"
  },
  "jest": {
    "testEnvironment": "node",
    "testMatch": ["**/tests/**/*.test.js"]
  }
}
```

- [ ] **Step 2: Create `server/index.js`**

```js
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Routes registered in Task 11 after all routes exist
// Placeholder health check
app.get('/api/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3001;

if (require.main === module) {
  app.listen(PORT, () => console.log(`[server] Running on port ${PORT}`));
}

module.exports = app;
```

- [ ] **Step 3: Install server deps and verify**

```bash
cd /Users/nictowey/blueprint/server
npm install
node -e "const app = require('./index'); console.log('ok')"
```

Expected: prints `ok` with no errors.

- [ ] **Step 4: Commit**

```bash
cd /Users/nictowey/blueprint
git add server/
git commit -m "feat: server scaffold with Express"
```

---

## Task 3: FMP Service

**Files:**
- Create: `server/services/fmp.js`

All FMP API calls live here. The API key stays server-side.

- [ ] **Step 1: Create `server/services/fmp.js`**

```js
const fetch = require('node-fetch');

const BASE = 'https://financialmodelingprep.com/api/v3';

function key() {
  if (!process.env.FMP_API_KEY) throw new Error('FMP_API_KEY not set');
  return process.env.FMP_API_KEY;
}

async function fmpGet(path, params = {}) {
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set('apikey', key());
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`FMP ${path} returned HTTP ${res.status}`);
  }
  const data = await res.json();
  // FMP returns { "Error Message": "..." } on auth failures
  if (data && data['Error Message']) {
    throw new Error(`FMP error: ${data['Error Message']}`);
  }
  return data;
}

// Ticker typeahead search
async function searchTickers(query) {
  const results = await fmpGet('/search', { query, limit: 10 });
  return Array.isArray(results) ? results : [];
}

// Company profile (name, sector, etc.)
async function getProfile(ticker) {
  const data = await fmpGet(`/profile/${ticker}`);
  return Array.isArray(data) ? data[0] : data;
}

// Annual income statements (newest first)
// limit=2 returns 2 most recent annual periods
async function getIncomeStatements(ticker, limit = 10) {
  const data = await fmpGet(`/income-statement/${ticker}`, { period: 'annual', limit });
  return Array.isArray(data) ? data : [];
}

// Annual key metrics (newest first)
async function getKeyMetricsAnnual(ticker) {
  const data = await fmpGet(`/key-metrics/${ticker}`, { period: 'annual' });
  return Array.isArray(data) ? data : [];
}

// TTM key metrics for a single ticker (for universe cache + comparison right panel)
async function getKeyMetricsTTM(ticker) {
  const data = await fmpGet(`/key-metrics/${ticker}/ttm`);
  const obj = Array.isArray(data) ? data[0] : data;
  return obj || {};
}

// Historical daily prices, newest first
// from/to are YYYY-MM-DD strings (optional)
async function getHistoricalPrices(ticker, from, to) {
  const params = {};
  if (from) params.from = from;
  if (to) params.to = to;
  const data = await fmpGet(`/historical-price-full/${ticker}`, params);
  return Array.isArray(data?.historical) ? data.historical : [];
}

// Stock screener — returns array of basic stock info
async function getScreener(params = {}) {
  const data = await fmpGet('/stock-screener', params);
  return Array.isArray(data) ? data : [];
}

// Short interest for a ticker (may be null on some plans)
async function getShortInterest(ticker) {
  try {
    const data = await fmpGet(`/stock-short-interest/${ticker}`);
    return Array.isArray(data) && data.length > 0 ? data[0] : null;
  } catch {
    return null; // endpoint may not be available on all plans
  }
}

module.exports = {
  searchTickers,
  getProfile,
  getIncomeStatements,
  getKeyMetricsAnnual,
  getKeyMetricsTTM,
  getHistoricalPrices,
  getScreener,
  getShortInterest,
};
```

- [ ] **Step 2: Create `server/middleware/cache.js`** (in-memory TTL cache to avoid duplicate FMP calls within a request session)

```js
const store = new Map();

/**
 * Wrap an async function so its result is cached by key for `ttlMs` milliseconds.
 * Usage: const cachedGet = withCache(fmpGet, 5 * 60 * 1000);
 */
function withCache(fn, ttlMs = 5 * 60 * 1000) {
  return async function cached(key, ...args) {
    const now = Date.now();
    const hit = store.get(key);
    if (hit && now - hit.ts < ttlMs) return hit.value;
    const value = await fn(key, ...args);
    store.set(key, { value, ts: now });
    return value;
  };
}

module.exports = { withCache };
```

- [ ] **Step 3: Verify both modules load**

```bash
cd /Users/nictowey/blueprint/server
node -e "const fmp = require('./services/fmp'); console.log(Object.keys(fmp))"
node -e "const c = require('./middleware/cache'); console.log(Object.keys(c))"
```

Expected:
```
[ 'searchTickers', 'getProfile', 'getIncomeStatements', 'getKeyMetricsAnnual', 'getKeyMetricsTTM', 'getHistoricalPrices', 'getScreener', 'getShortInterest' ]
[ 'withCache' ]
```

- [ ] **Step 4: Commit**

```bash
cd /Users/nictowey/blueprint
git add server/services/fmp.js server/middleware/cache.js
git commit -m "feat: FMP API service + in-memory response cache middleware"
```

---

## Task 4: RSI Service + Tests

**Files:**
- Create: `server/services/rsi.js`
- Create: `server/tests/rsi.test.js`

- [ ] **Step 1: Write failing tests in `server/tests/rsi.test.js`**

```js
const { computeRSI } = require('../services/rsi');

describe('computeRSI', () => {
  test('returns null for null input', () => {
    expect(computeRSI(null)).toBeNull();
  });

  test('returns null for empty array', () => {
    expect(computeRSI([])).toBeNull();
  });

  test('returns null for fewer than 15 prices', () => {
    const prices = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113];
    expect(computeRSI(prices)).toBeNull(); // 14 prices, needs 15
  });

  test('returns 100 when all 14 periods are gains', () => {
    // 15 strictly increasing prices => 14 gains, 0 losses => RSI = 100
    const prices = Array.from({ length: 15 }, (_, i) => 100 + i);
    expect(computeRSI(prices)).toBe(100);
  });

  test('returns a number between 0 and 100 for mixed prices', () => {
    const prices = [
      44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.15,
      43.61, 44.33, 44.83, 45.10, 45.15, 46.00, 46.50
    ];
    const result = computeRSI(prices);
    expect(typeof result).toBe('number');
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThan(100);
  });

  test('uses only the last 15 prices when given more', () => {
    // First half: all losses. Last 15: all gains. RSI should be 100.
    const losses = Array.from({ length: 20 }, (_, i) => 100 - i); // decreasing
    const gains = Array.from({ length: 15 }, (_, i) => 80 + i);   // increasing
    const prices = [...losses, ...gains];
    expect(computeRSI(prices)).toBe(100);
  });

  test('result is rounded to 1 decimal place', () => {
    const prices = [
      44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.15,
      43.61, 44.33, 44.83, 45.10, 45.15, 46.00, 46.50
    ];
    const result = computeRSI(prices);
    const rounded = Math.round(result * 10) / 10;
    expect(result).toBe(rounded);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (module not found)**

```bash
cd /Users/nictowey/blueprint/server
npx jest tests/rsi.test.js --no-coverage
```

Expected: `Cannot find module '../services/rsi'`

- [ ] **Step 3: Create `server/services/rsi.js`**

```js
/**
 * Compute 14-period RSI from an array of closing prices (oldest first).
 * Returns null if fewer than 15 prices are provided (need 14 periods of change).
 * Returns a number 0-100 rounded to 1 decimal place.
 */
function computeRSI(prices) {
  if (!prices || prices.length < 15) return null;

  // Use the last 15 prices (oldest-first) to compute 14 periods of change
  const window = prices.slice(-15);
  const changes = [];
  for (let i = 1; i < window.length; i++) {
    changes.push(window[i] - window[i - 1]);
  }

  let totalGain = 0;
  let totalLoss = 0;
  for (const change of changes) {
    if (change > 0) totalGain += change;
    else totalLoss += Math.abs(change);
  }

  const avgGain = totalGain / 14;
  const avgLoss = totalLoss / 14;

  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;

  const rs = avgGain / avgLoss;
  const rsi = 100 - 100 / (1 + rs);
  return Math.round(rsi * 10) / 10;
}

module.exports = { computeRSI };
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd /Users/nictowey/blueprint/server
npx jest tests/rsi.test.js --no-coverage
```

Expected: `Tests: 6 passed, 6 total`

- [ ] **Step 5: Commit**

```bash
cd /Users/nictowey/blueprint
git add server/services/rsi.js server/tests/rsi.test.js
git commit -m "feat: RSI calculation service with tests"
```

---

## Task 5: Matcher Service + Tests

**Files:**
- Create: `server/services/matcher.js`
- Create: `server/tests/matcher.test.js`

- [ ] **Step 1: Write failing tests in `server/tests/matcher.test.js`**

```js
const { findMatches } = require('../services/matcher');

const makeStock = (ticker, overrides = {}) => ({
  ticker,
  companyName: `${ticker} Corp`,
  sector: 'Technology',
  price: 100,
  peRatio: 20,
  revenueGrowthYoY: 0.2,
  grossMargin: 0.5,
  marketCap: 10_000_000_000,
  rsi14: 50,
  pctBelowHigh: 10,
  ...overrides,
});

describe('findMatches', () => {
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

  test('perfect match scores 100', () => {
    const universe = new Map();
    universe.set('TWIN', makeStock('TWIN')); // identical to snapshot
    const results = findMatches(snapshot, universe);
    expect(results[0].matchScore).toBe(100);
  });

  test('does not throw when metrics are null', () => {
    const universe = new Map();
    universe.set('SPARSE', makeStock('SPARSE', { peRatio: null, rsi14: null, grossMargin: null }));
    expect(() => findMatches(snapshot, universe)).not.toThrow();
  });

  test('topMatches contains 3 metric keys', () => {
    const universe = new Map();
    universe.set('CLOSE', makeStock('CLOSE'));
    const results = findMatches(snapshot, universe);
    expect(results[0].topMatches).toHaveLength(3);
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
      topMatches: expect.any(Array),
      topDifferences: expect.any(Array),
    });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd /Users/nictowey/blueprint/server
npx jest tests/matcher.test.js --no-coverage
```

Expected: `Cannot find module '../services/matcher'`

- [ ] **Step 3: Create `server/services/matcher.js`**

```js
const MATCH_METRICS = ['peRatio', 'revenueGrowthYoY', 'grossMargin', 'marketCap', 'rsi14', 'pctBelowHigh'];

// Log-normalize market cap before distance calculation
function prepareValue(metric, value) {
  if (value == null) return null;
  if (metric === 'marketCap') {
    return value > 0 ? Math.log(value) : null;
  }
  return value;
}

// Compute min/max for a metric across all stocks (for normalization)
function computeScale(stocks, metric) {
  const values = stocks
    .map(s => prepareValue(metric, s[metric]))
    .filter(v => v != null && isFinite(v));
  if (values.length === 0) return { min: 0, max: 1 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min, max: max === min ? min + 1 : max };
}

function normalizeValue(value, min, max) {
  const clamped = Math.max(min, Math.min(max, value));
  return (clamped - min) / (max - min);
}

/**
 * Find the top 10 stocks from the universe that most closely match the snapshot.
 * @param {object} snapshot — Snapshot data shape (see README)
 * @param {Map<string, object>} universe — Map of ticker -> stock metrics
 * @returns {Array} ranked array of match result objects
 */
function findMatches(snapshot, universe) {
  const stocks = Array.from(universe.values());

  // Pre-compute min/max scales across the full universe for each metric
  const scales = {};
  for (const metric of MATCH_METRICS) {
    scales[metric] = computeScale(stocks, metric);
  }

  const results = stocks
    .filter(stock => stock.ticker !== snapshot.ticker)
    .map(stock => {
      let sumSquared = 0;
      let count = 0;
      const diffs = [];

      for (const metric of MATCH_METRICS) {
        const snapRaw = prepareValue(metric, snapshot[metric]);
        const stockRaw = prepareValue(metric, stock[metric]);
        if (snapRaw == null || stockRaw == null || !isFinite(snapRaw) || !isFinite(stockRaw)) continue;

        const { min, max } = scales[metric];
        const normSnap = normalizeValue(snapRaw, min, max);
        const normStock = normalizeValue(stockRaw, min, max);
        const diff = Math.abs(normSnap - normStock);

        sumSquared += diff * diff;
        count++;
        diffs.push({ metric, diff });
      }

      let matchScore = 0;
      if (count > 0) {
        const maxDist = Math.sqrt(count); // max possible distance when all metrics are 0 vs 1
        const dist = Math.sqrt(sumSquared);
        matchScore = Math.round((1 - dist / maxDist) * 100);
        matchScore = Math.max(0, Math.min(100, matchScore));
      }

      // Sort by diff ascending: smallest diff = most similar
      diffs.sort((a, b) => a.diff - b.diff);
      const topMatches = diffs.slice(0, 3).map(d => d.metric);

      // topDifferences: largest diffs, but only if normalized diff > 0.2
      const bigDiffs = diffs.filter(d => d.diff > 0.2).slice(-2).map(d => d.metric);

      return {
        ticker: stock.ticker,
        companyName: stock.companyName,
        sector: stock.sector,
        price: stock.price,
        matchScore,
        topMatches,
        topDifferences: bigDiffs,
      };
    })
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 10);

  return results;
}

module.exports = { findMatches, MATCH_METRICS };
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd /Users/nictowey/blueprint/server
npx jest tests/matcher.test.js --no-coverage
```

Expected: `Tests: 7 passed, 7 total`

- [ ] **Step 5: Commit**

```bash
cd /Users/nictowey/blueprint
git add server/services/matcher.js server/tests/matcher.test.js
git commit -m "feat: matching algorithm with Euclidean distance + tests"
```

---

## Task 6: Universe Cache Service

**Files:**
- Create: `server/services/universe.js`

- [ ] **Step 1: Create `server/services/universe.js`**

```js
const fmp = require('./fmp');
const { computeRSI } = require('./rsi');

const EXCLUDED_SECTORS = new Set(['Financial Services', 'Utilities']);
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 150;
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const RETRY_ON_FAIL_MS = 60 * 60 * 1000;          // 1 hour

const state = {
  cache: new Map(),
  ready: false,
  lastRefreshed: null,
};

function getCache() { return state.cache; }
function isReady() { return state.ready; }
function getStatus() {
  return {
    ready: state.ready,
    stockCount: state.cache.size,
    lastRefreshed: state.lastRefreshed,
  };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function dateStr(d) { return d.toISOString().slice(0, 10); }

// Fetch all metrics needed for a single stock in the universe
async function fetchStockData(symbol) {
  const today = dateStr(new Date());
  const oneYearAgo = dateStr(new Date(Date.now() - 365 * 24 * 60 * 60 * 1000));

  // Three parallel FMP calls per stock
  const [ttmData, incomeData, histData] = await Promise.all([
    fmp.getKeyMetricsTTM(symbol),
    fmp.getIncomeStatements(symbol, 2),
    fmp.getHistoricalPrices(symbol, oneYearAgo, today),
  ]);

  // Income statement: newest first from FMP
  const income0 = incomeData[0] || {};
  const income1 = incomeData[1] || {};

  // Gross margin from most recent income statement
  const grossMargin = income0.grossProfitRatio ?? null;

  // Revenue growth YoY
  let revenueGrowthYoY = null;
  if (income0.revenue != null && income1.revenue && income1.revenue !== 0) {
    revenueGrowthYoY = (income0.revenue - income1.revenue) / Math.abs(income1.revenue);
  }

  // Historical prices: FMP returns newest-first, reverse for RSI (needs oldest-first)
  const pricesOldestFirst = [...histData].reverse().map(h => h.close);
  const rsi14 = computeRSI(pricesOldestFirst.slice(-30));

  // Current price (newest entry)
  const currentPrice = histData[0]?.close ?? null;
  const high52w = histData.length > 0 ? Math.max(...histData.map(h => h.close)) : null;
  const pctBelowHigh =
    currentPrice != null && high52w != null && high52w > 0
      ? ((high52w - currentPrice) / high52w) * 100
      : null;

  return {
    peRatio: ttmData.peRatioTTM ?? null,
    priceToSales: ttmData.priceToSalesRatioTTM ?? null,
    revenueGrowthYoY,
    grossMargin,
    marketCap: ttmData.marketCapTTM ?? null,
    rsi14,
    pctBelowHigh,
    price: currentPrice,
  };
}

async function buildCache() {
  console.log('[universe] Starting cache build...');
  try {
    const screenerResults = await fmp.getScreener({
      marketCapMoreThan: 1_000_000_000,
      marketCapLessThan: 100_000_000_000,
      country: 'US',
      exchange: 'NYSE,NASDAQ',
    });

    const filtered = screenerResults.filter(
      s => s.sector && !EXCLUDED_SECTORS.has(s.sector)
    );

    console.log(`[universe] ${filtered.length} stocks after filtering. Fetching metrics...`);

    const newCache = new Map();

    for (let i = 0; i < filtered.length; i += BATCH_SIZE) {
      const batch = filtered.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async stock => {
          try {
            const metrics = await fetchStockData(stock.symbol);
            newCache.set(stock.symbol, {
              ticker: stock.symbol,
              companyName: stock.companyName,
              sector: stock.sector,
              price: metrics.price ?? stock.price,
              peRatio: metrics.peRatio,
              priceToSales: metrics.priceToSales,
              revenueGrowthYoY: metrics.revenueGrowthYoY,
              grossMargin: metrics.grossMargin,
              marketCap: metrics.marketCap,
              rsi14: metrics.rsi14,
              pctBelowHigh: metrics.pctBelowHigh,
            });
          } catch (err) {
            // Silent skip — one bad stock won't break the cache
            console.warn(`[universe] Skipped ${stock.symbol}: ${err.message}`);
          }
        })
      );
      if (i + BATCH_SIZE < filtered.length) await sleep(BATCH_DELAY_MS);
    }

    state.cache = newCache;
    state.ready = true;
    state.lastRefreshed = new Date().toISOString();
    console.log(`[universe] Cache ready: ${newCache.size} stocks`);
  } catch (err) {
    console.error('[universe] Cache build failed:', err.message);
    setTimeout(buildCache, RETRY_ON_FAIL_MS);
  }
}

function startCache() {
  buildCache();
  setInterval(buildCache, REFRESH_INTERVAL_MS);
}

module.exports = { startCache, getCache, isReady, getStatus };
```

- [ ] **Step 2: Verify module loads**

```bash
cd /Users/nictowey/blueprint/server
node -e "const u = require('./services/universe'); console.log(Object.keys(u))"
```

Expected: `[ 'startCache', 'getCache', 'isReady', 'getStatus' ]`

- [ ] **Step 3: Commit**

```bash
cd /Users/nictowey/blueprint
git add server/services/universe.js
git commit -m "feat: universe cache service with 24h refresh"
```

---

## Task 7: Snapshot Route + Test

**Files:**
- Create: `server/routes/snapshot.js`
- Create: `server/tests/snapshot.test.js`

- [ ] **Step 1: Write failing integration test in `server/tests/snapshot.test.js`**

```js
jest.mock('../services/fmp');
const fmp = require('../services/fmp');
const request = require('supertest');
const app = require('../index');

const mockProfile = { companyName: 'NVIDIA Corp', sector: 'Technology' };
const mockIncome = [
  { date: '2019-01-27', revenue: 11716000000, grossProfit: 7279000000, grossProfitRatio: 0.6213 },
  { date: '2018-01-28', revenue: 9714000000, grossProfit: 5996000000, grossProfitRatio: 0.617 },
];
const mockKeyMetrics = [
  { date: '2019-01-27', peRatio: 32.5, priceToSalesRatio: 5.2, marketCap: 81000000000 },
];
// 40 prices around 2019-06-15, newest first
const mockHistorical = Array.from({ length: 40 }, (_, i) => ({
  date: new Date(Date.UTC(2019, 5, 15) - i * 86400000).toISOString().slice(0, 10),
  close: 160 + Math.sin(i) * 5,
}));

beforeEach(() => {
  fmp.getProfile.mockResolvedValue(mockProfile);
  fmp.getIncomeStatements.mockResolvedValue(mockIncome);
  fmp.getKeyMetricsAnnual.mockResolvedValue(mockKeyMetrics);
  fmp.getHistoricalPrices.mockResolvedValue(mockHistorical);
  fmp.getShortInterest.mockResolvedValue(null);
});

describe('GET /api/snapshot', () => {
  test('returns 400 when ticker or date missing', async () => {
    const res = await request(app).get('/api/snapshot');
    expect(res.status).toBe(400);
  });

  test('returns snapshot object with correct shape', async () => {
    const res = await request(app).get('/api/snapshot?ticker=NVDA&date=2019-06-15');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ticker: 'NVDA',
      companyName: 'NVIDIA Corp',
      sector: 'Technology',
      date: '2019-06-15',
    });
    expect(typeof res.body.price).toBe('number');
    expect(typeof res.body.peRatio).toBe('number');
    expect(typeof res.body.revenueGrowthYoY).toBe('number');
    expect(typeof res.body.grossMargin).toBe('number');
  });

  test('revenue growth is computed correctly from two income statements', async () => {
    const res = await request(app).get('/api/snapshot?ticker=NVDA&date=2019-06-15');
    // (11716 - 9714) / 9714 ≈ 0.206
    expect(res.body.revenueGrowthYoY).toBeCloseTo(0.206, 2);
  });

  test('null fields are present but null when data unavailable', async () => {
    fmp.getIncomeStatements.mockResolvedValue([]);
    fmp.getKeyMetricsAnnual.mockResolvedValue([]);
    const res = await request(app).get('/api/snapshot?ticker=NVDA&date=2019-06-15');
    expect(res.status).toBe(200);
    expect(res.body.peRatio).toBeNull();
    expect(res.body.grossMargin).toBeNull();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL (route not registered)**

```bash
cd /Users/nictowey/blueprint/server
npx jest tests/snapshot.test.js --no-coverage 2>&1 | tail -20
```

Expected: test failures (route returns 404 or route module not found).

- [ ] **Step 3: Create `server/routes/snapshot.js`**

```js
const express = require('express');
const router = express.Router();
const fmp = require('../services/fmp');
const { computeRSI } = require('../services/rsi');

// Find the most recent period whose date falls on or before targetDate
function findPeriodOnOrBefore(periods, targetDate) {
  const target = new Date(targetDate);
  return periods
    .filter(p => new Date(p.date) <= target)
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;
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

  const sym = ticker.toUpperCase();

  // Fetch 1 year of prices before snapshot date for 52w high + RSI window
  const fromDate = new Date(date);
  fromDate.setFullYear(fromDate.getFullYear() - 1);
  const fromStr = fromDate.toISOString().slice(0, 10);

  try {
    const [profileData, incomeData, metricsData, histData, shortData] = await Promise.allSettled([
      fmp.getProfile(sym),
      fmp.getIncomeStatements(sym),
      fmp.getKeyMetricsAnnual(sym),
      fmp.getHistoricalPrices(sym, fromStr, date),
      fmp.getShortInterest(sym),
    ]);

    const profile = profileData.status === 'fulfilled' ? profileData.value : {};
    const income = incomeData.status === 'fulfilled' ? incomeData.value : [];
    const metrics = metricsData.status === 'fulfilled' ? metricsData.value : [];
    const historical = histData.status === 'fulfilled' ? histData.value : [];
    const shortRaw = shortData.status === 'fulfilled' ? shortData.value : null;

    // Annual period on or before snapshot date
    const curIncome = findPeriodOnOrBefore(income, date);
    const curMetrics = findPeriodOnOrBefore(metrics, date);

    // Prior income statement for revenue growth
    const priorIncome = curIncome
      ? income.find(p => p.date !== curIncome.date && new Date(p.date) < new Date(curIncome.date))
      : null;

    // Revenue growth YoY
    let revenueGrowthYoY = null;
    if (curIncome?.revenue != null && priorIncome?.revenue && priorIncome.revenue !== 0) {
      revenueGrowthYoY = (curIncome.revenue - priorIncome.revenue) / Math.abs(priorIncome.revenue);
    }

    // Gross margin
    const grossMargin = curIncome?.grossProfitRatio ?? null;

    // Price on snapshot date (newest-first historical array)
    const price = findPrice(historical, date);

    // RSI: oldest-first, last 30 prices on or before snapshot date
    const pricesAsc = [...historical]
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .filter(h => new Date(h.date) <= new Date(date))
      .map(h => h.close);
    const rsi14 = computeRSI(pricesAsc.slice(-30));

    // 52-week high (all prices in the 1-year window)
    const high52w = historical.length > 0 ? Math.max(...historical.map(h => h.close)) : null;
    const pctBelowHigh =
      price != null && high52w != null && high52w > 0
        ? ((high52w - price) / high52w) * 100
        : null;

    res.json({
      ticker: sym,
      companyName: profile.companyName || sym,
      sector: profile.sector || null,
      date,
      price,
      peRatio: curMetrics?.peRatio ?? null,
      priceToSales: curMetrics?.priceToSalesRatio ?? null,
      revenueGrowthYoY,
      grossMargin,
      rsi14,
      pctBelowHigh,
      marketCap: curMetrics?.marketCap ?? null,
      shortInterestPct: shortRaw?.shortInterestPercent ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 4: Register the snapshot route in `server/index.js`** (add one line)

```js
// Add after the health check line:
app.use('/api/snapshot', require('./routes/snapshot'));
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd /Users/nictowey/blueprint/server
npx jest tests/snapshot.test.js --no-coverage
```

Expected: `Tests: 4 passed, 4 total`

- [ ] **Step 6: Commit**

```bash
cd /Users/nictowey/blueprint
git add server/routes/snapshot.js server/tests/snapshot.test.js server/index.js
git commit -m "feat: snapshot route with RSI + 52w high computation"
```

---

## Task 8: Search Route

**Files:**
- Create: `server/routes/search.js`

No automated test (just proxies FMP; tested manually).

- [ ] **Step 1: Create `server/routes/search.js`**

```js
const express = require('express');
const router = express.Router();
const fmp = require('../services/fmp');

router.get('/', async (req, res) => {
  const { q } = req.query;
  if (!q || q.trim().length < 1) return res.json([]);

  try {
    const results = await fmp.searchTickers(q.trim());
    const filtered = results
      .filter(r => r.exchangeShortName === 'NASDAQ' || r.exchangeShortName === 'NYSE')
      .slice(0, 10)
      .map(r => ({
        symbol: r.symbol,
        name: r.name,
        exchangeShortName: r.exchangeShortName,
      }));
    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 2: Register the search route in `server/index.js`**

```js
app.use('/api/search', require('./routes/search'));
```

- [ ] **Step 3: Commit**

```bash
cd /Users/nictowey/blueprint
git add server/routes/search.js server/index.js
git commit -m "feat: ticker search route"
```

---

## Task 9: Matches Route + Test

**Files:**
- Create: `server/routes/matches.js`
- Create: `server/tests/matches.test.js`

- [ ] **Step 1: Write failing test in `server/tests/matches.test.js`**

```js
jest.mock('../services/universe');
const universe = require('../services/universe');
const request = require('supertest');
const app = require('../index');

const makeStock = (ticker) => ({
  ticker,
  companyName: `${ticker} Corp`,
  sector: 'Technology',
  price: 150,
  peRatio: 25,
  revenueGrowthYoY: 0.2,
  grossMargin: 0.6,
  marketCap: 20_000_000_000,
  rsi14: 55,
  pctBelowHigh: 8,
});

const mockUniverse = new Map();
for (let i = 0; i < 15; i++) mockUniverse.set(`STK${i}`, makeStock(`STK${i}`));

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
    const res = await request(app).get('/api/matches?ticker=NVDA&date=2019-06-15');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeLessThanOrEqual(10);
  });

  test('each result has matchScore, topMatches, topDifferences', async () => {
    const res = await request(app).get('/api/matches?ticker=NVDA&date=2019-06-15');
    for (const item of res.body) {
      expect(typeof item.matchScore).toBe('number');
      expect(Array.isArray(item.topMatches)).toBe(true);
      expect(Array.isArray(item.topDifferences)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd /Users/nictowey/blueprint/server
npx jest tests/matches.test.js --no-coverage 2>&1 | tail -10
```

Expected: failures (route not registered).

- [ ] **Step 3: Create `server/routes/matches.js`**

```js
const express = require('express');
const router = express.Router();
const { getCache, isReady } = require('../services/universe');
const { findMatches } = require('../services/matcher');

router.get('/', async (req, res) => {
  const { ticker, date } = req.query;
  if (!ticker || !date) {
    return res.status(400).json({ error: 'ticker and date are required' });
  }

  if (!isReady()) {
    return res.status(503).json({ error: 'Stock universe cache is still loading. Please try again in a moment.' });
  }

  // Build a minimal snapshot from query params to run matching
  // The snapshot metrics come from the client (passed via the actual snapshot data).
  // This route expects the snapshot metrics as query params.
  const snapshot = {
    ticker: ticker.toUpperCase(),
    peRatio: req.query.peRatio ? parseFloat(req.query.peRatio) : null,
    revenueGrowthYoY: req.query.revenueGrowthYoY ? parseFloat(req.query.revenueGrowthYoY) : null,
    grossMargin: req.query.grossMargin ? parseFloat(req.query.grossMargin) : null,
    marketCap: req.query.marketCap ? parseFloat(req.query.marketCap) : null,
    rsi14: req.query.rsi14 ? parseFloat(req.query.rsi14) : null,
    pctBelowHigh: req.query.pctBelowHigh ? parseFloat(req.query.pctBelowHigh) : null,
  };

  try {
    const universe = getCache();
    const matches = findMatches(snapshot, universe);
    res.json(matches);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 4: Register in `server/index.js`**

```js
app.use('/api/matches', require('./routes/matches'));
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd /Users/nictowey/blueprint/server
npx jest tests/matches.test.js --no-coverage
```

Expected: `Tests: 4 passed, 4 total`

- [ ] **Step 6: Commit**

```bash
cd /Users/nictowey/blueprint
git add server/routes/matches.js server/tests/matches.test.js server/index.js
git commit -m "feat: matches route reading from universe cache"
```

---

## Task 10: Comparison Route

**Files:**
- Create: `server/routes/comparison.js`

- [ ] **Step 1: Create `server/routes/comparison.js`**

```js
const express = require('express');
const router = express.Router();
const fmp = require('../services/fmp');
const { computeRSI } = require('../services/rsi');

function findPeriodOnOrBefore(periods, targetDate) {
  const target = new Date(targetDate);
  return periods
    .filter(p => new Date(p.date) <= target)
    .sort((a, b) => new Date(b.date) - new Date(a.date))[0] || null;
}

function findPrice(historical, targetDate) {
  const target = new Date(targetDate);
  const entry = historical.find(h => new Date(h.date) <= target);
  return entry ? entry.close : null;
}

// Build a snapshot-shaped object from live TTM metrics + profile
async function buildCurrentMetrics(ticker) {
  const [profile, ttm, income, hist] = await Promise.all([
    fmp.getProfile(ticker),
    fmp.getKeyMetricsTTM(ticker),
    fmp.getIncomeStatements(ticker, 2),
    fmp.getHistoricalPrices(ticker,
      new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10),
      new Date().toISOString().slice(0, 10)
    ),
  ]);

  const income0 = income[0] || {};
  const income1 = income[1] || {};
  const grossMargin = income0.grossProfitRatio ?? null;
  let revenueGrowthYoY = null;
  if (income0.revenue != null && income1.revenue && income1.revenue !== 0) {
    revenueGrowthYoY = (income0.revenue - income1.revenue) / Math.abs(income1.revenue);
  }

  const pricesAsc = [...hist].reverse().map(h => h.close);
  const rsi14 = computeRSI(pricesAsc.slice(-30));
  const currentPrice = hist[0]?.close ?? null;
  const high52w = hist.length > 0 ? Math.max(...hist.map(h => h.close)) : null;
  const pctBelowHigh =
    currentPrice != null && high52w != null && high52w > 0
      ? ((high52w - currentPrice) / high52w) * 100
      : null;

  return {
    ticker,
    companyName: profile?.companyName || ticker,
    sector: profile?.sector || null,
    date: new Date().toISOString().slice(0, 10),
    price: currentPrice,
    peRatio: ttm.peRatioTTM ?? null,
    priceToSales: ttm.priceToSalesRatioTTM ?? null,
    revenueGrowthYoY,
    grossMargin,
    rsi14,
    pctBelowHigh,
    marketCap: ttm.marketCapTTM ?? null,
    shortInterestPct: null,
  };
}

router.get('/', async (req, res) => {
  const { ticker, date, matchTicker } = req.query;
  if (!ticker || !date || !matchTicker) {
    return res.status(400).json({ error: 'ticker, date, and matchTicker are required' });
  }

  const sym = ticker.toUpperCase();
  const matchSym = matchTicker.toUpperCase();

  // Date 18 months after snapshot for sparkline
  const afterDate = new Date(date);
  afterDate.setMonth(afterDate.getMonth() + 18);
  const afterStr = afterDate.toISOString().slice(0, 10);
  const todayStr = new Date().toISOString().slice(0, 10);
  const sparklineEnd = afterStr < todayStr ? afterStr : todayStr;

  try {
    const fromDate = new Date(date);
    fromDate.setFullYear(fromDate.getFullYear() - 1);
    const fromStr = fromDate.toISOString().slice(0, 10);

    const [profileData, incomeData, metricsData, histData, shortData, sparklineData, matchData] =
      await Promise.allSettled([
        fmp.getProfile(sym),
        fmp.getIncomeStatements(sym),
        fmp.getKeyMetricsAnnual(sym),
        fmp.getHistoricalPrices(sym, fromStr, date),
        fmp.getShortInterest(sym),
        fmp.getHistoricalPrices(sym, date, sparklineEnd),
        buildCurrentMetrics(matchSym),
      ]);

    const profile = profileData.status === 'fulfilled' ? profileData.value : {};
    const income = incomeData.status === 'fulfilled' ? incomeData.value : [];
    const metrics = metricsData.status === 'fulfilled' ? metricsData.value : [];
    const historical = histData.status === 'fulfilled' ? histData.value : [];
    const shortRaw = shortData.status === 'fulfilled' ? shortData.value : null;
    const sparklineRaw = sparklineData.status === 'fulfilled' ? sparklineData.value : [];
    const matchMetrics = matchData.status === 'fulfilled' ? matchData.value : {};

    const curIncome = findPeriodOnOrBefore(income, date);
    const curMetrics = findPeriodOnOrBefore(metrics, date);
    const priorIncome = curIncome
      ? income.find(p => p.date !== curIncome.date && new Date(p.date) < new Date(curIncome.date))
      : null;

    let revenueGrowthYoY = null;
    if (curIncome?.revenue != null && priorIncome?.revenue && priorIncome.revenue !== 0) {
      revenueGrowthYoY = (curIncome.revenue - priorIncome.revenue) / Math.abs(priorIncome.revenue);
    }

    const price = findPrice(historical, date);
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

    const template = {
      ticker: sym,
      companyName: profile.companyName || sym,
      sector: profile.sector || null,
      date,
      price,
      peRatio: curMetrics?.peRatio ?? null,
      priceToSales: curMetrics?.priceToSalesRatio ?? null,
      revenueGrowthYoY,
      grossMargin: curIncome?.grossProfitRatio ?? null,
      rsi14,
      pctBelowHigh,
      marketCap: curMetrics?.marketCap ?? null,
      shortInterestPct: shortRaw?.shortInterestPercent ?? null,
    };

    // Sparkline: oldest first, from snapshot date onward
    const sparkline = [...sparklineRaw]
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .map(h => ({ date: h.date, price: h.close }));

    // Gain/loss % over sparkline period
    let sparklineGainPct = null;
    if (sparkline.length >= 2) {
      const start = sparkline[0].price;
      const end = sparkline[sparkline.length - 1].price;
      if (start > 0) sparklineGainPct = ((end - start) / start) * 100;
    }

    res.json({ template, match: matchMetrics, sparkline, sparklineGainPct });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 2: Register in `server/index.js`**

```js
app.use('/api/comparison', require('./routes/comparison'));
```

- [ ] **Step 3: Commit**

```bash
cd /Users/nictowey/blueprint
git add server/routes/comparison.js server/index.js
git commit -m "feat: comparison route with sparkline data"
```

---

## Task 11: Status Route + Wire All Routes

**Files:**
- Create: `server/routes/status.js`
- Modify: `server/index.js`

- [ ] **Step 1: Create `server/routes/status.js`**

```js
const express = require('express');
const router = express.Router();
const { getStatus } = require('../services/universe');

router.get('/', (_req, res) => {
  res.json(getStatus());
});

module.exports = router;
```

- [ ] **Step 2: Replace `server/index.js` with the final version (all routes + universe startup)**

```js
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/search',     require('./routes/search'));
app.use('/api/snapshot',   require('./routes/snapshot'));
app.use('/api/matches',    require('./routes/matches'));
app.use('/api/comparison', require('./routes/comparison'));
app.use('/api/status',     require('./routes/status'));

const PORT = process.env.PORT || 3001;

if (require.main === module) {
  const { startCache } = require('./services/universe');
  app.listen(PORT, () => {
    console.log(`[server] Running on port ${PORT}`);
    startCache();
  });
}

module.exports = app;
```

- [ ] **Step 3: Run all server tests to confirm nothing broke**

```bash
cd /Users/nictowey/blueprint/server
npx jest --no-coverage
```

Expected: all tests pass (rsi, matcher, snapshot, matches).

- [ ] **Step 4: Commit**

```bash
cd /Users/nictowey/blueprint
git add server/routes/status.js server/index.js
git commit -m "feat: status route + wire all server routes"
```

---

## Task 12: Client Scaffold

**Files:**
- Create: `client/package.json`
- Create: `client/vite.config.js`
- Create: `client/tailwind.config.js`
- Create: `client/postcss.config.js`
- Create: `client/index.html`
- Create: `client/src/main.jsx`

- [ ] **Step 1: Create `client/package.json`**

```json
{
  "name": "blueprint-client",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.23.1"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.3.1",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.38",
    "tailwindcss": "^3.4.4",
    "vite": "^5.3.1"
  }
}
```

- [ ] **Step 2: Create `client/vite.config.js`**

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
```

- [ ] **Step 3: Create `client/tailwind.config.js`**

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        'dark-bg':     '#0f0f13',
        'dark-card':   '#1a1a24',
        'dark-border': '#2a2a3a',
        accent:        '#6c63ff',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 4: Create `client/postcss.config.js`**

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 5: Create `client/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Blueprint</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create `client/src/main.jsx`**

```jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
```

- [ ] **Step 7: Install client deps and verify Vite starts**

```bash
cd /Users/nictowey/blueprint/client
npm install
```

Expected: node_modules created, no errors.

- [ ] **Step 8: Commit**

```bash
cd /Users/nictowey/blueprint
git add client/
git commit -m "feat: client scaffold — Vite + React + Tailwind"
```

---

## Task 13: App Shell — Routing, Global Styles, Header, Format Utils

**Files:**
- Create: `client/src/App.jsx`
- Create: `client/src/index.css`
- Create: `client/src/utils/format.js`
- Create: `client/src/components/Header.jsx`

- [ ] **Step 1: Create `client/src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  body {
    background-color: #0f0f13;
    color: #f1f5f9;
    font-family: 'Inter', system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
}

@layer components {
  .card {
    @apply bg-dark-card border border-dark-border rounded-xl p-6;
  }
  .btn-primary {
    @apply bg-accent hover:bg-opacity-90 text-white font-semibold px-6 py-3 rounded-lg transition-all duration-150 cursor-pointer;
  }
  .btn-secondary {
    @apply border border-dark-border text-slate-400 hover:text-white hover:border-slate-500 px-4 py-2 rounded-lg transition-all duration-150 cursor-pointer text-sm;
  }
  .input-field {
    @apply bg-dark-card border border-dark-border text-slate-100 rounded-lg px-4 py-2.5 outline-none
           focus:border-accent focus:ring-1 focus:ring-accent transition-all duration-150 w-full placeholder-slate-600;
  }
  .tag-green {
    @apply text-xs bg-green-500/10 border border-green-500/30 text-green-400 px-2.5 py-0.5 rounded-full;
  }
  .tag-yellow {
    @apply text-xs bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 px-2.5 py-0.5 rounded-full;
  }
}
```

- [ ] **Step 2: Create `client/src/utils/format.js`**

```js
/**
 * Format a metric value for display.
 * Returns '—' when value is null/undefined.
 */
export function formatMetric(key, value) {
  if (value == null) return '—';

  switch (key) {
    case 'price':
      return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    case 'peRatio':
      return `${value.toFixed(1)}x`;
    case 'priceToSales':
      return `${value.toFixed(1)}x`;
    case 'revenueGrowthYoY':
      return `${(value * 100).toFixed(1)}%`;
    case 'grossMargin':
      return `${(value * 100).toFixed(1)}%`;
    case 'rsi14':
      return value.toFixed(1);
    case 'pctBelowHigh':
      return `${value.toFixed(1)}%`;
    case 'marketCap':
      return formatMarketCap(value);
    case 'shortInterestPct':
      return `${value.toFixed(1)}%`;
    default:
      return String(value);
  }
}

function formatMarketCap(value) {
  if (value >= 1e12) return `$${(value / 1e12).toFixed(1)}T`;
  if (value >= 1e9)  return `$${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6)  return `$${(value / 1e6).toFixed(1)}M`;
  return `$${value.toLocaleString()}`;
}

export const METRIC_LABELS = {
  price:             'Price',
  peRatio:           'P/E Ratio',
  priceToSales:      'Price-to-Sales',
  revenueGrowthYoY:  'Revenue Growth YoY',
  grossMargin:       'Gross Margin',
  rsi14:             'RSI (14-day)',
  pctBelowHigh:      '% Below 52W High',
  marketCap:         'Market Cap',
  shortInterestPct:  'Short Interest %',
};
```

- [ ] **Step 3: Create `client/src/components/Header.jsx`**

```jsx
export default function Header() {
  return (
    <header className="border-b border-dark-border bg-dark-card/50 backdrop-blur sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md bg-accent flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <rect x="1" y="1" width="5" height="5" rx="1" fill="white" opacity="0.9"/>
              <rect x="8" y="1" width="5" height="5" rx="1" fill="white" opacity="0.6"/>
              <rect x="1" y="8" width="5" height="5" rx="1" fill="white" opacity="0.6"/>
              <rect x="8" y="8" width="5" height="5" rx="1" fill="white" opacity="0.3"/>
            </svg>
          </div>
          <span className="text-xl font-bold text-slate-100 tracking-tight">Blueprint</span>
        </div>
        <span className="text-slate-500 text-sm hidden sm:block">
          Find tomorrow's breakouts by matching yesterday's winners
        </span>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Create `client/src/App.jsx`**

```jsx
import { Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import TemplatePicker from './pages/TemplatePicker';
import MatchResults from './pages/MatchResults';
import ComparisonDetail from './pages/ComparisonDetail';

export default function App() {
  return (
    <div className="min-h-screen bg-dark-bg">
      <Header />
      <Routes>
        <Route path="/"           element={<TemplatePicker />} />
        <Route path="/matches"    element={<MatchResults />} />
        <Route path="/comparison" element={<ComparisonDetail />} />
      </Routes>
    </div>
  );
}
```

- [ ] **Step 5: Create placeholder page stubs so Vite builds**

Create `client/src/pages/TemplatePicker.jsx`:
```jsx
export default function TemplatePicker() { return <div className="p-8 text-slate-400">Screen 1 — coming soon</div>; }
```

Create `client/src/pages/MatchResults.jsx`:
```jsx
export default function MatchResults() { return <div className="p-8 text-slate-400">Screen 2 — coming soon</div>; }
```

Create `client/src/pages/ComparisonDetail.jsx`:
```jsx
export default function ComparisonDetail() { return <div className="p-8 text-slate-400">Screen 3 — coming soon</div>; }
```

- [ ] **Step 6: Verify client builds without errors**

```bash
cd /Users/nictowey/blueprint/client
npx vite build 2>&1 | tail -5
```

Expected: `✓ built in ...` with no errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/nictowey/blueprint
git add client/src/
git commit -m "feat: app shell — routing, global styles, header, format utils"
```

---

## Task 14: TickerSearch Component

**Files:**
- Create: `client/src/components/TickerSearch.jsx`

- [ ] **Step 1: Create `client/src/components/TickerSearch.jsx`**

```jsx
import { useState, useEffect, useRef } from 'react';

export default function TickerSearch({ value, onChange, onSelect }) {
  const [query, setQuery] = useState(value || '');
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);
  const wrapperRef = useRef(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  function handleChange(e) {
    const val = e.target.value.toUpperCase();
    setQuery(val);
    onChange(val);

    clearTimeout(debounceRef.current);
    if (val.length < 1) { setSuggestions([]); setOpen(false); return; }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(val)}`);
        const data = await res.json();
        setSuggestions(Array.isArray(data) ? data : []);
        setOpen(true);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 300);
  }

  function handleSelect(item) {
    setQuery(item.symbol);
    onChange(item.symbol);
    onSelect(item.symbol);
    setOpen(false);
    setSuggestions([]);
  }

  return (
    <div className="relative" ref={wrapperRef}>
      <div className="relative">
        <input
          type="text"
          className="input-field pr-10 uppercase tracking-widest font-mono"
          placeholder="NVDA"
          value={query}
          onChange={handleChange}
          onFocus={() => suggestions.length > 0 && setOpen(true)}
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
      {open && suggestions.length > 0 && (
        <div className="absolute z-20 w-full mt-1 bg-dark-card border border-dark-border rounded-lg shadow-xl overflow-hidden">
          {suggestions.map(item => (
            <button
              key={item.symbol}
              className="w-full text-left px-4 py-2.5 hover:bg-dark-border flex items-center justify-between gap-3 transition-colors"
              onMouseDown={() => handleSelect(item)}
            >
              <span className="font-mono font-semibold text-slate-100 text-sm">{item.symbol}</span>
              <span className="text-slate-400 text-sm truncate">{item.name}</span>
              <span className="text-slate-600 text-xs flex-shrink-0">{item.exchangeShortName}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/nictowey/blueprint
git add client/src/components/TickerSearch.jsx
git commit -m "feat: TickerSearch component with debounced typeahead"
```

---

## Task 15: SnapshotCard Component

**Files:**
- Create: `client/src/components/SnapshotCard.jsx`

- [ ] **Step 1: Create `client/src/components/SnapshotCard.jsx`**

```jsx
import { formatMetric, METRIC_LABELS } from '../utils/format';

const METRICS = [
  'price', 'peRatio', 'priceToSales',
  'revenueGrowthYoY', 'grossMargin', 'rsi14',
  'pctBelowHigh', 'marketCap', 'shortInterestPct',
];

function MetricCell({ label, value }) {
  return (
    <div className="bg-dark-bg rounded-lg p-4 flex flex-col gap-1.5">
      <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">{label}</span>
      <span className={`text-lg font-semibold ${value === '—' ? 'text-slate-600' : 'text-slate-100'}`}>
        {value}
      </span>
    </div>
  );
}

export default function SnapshotCard({ snapshot }) {
  return (
    <div className="card">
      <div className="flex items-start justify-between mb-5">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <span className="text-2xl font-bold text-slate-100 font-mono">{snapshot.ticker}</span>
            {snapshot.sector && (
              <span className="text-xs border border-dark-border text-slate-400 px-2.5 py-1 rounded-full">
                {snapshot.sector}
              </span>
            )}
          </div>
          <p className="text-slate-400">{snapshot.companyName}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Snapshot Date</p>
          <p className="text-sm font-medium text-slate-300">{snapshot.date}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {METRICS.map(key => (
          <MetricCell
            key={key}
            label={METRIC_LABELS[key]}
            value={formatMetric(key, snapshot[key])}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/nictowey/blueprint
git add client/src/components/SnapshotCard.jsx
git commit -m "feat: SnapshotCard component with 3-column metric grid"
```

---

## Task 16: TemplatePicker Page (Screen 1)

**Files:**
- Modify: `client/src/pages/TemplatePicker.jsx` (replace stub)

- [ ] **Step 1: Replace `client/src/pages/TemplatePicker.jsx`**

```jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import TickerSearch from '../components/TickerSearch';
import SnapshotCard from '../components/SnapshotCard';

// Yesterday as YYYY-MM-DD (max date for picker)
function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export default function TemplatePicker() {
  const navigate = useNavigate();
  const [ticker, setTicker] = useState('');
  const [date, setDate] = useState('2020-01-15');
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function loadSnapshot() {
    if (!ticker.trim()) { setError('Enter a stock ticker'); return; }
    if (!date) { setError('Select a date'); return; }
    setError(null);
    setLoading(true);
    setSnapshot(null);
    try {
      const res = await fetch(`/api/snapshot?ticker=${encodeURIComponent(ticker)}&date=${date}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load snapshot');
      setSnapshot(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function goToMatches() {
    if (!snapshot) return;
    navigate('/matches', { state: { snapshot } });
  }

  return (
    <main className="max-w-3xl mx-auto px-6 py-12">
      {/* Hero */}
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-slate-100 mb-3">
          Find the next <span className="text-accent">10x</span>
        </h1>
        <p className="text-slate-400 text-lg">
          Pick a stock and a date. See what its profile looked like. Find stocks that look the same today.
        </p>
      </div>

      {/* Search area */}
      <div className="card mb-6">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">Template Stock</p>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="block text-sm text-slate-400 mb-1.5">Ticker</label>
            <TickerSearch
              value={ticker}
              onChange={setTicker}
              onSelect={setTicker}
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">Snapshot Date</label>
            <input
              type="date"
              className="input-field w-40"
              value={date}
              min="2010-01-01"
              max={yesterday()}
              onChange={e => setDate(e.target.value)}
            />
          </div>
          <button
            className="btn-primary whitespace-nowrap"
            onClick={loadSnapshot}
            disabled={loading}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Loading…
              </span>
            ) : 'Load Snapshot'}
          </button>
        </div>
        {error && (
          <p className="mt-3 text-red-400 text-sm">{error}</p>
        )}
      </div>

      {/* Snapshot card */}
      {snapshot && (
        <>
          <SnapshotCard snapshot={snapshot} />
          <div className="mt-6">
            <button
              className="btn-primary w-full text-center text-base py-4"
              onClick={goToMatches}
            >
              Find Stocks That Look Like This Today →
            </button>
          </div>
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Start both servers and verify Screen 1 renders**

```bash
cd /Users/nictowey/blueprint
# In one terminal: node server/index.js
# In another: cd client && npx vite
# Open http://localhost:5173
# Search for NVDA, pick a date, click Load Snapshot
# Confirm snapshot card appears
```

- [ ] **Step 3: Commit**

```bash
cd /Users/nictowey/blueprint
git add client/src/pages/TemplatePicker.jsx
git commit -m "feat: TemplatePicker page — Screen 1 complete"
```

---

## Task 17: MatchCard Component

**Files:**
- Create: `client/src/components/MatchCard.jsx`

- [ ] **Step 1: Create `client/src/components/MatchCard.jsx`**

```jsx
import { useNavigate } from 'react-router-dom';
import { formatMetric, METRIC_LABELS } from '../utils/format';

export default function MatchCard({ match, snapshot, rank }) {
  const navigate = useNavigate();

  function goToComparison() {
    navigate('/comparison', { state: { snapshot, matchTicker: match.ticker } });
  }

  return (
    <div className="card hover:border-accent/40 transition-colors cursor-default">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2.5 mb-0.5">
            <span className="text-xs text-slate-600 font-medium">#{rank}</span>
            <span className="font-mono font-bold text-slate-100 text-lg">{match.ticker}</span>
            <span className="text-slate-400">{match.companyName}</span>
          </div>
          <div className="flex items-center gap-2 mt-1">
            {match.sector && (
              <span className="text-xs border border-dark-border text-slate-500 px-2 py-0.5 rounded-full">
                {match.sector}
              </span>
            )}
            <span className="text-sm text-slate-300 font-medium">
              {formatMetric('price', match.price)}
            </span>
          </div>
        </div>
        <div className="text-right">
          <div
            className="inline-flex items-center px-3 py-1 rounded-full text-sm font-bold"
            style={{
              background: 'linear-gradient(135deg, #6c63ff22, #6c63ff44)',
              border: '1px solid #6c63ff66',
              color: '#a09cf5',
            }}
          >
            {match.matchScore}% Match
          </div>
        </div>
      </div>

      {/* Metric tags */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {match.topMatches.map(key => (
          <span key={key} className="tag-green">
            {METRIC_LABELS[key] || key} ✓
          </span>
        ))}
        {match.topDifferences.map(key => (
          <span key={key} className="tag-yellow">
            {METRIC_LABELS[key] || key} ~
          </span>
        ))}
      </div>

      <div className="flex justify-end">
        <button className="btn-secondary" onClick={goToComparison}>
          View Comparison →
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/nictowey/blueprint
git add client/src/components/MatchCard.jsx
git commit -m "feat: MatchCard component with match score + metric tags"
```

---

## Task 18: MatchResults Page (Screen 2)

**Files:**
- Modify: `client/src/pages/MatchResults.jsx` (replace stub)

- [ ] **Step 1: Replace `client/src/pages/MatchResults.jsx`**

```jsx
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import MatchCard from '../components/MatchCard';
import { formatMetric } from '../utils/format';

const LOADING_MESSAGES = [
  'Scanning the stock universe…',
  'Calculating similarity scores…',
  'Ranking closest matches…',
  'Almost there…',
];

export default function MatchResults() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const snapshot = state?.snapshot;

  const [matches, setMatches] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [msgIdx, setMsgIdx] = useState(0);

  // Redirect if no snapshot in state
  useEffect(() => {
    if (!snapshot) navigate('/', { replace: true });
  }, [snapshot, navigate]);

  // Rotate loading messages
  useEffect(() => {
    if (!loading) return;
    const id = setInterval(() => {
      setMsgIdx(i => (i + 1) % LOADING_MESSAGES.length);
    }, 1800);
    return () => clearInterval(id);
  }, [loading]);

  useEffect(() => {
    if (!snapshot) return;
    const params = new URLSearchParams({
      ticker: snapshot.ticker,
      date: snapshot.date,
      ...(snapshot.peRatio          != null && { peRatio:          snapshot.peRatio }),
      ...(snapshot.revenueGrowthYoY != null && { revenueGrowthYoY: snapshot.revenueGrowthYoY }),
      ...(snapshot.grossMargin      != null && { grossMargin:      snapshot.grossMargin }),
      ...(snapshot.marketCap        != null && { marketCap:        snapshot.marketCap }),
      ...(snapshot.rsi14            != null && { rsi14:            snapshot.rsi14 }),
      ...(snapshot.pctBelowHigh     != null && { pctBelowHigh:     snapshot.pctBelowHigh }),
    });

    fetch(`/api/matches?${params}`)
      .then(res => {
        if (!res.ok) return res.json().then(d => { throw new Error(d.error || 'Match failed'); });
        return res.json();
      })
      .then(data => { setMatches(data); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [snapshot]);

  if (!snapshot) return null;

  return (
    <main className="max-w-3xl mx-auto px-6 py-10">
      {/* Summary bar */}
      <div className="card mb-8 flex flex-wrap items-center gap-4 justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono font-bold text-xl text-slate-100">{snapshot.ticker}</span>
            <span className="text-slate-500">·</span>
            <span className="text-slate-400 text-sm">{snapshot.date}</span>
          </div>
          <p className="text-sm text-slate-400">{snapshot.companyName}</p>
        </div>
        <div className="flex gap-6">
          {[
            { key: 'peRatio', label: 'P/E' },
            { key: 'revenueGrowthYoY', label: 'Growth' },
            { key: 'grossMargin', label: 'Margin' },
          ].map(({ key, label }) => (
            <div key={key} className="text-center">
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-0.5">{label}</p>
              <p className="text-sm font-semibold text-slate-200">{formatMetric(key, snapshot[key])}</p>
            </div>
          ))}
        </div>
        <button className="btn-secondary" onClick={() => navigate(-1)}>← Back</button>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-24 gap-4">
          <div className="w-10 h-10 border-4 border-dark-border border-t-accent rounded-full animate-spin" />
          <p className="text-slate-400 text-sm animate-pulse">{LOADING_MESSAGES[msgIdx]}</p>
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <div className="card border-red-500/30 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Match results */}
      {matches && !loading && (
        <>
          <p className="text-sm text-slate-500 mb-5">
            {matches.length} stocks matched — ranked by similarity
          </p>
          <div className="flex flex-col gap-4">
            {matches.map((match, i) => (
              <MatchCard key={match.ticker} match={match} snapshot={snapshot} rank={i + 1} />
            ))}
          </div>
        </>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Verify Screen 2 renders — run both servers and navigate from Screen 1**

```bash
# With both servers running (npm run dev from root):
# Load a snapshot on Screen 1, click "Find Stocks That Look Like This Today"
# Confirm loading messages rotate, results render as MatchCards
```

- [ ] **Step 3: Commit**

```bash
cd /Users/nictowey/blueprint
git add client/src/pages/MatchResults.jsx
git commit -m "feat: MatchResults page — Screen 2 complete"
```

---

## Task 19: Sparkline Component

**Files:**
- Create: `client/src/components/Sparkline.jsx`

Pure SVG — no charting library required.

- [ ] **Step 1: Create `client/src/components/Sparkline.jsx`**

```jsx
export default function Sparkline({ data, gainPct }) {
  if (!data || data.length < 2) {
    return <div className="h-24 flex items-center justify-center text-slate-600 text-sm">No price history</div>;
  }

  const prices = data.map(d => d.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const range = maxP - minP || 1;

  const W = 600;
  const H = 80;
  const PAD = 4;

  const points = prices.map((p, i) => {
    const x = PAD + (i / (prices.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((p - minP) / range) * (H - PAD * 2);
    return `${x},${y}`;
  }).join(' ');

  const isPositive = gainPct == null || gainPct >= 0;
  const strokeColor = isPositive ? '#22c55e' : '#ef4444';
  const gainStr = gainPct == null
    ? '—'
    : `${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(1)}%`;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-slate-500 uppercase tracking-wider">
          What happened after this snapshot
        </span>
        <span
          className="text-sm font-bold"
          style={{ color: isPositive ? '#22c55e' : '#ef4444' }}
        >
          {gainStr} over 18 months
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: '80px' }}
        preserveAspectRatio="none"
      >
        <polyline
          points={points}
          fill="none"
          stroke={strokeColor}
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/nictowey/blueprint
git add client/src/components/Sparkline.jsx
git commit -m "feat: Sparkline SVG component for post-snapshot price history"
```

---

## Task 20: ComparisonRow Component

**Files:**
- Create: `client/src/components/ComparisonRow.jsx`

- [ ] **Step 1: Create `client/src/components/ComparisonRow.jsx`**

```jsx
import { formatMetric } from '../utils/format';

// Color-code by % difference between two metric values
function getDiffColor(key, leftVal, rightVal) {
  if (leftVal == null || rightVal == null) return 'text-slate-600';
  let leftNum = leftVal;
  let rightNum = rightVal;
  if (leftNum === 0) return rightNum === 0 ? 'text-green-400' : 'text-red-400';
  const pctDiff = Math.abs((rightNum - leftNum) / Math.abs(leftNum)) * 100;
  if (pctDiff <= 15) return 'text-green-400';
  if (pctDiff <= 40) return 'text-yellow-400';
  return 'text-red-400';
}

function DotIndicator({ colorClass }) {
  return (
    <div className={`w-2 h-2 rounded-full bg-current ${colorClass} mx-auto`} />
  );
}

export default function ComparisonRow({ label, metricKey, leftValue, rightValue }) {
  const colorClass = getDiffColor(metricKey, leftValue, rightValue);

  return (
    <div className="grid grid-cols-[1fr_2px_40px_2px_1fr] items-center gap-0 py-3 border-b border-dark-border last:border-0">
      {/* Left value */}
      <div className="text-right pr-4">
        <span className={`text-sm font-semibold ${leftValue == null ? 'text-slate-600' : 'text-slate-100'}`}>
          {formatMetric(metricKey, leftValue)}
        </span>
      </div>

      {/* Divider */}
      <div className="w-px bg-dark-border h-full" />

      {/* Color dot */}
      <div className="flex justify-center">
        <DotIndicator colorClass={colorClass} />
      </div>

      {/* Divider */}
      <div className="w-px bg-dark-border h-full" />

      {/* Right value */}
      <div className="pl-4">
        <span className={`text-sm font-semibold ${rightValue == null ? 'text-slate-600' : 'text-slate-100'}`}>
          {formatMetric(metricKey, rightValue)}
        </span>
      </div>
    </div>
  );
}

// Static row for the label column (rendered separately)
export function MetricLabel({ label }) {
  return (
    <div className="py-3 border-b border-dark-border last:border-0 text-center">
      <span className="text-xs text-slate-500 uppercase tracking-wider">{label}</span>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
cd /Users/nictowey/blueprint
git add client/src/components/ComparisonRow.jsx
git commit -m "feat: ComparisonRow with green/yellow/red color coding"
```

---

## Task 21: ComparisonDetail Page (Screen 3)

**Files:**
- Modify: `client/src/pages/ComparisonDetail.jsx` (replace stub)

- [ ] **Step 1: Replace `client/src/pages/ComparisonDetail.jsx`**

```jsx
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Sparkline from '../components/Sparkline';
import ComparisonRow, { MetricLabel } from '../components/ComparisonRow';
import { formatMetric, METRIC_LABELS } from '../utils/format';

const DISPLAY_METRICS = [
  'peRatio', 'priceToSales', 'revenueGrowthYoY',
  'grossMargin', 'rsi14', 'pctBelowHigh',
];

const WATCHLIST_KEY = 'blueprint_watchlist';

function getWatchlist() {
  try { return JSON.parse(localStorage.getItem(WATCHLIST_KEY) || '[]'); } catch { return []; }
}

function saveToWatchlist(ticker, companyName) {
  const list = getWatchlist();
  if (list.find(item => item.ticker === ticker)) return; // already saved
  list.push({ ticker, companyName, addedAt: new Date().toISOString() });
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
}

export default function ComparisonDetail() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const snapshot = state?.snapshot;
  const matchTicker = state?.matchTicker;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [watchlisted, setWatchlisted] = useState(false);

  useEffect(() => {
    if (!snapshot || !matchTicker) navigate('/', { replace: true });
  }, [snapshot, matchTicker, navigate]);

  useEffect(() => {
    if (!snapshot || !matchTicker) return;
    const params = new URLSearchParams({
      ticker:      snapshot.ticker,
      date:        snapshot.date,
      matchTicker: matchTicker,
    });
    fetch(`/api/comparison?${params}`)
      .then(res => {
        if (!res.ok) return res.json().then(d => { throw new Error(d.error || 'Failed'); });
        return res.json();
      })
      .then(d => { setData(d); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, [snapshot, matchTicker]);

  function addToWatchlist() {
    if (!data?.match) return;
    saveToWatchlist(data.match.ticker, data.match.companyName);
    setWatchlisted(true);
  }

  if (!snapshot || !matchTicker) return null;

  return (
    <main className="max-w-5xl mx-auto px-6 py-10">
      {/* Nav */}
      <div className="flex items-center justify-between mb-8">
        <button className="btn-secondary" onClick={() => navigate(-1)}>← Back to Results</button>
        {data && (
          <button
            className={`btn-secondary ${watchlisted ? 'text-green-400 border-green-500/30' : ''}`}
            onClick={addToWatchlist}
            disabled={watchlisted}
          >
            {watchlisted ? '✓ Added to Watchlist' : 'Add to Watchlist'}
          </button>
        )}
      </div>

      {loading && (
        <div className="flex justify-center py-24">
          <div className="w-10 h-10 border-4 border-dark-border border-t-accent rounded-full animate-spin" />
        </div>
      )}

      {error && !loading && (
        <div className="card border-red-500/30 text-red-400 text-sm">{error}</div>
      )}

      {data && !loading && (
        <div className="grid grid-cols-2 gap-6">
          {/* LEFT PANEL — Template (historical) */}
          <div className="card">
            <div className="mb-4">
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Template · {data.template.date}</p>
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-xl text-slate-100">{data.template.ticker}</span>
                <span className="text-slate-400 text-sm">{data.template.companyName}</span>
              </div>
              {data.template.sector && (
                <span className="text-xs border border-dark-border text-slate-500 px-2 py-0.5 rounded-full mt-1 inline-block">
                  {data.template.sector}
                </span>
              )}
            </div>

            {/* Sparkline */}
            <div className="bg-dark-bg rounded-lg p-4 mb-6">
              <Sparkline data={data.sparkline} gainPct={data.sparklineGainPct} />
            </div>

            {/* Price */}
            <div className="flex items-center justify-between py-3 border-b border-dark-border mb-1">
              <span className="text-xs text-slate-500 uppercase tracking-wider">Price</span>
              <span className="text-sm font-semibold text-slate-100">
                {formatMetric('price', data.template.price)}
              </span>
            </div>

            {/* Metrics */}
            {DISPLAY_METRICS.map(key => (
              <div key={key} className="flex items-center justify-between py-3 border-b border-dark-border last:border-0">
                <span className="text-xs text-slate-500 uppercase tracking-wider">{METRIC_LABELS[key]}</span>
                <span className={`text-sm font-semibold ${data.template[key] == null ? 'text-slate-600' : 'text-slate-100'}`}>
                  {formatMetric(key, data.template[key])}
                </span>
              </div>
            ))}
          </div>

          {/* RIGHT PANEL — Match (current) */}
          <div className="card">
            <div className="mb-4">
              <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">
                Current · {data.match.date}
              </p>
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-xl text-slate-100">{data.match.ticker}</span>
                <span className="text-slate-400 text-sm">{data.match.companyName}</span>
              </div>
              {data.match.sector && (
                <span className="text-xs border border-dark-border text-slate-500 px-2 py-0.5 rounded-full mt-1 inline-block">
                  {data.match.sector}
                </span>
              )}
            </div>

            {/* Spacer to align with sparkline area */}
            <div className="bg-dark-bg rounded-lg p-4 mb-6 flex items-center justify-center" style={{ minHeight: '120px' }}>
              <p className="text-slate-600 text-sm text-center">
                Current profile as of today
              </p>
            </div>

            {/* Price with color coding vs template */}
            <div className="flex items-center justify-between py-3 border-b border-dark-border mb-1">
              <span className="text-xs text-slate-500 uppercase tracking-wider">Price</span>
              <span className="text-sm font-semibold text-slate-100">
                {formatMetric('price', data.match.price)}
              </span>
            </div>

            {/* Metrics with color coding */}
            {DISPLAY_METRICS.map(key => {
              const leftVal = data.template[key];
              const rightVal = data.match[key];
              let colorClass = 'text-slate-100';
              if (leftVal != null && rightVal != null && leftVal !== 0) {
                const pct = Math.abs((rightVal - leftVal) / Math.abs(leftVal)) * 100;
                if (pct <= 15) colorClass = 'text-green-400';
                else if (pct <= 40) colorClass = 'text-yellow-400';
                else colorClass = 'text-red-400';
              } else if (rightVal == null) {
                colorClass = 'text-slate-600';
              }
              return (
                <div key={key} className="flex items-center justify-between py-3 border-b border-dark-border last:border-0">
                  <span className="text-xs text-slate-500 uppercase tracking-wider">{METRIC_LABELS[key]}</span>
                  <span className={`text-sm font-semibold ${colorClass}`}>
                    {formatMetric(key, rightVal)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Verify Screen 3 renders — navigate from Screen 2 and click "View Comparison"**

```bash
# With both servers running:
# Navigate: Screen 1 → Screen 2 → click "View Comparison →" on any result
# Confirm: two-column layout, sparkline, color-coded metrics, watchlist button works
```

- [ ] **Step 3: Commit**

```bash
cd /Users/nictowey/blueprint
git add client/src/pages/ComparisonDetail.jsx
git commit -m "feat: ComparisonDetail page — Screen 3 complete"
```

---

## Task 22: README + Final Polish

**Files:**
- Create: `README.md`
- Verify: end-to-end smoke test

- [ ] **Step 1: Create `README.md`**

```markdown
# Blueprint

Blueprint is a stock analysis tool that lets investors pick a historical stock and date, see a fundamental and technical snapshot of that company at that moment, and then find current stocks that match the same profile. The core insight: if NVDA looked a certain way before it 10x'd, find stocks that look the same way today.

## How to Run Locally

**Prerequisites:** Node.js 18+, a Financial Modeling Prep API key (Starter plan or above)

```bash
# 1. Clone and install
git clone <repo-url>
cd blueprint
cp .env.example .env
# Edit .env and add your FMP_API_KEY

npm install       # installs root, client, and server deps via postinstall

# 2. Start development servers
npm run dev       # starts Express on :3001 and Vite on :5173
```

Open [http://localhost:5173](http://localhost:5173).

> **Note:** The stock universe cache takes ~3 minutes to warm up on first start. The match results page will show a 503 error until it's ready. Check `/api/status` to see cache state.

## Get an FMP API Key

Sign up at [financialmodelingprep.com](https://financialmodelingprep.com/developer/docs) and grab a Starter plan key (~$14.99/mo). The free tier limits you to 250 requests/day, which will be exhausted by the universe cache build.

## Architecture

- **Frontend:** React 18 + Vite + Tailwind CSS, served on port 5173 in dev
- **Backend:** Node.js + Express on port 3001, proxied by Vite in dev
- **Data:** All FMP API calls go through the Express backend — the API key is never exposed to the browser
- **Matching:** Server maintains an in-memory cache of ~300 stocks refreshed every 24h; match queries are instant

## Monetization

Pro tier and Lemon Squeezy payment integration to be added in V2.
```

- [ ] **Step 2: End-to-end smoke test**

With both servers running (`npm run dev` from root):

1. Open `http://localhost:5173`
2. Type `NVDA` in the ticker field — confirm typeahead dropdown appears
3. Set date to `2020-01-15`, click "Load Snapshot"
4. Confirm snapshot card appears with ticker, company name, sector, and at least price + a few metrics
5. Click "Find Stocks That Look Like This Today →"
6. Confirm loading messages rotate, then 10 match cards appear
7. Click "View Comparison →" on the first result
8. Confirm two-column layout with sparkline and color-coded metrics
9. Click "Add to Watchlist" — confirm button changes to "✓ Added to Watchlist"
10. Click "← Back to Results" — confirm you return to Screen 2

- [ ] **Step 3: Commit everything**

```bash
cd /Users/nictowey/blueprint
git add README.md
git commit -m "feat: README + complete Blueprint v1"
```

- [ ] **Step 4: Verify the startup command from README works clean**

```bash
cd /Users/nictowey/blueprint
rm -rf node_modules client/node_modules server/node_modules
npm install
npm run dev
```

Expected: both servers start, Vite on 5173, Express on 3001.
