# Scoring Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three scoring bugs — missing historical data, outlier-compressed normalization, no completeness signal — and replace the match score pill badge with a circular ring.

**Architecture:** Three independent backend fixes (fmp.js limit, matcher.js normalization, matcher.js metricsCompared) followed by a frontend-only visual change (MatchCard.jsx). Each task is independently testable and committable.

**Tech Stack:** Node.js/Express backend, Jest + Supertest for backend tests, React 18 + Vite frontend, inline SVG for the ring.

---

### Task 1: Fix getKeyMetricsAnnual missing limit

The FMP stable API defaults to returning 5 records when no `limit` is specified. For any snapshot older than ~5 fiscal years, `getKeyMetricsAnnual` returns an empty result, silently nulling 8 of the 26 match metrics. Adding `limit: 15` fixes this for snapshots back to ~2011.

**Files:**
- Modify: `server/services/fmp.js:96-99`
- Modify: `server/tests/snapshot.test.js`

- [ ] **Step 1: Write the failing test**

Add this test to the `'GET /api/snapshot'` describe block in `server/tests/snapshot.test.js`. It will currently fail because `mockKeyMetrics` doesn't include these fields, so `evToEBITDA` comes back null.

```js
test('key-metrics fields are included in snapshot when available', async () => {
  fmp.getKeyMetricsAnnual.mockResolvedValueOnce([
    {
      date: '2019-01-27',
      evToEBITDA: 20.5,
      evToSales: 5.2,
      earningsYield: 0.049,
      returnOnEquity: 0.443,
      returnOnAssets: 0.17,
      returnOnInvestedCapital: 0.22,
      netDebtToEBITDA: 0.3,
      freeCashFlowYield: 0.04,
    },
  ]);
  const res = await request(app).get('/api/snapshot?ticker=NVDA&date=2019-06-15');
  expect(res.status).toBe(200);
  expect(res.body.evToEBITDA).toBe(20.5);
  expect(res.body.evToRevenue).toBe(5.2);
  expect(res.body.returnOnEquity).toBe(0.443);
  expect(res.body.returnOnAssets).toBe(0.17);
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd /Users/nictowey/blueprint
npx jest server/tests/snapshot.test.js --no-coverage
```

Expected: FAIL — `expected null to be 20.5` (evToEBITDA is null because the default mockKeyMetrics has no evToEBITDA field).

- [ ] **Step 3: Apply the fix**

In `server/services/fmp.js`, change line 97:

```js
// Before
async function getKeyMetricsAnnual(ticker, throttle = true) {
  const data = await fmpGet(`/key-metrics`, { symbol: ticker, period: 'annual' }, throttle);
  return Array.isArray(data) ? data : [];
}

// After
async function getKeyMetricsAnnual(ticker, throttle = true) {
  const data = await fmpGet(`/key-metrics`, { symbol: ticker, period: 'annual', limit: 15 }, throttle);
  return Array.isArray(data) ? data : [];
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npx jest server/tests/snapshot.test.js --no-coverage
```

Expected: PASS — all snapshot tests green.

- [ ] **Step 5: Run full suite to confirm nothing broke**

```bash
npx jest --no-coverage
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/services/fmp.js server/tests/snapshot.test.js
git commit -m "fix: add limit 15 to getKeyMetricsAnnual — unblocks 8 metrics for historical snapshots"
```

---

### Task 2: Percentile-clipped normalization in computeScale

The current `computeScale` uses raw `Math.min/Math.max` across the universe. One outlier stock (e.g. `interestCoverageRatioTTM = 503`) compresses all normal stocks into a tiny fraction of [0,1], making every normal stock look nearly identical to every snapshot. Replacing with 5th/95th percentile clipping spreads the normal range across the full [0,1] space.

The existing `normalize` function already clamps values before scaling, so values outside the percentile range are harmlessly clamped to 0 or 1 — no other function needs to change.

**Files:**
- Modify: `server/services/matcher.js:40-48`
- Modify: `server/tests/matcher.test.js`

- [ ] **Step 1: Write the failing test**

Add this describe block to `server/tests/matcher.test.js`:

