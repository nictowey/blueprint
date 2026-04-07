# Comparison Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three compounding issues that make match scores meaningless and the comparison view misleading: inflate-to-98% scoring, market-cap distortion, and missing match sparkline.

**Architecture:** Three independent changes — (1) fix the scoring denominator and remove marketCap in `matcher.js`, (2) fetch the match ticker's trailing 12-month prices in `comparison.js` and return them, (3) replace the ComparisonDetail placeholder with a live `<Sparkline>`. The Sparkline component gets configurable labels so both panels can use it with appropriate copy.

**Tech Stack:** Node.js + Jest (backend), React 18 + Vite (frontend), FMP REST API, Supertest for integration tests.

---

### Task 1: Fix Matcher Scoring — Fixed Denominator + Remove marketCap

**Files:**
- Modify: `server/services/matcher.js`
- Modify: `server/tests/matcher.test.js`

**Background:** `calculateSimilarity` currently skips null snapshot metrics entirely (`if (snapVal === null) continue`), so the denominator only counts populated metrics. A snapshot with 8/27 metrics scores 95%+ even when those 8 are barely similar. The fix: always divide by `FIXED_TOTAL_WEIGHT` — the sum of ALL metric weights. Null snapshot metrics contribute 0 to the numerator but their weight still counts. Also remove `marketCap` (outcome metric, not a fundamental profile indicator) from `MATCH_METRICS` and `METRIC_WEIGHTS`.

After removing `marketCap` (weight 1.0), `FIXED_TOTAL_WEIGHT` = 35.0 (sum of remaining 26 metric weights).

- [ ] **Step 1: Write failing tests**

Add these tests to `server/tests/matcher.test.js` (append after the existing `describe` block):

```js
describe('findMatches — fixed denominator scoring', () => {
  test('sparse snapshot (5 metrics) scores lower than rich snapshot (20 metrics)', () => {
    const universe = new Map();
    universe.set('CANDIDATE', makeStock('CANDIDATE'));

    // Sparse: only 5 metrics populated on snapshot
    const sparseSnap = {
      ticker: 'SPARSE', sector: 'Technology',
      peRatio: 20, grossMargin: 0.5, revenueGrowthYoY: 0.2, rsi14: 50, pctBelowHigh: 10,
      priceToBook: null, priceToSales: null, evToEBITDA: null, evToRevenue: null,
      pegRatio: null, earningsYield: null, operatingMargin: null, netMargin: null,
      ebitdaMargin: null, returnOnEquity: null, returnOnAssets: null, returnOnCapital: null,
      revenueGrowth3yr: null, epsGrowthYoY: null, currentRatio: null, debtToEquity: null,
      interestCoverage: null, netDebtToEBITDA: null, freeCashFlowYield: null,
      priceVsMa50: null, priceVsMa200: null,
    };

    // Rich: all metrics populated on snapshot (identical values to CANDIDATE)
    const richSnap = makeStock('RICH');

    const sparseResults = findMatches(sparseSnap, universe);
    const richResults = findMatches(richSnap, universe);

    expect(sparseResults[0].matchScore).toBeLessThan(richResults[0].matchScore);
  });

  test('identical stock with all metrics populated scores above 90', () => {
    const universe = new Map();
    universe.set('TWIN', makeStock('TWIN'));
    const snapshot = makeStock('TMPL2');
    const results = findMatches(snapshot, universe);
    expect(results[0].matchScore).toBeGreaterThan(90);
  });

  test('marketCap is not a property of MATCH_METRICS', () => {
    const { MATCH_METRICS } = require('../services/matcher');
    expect(MATCH_METRICS).not.toContain('marketCap');
  });

  test('findMatches does not throw when marketCap is absent from stock', () => {
    const universe = new Map();
    const stockWithoutMarketCap = { ...makeStock('NOMC') };
    delete stockWithoutMarketCap.marketCap;
    universe.set('NOMC', stockWithoutMarketCap);
    expect(() => findMatches(makeStock('SNAP'), universe)).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/nictowey/blueprint
npx jest server/tests/matcher.test.js --no-coverage 2>&1 | tail -30
```

Expected: failures on the new tests. The "marketCap not in MATCH_METRICS" test should fail with `expect(received).not.toContain('marketCap')`.

- [ ] **Step 3: Implement the fix in matcher.js**

Replace the top of `server/services/matcher.js` (lines 1–35) with:

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
  // Technical
  'rsi14', 'pctBelowHigh', 'priceVsMa50', 'priceVsMa200',
];

// Growth and profitability matter most for finding breakout candidates.
// Technical signals are supplementary — weighted lower to avoid noise domination.
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
  // Technical — lower weight
  rsi14: 0.5, pctBelowHigh: 0.5, priceVsMa50: 0.5, priceVsMa200: 0.5,
};

