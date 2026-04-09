# TTM Data Alignment + Transparent Scoring Rewrite

## Problem

The matching system has three compounding bugs that make results untrustworthy:

1. **Annual vs TTM data mismatch**: The snapshot fetches annual fiscal year data (`getRatiosAnnual`, `getKeyMetricsAnnual`) while the universe uses TTM data (`getRatiosTTM`, `getKeyMetricsTTM`). For the same company, annual P/E and TTM P/E can differ 20-50%. Every comparison is on a different basis.

2. **Tanh compression destroys differentiation**: The normalization maps values to [0,1] via `tanh(z)`. Any two values more than ~2 IQR above the universe median both squash to ~0.99. A P/E of 50 and 100 appear "98% similar" when one is literally double the other.

3. **Sector bonus dominates scoring**: Sector match has weight 3.0 — heavier than any individual metric (max is 2.5 for revenue growth). Same-sector stocks get a guaranteed boost regardless of fundamental differences.

## Goal

Find companies whose current TTM fundamentals are objectively most similar to a historical snapshot's TTM fundamentals. Scores must be directly verifiable by comparing the raw numbers side by side.

## Design

### 1. Snapshot: Reconstruct TTM from Quarterly Data

**Current state** (`server/routes/snapshot.js`):
- Fetches annual income statements, annual key-metrics, annual ratios
- Uses `findPeriodOnOrBefore()` to select the fiscal year ending before the snapshot date
- Growth metrics and margins are computed from annual income statements
- Valuation ratios come directly from annual key-metrics/ratios endpoints

**New approach**:
- Fetch **quarterly** data instead of annual for all financial endpoints:
  - `getIncomeStatements(ticker, 20, false, 'quarter')` — 20 quarters (~5 years of history)
  - `getKeyMetrics(ticker, 'quarter')` — quarterly key metrics
  - `getRatios(ticker, 'quarter')` — quarterly ratios
  - `getBalanceSheet(ticker, 8, false, 'quarter')` — quarterly balance sheets
  - `getCashFlowStatement(ticker, 8, false, 'quarter')` — quarterly cash flow
- Filter all quarterly data to periods ending on or before the snapshot date
- **For flow metrics** (revenue, earnings, EBITDA, operating income, gross profit, cash flow): sum the 4 most recent quarters to construct TTM values
- **For point-in-time ratios** (P/E, P/B, P/S, EV/EBITDA, etc.): first check if FMP's quarterly key-metrics/ratios entries are TTM-based. If yes, use the most recent quarterly entry directly. If they are single-quarter values, compute ratios manually using snapshot-date price and TTM earnings/book value/sales (from the summed quarterly income statements and balance sheet)
- **For balance sheet items** (cash, debt): use the most recent quarter's values
- **For growth metrics**: compute from TTM sums vs prior-year TTM sums (4 quarters ending before snapshot date vs 4 quarters ending ~12 months earlier)
- **For margins**: compute from TTM sums (TTM gross profit / TTM revenue, etc.)
- Technical metrics (RSI, MAs, % below high) stay unchanged — already price-based and date-accurate

**FMP API changes needed** (`server/services/fmp.js`):
- Add `period` parameter support to `getIncomeStatements`, `getKeyMetricsAnnual`, `getRatiosAnnual`, `getBalanceSheet`, `getCashFlowStatement`
- Or create new quarterly-specific wrapper functions

**TTM construction helper** (new function in `snapshot.js` or a shared utility):
```
function computeTTM(quarters, snapshotDate) {
  // Filter to quarters ending on or before snapshotDate
  // Take the 4 most recent
  // Sum flow metrics: revenue, netIncome, ebitda, grossProfit, operatingIncome, eps
  // Return { ttm: summed values, priorTTM: previous 4 quarters for growth calc }
}
```

### 2. Universe: No Changes Needed

The universe enrichment (`server/services/universe.js`) already uses TTM data:
- `getKeyMetricsTTM()` → TTM valuation ratios
- `getRatiosTTM()` → TTM financial health ratios
- Growth metrics computed from most recent annual income statements (acceptable — represents current growth)
- Technical metrics from current prices

With the snapshot also on TTM, both sides now speak the same language.

### 3. Scoring Algorithm: Direct Percentage Difference

**Current state** (`server/services/matcher.js`):
- Compute universe-wide scale (median/IQR) per metric
- Normalize both snapshot and match values to robust z-scores
- Apply tanh to map to [0,1]
- Compute similarity as `1 - |normalizedA - normalizedB|`

**New approach** — replace with direct percentage difference:

```
For each metric where both snapshot and match have data:
  percentDiff = |snapshot - match| / max(|snapshot|, |match|, epsilon)
  similarity = max(0, 1 - percentDiff)
```

Where `epsilon` is a small floor (e.g., 0.01) to prevent division-by-zero when both values are near zero.

