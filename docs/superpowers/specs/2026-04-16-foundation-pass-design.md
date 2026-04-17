# Foundation Pass — Ensemble Fix + Stock Detail Page

**Date:** 2026-04-16
**Status:** Design, awaiting implementation plan

## Goal

Fix the two blockers preventing Blueprint's multi-engine UI from being useful on its own:

1. **Ensemble Consensus returns no results** when clicked from the template picker (template-free mode).
2. **Tickers in template-free pickers are not clickable** — a user cannot drill into a stock's data from Momentum Breakout, Catalyst-Driven, or Ensemble result lists.

Ship a pluggable foundation so every future screener (top-score picker, holding-duration pickers, and engines beyond those) inherits working consensus behavior and click-through-to-detail navigation without per-engine rework.

## Context

Blueprint ships four ranking engines as of commit `6b0ccf0`:

- `templateMatch` — historical-winner similarity (requires a template ticker)
- `momentumBreakout` — template-free technical scanner
- `catalystDriven` — template-free event-driven scanner (reads catalyst cache; no FMP I/O at rank time)
- `ensembleConsensus` — Reciprocal Rank Fusion (RRF) merge of the above

The existing template-mode flow (`/matches?ticker=X&date=Y`) is intact. The UI dead-ends are specifically in template-free mode, which was added in Phase 6 of the multi-algorithm plan (`docs/superpowers/plans/2026-04-16-multi-algorithm-ensemble.md`).

Related memory: `project_multi_algo_direction` — Blueprint treats new ranking ideas as new engines under `server/services/algorithms/`, not new weight profiles inside templateMatch.

## Scope

### In scope

- Ensemble Consensus bug fix with a future-proof `minEngines` rule
- New `/stock/:ticker` detail page (multi-lens: metrics + per-engine scores + "Find similar" CTA)
- New `GET /api/stock/:ticker/engine-scores` endpoint
- Clickable tickers on picker cards (all modes) and on `ComparisonDetail` (both template + match)
- Manual post-implementation audit (code + visual via Chrome) with iterate-until-correct requirement

### Out of scope (future work)

- Top-score picker algorithm
- Holding-duration pickers (1yr / 2yr / 5yr)
- Click-through on watchlist rows, backtest result rows, TopPairs component
- Engine scores computed historically (engines are always scored "latest" in this spec)
- Engine-score distribution bars / visual polish beyond the documented layout
- Any changes to the FMP call pattern, catalyst cache warming cadence, or universe build

## Architecture & Routing

### New route

`/stock/:ticker` with optional `?date=YYYY-MM-DD` query param.

- Date absent → "latest" state: current metrics, current engine scores.
- Date present → metrics as-of-date (via existing `/api/snapshot`), engine scores still current with a visible note: *"Engine scores are current. Metrics shown as of {date}."*

Rationale for showing current engine scores on historical metric views: catalyst cache is always "current" by design (`server/services/catalystSnapshot.js` uses trailing-90d FMP data from today). Recomputing engines historically would require parallel snapshot versions per engine and is out of scope. The dissonance is acknowledged in UI copy.

### New server endpoint

`GET /api/stock/:ticker/engine-scores` — returns engine scores and ranks for the three template-free engines. Details in the Backend Changes section.

### Data flow on page load

`StockDetail.jsx` fires two parallel requests:

1. `/api/snapshot?ticker=X&date=Y` — metrics (reuses existing endpoint, unchanged)
2. `/api/stock/X/engine-scores` — engine scores

Independent failures: if snapshot fails but scores succeed, the scorecard renders; if scores fail but snapshot succeeds, metrics render and the scorecard shows "Scores temporarily unavailable".

### New client route wiring

`client/src/App.jsx` registers `<Route path="/stock/:ticker" element={<StockDetail />} />` alongside the existing routes.

## Ensemble Bug Fix

**Root cause:** `server/services/algorithms/ensembleConsensus.js` defaults `minEngines = 2`. When invoked without a template, only two engines run (momentumBreakout + catalystDriven). Requiring both engines' top-50 to overlap is restrictive by design — the engines measure different things — and returns empty in common states, including catalyst-cold-start where `catalystDriven.rank()` returns `[]`.

### Fix

Replace the fixed `DEFAULT_MIN_ENGINES = 2` with an adaptive rule:

```js
function defaultMinEngines(enginesRunning) {
  if (enginesRunning <= 2) return 1;            // union view — RRF ordering still surfaces agreement
  return Math.floor(enginesRunning / 2) + 1;    // strict majority
}
```

Projected behavior as engines are added:

| engines running | minEngines | semantic |
|---|---|---|
| 2 | 1 | union — results sorted by RRF; stocks in both engines rank higher organically |
| 3 | 2 | majority ("2 of 3 agree") — preserves today's with-template behavior |
| 4 | 3 | majority |
| 5 | 3 | majority |
| 6 | 4 | majority |
| 7 | 4 | majority |

