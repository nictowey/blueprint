# Blueprint Trustworthiness & Proof System

**Date:** 2026-04-14
**Status:** Design approved, pending implementation

## Problem

Blueprint's matching algorithm is well-built (28 metrics, category-first architecture, metric-specific similarity functions) but has critical gaps that prevent it from being trustworthy and sellable:

1. **Profile weights are dead code.** `matchProfiles.js` defines per-metric weights for all 5 profiles, but `matcher.js` never applies them. Profile selection only affects hard filters, not ranking.
2. **No user-facing proof the algorithm works.** Walk-forward validation exists in code but no results are surfaced to users.
3. **Current backtests are misleading.** Per-query backtests match against today's fundamentals, not what companies looked like at the template date. Survivorship bias (current universe only) inflates results.
4. **No stored validation results.** The CLI script exists but has never been run to produce saved output.

## Goals

- Make backtests honest by using historical fundamentals for the 15 curated test cases
- Surface proof of algorithm performance via a dedicated proof page and inline trust signals
- Wire up profile weights so the 5 strategy profiles produce genuinely different rankings
- Architect for future upgrades (historical universe, per-query honest backtests) without blocking current ship

## Non-Goals

- Building a full historical universe (future work)
- Making per-query backtests use historical fundamentals (future work, architected for)
- Validating each profile separately with its own proof data (follow-up after weights are wired)
- UI redesign or new features beyond proof/trust signals

## Constraints

- **Render deployment:** Server hosted on Render, auto-deploys from GitHub push. Universe loads from Redis (Upstash) on cold start — too slow to rebuild from FMP each deploy.
- **FMP rate limit:** 220ms between calls (~272/min). The proof CLI script will make ~1,050+ calls across 15 cases. Estimated runtime: 30-60 minutes.
- **Local dev:** Cannot load full universe locally (too slow). All changes must be testable via unit tests with mock data. Verification happens on Render after push.
- **Redis (Upstash):** Already used for universe cache (7-day TTL). Proof results will also be stored here (30-day TTL) with committed JSON fallback.

---

## Design

### 1. Honest Pre-Computed Backtests

**What:** For each of the 15 curated historical test cases, run the matching algorithm using historical fundamentals — building snapshots for candidate stocks as they looked at the template date, not today.

**How:**

A new CLI script `server/scripts/run-proof.js`:

1. Loads the current universe ticker list from Redis (just the ticker symbols, not the enriched data)
2. For each test case (e.g., NVDA 2023-01-03):
   a. Builds the template snapshot using `snapshotBuilder(ticker, date, true)` (throttled)
   b. For each candidate in the universe (or a pre-filtered subset by sector/market cap):
      - Builds a historical snapshot using `snapshotBuilder(candidateTicker, templateDate, true)`
      - This is the expensive part — mitigated by filtering candidates first
   c. Runs `calculateSimilarity` between template and each candidate's historical snapshot
   d. Takes top 10 matches
   e. Fetches forward returns for top 10 using `getForwardReturns` (already works)
   f. Stores: template info, matches with historical metrics, similarity scores, forward returns

**Candidate filtering to reduce API calls:**
- Use the current universe enrichment data to pre-filter candidates:
  - Market cap within 0.1x to 10x of template's market cap at snapshot date
  - Positive revenue (excludes pre-revenue companies)
  - Has at least 4 quarterly reports available (needed for TTM)
- Only build historical snapshots for the ~100-200 most plausible candidates per case (not all 3,500+)
- This reduces API calls from ~25,000 per case to ~1,400 per case, making the total feasible
- If filtering produces <50 candidates for a case, widen market cap range to 0.01x-100x

**Progress and resume:**
- Script reports progress per test case (e.g., "Case 3/15: SMCI — building 150 candidate snapshots...")
- Results saved incrementally — if the script crashes at case 8, cases 1-7 are preserved
- Resume flag: `--resume` skips cases that already have results in the output file

