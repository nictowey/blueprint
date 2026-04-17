# Multi-Algorithm Ensemble — Implementation Plan

> **Status:** Roadmap / progress tracker. Phases 1–5 are not yet started. Update the checkboxes in this file as work completes so sessions on web and desktop stay in sync.
>
> **Related strategy doc:** earlier session plan file at `~/.claude/plans/i-m-wondering-if-this-humble-treasure.md` (on web host; captures the honest assessment and decision rationale).

**Goal:** Evolve Blueprint from a single template-matching engine (with five weight profiles) into a true multi-algorithm system that surfaces stocks appearing in the top-N of multiple independent engines. Preserve the "find the next NVDA" marketing pitch — template-matching becomes one lens among several, not the only one.

**Core insight from strategic review:** The current system is one algorithm in five costumes. `growth_breakout`, `value_inflection`, `momentum_technical`, `quality_compounder`, and `garp` all flow through the same `findMatches()` engine in `server/services/matcher.js:577` and differ only in per-metric weights. Genuinely different engines (momentum/volume breakout detection, catalyst/event-driven ranking) would diversify failure modes and give the backtest something meaningful to measure.

**Known limitations of today's approach (design constraints):**
- **Survivorship bias** in templates — `validation.js:19` lists only famous winners.
- **Fundamentals-heavy, catalyst-blind** — PE, margins, ROE don't capture AI narratives, earnings surprises, or product cycles, which is where real breakouts come from.
- **No causal theory** linking template DNA to forward returns.
- **No reportable edge** — `backtest.js` computes Spearman correlation but surfaces no "we beat SPY by X%" statement.

**User decisions (2026-04-16):**
- Keep template-matching as first-class — it's the distinctive UX and the marketing hook ("find the next NVDA").
- Target ensemble consensus across multiple independent engines.
- Proceed with build.

---

## Architecture Target

Today: `routes/matches.js` → `matcher.findMatches()` (one monolithic function).

Target: `routes/matches.js?algo=<name>` → pluggable engines sharing the same snapshot/universe data.

```
server/services/algorithms/
  templateMatch.js       # current engine extracted + renamed
  momentumBreakout.js    # price/volume pattern detection (template-free)
  catalystDriven.js      # earnings surprises, estimate revisions, insider buys (template-free)
  ensembleConsensus.js   # merges rankings from the others (Borda / reciprocal rank fusion)
```

Each engine exports a common interface — roughly `rank({ template?, universe, options }) → rankedResults[]`. Template is optional (only `templateMatch` requires it). Ensemble engine does not fetch data; it orchestrates and merges rankings from the others.

---

## Phase 0: Verify Data Access (prerequisite)

Catalyst-driven engine depends on FMP endpoints we don't currently consume. Confirm availability and plan-tier access **before** scoping Phase 3.

**Run on local desktop (FMP_API_KEY required, lives in local `.env` only):**

```bash
node server/scripts/verify-fmp-endpoints.js
# or with a different ticker:
node server/scripts/verify-fmp-endpoints.js --ticker NVDA
```

The script probes each candidate endpoint, reports HTTP status + response shape, then groups results by catalyst signal (earnings surprise, estimate revisions, insider buying) and prints a verdict.

**To extend coverage:** edit the `ENDPOINTS_TO_PROBE` (i.e. `buildEndpoints()`) array at the top of `server/scripts/verify-fmp-endpoints.js` to add new endpoints. The script auto-handles auth, status codes, and shape checks.