**Why this works**:
- P/E 45 vs 50: `|45-50| / 50 = 0.10` → 90% similar. User can verify instantly.
- Revenue growth 50% vs 45%: `|0.50-0.45| / 0.50 = 0.10` → 90% similar.
- Opposite signs (growth -10% vs +10%): `0.20 / 0.10 = 2.0`, capped → 0% similar. Correct.
- Both near zero (growth 2% vs 1%): `0.01 / 0.02 = 0.50` → 50% similar. Honest — one is half the other.

**Special handling for market cap**: Market cap values span orders of magnitude ($100M to $3T). Use log-scale percentage difference:
```
logSnap = log10(snapshotMarketCap)
logMatch = log10(matchMarketCap)
percentDiff = |logSnap - logMatch| / max(|logSnap|, |logMatch|)
```
This means a $1B vs $2B company (1 order of magnitude apart on log scale) is treated similarly to $100B vs $200B.

**Remove**:
- `computeScale()` function — no longer needed
- `normalize()` function — no longer needed
- `prepareValue()` log transforms — only keep for market cap
- `LOG_TRANSFORM_METRICS` set — remove (market cap handled as special case)

### 4. Metric Weights (Kept, Tuned)

Keep the existing weight structure — the user wants some metrics to matter more:

| Category | Metrics | Weight |
|----------|---------|--------|
| Growth | revenueGrowthYoY, revenueGrowth3yr, epsGrowthYoY | 2.5, 2.5, 2.0 |
| Profitability | operatingMargin, returnOnEquity | 2.0 |
| Profitability | grossMargin, netMargin, returnOnAssets, returnOnCapital | 1.5 |
| Valuation | peRatio, evToEBITDA, pegRatio | 1.5 |
| Valuation | priceToBook, priceToSales, evToRevenue, earningsYield | 1.0 |
| Financial Health | debtToEquity, netDebtToEBITDA, freeCashFlowYield | 1.5 |
| Financial Health | currentRatio, interestCoverage | 1.0 |
| Profitability | ebitdaMargin | 1.0 |
| Size | marketCap | 1.5 |
| Technical | rsi14, pctBelowHigh, priceVsMa50, priceVsMa200 | 0.5 |

### 5. Sector: Filter Only, Not Scored

**Remove** sector from `calculateSimilarity()`:
- Delete the sector bonus block (lines 130-135 of current matcher.js)
- Add `sector` as a query parameter to the `/api/matches` endpoint
- When provided, filter universe to only same-sector stocks before scoring
- When omitted, search all sectors (current behavior without the bonus)

The frontend should expose this as an optional toggle: "Same sector only"

### 6. Overlap Handling (Unchanged)

- **Minimum overlap**: 60% of snapshot's populated metrics must also exist on the match
- **Overlap penalty**: `finalScore *= sqrt(overlapRatio)` — stocks with less data coverage get penalized proportionally
- **Minimum metrics**: Still require at least 4 populated metrics in the snapshot

### 7. Final Score Formula

```
For each metric in MATCH_METRICS where both sides have non-null data:
  if metric === 'marketCap':
    diff = |log10(snap) - log10(match)| / max(|log10(snap)|, |log10(match)|)
  else:
    diff = |snap - match| / max(|snap|, |match|, 0.01)

  similarity = max(0, 1 - diff)
  weightedSim = similarity * METRIC_WEIGHTS[metric]

  accumulate weightedSim into score
  accumulate weight into totalWeight

overlapRatio = metricsCompared / snapshotPopulatedCount
rawScore = (score / totalWeight) * 100
finalScore = rawScore * sqrt(overlapRatio)

Return: matchScore (0-100), metricsCompared, topMatches[3], topDifferences[3]
```

## Files Changed

| File | Change |
|------|--------|
| `server/services/fmp.js` | Add `period` parameter to financial data functions |
| `server/routes/snapshot.js` | Rewrite to use quarterly data, construct TTM values |
| `server/services/matcher.js` | Replace normalization with direct % diff, remove sector bonus |
| `server/routes/matches.js` | Add optional `sector` filter parameter |
| `client/src/pages/MatchResults.jsx` | Add sector filter toggle (optional, can defer to later) |

## What Stays the Same

- All 27 match metrics (no additions or removals)
- Universe cache + incremental refresh (`universe.js`)
- UI components (circular rings, metric tags, comparison detail page)
- Top 3 matches / top 3 differences per result
- Metric formatting (`client/src/utils/format.js`)

## Validation

After implementation, test with NVDA 12/15/2023 and CLS 12/15/2023 snapshots:
1. Verify snapshot metrics are TTM-based (not annual)
2. Verify top matches have raw values that are visibly close to the snapshot
3. Verify the match score is explainable by summing the per-metric percentage differences
4. Compare a same-sector match vs a different-sector match — confirm sector doesn't inflate scores
