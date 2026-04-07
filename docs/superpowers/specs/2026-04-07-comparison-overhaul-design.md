# Comparison Overhaul Design

**Date:** 2026-04-07  
**Status:** Approved

## Problem

Three compounding issues make match results misleading:

1. **Score inflation** — The matcher skips null snapshot metrics entirely. A historical snapshot with only 8 of 27 metrics populated scores against just those 8, so everything clusters at 95–99% regardless of actual similarity.
2. **Market cap distortion** — Matching compares a historical market cap (e.g. NVDA 2022: $611B) against current universe values. This punishes stocks that have grown since then — exactly the stocks the app is trying to surface.
3. **Missing match sparkline** — The comparison page shows the template's historical price chart but leaves the match company's panel empty ("Current profile as of today"), breaking the core visual narrative.

## Fix 1: Honest Scoring (Fixed Denominator)

**Change:** `calculateSimilarity` in `server/services/matcher.js`

Instead of dividing by the weight of only populated metrics, always divide by the total possible weight of all metrics in `MATCH_METRICS`. Null snapshot metrics contribute 0 to the numerator but their weight still counts in the denominator.

```
score = Σ (metricSimilarity × weight) for populated metrics only
totalWeight = Σ (weight) for ALL metrics in MATCH_METRICS (fixed)
finalScore = (score / totalWeight) × 100
```

**Effect:** A snapshot with 8/27 metrics can never score higher than ~30–40% even if those 8 are perfect matches. Real, well-populated matches score in the 55–80% range. Scores become meaningful and differentiated.

Sector bonus stays but is also divided by the fixed denominator.

## Fix 2: Remove marketCap from Matching

**Change:** Remove `'marketCap'` from `MATCH_METRICS` in `server/services/matcher.js` and from the client-side `MATCH_METRICS` array in `MatchResults.jsx`.

**Rationale:** Market cap is an outcome of the stock's trajectory, not a fundamental indicator of its profile. The thesis is: "find stocks whose fundamentals look like this company's did." A stock that was $600B then and is $2T now is a success story — removing market cap from matching means today's stocks aren't penalized for having grown.

Market cap remains visible in the comparison detail page for reference — it's just not used in scoring.

## Fix 3: Dual Sparkline in Comparison

**Backend:** `server/routes/comparison.js`
- Add a second historical price fetch for the match ticker covering its last 12 months
- Return as `matchSparkline` and `matchSparklineCurrentPrice` in the response

**Frontend:** `client/src/pages/ComparisonDetail.jsx`
- Replace the "Current profile as of today" placeholder with a `<Sparkline>` component using `data.matchSparkline`
- Left sparkline: template's historical run-up window (unchanged)
- Right sparkline: match company's last 12 months

The `Sparkline` component already accepts `data` (array of prices) and `gainPct` — compute `matchSparklineGainPct` on the backend the same way `sparklineGainPct` is computed for the template.

## Files Changed

| File | Change |
|------|--------|
| `server/services/matcher.js` | Fixed denominator scoring, remove `marketCap` from `MATCH_METRICS` |
| `server/routes/comparison.js` | Fetch match ticker 12-month prices, return `matchSparkline` + `matchSparklineGainPct` |
| `client/src/pages/MatchResults.jsx` | Remove `marketCap` from client `MATCH_METRICS` |
| `client/src/pages/ComparisonDetail.jsx` | Render `<Sparkline>` for match company |

## Testing

- `matcher.test.js`: update score expectations to reflect fixed denominator (scores will drop significantly)
- New test: sparse snapshot (5 metrics) scores lower than rich snapshot (20 metrics) against identical stock
- New test: removing `marketCap` from MATCH_METRICS doesn't break `findMatches`
- `comparison.js` integration: mock second historical price fetch, assert `matchSparkline` in response

## Out of Scope

- Correlation filter (most/least correlated companies) — future spec
- Changing which metrics appear in the comparison detail table