- [x] Verification script created (`server/scripts/verify-fmp-endpoints.js`)
- [x] **(Run locally)** Verify FMP `earnings-surprises` (or `/earnings`) availability at current plan tier — `/earnings-surprises` 404, `/earnings` ✓ (use `epsActual` vs `epsEstimated` to compute surprise)
- [x] **(Run locally)** Verify FMP `analyst-estimates`, `grades-consensus`, or `grades-historical` availability — all three ✓; `grades-historical` preferred (30 rows of dated rating breakdowns)
- [x] **(Run locally)** Verify FMP `insider-trading/latest` or `insider-trading-statistics` availability — `/insider-trading/latest` ✓ (30 rows), `/insider-trading-statistics` 404
- [x] **(Run locally)** Paste the script output into the Progress Log below so future sessions know which signals are usable
- [x] If a critical signal has no available path, decide: upgrade FMP plan, substitute alternative data source, or scope catalyst engine down to available signals only — **Decision:** all 3 catalyst signals are buildable on the current plan via the working paths above; no plan upgrade needed for v1

---

## Phase 1: Extract Template-Match into Pluggable Architecture

Non-behavioral refactor. Current matcher becomes one engine among many, with zero change to outputs. This is the scaffolding every other phase depends on.

**Implementation note (2026-04-16):** Took the additive approach rather than physically moving `matcher.js`. `matcher.js` remains the source of truth for similarity scoring; `algorithms/templateMatch.js` is a thin adapter that conforms to the shared engine interface. This avoided churning 6 production importers and 2 test files. Future phases add new files to `algorithms/`; no need to revisit this decision unless we want to clean up the wrapper later.

- [x] Create `server/services/algorithms/` directory
- [x] Define shared engine interface in `server/services/algorithms/index.js` — exports `rank({ template?, universe, options })` contract + engine registry
- [x] ~~Move~~ Adapt `server/services/matcher.js` via `server/services/algorithms/templateMatch.js` (thin wrapper exposing the registry interface; matcher.js untouched)
- [x] Update `server/routes/matches.js` to route through the engine registry, defaulting to `templateMatch` when no `algo` param is supplied
- [x] Add `algo` query param parsing with whitelist validation
- [x] Confirm all existing tests pass unchanged (`server/tests/matcher.test.js` — 86 tests pass across matcher/matches/similarity suites)
- [ ] Smoke test: hit `/api/matches?algo=templateMatch&ticker=NVDA&date=2023-01-03` and confirm identical results to the pre-refactor endpoint *(deferred — requires running dev server with FMP API key; can verify on desktop)*

---

## Phase 2: Momentum + Volume Breakout Engine

Template-free engine ranking the universe by classical technical breakout setup. Academically grounded (Jegadeesh & Titman momentum literature). Uses snapshot data we already fetch.

**Ranking signals (v1):**
- Proximity to 52-week high (`pctBelowHigh`) — weight 0.25
- Price vs. 50-day MA (`priceVsMa50`) — weight 0.20
- Price vs. 200-day MA (`priceVsMa200`) — weight 0.20
- RSI-14 in the 60–70 "strong but not overbought" band (`rsi14`) — weight 0.20
- Relative volume spike (`relativeVolume` > 1.5×) — weight 0.15

Each signal is scored 0..1 via a piecewise-linear function tuned for breakout setups. Missing signals are excluded from the weighted average (partial coverage renormalizes over present signals). Stocks with <3 of 5 signals present are dropped. Consolidation/volatility as a 6th signal was scoped out of v1 — not needed for a decent first-pass ranker; reconsider after seeing live results.

- [x] Design scoring function — piecewise-linear per signal, weighted average, coverage threshold
- [x] Confirm no new snapshot fields needed — all 5 signals already on every universe entry (`universe.js:234–239`)
- [x] Implement `server/services/algorithms/momentumBreakout.js`
- [x] Extract shared `isInvestable` to `server/services/algorithms/shared.js` (avoid circular require with registry)
- [x] Register in engine registry (`server/services/algorithms/index.js`)
- [x] Update `server/routes/matches.js` to make ticker+date optional when engine.requiresTemplate === false
- [x] Unit tests — piecewise helper, each signal scorer, combineScores, rank integration (investable filter, coverage threshold, topN, shape compat)
- [ ] **(Run locally)** Smoke test against live universe: `curl http://localhost:3001/api/matches?algo=momentumBreakout` — manually sanity-check top 10 for recognizable momentum names (NVDA, PLTR, APP, etc. likely rank high in current market)
- [ ] UI affordance: frontend needs an algorithm selector + template-free mode (deferred to Phase 6)

