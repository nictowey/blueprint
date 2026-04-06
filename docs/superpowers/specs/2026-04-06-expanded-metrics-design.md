# Blueprint — Expanded Metrics Design

**Date:** 2026-04-06  
**Status:** Approved

## Overview

Expand Blueprint's stock comparison and matching system from 9 display metrics / 6 match dimensions to ~34 fields across 6 categories. The expansion covers valuation, profitability, growth, financial health, and technical indicators — sourced from 6 FMP API calls per stock. All numeric metrics feed the universe matcher for richer lookalike scoring.

## Goals

- Every fundamental and technical metric available from FMP Starter plan is populated
- The universe cache is fully enriched so matching uses ~22 dimensions instead of 6
- The comparison UI groups metrics by category instead of a flat list
- Boot time increases are acceptable; the app stays usable via Phase 1 cache within ~60 seconds

## Constraints

- FMP Starter plan: 300 calls/min max
- `RATE_LIMIT_MS` bumped from 200ms → 250ms (240 calls/min, safe headroom)
- Phase 2 enrichment: 6 calls/stock × ~1000 stocks × 250ms = ~25 min cold start
- Module API of `universe.js` stays intact: `startCache`, `getCache`, `isReady`, `getStatus`

---

## Metrics Catalog

### Valuation (7 metrics — all matched)

| Key | Label | Source |
|---|---|---|
| `peRatio` | P/E Ratio | `key-metrics-ttm.peRatioTTM` |
| `priceToBook` | Price-to-Book | `key-metrics-ttm.pbRatioTTM` |
| `priceToSales` | Price-to-Sales | `key-metrics-ttm.priceToSalesRatioTTM` |
| `evToEBITDA` | EV/EBITDA | `key-metrics-ttm.evToEBITDATTM` |
| `evToRevenue` | EV/Revenue | `key-metrics-ttm.evToRevenueTTM` |
| `pegRatio` | PEG Ratio | `key-metrics-ttm.pegRatioTTM` |
| `earningsYield` | Earnings Yield | `key-metrics-ttm.earningsYieldTTM` |

### Profitability (7 metrics — all matched)

| Key | Label | Source |
|---|---|---|
| `grossMargin` | Gross Margin | `income[0].grossProfitRatio` |
| `operatingMargin` | Operating Margin | `income[0].operatingIncomeRatio` |
| `netMargin` | Net Margin | `income[0].netIncomeRatio` |
| `ebitdaMargin` | EBITDA Margin | `income[0].ebitdaratio` |
| `returnOnEquity` | Return on Equity | `key-metrics-ttm.returnOnEquityTTM` |
| `returnOnAssets` | Return on Assets | `key-metrics-ttm.returnOnAssetsTTM` |
| `returnOnCapital` | Return on Capital (ROIC) | `key-metrics-ttm.roicTTM` |

### Growth (3 metrics — all matched)

| Key | Label | Source | Notes |
|---|---|---|---|
| `revenueGrowthYoY` | Revenue Growth YoY | `income[0-1]` computed | `(rev0 - rev1) / abs(rev1)` |
| `revenueGrowth3yr` | Revenue 3yr CAGR | `income[0-3]` computed | `(rev0/rev3)^(1/3) - 1`; income limit bumped 2→4 |
| `epsGrowthYoY` | EPS Growth YoY | `income[0-1].eps` computed | `(eps0 - eps1) / abs(eps1)` |

### Financial Health (9 metrics — 5 matched, 4 display-only)

| Key | Label | Source | Matched |
|---|---|---|---|
| `currentRatio` | Current Ratio | `key-metrics-ttm.currentRatioTTM` | ✓ |
| `debtToEquity` | Debt/Equity | `key-metrics-ttm.debtToEquityTTM` | ✓ |
| `interestCoverage` | Interest Coverage | `key-metrics-ttm.interestCoverageTTM` | ✓ |
| `netDebtToEBITDA` | Net Debt/EBITDA | `key-metrics-ttm.netDebtToEBITDATTM` | ✓ |
| `freeCashFlowYield` | FCF Yield | `key-metrics-ttm.freeCashFlowYieldTTM` | ✓ |
| `totalCash` | Total Cash | `balance-sheet[0].cashAndCashEquivalents` | display only |
| `totalDebt` | Total Debt | `balance-sheet[0].totalDebt` | display only |
| `freeCashFlow` | Free Cash Flow | `cash-flow[0].freeCashFlow` | display only |
| `operatingCashFlow` | Operating Cash Flow | `cash-flow[0].operatingCashFlow` | display only |