Explicit `options.minEngines` overrides still honored — callers can force strict unanimity or a custom threshold.

### UI messaging

When ensemble runs in the 2-engine (template-free) path, the MatchResults empty-state copy (only hit now if every engine returned zero results) and the results-header copy should acknowledge the lens count:

- Results header: *"Top picks across Momentum + Catalyst. Add a template ticker to include Template Match as a third lens."*
- Empty state: *"No stocks scored by both engines. Add a template ticker to include Template Match."*

No new route or state needed — this is a copy change inside `MatchResults.jsx`.

### Optional: catalyst cold-start log

Single `console.warn('[ensembleConsensus] catalystDriven returned 0 results — cache may be cold')` gated to fire at most once per server uptime. Lightweight debuggability for dev environments where the catalyst warm loop hasn't run. Skippable if the team wants zero log noise; flagged here so the implementation plan can make a call.

## Stock Detail Page (`client/src/pages/StockDetail.jsx`)

Page structure, top to bottom:

### 1. Header card

- Ticker (mono, bold), company name, sector pill, market cap
- If date param present: amber notice *"Viewing metrics as of {date}"*
- Back button (uses `navigate(-1)` like other pages)

### 2. Price strip

- Current price (or close-on-date for historical) with `MiniSparkline` from `recentCloses`
- Historical framing: `close: $142.30` rather than "current price"

### 3. Engine scorecard

Four rows in a card layout:

```
Template Match      — requires a template ticker            [Find similar stocks →]
Momentum Breakout   72 · ranked #14 of 487                  Top signals: pctBelowHigh, priceVsMa50
Catalyst-Driven     48 · ranked #203 of 487                 Top signals: estimateRevisions
                                                            Low signal: insiderBuying
Ensemble Consensus  65 · ranked #38 of 487                  2 / 2 engines rank this top-50
```

Formatting:

- Score: 0–100, rounded to 1 decimal (matches existing MatchCard).
- Rank: `#14 of 487` when ranked. `totalRanked` comes from the engine-scores response and reflects how many stocks that engine ranked (investable + coverage-passing); it will be slightly different per engine.
- If the engine dropped this stock (coverage threshold fail or missing signals): render the row as `— insufficient data`. This is the only "not ranked" case — the endpoint calls each engine with `topN: universe.size`, so any ranked stock has a numeric rank.
- Each row has hover state linking to `/matches?algo=<key>` so users can jump to that engine's top-10 list.

Top/weak signals render as metric keys using existing `topMatches` / `topDifferences` fields on the engine output. A follow-up polish pass can humanize labels ("near 52wk high" instead of `pctBelowHigh`), but keys are acceptable for v1.

### 4. Metrics groups

28 metrics grouped by category. Each group is a card with two-column layout (label + formatted value). Categories and order:

- *Valuation* — `peRatio`, `pegRatio`, `priceToBook`, `priceToSales`, `evToEBITDA`, `evToRevenue`
- *Growth* — `revenueGrowthYoY`, `revenueGrowth3yr`, `epsGrowthYoY`
- *Margins* — `grossMargin`, `operatingMargin`, `netMargin`, `ebitdaMargin`
- *Quality* — `returnOnEquity`, `returnOnAssets`, `returnOnCapital`, `freeCashFlowYield`
- *Balance Sheet* — `currentRatio`, `debtToEquity`, `interestCoverage`, `netDebtToEBITDA`
- *Technicals* — `rsi14`, `pctBelowHigh`, `priceVsMa50`, `priceVsMa200`, `beta`, `relativeVolume`

Missing values render as `—` (existing `formatMetric` convention).

### 5. Primary CTA

Prominent "Find similar stocks →" button near the top of the page, repeated at the bottom of the metrics section. Navigates to:

```
/matches?ticker={ticker}&date={date-or-latest}&algo=templateMatch
```

Passes the already-loaded snapshot via React Router state so `MatchResults.jsx` skips the snapshot fetch (same pattern used from `TemplatePicker`).

### 6. Secondary actions

- "Add to watchlist" button — reuses existing watchlist infrastructure (same behavior as from the comparison page).

### Responsive layout

Mobile-first, single column below 640px. Engine scorecard rows stack vertically. Metric groups stack single-column. Follow existing Blueprint pattern (see `MatchResults.jsx` mobile layout with `w-full min-w-0`).

### Empty / error states

- Ticker not in universe → 404 state with back link
- Snapshot fetch fails → show error in header card, still render engine scorecard
- Engine scores fetch fails → scorecard placeholder with "Scores temporarily unavailable"
- All three template-free engines return `insufficientData` → scorecard shows each row with `— insufficient data` (not an error)

## Navigation Changes

### `client/src/components/MatchCard.jsx`