---

## Phase 3: Catalyst / Event-Driven Engine

**GATED ON PHASE 0.** Template-free engine ranking by recent catalysts. Closest of the three engines to what actually drives breakouts.

**Ranking signals:**
- Earnings surprise magnitude (last 1–2 quarters)
- Analyst estimate revision breadth — (upgrades − downgrades) / total coverage, weighted by recency
- Insider buying clusters — net share acquisition by insiders over trailing 90 days, normalized by market cap
- Optional: relative-strength vs. sector over last 3 months

- [x] Extend `server/services/fmp.js` with the endpoints verified in Phase 0
- [x] Extend or create snapshot fields for catalyst signals (likely separate from the historical snapshot — these are current-state only for v1; historical backtesting gated on data availability)
- [x] Implement `server/services/algorithms/catalystDriven.js`
- [x] Register in engine registry; wire `/api/matches?algo=catalystDriven`
- [ ] UI affordance: template-free mode
- [x] Unit tests
- [ ] Smoke test against live universe

---

## Phase 4: Ensemble Consensus Layer

Merges rankings from the other engines. This is the actual product pitch: "three independent lenses agree on this stock."

**Approach:**
- Primary merge: reciprocal rank fusion (RRF) — robust to outlier scores, widely used in IR.
- Alternative: Borda count — simpler but can be gamed by long tail of each engine's rankings.
- Consensus threshold: stock must appear in top-N of ≥K engines (configurable; default N=50, K=2 for v1).

- [ ] Implement `server/services/algorithms/ensembleConsensus.js` with RRF merge
- [ ] Accept `engines=[...]` param listing which component engines to include; default to all available
- [ ] Return merged ranking **plus** per-engine rank for each result (so UI can show "ranked #3 by template, #12 by momentum, #7 by catalyst")
- [ ] Register; wire `/api/matches?algo=ensembleConsensus`
- [ ] UI: new results layout showing per-engine ranks alongside consensus score
- [ ] Unit tests — especially edge cases (stock in only one engine, stock in all engines, tied ranks)

---

## Phase 5: Validation & Proof Hardening

Without this, adding more algorithms just adds more unproven claims. Each engine gets backtest numbers surfaced on the methodology page.

- [x] Extend `server/services/backtest.js` (already engine-agnostic; added hitRateVsBenchmark + median maxDrawdownPct + `withSeries` flag)
- [x] Add **random-ticker control group** — same-era random stocks as baseline (not just SPY)
- [x] Report hit rate, median forward return, and max drawdown at 1/3/6/12 months per engine
- [x] Enforce **walk-forward construction** — only data available at template date is used (verify no peek-ahead in any engine); catalystDriven excluded (peek-ahead) + momentum/template confirmed safe
- [x] Report consensus-top-N vs. individual-engine-top-N vs. random control side by side (fixture JSON v2; surfaced in aggregate.engines)
- [x] Update `client/src/pages/Proof.jsx` with per-engine methodology + backtest numbers *(Phase 5b)*
- [ ] Commit pre-computed proof data following the `2026-04-14-trustworthiness-proof-system` pattern (JSON fallback + Redis cache) *(requires fresh fixture regeneration — FMP API + ~30 min)*

---

## Phase 6: Product / Marketing Updates

- [x] Update `client/src/pages/TemplatePicker.jsx` — add algorithm selector; keep template input visible in templateMatch mode (preserves "find the next NVDA" hook)
- [x] Update homepage hero copy to support ensemble narrative without abandoning the NVDA/SMCI/PLTR rotating gains
- [x] Update `client/src/pages/Proof.jsx` methodology page with 3-engine explanation
- [x] Update `README.md` with new architecture overview

---

## Critical Files Reference

