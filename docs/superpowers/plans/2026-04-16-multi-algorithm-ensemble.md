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

- [ ] Verify FMP `earnings-surprises` endpoint availability at current plan tier
- [ ] Verify FMP `analyst-estimates` (or `upgrades-downgrades-consensus`) availability
- [ ] Verify FMP `insider-trading` endpoint availability
- [ ] Document which endpoints are missing and whether an alternative data source is needed
- [ ] If a critical endpoint is missing, decide: upgrade plan, substitute algorithm, or defer catalyst engine

---

## Phase 1: Extract Template-Match into Pluggable Architecture

Non-behavioral refactor. Current matcher becomes one engine among many, with zero change to outputs. This is the scaffolding every other phase depends on.

- [ ] Create `server/services/algorithms/` directory
- [ ] Define shared engine interface in `server/services/algorithms/index.js` — exports `rank({ template?, universe, options })` contract + engine registry
- [ ] Move `server/services/matcher.js` → `server/services/algorithms/templateMatch.js`; rename `findMatches` to match interface (keep old name as re-export for back-compat during transition)
- [ ] Update `server/routes/matches.js` to route through the engine registry, defaulting to `templateMatch` when no `algo` param is supplied
- [ ] Add `algo` query param parsing with whitelist validation
- [ ] Confirm all existing tests pass unchanged (`server/tests/matcher.test.js`)
- [ ] Smoke test: hit `/api/matches?algo=templateMatch&ticker=NVDA&date=2023-01-03` and confirm identical results to the pre-refactor endpoint

---

## Phase 2: Momentum + Volume Breakout Engine

Template-free engine ranking the universe by classical technical breakout setup. Academically grounded (Jegadeesh & Titman momentum literature). Uses snapshot data we already fetch.

**Ranking signals:**
- Proximity to 52-week high (`pctBelowHigh`) — prefer <10% below
- Price above 50-day MA AND above 200-day MA (`priceVsMa50`, `priceVsMa200`)
- RSI-14 in the 60–70 "strong but not overbought" band
- Relative volume spike (`relativeVolume` > 1.5)
- Low-volatility consolidation before move (measured over N-day window — may need new snapshot field)

- [ ] Design scoring function — decide weighting among the 5 signals
- [ ] Determine if consolidation detection needs a new snapshot field (stddev of daily returns over last 30 days); if so, extend `snapshotBuilder.js`
- [ ] Implement `server/services/algorithms/momentumBreakout.js`
- [ ] Register in engine registry; wire `/api/matches?algo=momentumBreakout`
- [ ] UI affordance: on frontend, when `algo=momentumBreakout` is selected, hide template input (engine is template-free)
- [ ] Unit tests with synthetic universes where expected rankings are known
- [ ] Smoke test: run against current universe, manually sanity-check top 10 for recognizable momentum names

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
- **Last updated:** 2026-04-16 (initial roadmap creation, no implementation started)
- **Next step when resuming:** Decide Phase 0 (data access verification) vs. Phase 1 (architectural refactor) as the first concrete increment. Phase 1 is pure refactoring with zero behavior change — low risk, unblocks everything. Phase 0 is reading API docs / making test calls.
- **How to update this file:** Tick checkboxes as steps complete. Add a dated entry at the bottom of this section when you finish a phase or make a significant decision.

### Progress log

- `2026-04-16`: Roadmap created. No implementation work started. Strategic direction locked: pluggable architecture + ensemble consensus, template-match preserved as featured engine.
