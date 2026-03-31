# Blueprint — Design Spec
**Date:** 2026-03-30  
**Status:** Approved

## Overview

Blueprint is a stock analysis web app that lets investors select a historical stock + date, view that company's fundamental and technical snapshot at that moment, and find current stocks that match the same profile. Core concept: "NVDA looked like this before it 10x'd. Here are stocks that look like that right now."

---

## Tech Stack

- **Frontend:** React (Vite) + Tailwind CSS + React Router v6
- **Backend:** Node.js + Express
- **Data:** Financial Modeling Prep (FMP) API — Starter plan
- **No database** — all data fetched live from FMP or served from server-side memory cache
- **Font:** Inter (Google Fonts)

---

## Color Palette

| Token | Value |
|---|---|
| Background | `#0f0f13` |
| Card background | `#1a1a24` |
| Border | `#2a2a3a` |
| Accent / CTA | `#6c63ff` (purple) |
| Green | `#22c55e` |
| Yellow | `#eab308` |
| Red | `#ef4444` |
| Text primary | `#f1f5f9` |
| Text secondary | `#94a3b8` |

Dark theme throughout. Premium fintech aesthetic — clean cards, subtle shadows, tight spacing.

---

## Project Structure

```
blueprint/
├── package.json              # root — scripts: dev, install:all
├── .env                      # FMP_API_KEY (never committed)
├── .env.example
├── README.md
├── client/                   # Vite + React + Tailwind
│   ├── package.json
│   ├── vite.config.js        # proxy /api → localhost:3001
│   ├── index.html
│   └── src/
│       ├── main.jsx
│       ├── App.jsx           # React Router, 3 routes
│       ├── components/
│       │   ├── Header.jsx
│       │   ├── SnapshotCard.jsx
│       │   ├── TickerSearch.jsx
│       │   ├── MatchCard.jsx
│       │   ├── ComparisonRow.jsx
│       │   └── Sparkline.jsx
│       └── pages/
│           ├── TemplatePicker.jsx   # Screen 1
│           ├── MatchResults.jsx     # Screen 2
│           └── ComparisonDetail.jsx # Screen 3
├── server/
│   ├── package.json
│   ├── index.js              # Express entry point
│   ├── routes/
│   │   ├── snapshot.js       # GET /api/snapshot
│   │   ├── search.js         # GET /api/search (ticker typeahead)
│   │   ├── matches.js        # GET /api/matches
│   │   └── comparison.js     # GET /api/comparison
│   ├── services/
│   │   ├── fmp.js            # all FMP API calls, key never exposed to client
│   │   ├── rsi.js            # RSI calculation
│   │   ├── matcher.js        # Euclidean distance + scoring
│   │   └── universe.js       # stock universe cache + 24h refresh
│   └── middleware/
│       └── cache.js          # in-memory cache for FMP HTTP responses (TTL: 5min); prevents duplicate FMP calls within a single comparison request (e.g. historical prices fetched once, reused for both RSI and 52-week high)
```

---

## Backend API

Base: `http://localhost:3001`  
All FMP calls are server-side only. The `FMP_API_KEY` env var is never sent to or accessible from the frontend.

### `GET /api/search?q={query}`
Proxies FMP `/search?query={q}&limit=10` for ticker typeahead. Returns array of `{ symbol, name, exchangeShortName }`.

### `GET /api/snapshot?ticker={ticker}&date={YYYY-MM-DD}`
Returns the historical fundamental + technical snapshot for a stock at a given date.

**FMP calls:**
- `/income-statement/{ticker}?period=annual` — use the most recent annual period whose `date` field falls on or before the snapshot date
- `/key-metrics/{ticker}?period=annual` — same period selection logic
- `/historical-price-full/{ticker}` — 30-day window around date for RSI; 1 year back for 52-week high
- `/stock-short-interest/{ticker}` — for `shortInterestPct`; returns `null` if endpoint returns empty or errors