```js
describe('findMatches — outlier resistance', () => {
  test('outlier stock does not inflate scores of normal stocks', () => {
    // Universe: 10 normal stocks with interestCoverage 10-50,
    // plus one extreme outlier at 5000.
    // Without percentile clipping, all normal stocks compress into
    // [10/5000, 50/5000] = [0.002, 0.01] and look nearly identical.
    // With p5/p95 clipping, the outlier is excluded from the scale
    // and normal stocks spread across [0, 1].
    const universe = new Map();
    const icValues = [10, 15, 20, 25, 30, 35, 40, 45, 50, 5000];
    icValues.forEach((ic, i) => {
      universe.set(`S${i}`, makeStock(`S${i}`, { interestCoverage: ic }));
    });

    // Snapshot has interestCoverage of 20 — should match S2 (ic=20) best
    // and score it substantially higher than S0 (ic=10) for this metric
    const snap = makeStock('SNAP', { interestCoverage: 20 });
    const results = findMatches(snap, universe);

    const s2 = results.find(r => r.ticker === 'S2'); // ic=20, identical to snap
    const s0 = results.find(r => r.ticker === 'S0'); // ic=10, divergent from snap

    // With outlier compression (old code) both would be ~99% similar to each other.
    // With percentile clipping (new code) S2 scores meaningfully higher than S0.
    expect(s2.matchScore).toBeGreaterThan(s0.matchScore);
  });

  test('scores show meaningful spread across varied universe', () => {
    const universe = new Map();
    // Stocks designed to be clearly more/less similar to snapshot
    universe.set('TWIN',  makeStock('TWIN'));  // identical profile
    universe.set('CLOSE', makeStock('CLOSE', { peRatio: 22, grossMargin: 0.48 }));
    universe.set('FAR',   makeStock('FAR',   { peRatio: 80, grossMargin: 0.1, revenueGrowthYoY: -0.3 }));

    const snap = makeStock('SNAP');
    const results = findMatches(snap, universe);

    const twin  = results.find(r => r.ticker === 'TWIN').matchScore;
    const close = results.find(r => r.ticker === 'CLOSE').matchScore;
    const far   = results.find(r => r.ticker === 'FAR').matchScore;

    expect(twin).toBeGreaterThan(close);
    expect(close).toBeGreaterThan(far);
    // Meaningful spread: at least 10 points between best and worst
    expect(twin - far).toBeGreaterThanOrEqual(10);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx jest server/tests/matcher.test.js --no-coverage
```

Expected: FAIL — `expect(s2.matchScore).toBeGreaterThan(s0.matchScore)` fails because outlier compression makes both scores identical.

- [ ] **Step 3: Replace computeScale with percentile version**

In `server/services/matcher.js`, replace the `computeScale` function (lines 40-48):

```js
// Before
function computeScale(stocks, metric) {
  const values = stocks
    .map(s => prepareValue(metric, s[metric]))
    .filter(v => v != null);
  if (values.length === 0) return { min: 0, max: 1 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min, max: max === min ? min + 1 : max };
}

// After
function computeScale(stocks, metric) {
  const values = stocks
    .map(s => prepareValue(metric, s[metric]))
    .filter(v => v != null)
    .sort((a, b) => a - b);
  if (values.length === 0) return { min: 0, max: 1 };
  const p5  = values[Math.max(0, Math.floor(values.length * 0.05))];
  const p95 = values[Math.min(values.length - 1, Math.floor(values.length * 0.95))];
  return { min: p5, max: p95 === p5 ? p5 + 1 : p95 };
}
```

- [ ] **Step 4: Run test to confirm it passes**

```bash
npx jest server/tests/matcher.test.js --no-coverage
```

Expected: all matcher tests pass including the two new outlier tests.

- [ ] **Step 5: Run full suite**

```bash
npx jest --no-coverage
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/services/matcher.js server/tests/matcher.test.js
git commit -m "fix: percentile-clipped normalization — prevents outliers from compressing score range"
```

---

### Task 3: Add metricsCompared count to match results

Each match result needs a `metricsCompared` field — the count of metrics where both the snapshot and the universe stock had non-null data. The client uses this to display "X/26 metrics compared".

**Files:**
- Modify: `server/services/matcher.js`
- Modify: `server/tests/matcher.test.js`