### Technical (6 metrics — 4 matched, 2 display-only)

| Key | Label | Source | Matched |
|---|---|---|---|
| `rsi14` | RSI (14-day) | computed from historical prices, oldest-first, last 30 | ✓ |
| `pctBelowHigh` | % Below 52W High | `(high52w - price) / high52w * 100` | ✓ |
| `priceVsMa50` | vs 50-Day MA | `(price - ma50) / ma50 * 100`; ma50 = avg of last 50 closes | ✓ |
| `priceVsMa200` | vs 200-Day MA | `(price - ma200) / ma200 * 100`; ma200 = avg of all closes (need full year ~252 days) | ✓ |
| `beta` | Beta | `profile.beta` | display only |
| `avgVolume` | Avg Volume | `profile.volAvg` | display only |

### Overview (4 metrics — display only)

| Key | Label | Source |
|---|---|---|
| `price` | Price | `historical[0].close` |
| `marketCap` | Market Cap | `key-metrics-ttm.marketCapTTM` |
| `eps` | EPS (TTM) | `income[0].eps` |
| `dividendYield` | Dividend Yield | `key-metrics-ttm.dividendYieldPercentageTTM` |

**Total matched dimensions: 22**  
**Total display fields: ~34**

---

## Server Changes

### `server/services/fmp.js`

Two new exported functions:

```js
getBalanceSheet(ticker, limit = 1)   // GET /balance-sheet-statement
getCashFlowStatement(ticker, limit = 1) // GET /cash-flow-statement
```

`RATE_LIMIT_MS` bumped from `200` to `250`.

### `server/services/universe.js`

Phase 2 enrichment expands from 3 → 6 sequential calls per stock:

1. `getKeyMetricsTTM(symbol)`
2. `getIncomeStatements(symbol, 4)` — limit 2→4 for 3yr CAGR
3. `getHistoricalPrices(symbol, from, to)`
4. `getProfile(symbol)`
5. `getBalanceSheet(symbol, 1)`
6. `getCashFlowStatement(symbol, 1)`

All 34 fields computed and stored in cache. Universe cache entries grow accordingly. `MATCH_METRICS` import from `matcher.js` drives which fields are needed for scoring.

### `server/routes/snapshot.js`

`Promise.allSettled` block expands from 5 → 7 concurrent fetches (add `getBalanceSheet`, `getCashFlowStatement`). Income limit 2→4. All new fields extracted and included in response JSON.

### `server/routes/comparison.js`

`buildCurrentMetrics()` expands to 6 concurrent fetches (currently 4: profile, ttm, income, hist — add balance sheet and cash flow). Income limit 2→4. All new fields extracted.

The historical `template` object built from annual key-metrics/income also extracts all new fields where available from `getKeyMetricsAnnual`.

### `server/services/matcher.js`