**Returns:**
```json
{
  "ticker": "NVDA",
  "companyName": "NVIDIA Corporation",
  "sector": "Technology",
  "date": "2020-01-15",
  "price": 59.84,
  "peRatio": 52.3,
  "priceToSales": 18.1,
  "revenueGrowthYoY": 0.155,
  "grossMargin": 0.621,
  "rsi14": 61.4,
  "pctBelowHigh": 8.2,
  "marketCap": 36700000000,
  "shortInterestPct": null
}
```

Missing fields are `null` — never omitted from the object.

### `GET /api/matches?ticker={ticker}&date={YYYY-MM-DD}`
Returns top 10 current stocks matching the snapshot profile.

- Reads from in-memory universe cache (no FMP calls at query time — instant response)
- Computes Euclidean distance across 6 core metrics
- Returns ranked array of 10 match objects

**Returns:**
```json
[
  {
    "ticker": "CRWD",
    "companyName": "CrowdStrike Holdings",
    "sector": "Technology",
    "price": 289.40,
    "matchScore": 91,
    "topMatches": ["peRatio", "rsi14", "grossMargin"],
    "topDifferences": ["revenueGrowthYoY"]
  }
]
```

### `GET /api/comparison?ticker={ticker}&date={YYYY-MM-DD}&matchTicker={matchTicker}`
Returns side-by-side data for Screen 3.

- Left: historical snapshot (same logic as `/api/snapshot`)
- Right: current live metrics for `matchTicker` via `/key-metrics/{matchTicker}/ttm`
- Sparkline: 18 months of daily prices AFTER snapshot date via `/historical-price-full/{ticker}`

**Returns:**
```json
{
  "template": { /* snapshot object */ },
  "match": { /* current metrics object, same shape */ },
  "sparkline": [
    { "date": "2020-01-15", "price": 59.84 },
    ...
  ],
  "sparklineGainPct": 847.3
}
```

### `GET /api/status`
Returns cache state: `{ ready: boolean, stockCount: number, lastRefreshed: ISO8601 | null }`. Used by frontend to show a "warming up" state on first load.

---

## Stock Universe Cache (`universe.js`)

- Runs on server startup and every 24 hours via `setInterval`
- **Step 1:** FMP `/stock-screener?marketCapMoreThan=1000000000&marketCapLessThan=100000000000&country=US&exchange=NYSE,NASDAQ` → ~500 results
- **Step 2:** Filter out sectors "Financial Services" and "Utilities"
- **Step 3:** For each stock, fetch `/key-metrics/{ticker}/ttm` in batches of 10 (with 100ms delay between batches to respect rate limits)
- **Step 4:** Store `Map<ticker, metrics>` in memory
- Startup takes ~2–3 minutes for full universe. `/api/status` reports readiness.
- If a per-ticker fetch fails, that stock is silently skipped.

---

## Frontend Screens

### Screen 1 — TemplatePicker (`/`)

Layout: Stacked column (approved). Header at top with "Blueprint" + tagline. Below: search area, then snapshot card, then CTA.

- `TickerSearch`: text input with typeahead dropdown (debounced 300ms, calls `/api/search`). Plain input fallback if no results.
- Date picker: native `<input type="date">` styled dark, `min="2010-01-01"`, `max` = yesterday.
- "Load Snapshot" button: calls `/api/snapshot`, shows loading spinner, renders `SnapshotCard` on success.
- `SnapshotCard`: 3-column metric grid. Each cell has a label + value. Missing data shows "—".
- CTA: "Find Stocks That Look Like This Today →" — calls `navigate('/matches', { state: { snapshot } })`.

Metrics displayed in snapshot card:
1. Price on date
2. P/E Ratio (TTM)
3. Price-to-Sales (TTM)
4. Revenue Growth YoY
5. Gross Margin
6. RSI (14-day)
7. % Below 52-Week High
8. Market Cap
9. Short Interest % (or "—" if unavailable)

### Screen 2 — MatchResults (`/matches`)