**Output:**
- Writes to Redis key `proof_results` (30-day TTL)
- Writes to `server/.cache/proof-results.json` (committed to repo as fallback)
- JSON structure:
```json
{
  "version": 1,
  "generatedAt": "2026-04-14T...",
  "profile": "growth_breakout",
  "cases": [
    {
      "templateTicker": "NVDA",
      "templateDate": "2023-01-03",
      "templateCompanyName": "NVIDIA Corporation",
      "templateSector": "Technology",
      "snapshotMetrics": { ... },
      "matches": [
        {
          "ticker": "ANET",
          "companyName": "Arista Networks",
          "sector": "Technology",
          "matchScore": 82.3,
          "categoryScores": { ... },
          "historicalMetrics": { ... },
          "forwardReturns": { "1m": 5.2, "3m": 12.1, "6m": 28.4, "12m": 45.7 }
        }
      ],
      "benchmark": { "1m": 1.2, "3m": 3.5, "6m": 8.1, "12m": 15.3 }
    }
  ],
  "aggregate": {
    "periods": {
      "1m": { "avgReturn": 4.1, "benchmarkReturn": 1.5, "alpha": 2.6, "winRate": 62, "caseCount": 15 },
      "3m": { ... },
      "6m": { ... },
      "12m": { ... }
    },
    "correlation": {
      "1m": { "rho": 0.12, "pairs": 150 },
      "3m": { "rho": 0.18, "pairs": 148 },
      "6m": { "rho": 0.21, "pairs": 140 },
      "12m": { "rho": 0.15, "pairs": 130 }
    },
    "totalMatches": 150,
    "totalCases": 15
  },
  "disclaimers": [
    "Backtests use historical fundamentals reconstructed at the template date via Financial Modeling Prep data.",
    "Match candidates drawn from current stock universe. Companies delisted or acquired between the template date and today are not included, which may overstate results.",
    "Past performance does not guarantee future results.",
    "Not financial advice."
  ]
}
```

**Estimated runtime:** 15 cases x ~150 filtered candidates x 7 FMP calls x 220ms = ~35-45 minutes with throttling. With resume capability, can be run in segments if needed.

### 2. Wire Up Profile Weights

**What:** Make `calculateSimilarity` in `matcher.js` use the per-metric weights defined in `matchProfiles.js`.

**Where:** `matcher.js`, inside the category aggregation loop (currently around line 513 where `weight: 1.0` is hardcoded).

**Change:**
```
// Current (line ~513):
weight: 1.0

// New:
weight: (profileOptions?.weights?.[metricKey]) || 1.0
```

The category score becomes a weighted average of its constituent metric similarities:
- `categoryScore = sum(similarity_i * weight_i) / sum(weight_i)` for metrics in that category
- Instead of: `categoryScore = sum(similarity_i) / count` (current)

**Impact:**
- "Growth Breakout" with revenue growth at weight 3.0 and beta at 1.0 genuinely emphasizes growth metrics
- "Value Inflection" with P/E at 3.0 and technical indicators at 0.5 genuinely favors valuation
- Rankings shift meaningfully based on profile selection

**What doesn't change:**
- Category-level weights (Valuation 0.22, Growth 0.25, etc.) stay the same
- Similarity functions stay the same
- Hard filters stay the same
- Default behavior (no profile or growth_breakout) stays very close to current since growth_breakout weights are close to 1.0 for most metrics

**Tests:**
- Unit test: same stock scores differently under growth_breakout vs value_inflection weights
- Unit test: metric with weight 3.0 contributes 3x to category average vs weight 1.0
- Unit test: missing weight defaults to 1.0
- All with mock data, no universe needed

### 3. Proof API Endpoint

**New endpoint:** `GET /api/proof`

**Behavior:**
1. Try loading from Redis key `proof_results`
2. If Redis miss, load from `server/.cache/proof-results.json`
3. If neither available, return 404 with message "Proof data not yet generated"
4. Cache in-memory for 1 hour (avoid repeated Redis/file reads)

**Response:** The full JSON structure from Section 1.

**No auth required** — this is public-facing proof data.

### 4. Proof Page (Frontend)

**Route:** `/proof`
**Nav link:** Added to Header component, labeled "Methodology" or "Results"

**Layout (top to bottom):**

**A. Hero section:**
- Headline: "How Blueprint Performs"
- Subline: "Backtested across 15 historical breakouts using reconstructed fundamentals"

**B. Aggregate stats cards (4 cards in a row):**
- 12-Month Alpha vs SPY (large number, green if positive)
- Average Win Rate (percentage)
- Spearman Correlation (rho value with interpretation label)
- Cases Tested (count)

**C. Period breakdown table:**
| Period | Avg Return | SPY Return | Alpha | Win Rate | Cases |
|--------|-----------|------------|-------|----------|-------|
| 1 Month | +X.X% | +X.X% | +X.X% | XX% | 15 |
| 3 Month | ... | ... | ... | ... | ... |
| 6 Month | ... | ... | ... | ... | ... |
| 12 Month | ... | ... | ... | ... | ... |

**D. Individual case cards (scrollable/expandable):**
Each card shows:
- Template: ticker, company name, date, sector
- Top 3 matches with scores and 12m returns
- Benchmark (SPY) 12m return
- Alpha for this case
- Expandable to show all 10 matches