`MATCH_METRICS` array expands from 6 to 22:

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
```

`marketCap` stays with log-normalization. Existing distance/normalization logic unchanged.

### `server/tests/universe.test.js`

Mock data shapes updated to include all new fields so existing tests don't break.

---

## Client Changes

### `client/src/utils/format.js`

New format cases added to `formatMetric` switch:

| Keys | Format |
|---|---|
| `priceToBook`, `evToEBITDA`, `evToRevenue`, `pegRatio` | `x` suffix, 1 decimal |
| `operatingMargin`, `netMargin`, `ebitdaMargin`, `returnOnEquity`, `returnOnAssets`, `returnOnCapital`, `revenueGrowth3yr`, `epsGrowthYoY`, `earningsYield`, `freeCashFlowYield`, `dividendYield`, `priceVsMa50`, `priceVsMa200` | `%`, multiply by 100 if stored as decimal |
| `currentRatio`, `debtToEquity`, `interestCoverage`, `netDebtToEBITDA`, `beta` | raw number, 2 decimals |
| `totalCash`, `totalDebt`, `freeCashFlow`, `operatingCashFlow` | dollar abbreviation ($B/$M) |
| `avgVolume` | volume abbreviation (M/K) |
| `eps` | `$` prefix, 2 decimals |

New entries added to `METRIC_LABELS` for all ~28 keys.

### `client/src/pages/ComparisonDetail.jsx`

`DISPLAY_METRICS` flat array replaced with `METRIC_GROUPS`:

```js
const METRIC_GROUPS = [
  { label: 'Overview',         metrics: ['marketCap', 'eps', 'dividendYield'] },
  { label: 'Valuation',        metrics: ['peRatio', 'priceToBook', 'priceToSales', 'evToEBITDA', 'evToRevenue', 'pegRatio', 'earningsYield'] },
  { label: 'Profitability',    metrics: ['grossMargin', 'operatingMargin', 'netMargin', 'ebitdaMargin', 'returnOnEquity', 'returnOnAssets', 'returnOnCapital'] },
  { label: 'Growth',           metrics: ['revenueGrowthYoY', 'revenueGrowth3yr', 'epsGrowthYoY'] },
  { label: 'Financial Health', metrics: ['currentRatio', 'debtToEquity', 'interestCoverage', 'netDebtToEBITDA', 'freeCashFlowYield', 'totalCash', 'totalDebt', 'freeCashFlow', 'operatingCashFlow'] },
  { label: 'Technical',        metrics: ['rsi14', 'pctBelowHigh', 'priceVsMa50', 'priceVsMa200', 'beta', 'avgVolume'] },
];
```

Each group renders a full-width category header row between the two metric columns, then its rows using existing `ComparisonRow` component. Price stays pinned at top as today.

### `client/src/components/ComparisonRow.jsx`

No changes needed.

### `client/src/pages/MatchResults.jsx` / `MatchCard.jsx`

No changes needed. Match cards automatically benefit from richer scoring.

---

## Computed Metric Formulas

```
revenueGrowthYoY  = (income[0].revenue - income[1].revenue) / abs(income[1].revenue)
revenueGrowth3yr  = (income[0].revenue / income[3].revenue) ^ (1/3) - 1
epsGrowthYoY      = (income[0].eps - income[1].eps) / abs(income[1].eps)
rsi14             = computeRSI(closes.slice(-30))   // oldest-first, last 30
high52w           = Math.max(...historical.map(h => h.close))
pctBelowHigh      = (high52w - price) / high52w * 100
ma50              = avg of last 50 closes (oldest-first array)
ma200             = avg of all closes in 1-year window (~252 trading days)
priceVsMa50       = (price - ma50) / ma50 * 100
priceVsMa200      = (price - ma200) / ma200 * 100
```

All computed metrics wrapped in null guards — if insufficient data, returns null and is skipped by matcher.

---

## Files Modified

| File | Change |
|---|---|
| `server/services/fmp.js` | Add `getBalanceSheet`, `getCashFlowStatement`; bump `RATE_LIMIT_MS` to 250 |
| `server/services/universe.js` | 6-call enrichment, all 34 fields stored |
| `server/routes/snapshot.js` | 7-call fetch, all new fields in response |
| `server/routes/comparison.js` | `buildCurrentMetrics` 6-call, all new fields in template + match |
| `server/services/matcher.js` | `MATCH_METRICS` → 22 dimensions |
| `server/tests/universe.test.js` | Mock data updated for new field shapes |
| `client/src/utils/format.js` | Formatters + labels for all new keys |
| `client/src/pages/ComparisonDetail.jsx` | Grouped display with category headers |

## Files NOT Modified

`server/services/rsi.js`, `server/routes/matches.js`, `server/routes/status.js`, `client/src/components/ComparisonRow.jsx`, `client/src/pages/MatchResults.jsx`, `client/src/components/MatchCard.jsx`, `client/src/components/Sparkline.jsx`