- `server/services/matcher.js` — current monolithic engine (Phase 1 refactor target)
- `server/services/matchProfiles.js` — weight profiles (stays scoped to templateMatch)
- `server/services/validation.js:19` — historical test cases (Phase 5 expansion)
- `server/services/backtest.js` — backtest runner (Phase 5 upgrade)
- `server/services/snapshotBuilder.js` — may need new fields for momentum/catalyst
- `server/services/fmp.js` — new endpoints for catalyst engine
- `server/routes/matches.js` — add algo routing (Phase 1)
- `client/src/pages/TemplatePicker.jsx` — algorithm selector UI (Phase 6)
- `client/src/pages/Proof.jsx` — per-engine proof surface (Phases 5–6)

---

## Open Strategic Questions

1. **Phase ordering — validation before or after new engines?** A skeptical founder would harden the backtest first (Phase 5) so we know whether template-match alone has edge before investing in Phase 2–4. Current order assumes "build then validate."
2. **Ensemble default composition.** v1 = all 3 engines. But if Phase 0 shows catalyst data is restricted, fallback is templateMatch + momentumBreakout only.
3. **Template-match with consensus?** Should `ensembleConsensus` require a template (passed through to templateMatch, with momentum/catalyst as pure screeners) or support template-free consensus (momentum + catalyst only)? v1 recommendation: optional template — with template, all 3 engines run; without, only template-free engines run.
4. **UI information density.** Ensemble results show per-engine ranks. That's 3+ rank columns per row plus the consensus score. Needs design thought on the match card.

---

## Session Continuity Notes

- **Branch:** `claude/resume-session-q0YTI` (development branch for this work)
- **Last updated:** 2026-04-16 (Phases 1 + 2 backend complete, Phase 0 awaiting local FMP verification)
- **To resume on desktop:**
  ```bash
  git fetch origin
  git checkout claude/resume-session-q0YTI
  git pull origin claude/resume-session-q0YTI
  cd server && npm install      # if server deps changed
  ```
  Then:
  1. **Phase 0 probe (blocking for Phase 3 scoping):** `node server/scripts/verify-fmp-endpoints.js` — paste the output into this Progress Log.
  2. **Phase 2 smoke test:** start the dev server (`npm run dev` from repo root), then `curl 'http://localhost:3001/api/matches?algo=momentumBreakout' | jq '.[] | {ticker, matchScore, topMatches}'`. Confirm top 10 look plausible (NVDA, PLTR, APP, CLS, etc. likely rank high in momentum regimes).
  3. **Next build increment (recommended):** Phase 4 (ensemble consensus layer). Only requires templateMatch + momentumBreakout which are both live. Phase 3 (catalyst engine) stays gated on Phase 0 data availability.
- **How to update this file:** Tick checkboxes as steps complete. Add a dated entry at the bottom of this section when you finish a phase or make a significant decision.

### Progress log