- [ ] **Step 1: Write the failing test**

Add to the existing `describe('findMatches', ...)` block in `server/tests/matcher.test.js`. Update the existing "each result has required shape" test AND add a new count test:

```js
// Replace the existing 'each result has required shape' test with this:
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

// Add this new test to the same describe block:
test('metricsCompared equals number of metrics with data on both sides', () => {
  const universe = new Map();
  // Stock with 3 metrics nulled out
  universe.set('SPARSE', makeStock('SPARSE', { peRatio: null, grossMargin: null, rsi14: null }));
  const results = findMatches(snapshot, universe);
  // snapshot has all 26 metrics; SPARSE has 23 non-null; 23 are comparable
  expect(results[0].metricsCompared).toBe(23);
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx jest server/tests/matcher.test.js --no-coverage
```

Expected: FAIL — `metricsCompared` is undefined on the result object.

- [ ] **Step 3: Add metricsCompared to calculateSimilarity**

In `server/services/matcher.js`, update `calculateSimilarity`:

```js
// Score = weighted similarity on metrics where BOTH snapshot and stock have data.
// Denominator is dynamic (only comparable metrics), so scores reflect actual similarity —
// no neutral credit inflating stocks with missing data.
function calculateSimilarity(snapshot, stock, scales) {
  let score = 0;
  let totalWeight = 0;
  let metricsCompared = 0;
  const metricScores = [];

  for (const metric of MATCH_METRICS) {
    const snapVal = prepareValue(metric, snapshot[metric]);
    const stockVal = prepareValue(metric, stock[metric]);
    const weight = METRIC_WEIGHTS[metric] ?? 1.0;

    // Skip if either side has no data — only compare what we can actually measure
    if (snapVal === null || stockVal === null) continue;

    metricsCompared++;

    const normSnap = normalize(snapVal, scales[metric].min, scales[metric].max);
    const normStock = normalize(stockVal, scales[metric].min, scales[metric].max);
    const diff = Math.abs(normSnap - normStock);
    const metricSimilarity = 1 - diff;

    score += metricSimilarity * weight;
    totalWeight += weight;
    metricScores.push({ metric, similarity: metricSimilarity });
  }

  // Sector bonus: small nudge for same-sector matches, included in the denominator
  if (snapshot.sector && stock.sector && snapshot.sector === stock.sector) {
    score += 0.15;
    totalWeight += 0.15;
  }

  const finalScore = totalWeight > 0 ? Math.max(0, Math.min(100, (score / totalWeight) * 100)) : 0;
  return { score: finalScore, metricScores, metricsCompared };
}
```

- [ ] **Step 4: Thread metricsCompared through findMatches**

In `server/services/matcher.js`, update the `findMatches` map callback:

```js
.map(stock => {
  const { score, metricScores, metricsCompared } = calculateSimilarity(snapshot, stock, scales);

  // Sort by per-metric similarity to find closest and most divergent
  const ranked = [...metricScores].sort((a, b) => b.similarity - a.similarity);
  const topMatches = ranked.slice(0, 3).map(m => m.metric);
  const topDifferences = ranked.slice(-3).reverse().map(m => m.metric);

  return {
    ...stock,
    _rawScore: score,         // used for accurate ranking before rounding
    matchScore: Math.round(score),
    metricsCompared,
    topMatches,
    topDifferences,
  };
})
```

The `.map(({ _rawScore, ...rest }) => rest)` at the end already strips only `_rawScore` — `metricsCompared` passes through to the client unchanged.

- [ ] **Step 5: Run test to confirm it passes**

```bash
npx jest server/tests/matcher.test.js --no-coverage
```

Expected: all matcher tests pass.

- [ ] **Step 6: Run full suite**

```bash
npx jest --no-coverage
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add server/services/matcher.js server/tests/matcher.test.js
git commit -m "feat: add metricsCompared count to match results"
```

---

### Task 4: MatchCard — replace pill badge with circular ring

Replace the inline-styled `div` score badge with an SVG circular ring. The ring sits top-right (company info leads on the left). Below the metric tags, add a data completeness line.