// Fixed denominator: sum of ALL metric weights regardless of which are populated.
// Null snapshot metrics contribute 0 to the numerator but their weight still counts here.
const FIXED_TOTAL_WEIGHT = MATCH_METRICS.reduce((sum, m) => sum + (METRIC_WEIGHTS[m] ?? 1.0), 0);
// = 35.0
```

Then replace the `calculateSimilarity` function (lines 59–98) with:

```js
// Returns { score: 0-100, metricScores: [{ metric, similarity }] }
function calculateSimilarity(snapshot, stock, scales) {
  let score = 0;
  const metricScores = [];

  for (const metric of MATCH_METRICS) {
    const snapVal = prepareValue(metric, snapshot[metric]);
    const stockVal = prepareValue(metric, stock[metric]);
    const weight = METRIC_WEIGHTS[metric] ?? 1.0;

    // Snapshot missing — contributes 0 to numerator; weight already in FIXED_TOTAL_WEIGHT
    if (snapVal === null) continue;

    // Stock missing — neutral contribution (0.5), not tracked for top/diff
    if (stockVal === null) {
      score += 0.5 * weight;
      continue;
    }

    const normSnap = normalize(snapVal, scales[metric].min, scales[metric].max);
    const normStock = normalize(stockVal, scales[metric].min, scales[metric].max);
    const diff = Math.abs(normSnap - normStock);
    const metricSimilarity = 1 - diff;

    score += metricSimilarity * weight;
    metricScores.push({ metric, similarity: metricSimilarity });
  }

  // Sector bonus — added to numerator only; denominator stays at FIXED_TOTAL_WEIGHT
  if (snapshot.sector && stock.sector && snapshot.sector === stock.sector) {
    score += 0.15;
  }

  const finalScore = Math.max(0, Math.min(100, (score / FIXED_TOTAL_WEIGHT) * 100));
  return { score: finalScore, metricScores };
}
```

- [ ] **Step 4: Run all matcher tests**

```bash
npx jest server/tests/matcher.test.js --no-coverage 2>&1 | tail -30
```

Expected: all tests pass. The "identical stock scores above 90" test should pass because a fully-populated identical match will score (35.0 + 0.15) / 35.0 * 100 ≈ 100, capped to 100.

- [ ] **Step 5: Run all server tests to check for regressions**

```bash
npx jest --no-coverage 2>&1 | tail -40
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/nictowey/blueprint
git add server/services/matcher.js server/tests/matcher.test.js
git commit -m "fix: fixed-denominator scoring, remove marketCap from MATCH_METRICS"
```

---

### Task 2: Remove marketCap from Client-Side MATCH_METRICS

**Files:**
- Modify: `client/src/pages/MatchResults.jsx`

`MatchResults.jsx` has its own copy of `MATCH_METRICS` (lines 13–21) used to build the query params sent to `/api/matches`. `marketCap` is in this array — removing it ensures the client doesn't send stale historical market caps as match criteria.

- [ ] **Step 1: Edit MatchResults.jsx**

In `client/src/pages/MatchResults.jsx`, change the `MATCH_METRICS` array from:

```js
const MATCH_METRICS = [
  'peRatio', 'priceToBook', 'priceToSales', 'evToEBITDA', 'evToRevenue', 'pegRatio', 'earningsYield',
  'grossMargin', 'operatingMargin', 'netMargin', 'ebitdaMargin',
  'returnOnEquity', 'returnOnAssets', 'returnOnCapital',
  'revenueGrowthYoY', 'revenueGrowth3yr', 'epsGrowthYoY',
  'currentRatio', 'debtToEquity', 'interestCoverage', 'netDebtToEBITDA', 'freeCashFlowYield',
  'rsi14', 'pctBelowHigh', 'priceVsMa50', 'priceVsMa200',
  'marketCap',
];
```

To:

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

- [ ] **Step 2: Commit**

```bash
cd /Users/nictowey/blueprint
git add client/src/pages/MatchResults.jsx
git commit -m "fix: remove marketCap from client-side MATCH_METRICS query params"
```

---

### Task 3: Add matchSparkline to Comparison Route (TDD)

**Files:**
- Modify: `server/routes/comparison.js`
- Create: `server/tests/comparison.test.js`

The comparison route currently returns `{ template, match, sparkline, sparklineGainPct }`. It needs to also return `matchSparkline` (array of `{date, price}`) and `matchSparklineGainPct` (number) by fetching the match ticker's trailing 12-month prices.

- [ ] **Step 1: Write the failing test**

Create `server/tests/comparison.test.js`:

```js
jest.mock('../services/fmp');
jest.mock('../services/universe');
const fmp = require('../services/fmp');
const universe = require('../services/universe');
const request = require('supertest');
const app = require('../index');