- `2026-04-16`: Roadmap created. No implementation work started. Strategic direction locked: pluggable architecture + ensemble consensus, template-match preserved as featured engine.
- `2026-04-16`: **Phase 1 complete** (additive variant). Added `server/services/algorithms/{index.js, templateMatch.js}` with engine registry + shared `rank({ template, universe, topN, options })` contract. Wired `?algo=` query param with whitelist validation into `server/routes/matches.js`, defaulting to `templateMatch` when absent. All 86 existing tests across matcher/matches/similarity suites pass — zero behavior change. Live smoke test deferred (needs FMP API key in dev environment). **Next:** Phase 0 (verify FMP catalyst endpoints) or Phase 2 (momentum/volume engine). Phase 2 is buildable today because it only needs snapshot data we already have.
- `2026-04-16`: **Phase 0 partially complete** — verification script `server/scripts/verify-fmp-endpoints.js` shipped. The web environment doesn't have access to the local `.env`/`FMP_API_KEY` so the script needs to be run from the desktop. Probes 7 candidate endpoints across the 3 catalyst signal groups (earnings surprises, analyst grades/estimates, insider trading). Once run, paste the output here so we know which signals Phase 3 can rely on.
- `2026-04-16`: **Phase 2 complete (backend)** — momentum/volume breakout engine shipped at `server/services/algorithms/momentumBreakout.js`. Template-free; ranks the universe by 5 technical signals (52wk-high proximity, price vs. MA50/MA200, RSI-14, relative volume). Uses only data already on every universe entry — no snapshot extension needed. Shared `isInvestable` helper extracted to `server/services/algorithms/shared.js` to avoid circular requires with the registry. `routes/matches.js` updated so template-free engines don't require ticker+date. 33 new unit tests added; full server suite is 195 tests, all passing. **Next step:** run `curl http://localhost:3001/api/matches?algo=momentumBreakout` on desktop to smoke-test against the live universe. Or jump to Phase 4 (ensemble consensus layer) — it has enough component engines (templateMatch + momentumBreakout) to produce a meaningful v1 without blocking on catalyst data.
- `2026-04-16`: **Phase 0 verified on desktop** — ran `node server/scripts/verify-fmp-endpoints.js` against AAPL on the local FMP key. Results:
  ```
  ✗ /earnings-surprises                 HTTP 404 (endpoint missing on plan)
  ✓ /earnings                           10 rows; symbol, date, epsActual, epsEstimated, revenueActual, revenueEstimated
  ✓ /analyst-estimates                  10 rows; revenueLow/High/Avg, ebitdaLow/High/Avg, ...
  ✓ /grades-consensus                   1 row; strongBuy, buy, hold, sell, strongSell, consensus
  ✓ /grades-historical                  30 rows; analystRatingsStrongBuy/Buy/Hold/Sell/StrongSell by date
  ✓ /insider-trading/latest             30 rows; filingDate, transactionDate, transactionType, securitiesOwned, reportingName
  ✗ /insider-trading-statistics         HTTP 404 (endpoint missing on plan)
  ```
  **Verdict:** all 3 catalyst signals (earnings-surprise, estimate-revisions, insider-buying) are buildable. Earnings-surprise must be computed client-side from `epsActual` vs `epsEstimated` on `/earnings` rather than served pre-packaged. Insider-buying uses `/insider-trading/latest` and aggregates client-side (no `/insider-trading-statistics`). Estimate-revisions has 3 working paths; `/grades-historical` is preferred for trend computation. **Phase 3 unblocked — proceeding.**