- Reads snapshot from `location.state.snapshot` (redirects to `/` if missing)
- Compact summary bar: ticker, date, 3 key metrics inline
- Calls `/api/matches` on mount, shows loading state with rotating messages:
  - "Scanning 300 stocks…"
  - "Calculating similarity scores…"
  - "Ranking matches…"
- 10 `MatchCard` components (Rich Cards style — approved):
  - Ticker + company name + sector + current price
  - Match score badge (purple gradient)
  - Green metric tags (3 closest metrics)
  - Yellow metric tags (1–2 most different, only shown if normalized diff > 0.2)
  - "View Comparison →" → `navigate('/comparison', { state: { snapshot, matchTicker } })`

### Screen 3 — ComparisonDetail (`/comparison`)

- Reads `{ snapshot, matchTicker }` from `location.state` (redirects to `/` if missing)
- Calls `/api/comparison` on mount
- Two-column layout (left: template, right: match)
- Top of left panel: `Sparkline` SVG line chart (18 months post-snapshot), labeled "What happened after" + % gain/loss
- 6 `ComparisonRow` components — each shows: metric label | left value | right value | color dot
  - Green: values within 15% of each other
  - Yellow: 15–40% apart
  - Red: >40% apart
- "Add to Watchlist": saves `{ ticker: matchTicker, companyName, addedAt }` to `localStorage` key `blueprint_watchlist`
- "← Back to Results": `navigate(-1)`

---

## Matching Algorithm

**6 core metrics (equal weight):**
1. P/E ratio
2. Revenue growth YoY
3. Gross margin
4. Market cap (log-normalized before distance calc)
5. RSI (14-day)
6. % below 52-week high

**Per-metric normalization:**
- Collect all values for the metric across the universe
- Min-max scale to [0, 1]
- Apply same scale to snapshot value (clamp to [0, 1])

**Distance calculation:**
- Euclidean distance across available metrics only
- If either side (snapshot or universe stock) is missing a metric, skip that metric
- Adjust denominator: `max_possible_distance = sqrt(available_metric_count)`
- Match score = `(1 − distance / max_possible_distance) * 100`

**Metric tagging:**
- Sort metrics by normalized absolute difference (ascending)
- 3 smallest → green tags
- 1–2 largest → yellow tags (only if normalized diff > 0.2, to avoid tagging near-perfect matches as "different")

---

## RSI Calculation (`rsi.js`)

1. Fetch 30 days of daily closing prices centered on snapshot date
2. Use the 15 trading days ending on/before snapshot date → 14 periods of change
3. Separate daily changes into gains (positive) and losses (absolute value of negative)
4. RS = `avg(gains) / avg(losses)` over the 14 periods
5. RSI = `100 - (100 / (1 + RS))`
6. If fewer than 14 data points available: return `null` (omit from matching, show "—" in UI)

---

## % Below 52-Week High

1. Fetch 1 year of daily prices up to (and including) snapshot date
2. `high52w = max(close prices)`
3. `pctBelowHigh = ((high52w - priceOnDate) / high52w) * 100`

---

## Error Handling

- Missing metrics: always `null` in response, never throw. UI shows "—".
- FMP API errors: Express returns `{ error: "message" }` with appropriate HTTP status. Frontend shows inline error state (not a crash).
- Universe cache failure: server logs error, retries in 1 hour. `/api/status` returns `ready: false`.
- Per-ticker cache fetch failure: stock silently skipped, not added to universe.
- Screen 2/3 with missing route state: redirect to `/`.

---

## Running Locally

```bash
# Prerequisites: Node 18+, FMP Starter API key
cp .env.example .env        # add your FMP_API_KEY
npm install                  # installs root + client + server deps
npm run dev                  # starts both client (5173) and server (3001)
```

Universe cache warms up in background (~2–3 min). `/api/status` reports readiness.

---

## V2 / Out of Scope

- User accounts, authentication
- Database persistence
- Watchlist management UI (V1: localStorage only)
- Pro tier + Lemon Squeezy payment integration
- Mobile-optimized layout
- Backtesting / historical match accuracy