// 30 price entries for the template historical window
const mockTemplateHist = Array.from({ length: 30 }, (_, i) => ({
  date: new Date(Date.UTC(2022, 9, 15) - i * 86400000).toISOString().slice(0, 10),
  close: 200 + i,
}));

// 30 price entries for the match ticker's last 12 months
const mockMatchHist = Array.from({ length: 30 }, (_, i) => ({
  date: new Date(Date.now() - i * 86400000).toISOString().slice(0, 10),
  close: 100 + i,
}));

const mockProfile = { companyName: 'NVIDIA Corp', sector: 'Technology', beta: 1.5, volAvg: 50000000 };

beforeEach(() => {
  // Default: universe cache is empty so buildCurrentMetrics runs
  universe.getCache.mockReturnValue(new Map());

  fmp.getProfile.mockResolvedValue(mockProfile);
  fmp.getIncomeStatements.mockResolvedValue([]);
  fmp.getKeyMetricsAnnual.mockResolvedValue([]);
  fmp.getRatiosAnnual.mockResolvedValue([]);
  fmp.getShortInterest.mockResolvedValue(null);
  fmp.getBalanceSheet.mockResolvedValue([]);
  fmp.getCashFlowStatement.mockResolvedValue([]);
  fmp.getKeyMetricsTTM.mockResolvedValue({});
  fmp.getRatiosTTM.mockResolvedValue({});

  // getHistoricalPrices: first call → template window, second → template sparkline, third → match 12-month
  fmp.getHistoricalPrices
    .mockResolvedValueOnce(mockTemplateHist)  // template 1yr historical
    .mockResolvedValueOnce(mockTemplateHist)  // template sparkline (18 months after date)
    .mockResolvedValueOnce(mockMatchHist);    // match ticker last 12 months
});

describe('GET /api/comparison', () => {
  test('returns 400 when required params are missing', async () => {
    const res = await request(app).get('/api/comparison');
    expect(res.status).toBe(400);
  });

  test('returns matchSparkline array in response', async () => {
    const res = await request(app)
      .get('/api/comparison?ticker=NVDA&date=2022-10-15&matchTicker=MSFT');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.matchSparkline)).toBe(true);
    expect(res.body.matchSparkline.length).toBeGreaterThan(0);
    expect(res.body.matchSparkline[0]).toHaveProperty('date');
    expect(res.body.matchSparkline[0]).toHaveProperty('price');
  });

  test('returns matchSparklineGainPct as a number', async () => {
    const res = await request(app)
      .get('/api/comparison?ticker=NVDA&date=2022-10-15&matchTicker=MSFT');
    expect(res.status).toBe(200);
    expect(typeof res.body.matchSparklineGainPct).toBe('number');
  });

  test('response still includes template sparkline fields', async () => {
    const res = await request(app)
      .get('/api/comparison?ticker=NVDA&date=2022-10-15&matchTicker=MSFT');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.sparkline)).toBe(true);
    expect(res.body).toHaveProperty('sparklineGainPct');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/nictowey/blueprint
npx jest server/tests/comparison.test.js --no-coverage 2>&1 | tail -30
```

Expected: "matchSparkline array in response" and "matchSparklineGainPct as a number" fail with `received undefined`.

- [ ] **Step 3: Implement the match sparkline fetch in comparison.js**

In `server/routes/comparison.js`, inside the route handler, add the match sparkline date range before the `Promise.allSettled` call (insert after line ~141 where `sparklineEnd` is computed):

```js
const matchSparklineFrom = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
const matchSparklineTo = new Date().toISOString().slice(0, 10);
```

Add the match sparkline fetch as the last entry in the `Promise.allSettled` array (after `templateCashFlowData`):

```js
fmp.getHistoricalPrices(matchSym, matchSparklineFrom, matchSparklineTo, false),
```

The destructure line currently reads:
```js
const [profileData, incomeData, metricsData, ratiosData, histData, shortData,
       sparklineData, matchData, templateBalanceData, templateCashFlowData] =
  await Promise.allSettled([...]);
```

Change to:
```js
const [profileData, incomeData, metricsData, ratiosData, histData, shortData,
       sparklineData, matchData, templateBalanceData, templateCashFlowData,
       matchSparklineData] =
  await Promise.allSettled([...]);
```

After the `templateCashFlow` extraction line, add:
```js
const matchSparklineRaw = matchSparklineData?.status === 'fulfilled' ? matchSparklineData.value : [];
```

After the existing `sparklineGainPct` computation, add:
```js
const matchSparkline = [...matchSparklineRaw]
  .sort((a, b) => new Date(a.date) - new Date(b.date))
  .map(h => ({ date: h.date, price: h.close }));