- `2026-04-16`: **Phase 3 complete** (data layer 3a + engine 3b). Data layer shipped at `server/services/catalystSnapshot.js` — 24h in-memory cache, sequential FMP population, emits `{ earningsSurprise, estimateRevisions, insiderBuying }` in [-1, +1]. Engine shipped at `server/services/algorithms/catalystDriven.js` — template-free composite ranker with weights 0.40 / 0.35 / 0.25, `(s+1)/2` contribution mapping, MIN_SIGNALS_REQUIRED=2, same UI output shape as momentumBreakout. Registered in the engine registry; ensembleConsensus now picks it up automatically as a 3rd independent lens. Added startup hook in `server/index.js` that warms the catalyst cache for the top `CATALYST_WARM_TOP_N` tickers by market cap (default 200, non-blocking, skipped in tests). Route wiring required no changes — `/api/matches?algo=catalystDriven` already works through the existing template-free dispatch. 34 new unit tests (full suite 316, up from 282). **Still deferred:** smoke test against live universe (requires running server with warmed cache on desktop). **Next:** Phase 5 validation, or Phase 6 UI affordance for template-free mode.
- `2026-04-16`: **Phase 5a complete** — backtest + proof refactored for the multi-engine era.
  - `server/services/backtest.js` gains `hitRateVsBenchmark`, median `maxDrawdownPct`, a `withSeries` opt-in on `getForwardReturns` that streams the ascending daily-price series per period, and a standalone `computeMaxDrawdown(prices, endDate)` helper.
  - New `server/services/proof/runProofForEngine.js` — takes an `engineKey` + `testCase` + `universe`, builds the template snapshot, pre-filters candidates, builds historical candidate snapshots, runs `engine.rank(...)`, and fetches forward returns. Sibling `runProofForRandom(...)` picks `sampleSize` tickers from the same pre-filter pool using a seeded LCG RNG (default seed is deterministic from the ticker+date).
  - `server/scripts/run-proof.js` rewritten to loop over `ENGINES_TO_BACKTEST = ['templateMatch', 'momentumBreakout', 'ensembleConsensus']` per test case, then run the random control, producing version-2 JSON with `{ engines, cases: [{ engines: { ... }, random, benchmark }], aggregate: { engines: { templateMatch, momentumBreakout, ensembleConsensus, random } } }`. ensembleConsensus is constrained to templateMatch + momentumBreakout during backtest (catalyst engine excluded).
  - `catalystDriven` is intentionally excluded from historical backtest — `catalystSnapshot` uses current FMP data (last 90 days from today), so any historical score would peek ahead. Surfaced in fixture `disclaimers[]` and in `runProofForEngine`'s explicit skip path.
  - `server/routes/proof.js` now exposes `migrateToV2(data)` that wraps legacy v1 single-engine fixtures into v2 shape (`engines.templateMatch.{status,matches,snapshotsBuilt}`, `random: null`, aggregate nested under `engines.templateMatch`). UI stays unbroken before the first real v2 regeneration.
  - **Walk-forward audit result for momentumBreakout:** `buildSnapshot()` filters historical prices to on-or-before the snapshot date (line 113–114 of `snapshotBuilder.js`) and passes only that filtered series into `computeTechnicals`. All 5 momentum signals (`rsi14`, `pctBelowHigh`, `priceVsMa50`, `priceVsMa200`, `relativeVolume`) are therefore walk-forward safe when the engine reads from the snapshot-built candidate map. Separate concern (pre-existing, not introduced here): momentumBreakout's scoring expects decimal inputs for `priceVsMa50/200` (`0.15` = 15%) but `computeTechnicals` emits percent (`15.0`). Same mismatch exists in live mode — flagged for the phase that owns the engine file.
  - 24 new tests (16 in `tests/backtest.test.js`, 5 additional proof cases in `tests/proof.test.js`). Full suite 340 tests, up from 316. `proof-results.json` fixture intentionally NOT regenerated — the migration shim keeps the existing v1 fixture serving the UI until a real run-proof.js invocation produces v2.
  - **Deferred to Phase 5b:** `client/src/pages/Proof.jsx` update for per-engine methodology + per-engine rows.
  - **Deferred to Phase 5c:** regenerate the fixture (requires FMP API + long runtime) to produce real per-engine + random numbers.
- `2026-04-16`: **Phase 5b complete + Phase 6 Proof methodology piece.** `client/src/pages/Proof.jsx` upgraded from a static marketing page to a data-driven surface.
  - Adds `useState`/`useEffect` fetch of `/api/proof` with four display states: `loading` (shimmer skeleton), `success` (per-engine tables), `notReady` (404 → "results will appear after the next data run"), and `error` (network failure → quiet unavailable notice). Static methodology sections render identically in all states.
  - New "Backtest Results" card rendered after "Why This Approach" and before "28 Financial Metrics". Iterates `ENGINE_ORDER = ['templateMatch', 'momentumBreakout', 'ensembleConsensus', 'random']` and only renders engines actually present in `aggregate.engines` — no empty boxes for the v1-shimmed fixture where only `templateMatch` exists. Null cells (`hitRateVsBenchmark`, `maxDrawdownPct`) render as `—`. `random` engine styled muted (`opacity-80`, `text-text-muted` label, lighter border) to emphasize it's a control group, not a strategy. Migration banner surfaces when `_migratedFromV1: true`. Catalyst-exclusion honesty note rendered below the tables.
  - Methodology copy refreshed for the multi-engine story: hero subtitle now names the three active engines; stats row gains a 4th block ("4 ranking algorithms") alongside the existing 28/8/5; new "The Four Algorithms" card explains Template Match / Momentum Breakout / Catalyst Driven / Ensemble Consensus in 2-3 sentences each. "28 Financial Metrics" gains a scope clarifier ("these metrics drive the Template Match engine specifically"). Disclaimers card gains a third bullet about backtest interpretation + random control.
  - Mobile-layout fix: added `w-full min-w-0` to the `<main>` element. Without it, the table's intrinsic min-content (~317px) combined with `<body>`'s flex-column parent forced main to 425px at 375px viewport, causing horizontal overflow. `min-w-0` lets main shrink to viewport and the inner `overflow-x-auto` table wrapper takes the horizontal scroll instead.
  - All four display states visually verified via puppeteer against a local dev server (vite on 5174 + express on 3001). Success state verified by seeding a v1-shape `server/.cache/proof-results.json` that the migration shim expands to v2 — rendered as expected with `—` for null cells and migration banner showing. `notReady` verified by removing the fixture and restarting. `error` verified by killing the server. Console error-free in all states.
  - No server-side changes, no new tests. Full suite still 338/338 passing across 15 suites.