Replace the `canNavigate` gate. All cards become clickable. Click target depends on context:

| Context | Click destination |
|---|---|
| Template-mode (has `snapshot`, algo=`templateMatch`) | `/comparison?...` (unchanged) |
| Ensemble with template | `/comparison?...` (unchanged) |
| Template-free OR ensemble-without-template | `/stock/{ticker}` (new) |

Per-engine chips (`T#3 · M#12 · C#7`) stay on all variants — they're useful wherever they appear.

Remove the `cursor-default` className branch that's no longer reachable.

### `client/src/pages/ComparisonDetail.jsx`

Both ticker symbols in the header become clickable links:

- Template ticker → `/stock/{ticker}?date={date}` (the template's date)
- Match ticker → `/stock/{match-ticker}?date={date}` (same date as the comparison — user was reasoning about this moment)

Styling: underline-on-hover, mono font preserved, same color as current display. Should look like a link without shouting.

### Unchanged

- `client/src/pages/Watchlist.jsx` — rows still expand/collapse locally, no click-through
- `client/src/pages/BacktestResults.jsx` — result rows unchanged
- `client/src/components/TopPairs.jsx` — unchanged

Noted in "Future work" for a subsequent pass.

## Backend Changes

### New file: `server/routes/stock.js`

`GET /api/stock/:ticker/engine-scores`

Flow:

1. Validate ticker exists in the loaded universe → 404 if not.
2. Check in-memory LRU cache (60s TTL, keyed by ticker) — return cached payload if hit. TTL is short enough that universe refreshes (handled elsewhere) age entries out naturally; no cross-cache coordination needed.
3. Run `momentumBreakout.rank({ universe, topN: universe.size })` and `catalystDriven.rank({ universe, topN: universe.size })`. `topN = universe.size` gets the full ranking so we can locate arbitrary tickers.
4. Run `ensembleConsensus.rank({ universe, topN: universe.size })` with no template — exercises the Section "Ensemble Bug Fix" path.
5. For each engine, locate the ticker in its sorted output. Return rank = index + 1 when found; rank = null + `insufficientData: true` when the engine dropped the stock.
6. Build response and write to cache.

Response shape:

```json
{
  "ticker": "NVDA",
  "asOf": "2026-04-16",
  "engines": {
    "momentumBreakout": {
      "score": 72.4,
      "rank": 14,
      "totalRanked": 487,
      "topSignals": ["pctBelowHigh", "priceVsMa50"],
      "weakSignals": ["relativeVolume"],
      "coverageLevel": "complete"
    },
    "catalystDriven": {
      "score": null,
      "rank": null,
      "totalRanked": 487,
      "insufficientData": true,
      "coverageLevel": "sparse"
    },
    "ensembleConsensus": {
      "score": 65.1,
      "rank": 38,
      "totalRanked": 487,
      "consensusEngines": 2,
      "totalEngines": 2
    }
  }
}
```

`totalRanked` = number of stocks an engine returned (investable + coverage-passing), not universe size. `totalEngines` on ensemble = how many engines ran (2 template-free, 3 with template).

### Wiring

`server/index.js` adds `app.use('/api/stock', require('./routes/stock'))` next to the existing route mounts.

### Modified: `server/services/algorithms/ensembleConsensus.js`

Per Section "Ensemble Bug Fix":

- Add `defaultMinEngines(enginesRunning)` helper
- In `rank()`, replace `options.minEngines != null ? options.minEngines : DEFAULT_MIN_ENGINES` with `options.minEngines != null ? options.minEngines : defaultMinEngines(engines.length)`
- Export `defaultMinEngines` on `_test` for unit testing
- Keep `DEFAULT_MIN_ENGINES = 2` as a historical constant if any external code reads it, or remove it entirely (implementation plan decides based on grep results)

## FMP Rate Limit Considerations

Blueprint has a 300 ping/minute FMP budget (per user memory `feedback_fmp_rate_limit`). Audit of this spec's paths:

| Path | Hits FMP? | Notes |
|---|---|---|
| `/api/stock/:ticker/engine-scores` | **No** | In-memory reads only — universe + catalyst cache |
| `/api/snapshot?ticker=X` (latest) | No | Universe already has it |
| `/api/snapshot?ticker=X&date=Y` (historical) | Yes | Existing behavior, unchanged |
| `/stock/:ticker` navigated from template-free picker | No | No date → latest → no FMP |
| `/stock/:ticker?date=Y` navigated from comparison | Yes *or* reused | Detail page passes snapshot via React Router state; only fetches if absent |
| "Find similar" CTA | Unchanged | Reuses existing templateMatch flow |

### Explicit constraints carried into implementation

1. **Engine-scores endpoint must remain FMP-free.** Any future engine that introduces I/O has to route through the existing sequential FMP queue — not called per-request from this endpoint.
2. **Detail page prefers passed-in snapshot over fetch.** `StockDetail.jsx` checks `location.state.snapshot` first, falls back to `/api/snapshot` only if absent.
3. **Catalyst cache is never populated on a user-request path.** Cold-start fills via the startup warm loop only. Detail pages for non-warmed tickers show "insufficient data" gracefully.
4. **60s LRU on engine-scores** reduces re-rank cost on repeat views; the bigger win is never touching FMP.

**Net FMP delta from this spec: zero new calls.** Historical snapshot builds happen at today's rate.

## Testing & Verification

### Automated (Jest)

**New: `server/tests/stock.test.js`**

- Happy path: returns scores + ranks for a stock ranked by all three template-free engines
- Insufficient-data: stock with no catalyst data → `catalystDriven: { score: null, insufficientData: true }`
- Outside-top-N: stock dropped by an engine's coverage gate → `rank: null`, clear flag
- Unknown ticker → 404 + empty body
- Cache hit: second call within 60s does not re-run engine `rank()` methods (mocked, call count asserted)

**Extended: `server/tests/ensembleConsensus.test.js`**

- Parametrized cases for 2, 3, 4, 5, 6 engines → assert `defaultMinEngines` returns 1, 2, 3, 3, 4 respectively
- Template-free invocation with default options → returns non-empty union when engines have no overlap
- Explicit `options.minEngines=2` in a 2-engine invocation → original strict-agreement behavior preserved (regression guard)
- With-template 3-engine invocation → minEngines defaults to 2 (unchanged behavior)

No new frontend test harness. Frontend verification is manual (see below).

### Manual verification — post-implementation audit (required)

After implementation lands, audit both code paths and the rendered UI via Chrome. Iterate until everything functions correctly — do not mark the work complete if any case below fails.

**Backend / API:**
- `curl /api/stock/NVDA/engine-scores` returns the documented shape
- Unknown ticker returns 404
- Cache hit on second call (verified via server logs or timing)

**Frontend routing & state:**
- `/stock/NVDA` renders all six sections
- `/stock/NVDA?date=2023-01-03` shows amber date notice, historical metrics, current-scores note
- React Router state reuse: clicking a ticker from `ComparisonDetail` does NOT trigger a snapshot re-fetch (check network tab)

**Ensemble fix:**
- `/matches?algo=ensembleConsensus` (no template) returns a non-empty list
- Results show per-engine chips
- Empty state copy updated (only reachable if both engines return zero results)

**Click-through behavior:**
- Template-mode MatchCard click → `/comparison?...` (unchanged)
- Template-free MatchCard click → `/stock/:ticker`
- Both ticker symbols on ComparisonDetail header → respective `/stock/:ticker?date=...`

**Responsive:**
- 375px viewport: no horizontal overflow, engine scorecard stacks cleanly, metric groups collapse to single column

**Visual audit via Chrome MCP:**
- Confirm hover states, colors, typography match Blueprint's existing design language (compare to MatchResults and ComparisonDetail)
- Confirm the "Find similar" CTA is visually prominent but not overwhelming
- Confirm the engine scorecard reads cleanly — no cramped or misaligned rows

If any verification step fails, edit source and re-verify. The spec is not satisfied by "tests pass" alone; functionality-as-described is the completion bar.

## File Inventory

### New files
- `server/routes/stock.js`
- `server/tests/stock.test.js`
- `client/src/pages/StockDetail.jsx`

### Modified files
- `server/services/algorithms/ensembleConsensus.js` — adaptive `defaultMinEngines`
- `server/tests/ensembleConsensus.test.js` — new parametrized cases
- `server/index.js` — mount `/api/stock` route; optional catalyst cold-start log
- `client/src/App.jsx` — add `/stock/:ticker` route
- `client/src/components/MatchCard.jsx` — universal click-through + route selection
- `client/src/pages/ComparisonDetail.jsx` — clickable ticker links in header
- `client/src/pages/MatchResults.jsx` — ensemble-without-template copy updates

## Future Work (explicitly out of scope)

- **Top-score picker** — altindex-style "top 10 by composite score" view
- **Holding-duration pickers** — 1yr / 2yr / 5yr ideal-hold rankings (methodology research required)
- **Watchlist click-through** — rows navigate to `/stock/:ticker`
- **Backtest results click-through** — result rows navigate to `/stock/:ticker?date=...`
- **TopPairs click-through**
- **Historical engine scores** — would require per-date catalyst snapshots (currently impossible given catalyst cache design)
- **Engine-score distribution bars** — mini-bar visual showing stock's position in each engine's 0–100 distribution
- **Humanize signal labels** — show "near 52-week high" instead of the raw metric key `pctBelowHigh`
- **Compare-to-specific-stock shortcut** on the detail page (beyond the generic Find-similar CTA)