let matchSparklineGainPct = null;
if (matchSparkline.length >= 2) {
  const start = matchSparkline[0].price;
  const end = matchSparkline[matchSparkline.length - 1].price;
  if (start > 0) matchSparklineGainPct = ((end - start) / start) * 100;
}
```

Change the result object from:
```js
const result = { template, match: matchMetrics, sparkline, sparklineGainPct };
```

To:
```js
const result = { template, match: matchMetrics, sparkline, sparklineGainPct, matchSparkline, matchSparklineGainPct };
```

- [ ] **Step 4: Run comparison tests**

```bash
npx jest server/tests/comparison.test.js --no-coverage 2>&1 | tail -30
```

Expected: all 4 tests pass.

- [ ] **Step 5: Run all server tests**

```bash
npx jest --no-coverage 2>&1 | tail -40
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/nictowey/blueprint
git add server/routes/comparison.js server/tests/comparison.test.js
git commit -m "feat: fetch match ticker 12-month prices, return matchSparkline in comparison"
```

---

### Task 4: Make Sparkline Labels Configurable

**Files:**
- Modify: `client/src/components/Sparkline.jsx`

The Sparkline component currently has hardcoded copy: "What happened after this snapshot" and "over 18 months". The match panel needs different text: "Last 12 months" and "12 months". Add optional `label` and `period` props with defaults that preserve existing behavior.

- [ ] **Step 1: Update Sparkline.jsx**

Replace the entire `Sparkline.jsx` with:

```jsx
export default function Sparkline({ data, gainPct, label = 'What happened after this snapshot', period = '18 months' }) {
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
          {label}
        </span>
        <span
          className="text-sm font-bold"
          style={{ color: isPositive ? '#22c55e' : '#ef4444' }}
        >
          {gainStr} over {period}
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
git commit -m "feat: add configurable label and period props to Sparkline"
```

---

### Task 5: Render Match Sparkline in ComparisonDetail

**Files:**
- Modify: `client/src/pages/ComparisonDetail.jsx`

Replace the "Current profile as of today" placeholder div (lines 159–164) with a live `<Sparkline>` using `data.matchSparkline` and `data.matchSparklineGainPct`.

- [ ] **Step 1: Replace the placeholder in ComparisonDetail.jsx**

Find and replace this block in `client/src/pages/ComparisonDetail.jsx`:

```jsx
            {/* Spacer to align with sparkline area */}
            <div className="bg-dark-bg rounded-lg p-4 mb-6 flex items-center justify-center" style={{ minHeight: '120px' }}>
              <p className="text-slate-600 text-sm text-center">
                Current profile as of today
              </p>
            </div>
```

With:

```jsx
            {/* Match sparkline — last 12 months */}
            <div className="bg-dark-bg rounded-lg p-4 mb-6">
              <Sparkline
                data={data.matchSparkline}
                gainPct={data.matchSparklineGainPct}
                label="Last 12 months"
                period="12 months"
              />
            </div>
```

- [ ] **Step 2: Verify the build compiles without errors**

```bash
cd /Users/nictowey/blueprint
npm run build 2>&1 | tail -20
```

Expected: build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/nictowey/blueprint
git add client/src/pages/ComparisonDetail.jsx
git commit -m "feat: render match company sparkline in comparison detail (dual sparkline)"
```

---

### Task 6: Push to GitHub

- [ ] **Step 1: Verify all tests still pass**

```bash
cd /Users/nictowey/blueprint
npx jest --no-coverage 2>&1 | tail -20
```

Expected: all test suites pass.

- [ ] **Step 2: Push to GitHub**

```bash
cd /Users/nictowey/blueprint
git push origin master
```

Expected: push succeeds. Render will auto-deploy.

- [ ] **Step 3: Manual smoke test**

After deploy, open the app and:
1. Enter `NVDA` / `2022-10-15` → match results load
2. Verify scores are now in 40–80% range (not clustered at 98–99%)
3. Click the top match → comparison detail loads
4. Verify both sparklines render (left: NVDA's 18-month run, right: match ticker's last 12 months)
5. Verify `marketCap` differences no longer dominate the "top differences" list

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|---|---|
| Fixed denominator scoring | Task 1 (matcher.js + tests) |
| Remove marketCap from MATCH_METRICS | Task 1 (server) + Task 2 (client) |
| Fetch match ticker 12-month prices | Task 3 (comparison.js) |
| Return matchSparkline + matchSparklineGainPct | Task 3 |
| Render Sparkline for match company | Task 5 (ComparisonDetail) |
| Configurable Sparkline labels | Task 4 (Sparkline.jsx) |
| matcher.test.js: sparse vs rich snapshot test | Task 1 |
| comparison.js integration test | Task 3 |

**No placeholders found.**

**Type consistency:** `matchSparkline` is `Array<{date: string, price: number}>` — same shape as `sparkline` — so `<Sparkline data={data.matchSparkline} />` works with the existing component without any type changes.