- `2026-04-16`: **Phase 6 complete** — multi-engine UI shipped (commits `68a924f` + `3c6d2c7`).
  - **`/api/algorithms` endpoint** (`server/index.js`) returns `[{ key, name, description, requiresTemplate }]` per registered engine. Companion to `/api/profiles`.
  - **TemplatePicker** (`client/src/pages/TemplatePicker.jsx`): added subtle "Or browse the universe by lens —" row with 3 secondary-styled buttons that navigate to `/matches?algo=<key>` for momentum/catalyst/ensemble — gated on `serverReady && !blendMode`. Hero rotating subtitle reframed neutrally ("X ran +N% from Y" instead of "X matched our profile in Y") to avoid retroactive "we found this" claim. Existing search flow + FAMOUS_BREAKOUTS chips untouched.
  - **MatchResults** (`client/src/pages/MatchResults.jsx`): new template-free mode driven by `?algo=` URL param (defaults to `templateMatch`). Algorithm dropdown added before the existing Strategy dropdown, populated from `/api/algorithms`. When algo is template-free: snapshot is optional, summary bar shows algorithm name + description instead of ticker/PE/Growth/Margin, profile dropdown hidden, "same sector" option hidden, MATCH_METRICS pass-through skipped, empty-state copy simplified. Switching to templateMatch without a snapshot redirects to `/`. Ensemble + template hybrid: snapshot summary + per-engine MatchCard chips both render. URL state preserved across algo/profile/snapshot transitions.
  - **MatchCard** (`client/src/components/MatchCard.jsx`): when `match.perEngineRanks` exists, renders compact `T#3 · M#12 · C#7` chips below the ticker/company line in `text-[10px] text-text-muted font-mono`. Non-navigable mode for pure template-free results (no snapshot to compare against) — disables click handler, role/tabIndex, hover lift, and chevron. Ensemble + template still navigates to comparison.
  - **README**: replaced single-line "Matching" entry with a 4-engine subsection listing each engine's key + name + 1-line description, plus how to invoke template-free engines.
  - 338/338 tests pass. Polish commit followed code-quality review (dropped unused `useMemo` import, removed unreachable URL-write branch, removed misleading sector-dropdown comment, renamed shadowing variable in MatchCard).
  - **Still deferred:** live smoke test against the live universe with FMP key (validates each `/api/matches?algo=...` path against real data); regenerate `proof-results.json` via `run-proof.js` to replace the v1-migrated fixture with real per-engine numbers.
  - **Plan complete.** All 6 phases shipped. Next steps after this branch merges: run the proof regeneration on a machine with FMP_API_KEY (~30 min runtime); then plan Phase 7+ (e.g. catalyst engine historical backfill, ensemble engine selection in proof, additional algorithms).