Ring geometry: `r=24`, circumference = `2π×24 ≈ 150.8`. The stroke fills clockwise from the top — achieved by rotating the SVG -90°. `stroke-dashoffset = 150.8 × (1 − score/100)`.

**Files:**
- Modify: `client/src/components/MatchCard.jsx`

No backend changes. No new tests required (this is a pure render change with no logic).

- [ ] **Step 1: Read the current MatchCard file**

```bash
cat client/src/components/MatchCard.jsx
```

Verify the file matches the expected shape before editing.

- [ ] **Step 2: Replace the pill badge div with the ring**

In `client/src/components/MatchCard.jsx`, replace the entire file with:

```jsx
import { useNavigate } from 'react-router-dom';
import { formatMetric, METRIC_LABELS } from '../utils/format';

const CIRCUMFERENCE = 150.8; // 2π × r=24

export default function MatchCard({ match, snapshot, rank }) {
  const navigate = useNavigate();
  const offset = CIRCUMFERENCE * (1 - match.matchScore / 100);

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

        {/* Score ring */}
        <div style={{ position: 'relative', width: 60, height: 60, flexShrink: 0 }}>
          <svg
            width="60"
            height="60"
            viewBox="0 0 60 60"
            style={{ transform: 'rotate(-90deg)' }}
          >
            <circle
              cx="30" cy="30" r="24"
              fill="none"
              stroke="#1e2433"
              strokeWidth="5"
            />
            <circle
              cx="30" cy="30" r="24"
              fill="none"
              stroke="#6c63ff"
              strokeWidth="5"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={offset}
            />
          </svg>
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <span style={{ fontSize: '0.95rem', fontWeight: 800, color: '#a09cf5', lineHeight: 1 }}>
              {match.matchScore}
            </span>
            <span style={{ fontSize: '0.48rem', textTransform: 'uppercase', letterSpacing: '0.07em', color: '#475569' }}>
              match
            </span>
          </div>
        </div>
      </div>

      {/* Metric tags */}
      <div className="flex flex-wrap gap-1.5 mb-3">
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

      <div className="flex justify-between items-center">
        <span className="text-xs text-slate-600">
          {match.metricsCompared}/26 metrics compared
        </span>
        <button className="btn-secondary" onClick={goToComparison}>
          View Comparison →
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Start the dev server and verify visually**

```bash
cd /Users/nictowey/blueprint
npm run dev
```

Open the app, search for a stock (e.g. NVDA, date 2022-10-15), and verify:
- The match score pill is gone
- A circular ring appears top-right of each card, filled proportionally to the score
- The number inside the ring matches the score
- "X/26 metrics compared" appears bottom-left of each card

- [ ] **Step 4: Commit**

```bash
git add client/src/components/MatchCard.jsx
git commit -m "feat: replace match score pill with circular ring, add metrics compared count"
```

---

### Task 5: Run full test suite and verify end-to-end

- [ ] **Step 1: Run all tests**

```bash
npx jest --no-coverage
```

Expected output:
```
Test Suites: 7 passed, 7 total
Tests:       XX passed, XX total
```

All tests must be green before proceeding.

- [ ] **Step 2: Start the server and hit the live endpoints**

```bash
npm run dev
```

In a separate terminal:

```bash
curl -s "http://localhost:3001/api/snapshot?ticker=NVDA&date=2019-06-15" | python3 -m json.tool | grep -E '"evToEBITDA|returnOnEquity|returnOnAssets|evToRevenue|earningsYield|freeCashFlowYield"'
```

Expected: all 8 key-metrics fields show non-null values (the limit fix working).

- [ ] **Step 3: Check match score spread**

```bash
curl -s "http://localhost:3001/api/matches?ticker=NVDA&date=2019-06-15&peRatio=20.26&priceToBook=8.98&revenueGrowthYoY=-0.07&grossMargin=0.612&operatingMargin=0.26&netMargin=0.22" | python3 -c "
import json, sys
matches = json.load(sys.stdin)
for m in matches:
    print(f'{m[\"ticker\"]:6s}  score={m[\"matchScore\"]:3d}  compared={m[\"metricsCompared\"]}/26')
"
```

Expected: scores vary meaningfully (not all the same value), spread across at least a 20-point range, each showing a metrics-compared count.