**E. Methodology section:**
- Brief explanation: 28 metrics, 6 categories, category-weighted scoring
- How backtests work: historical snapshots reconstructed at template date
- What "match score" means

**F. Disclaimers section:**
- All 4 disclaimers from the proof data JSON
- Styled clearly, not hidden in fine print

**Design:** Follows existing Blueprint aesthetic — dark theme, gold accents, Instrument Serif headings, Outfit body, JetBrains Mono for numbers. Same card/section patterns as other pages.

### 5. Inline Trust Signals

**Match Results page (`MatchResults.jsx`):**
- Small card or banner below the snapshot summary: "Across 15 historical breakouts, Blueprint produced +X% alpha vs SPY over 12 months."
- Link: "See full methodology" → `/proof`
- Data sourced from `/api/proof` aggregate stats (cached, lightweight)

**Comparison Detail page (`ComparisonDetail.jsx`):**
- Near the match score display, subtle text: "Higher match scores have historically correlated with stronger forward returns (rho: X.XX)"
- Link to proof page

**Backtest Results page (`BacktestResults.jsx`):**
- Updated disclaimer: "This backtest compares current fundamentals to the historical template. For backtests using reconstructed historical fundamentals, see our methodology."
- Link to proof page

**Implementation:** Each page fetches `/api/proof` on mount (or shares a cached response). Only uses the aggregate stats — small payload. Falls back gracefully if proof data unavailable (just doesn't show the trust signal, no error).

### 6. Backtest Architecture for Future Upgrade

**Current:** `runBacktest(matches, matchDate)` in `backtest.js` takes pre-found matches and fetches forward returns. The matches come from the current universe.

**Change:** Add an optional `mode` parameter to the backtest flow:
- `mode: 'current'` (default) — current behavior, matches use today's fundamentals
- `mode: 'historical'` — matches rebuilt using `snapshotBuilder` at template date

The proof CLI script uses `mode: 'historical'`. The per-query API endpoint continues using `mode: 'current'`. When a historical universe is available in the future, switching the API endpoint to `mode: 'historical'` requires changing one parameter.

This is an architectural decision, not a big code change — it's about making sure the proof script and the API endpoint share the same backtest logic with a mode flag, rather than having two separate code paths.

---

## File Changes Summary

### New Files
| File | Purpose |
|------|---------|
| `server/scripts/run-proof.js` | CLI script to generate honest pre-computed backtests |
| `server/routes/proof.js` | API endpoint serving proof results |
| `server/.cache/proof-results.json` | Committed fallback for proof data |
| `client/src/pages/Proof.jsx` | Proof/methodology page |

### Modified Files
| File | Change |
|------|--------|
| `server/services/matcher.js` | Apply profile weights in category aggregation (~10-15 lines) |
| `server/services/backtest.js` | Add mode parameter for historical vs current (architectural prep) |
| `server/index.js` | Register `/api/proof` route |
| `client/src/App.jsx` | Add `/proof` route |
| `client/src/components/Header.jsx` | Add nav link to proof page |
| `client/src/pages/MatchResults.jsx` | Add inline trust signal banner |
| `client/src/pages/ComparisonDetail.jsx` | Add inline correlation note |
| `client/src/pages/BacktestResults.jsx` | Update disclaimer with link to proof |

### New Tests
| File | Coverage |
|------|----------|
| `server/tests/matcher.test.js` (extended) | Profile weight application, weighted category averages |
| `server/tests/proof.test.js` (new) | Proof endpoint, Redis/JSON fallback loading |

---

## Implementation Order

1. Wire up profile weights in `matcher.js` + tests
2. Build proof CLI script (`run-proof.js`)
3. Add `/api/proof` endpoint + tests
4. Run proof CLI script (30-60 min, done once)
5. Build proof page frontend
6. Add inline trust signals to existing pages
7. Update backtest disclaimer
8. Push to GitHub → auto-deploy to Render
9. Verify on live site

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Proof CLI script takes too long or hits FMP rate limits | Pre-filter candidates to ~150 per case; resume capability; throttle parameter already built into snapshotBuilder |
| Historical snapshots may have gaps (missing quarterly data for some tickers in 2023) | Gracefully handle nulls, report coverage; matches with <75% overlap already filtered out |
| Proof results may show negative alpha | Show honest results regardless — transparency builds more trust than cherry-picking. If results are bad, that's a signal to improve the algorithm, not hide results |
| Profile weight changes affect existing match rankings | Default profile (growth_breakout) weights are close to current equal-weight behavior; regression risk is low. Unit tests verify |
| Redis proof data expires (30-day TTL) | JSON fallback committed to repo ensures data always available on cold start |
