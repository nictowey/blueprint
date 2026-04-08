# Scoring Overhaul Design

**Date:** 2026-04-08
**Status:** Approved

## Problem

Three compounding issues make the match percentage untrustworthy:

1. **Missing data** — `getKeyMetricsAnnual` passes no `limit` to FMP, which returns only the 5 most recent fiscal years. For any snapshot date older than ~5 years, 8 of the 26 match metrics (`evToEBITDA`, `evToRevenue`, `earningsYield`, `returnOnEquity`, `returnOnAssets`, `returnOnCapital`, `netDebtToEBITDA`, `freeCashFlowYield`) are silently null. The matcher skips them, leaving the score based on only 18 metrics.

2. **Score compression** — `computeScale` uses `Math.min/Math.max` across the universe. One outlier stock (e.g. NVDA's current `interestCoverageRatioTTM = 503`) sets the scale max and compresses all normal stocks (IC = 5–50) into a tiny 0–0.10 slice of [0, 1]. Every normal stock looks 90–95% similar to every snapshot on that metric, regardless of their actual values. This inflates and clusters scores.

3. **No data quality signal** — the user has no way to know whether a 73% score is based on 24 metrics or 11.

## Goal

A match score that honestly reflects how structurally similar a stock's current fundamentals are to the template's historical fundamentals, with enough spread to rank matches meaningfully (top match ~75–85%, poor match ~30–50%), and a visible completeness indicator.

## Fix 1: Fetch Enough Historical Data

**File:** `server/services/fmp.js`

Add `limit: 15` to `getKeyMetricsAnnual`. This returns ~15 fiscal years, covering snapshots back to ~2011 for any current stock.

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

This is the only change to `fmp.js`. No other endpoints are affected.

## Fix 2: Percentile-Clipped Normalization

**File:** `server/services/matcher.js`

Replace `computeScale` with a version that uses the 5th and 95th percentile of universe values as the normalization range instead of the raw min/max.

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

The existing `normalize` function already clamps to `[min, max]` before scaling, so values outside the percentile range are clamped to 0 or 1 — no other changes needed there.

**Effect:** For a metric like `interestCoverage` where 95% of stocks have values 1–50 but one outlier is 503, the scale becomes `[p5, 50]` instead of `[p5, 503]`. The 95% normal range now spans the full [0, 1] space, producing genuine per-stock differentiation.

## Fix 3: metricsCompared Count

**File:** `server/services/matcher.js`

Track how many metrics contributed to each stock's score (i.e. both snapshot and stock had non-null data for that metric). Return `metricsCompared` alongside `matchScore` in every match result.

In `calculateSimilarity`: increment a counter for each metric that passes the null check. Return it alongside `score` and `metricScores`.

In `findMatches`: include `metricsCompared` in the returned result object (strip `_rawScore` as before, keep `metricsCompared`).

The total possible is `MATCH_METRICS.length` (currently 26). Client displays `"X/26 metrics compared"`.

## Fix 4: MatchCard Visual

**File:** `client/src/components/MatchCard.jsx`

Replace the inline-styled pill badge with an SVG circular ring. Layout: company info top-left, ring top-right (Option A). Ring stroke fills proportionally to `match.matchScore` out of 100.

Ring geometry: `r = 26`, `circumference = 2π × 26 ≈ 163.4`. `stroke-dashoffset = circumference × (1 - score/100)`.

Add `"{match.metricsCompared}/26 metrics compared"` below the metric tags, left-aligned, in muted text. The total (26) is hardcoded in MatchCard — it equals `MATCH_METRICS.length` and only changes if the metric list changes.

Remove the existing inline-styled `div` badge. The ring replaces it entirely.

## Files Changed

| File | Change |
|------|--------|
| `server/services/fmp.js` | Add `limit: 15` to `getKeyMetricsAnnual` |
| `server/services/matcher.js` | Percentile-clipped `computeScale`; add `metricsCompared` to result |
| `client/src/components/MatchCard.jsx` | SVG ring replaces pill badge; add completeness line |

## Out of Scope

- Category sub-scores (Valuation / Growth / etc.) — not the goal
- Changing which 26 metrics are used
- Changing metric weights
- Any changes to the comparison detail page

## Testing

- `matcher.test.js`: add test asserting outlier stock (e.g. `interestCoverage: 5000`) does not inflate scores of normal stocks; add test asserting `metricsCompared` is present on each result and equals the number of metrics with non-null data on both sides
- `matcher.test.js`: update `each result has required shape` test to include `metricsCompared`
- `snapshot.test.js`: add test asserting that with `limit: 15` mock, `evToEBITDA` and `returnOnEquity` are populated for a 2019-era snapshot
- No new comparison or universe tests required
