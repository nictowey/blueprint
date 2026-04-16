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
- [ ] **(Run locally)** Verify FMP `earnings-surprises` (or `/earnings`) availability at current plan tier
- [ ] **(Run locally)** Verify FMP `analyst-estimates`, `grades-consensus`, or `grades-historical` availability
- [ ] **(Run locally)** Verify FMP `insider-trading/latest` or `insider-trading-statistics` availability
- [ ] **(Run locally)** Paste the script output into the Progress Log below so future sessions know which signals are usable
- [ ] If a critical signal has no available path, decide: upgrade FMP plan, substitute alternative data source, or scope catalyst engine down to available signals only

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

- [ ] Extend `server/services/fmp.js` with the endpoints verified in Phase 0
- [ ] Extend or create snapshot fields for catalyst signals (likely separate from the historical snapshot — these are current-state only for v1; historical backtesting gated on data availability)
- [ ] Implement `server/services/algorithms/catalystDriven.js`
- [ ] Register in engine registry; wire `/api/matches?algo=catalystDriven`
- [ ] UI affordance: template-free mode
- [ ] Unit tests
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

- [ ] Extend `server/services/backtest.js` to accept an engine parameter (currently hardcoded to template-match)
- [ ] Add **random-ticker control group** — same-era random stocks as baseline (not just SPY)
- [ ] Report hit rate, median forward return, and max drawdown at 1/3/6/12 months per engine
- [ ] Enforce **walk-forward construction** — only data available at template date is used (verify no peek-ahead in any engine)
- [ ] Report consensus-top-N vs. individual-engine-top-N vs. random control side by side
- [ ] Update `client/src/pages/Proof.jsx` with per-engine methodology + backtest numbers
- [ ] Commit pre-computed proof data following the `2026-04-14-trustworthiness-proof-system` pattern (JSON fallback + Redis cache)

---

## Phase 6: Product / Marketing Updates

- [ ] Update `client/src/pages/TemplatePicker.jsx` — add algorithm selector; keep template input visible in templateMatch mode (preserves "find the next NVDA" hook)
- [ ] Update homepage hero copy to support ensemble narrative without abandoning the NVDA/SMCI/PLTR rotating gains
- [ ] Update `client/src/pages/Proof.jsx` methodology page with 3-engine explanation
- [ ] Update `README.md` with new architecture overview

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
