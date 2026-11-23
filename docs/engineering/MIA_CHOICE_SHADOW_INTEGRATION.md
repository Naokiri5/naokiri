# MIA Choice Management: Phase 1 integrated shadow arbitration

**Baseline:** Naokiri5/naokiri main (MIA 4.1 paper-only).  
**Branch:** feature/mia-choice-shadow-arbitration-20261123.  
**Scope:** Limited, observable implementation of MIA-CM-006/007 using canonical MIA services. NOT the complete 15-module specification and NOT a live-trading release.

## Source reconciliation

Reviewed the owner's uploaded MIA 5.0 Choice Management bundle (MIA-CM-001..015, three test bundles), the supporting TypeScript/state-machine, integration, SQLite/DuckDB, release-gate, React-panel documents, and the 97-slot SharedArrayBuffer proposal. The uploaded engineering master prompt requires no duplicate trading authorities, runnable paths, read-back testing, and no merge with incomplete gates.

Canonical owners in the repository:

| Concern | Reused owner | Current integration |
| --- | --- | --- |
| Market data/scanning | market/fabric.ts, market/scanner.ts | Canonical scanOnce unchanged |
| Indicators | features/indicators.ts | No second feature/vector implementation |
| Workers/consensus | workers/, qci/ | Reuse existing candidate reports |
| Decision/score | decision/engine.ts, decision/scoring.ts | Read only; neither bypassed nor replaced |
| Risk/permissions | risk/gate.ts, core/mode.ts | Must already authorize PAPER candidate; no new grant authority |
| Execution & reservations | exec/oms.ts, portfolio/ledger.ts | Completely unchanged |
| Observed comparison | choice/arbitration.ts (new pure function) | Bounded, deterministic, shadow-only |
| Durable results | ditas/memory.ts | Existing atomic append-only hash chain |
| Runtime | bot/bot.ts | Reports collected while normal onDecision callback remains intact |
| Owner cockpit | api/routes.ts, web/pages/Trading.tsx | Authenticated GET and read-only panel |

## Run-time behavior

1. The existing scan loop generates strategy candidates and passes them through canonical QCI, central Decision Engine, and Risk Gate.
2. The existing onDecision callback continues to submit or queue PAPER orders immediately, exactly as before. Protective exit monitoring remains on its independent hot lane.
3. A bounded copy of resulting DecisionReports is captured for shadow research, without modifying decisions.
4. At the end of the scan, the current lease holder performs an observational comparison. It considers only PAPER_TRADE reports with Risk=ALLOW, strong unexpired QCI, finite 0..100 evidence scores, finite nonnegative cost R, and non-failed data quality. Invalid/missing/expired/mode-changed inputs do not win.
5. A deterministic highest-evidence-score choice is compared with first-eligible arrival; cost R is only a tie-break in the *same unit*, never subtracted from a score of different units. An empty/unsafe/incomplete round produces a first-class no-trade outcome.
6. The DITAS immutable event chain records the comparison, original DecisionReport IDs, reasons and caveat. The event is idempotent by round ID. No orders, fills, positions, financial ledger entries or strategy policy are written by Choice Management.
7. GET /api/choice/shadow?limit=20 exposes historical rounds to the authenticated owner; the existing Bot Account screen displays the latest observed comparison.

**The comparison happens after sequential baseline execution and is NOT a causally valid counterfactual.** Observations later in a scan may be affected by earlier order fills, risk budget changes and candidate timing. A higher uncalibrated score is not proof of higher profitability.

## Activation, rollback and failure isolation

- The read-only shadow recorder defaults to enabled in running PAPER/OBSERVE modes. Set MIA_CHOICE_SHADOW=0 to disable further shadow recording (restart required), without changing canonical orders or exits.
- The API and UI continue to be read-only. Existing history remains visible unless the database is restored.
- If a shadow audit write fails, the bot records a visible choice-shadow error; it does not block protective exits or grant an order permission.
- The scanner holds the canonical database lease before recording. Only one holder can append a completed round.
- No schema migration was added. This deliberately avoids collision with draft bundle PR #106, which owns a separate v6 bundle migration.

## Duplicate/conflict register

- PR #106 contains a *different* PAPER atomic bundle capability using the canonical OMS. It must be reconciled before introducing portfolio-wide capital reservations or multi-leg active execution.
- PRs #118, #119 and #121 harden OMS write-transaction concurrency and executed-price risk. They must be merged/reconciled and retested before future active arbitration.
- PR #125 patches paper/live decision-mode classification. It must be reviewed before enabling any mode beyond PAPER.
- PR #45 is a large unmerged, currently conflicting integration branch. Do not copy its OMS/risk/decision code into this branch.
- The supplied AtomicReservationManager uses an in-memory Map, which is insufficient to guarantee reservations and locks across process crashes. It has NOT been installed.
- The supplied HP97 SharedArrayBuffer scheme overlaps with the existing canonical FeatureEngine/worker pool. A hard 4 ms SLA and 100 OS worker threads are NOT justified by the repository's measured architecture. It has NOT been installed.
- DuckDB analytical tables, counterfactual replay, calibrated economic scoring, real capital reservations and automatic ACTIVE routing are NOT installed; doing so now would misrepresent evidence and create a second risk/execution authority.

## Required tests (do not claim PASS unless actually run)

New regression file: server/test/choice-shadow.test.ts

- Stable ranking/tie-breaking, no mutation, risk veto, expiry, invalid scores/costs, mode changes, incomplete rounds and empty no-trade.
- Append-only DITAS hashing, duplicate round ID idempotency, SQLite close/reopen and financial-table isolation.
- Owner authentication and read-only API response, query bounds, honest release status.

Commands that must run at exact branch head:

    npm ci
    npm run typecheck
    npm test
    npm run build
    npm run test:e2e
    npm run scan:secrets
    npm audit --audit-level=high

Also replay a realistic scanner-to-OMS paper run, take a consistent DB backup and restore, compare paper account cash/fill accounting before and after shadow enablement, and profile CPU/DB footprint over a prospective soak.

## Unmet release gates / phased follow-up

The owner supplied G-CM-1 through G-CM-4: a statistically meaningful *observed* choice-vs-baseline counterfactual edge comparison, no-trade false-rejection accountability, bounded latency/expiry, and zero residual reservations. None is established by this phase. Shadow comparisons are not automatically promoted by the bot. The API explicitly returns NOT_CERTIFIED.

Before any ACTIVE paper cutover:
1. Assemble same-time frozen candidate snapshots BEFORE sequential OMS writes, and define bounded collection/deadlines without delaying exits.
2. Establish out-of-sample calibrated post-cost expectancy with cohort/version/provenance and enough observations. No QCI score as P(win).
3. Reuse the existing OMS/ledger transaction and deterministic risk gate for atomic, crash-recoverable capital/risk reservations. Do not add a competing OMS or in-memory-only financial authority.
4. Implement unbiased historical/prospective shadow comparisons and no-look-ahead Decision Twin evaluation on source-verified executable book data.
5. Complete 4 release gates with evidence and measure end-to-end risk/financial accounting, restart, partial-fill, cancellation and data-gap behavior.
6. Request owner permission before any ACTIVE mode change. Keep live execution locked until its separate global release gates and authorization are verified.

**Merge rule:** leave this pull request DRAFT until exact-head CI, independent review, regressions, architecture checks and operator approval are complete. No live venue adapter, signer or automatic authorization is added.


## Dual-intelligence research extension — FAST memecoins / DEEP futures (2026-11-23)

This reviewable increment follows the owner-supplied Dual Intelligence Plan and Architecture Protection Prompt. It **does not** implement complete automatic memecoin or futures trading.

### Real integrated behavior

- `server/src/providers/binanceFuturesResearch.ts`: a separate, public-data-only USD-M futures candle source using the already owned provider transport, telemetry, timeout, and rate limiting. Allows BTCUSDT, ETHUSDT, SOLUSDT and 15m/1h/4h, rejects malformed, replayed, stale or forming bars. Never imports signing, account or order modules.
- `server/src/choice/dualResearch.ts`: FAST assesses actual cached DEX pairs using existing `assessDexPair`; DEEP reconstructs a *non-authorizing* versioned long/short multi-timeframe structure hypothesis using the existing `analyzeChart`. A plan hash and invalidation level allow deterministic replay, but are not an executable futures strategy.
- `GET /api/choice/dual/fast`: owner-authenticated, read-only, source-staleness-aware, always reports NO_TRADE while contract permissions and executable sell routes are unverified.
- `GET /api/choice/dual/deep?symbol=BTCUSDT`: owner-authenticated and read-only, fetches public futures closed candles and returns research hypothesis / wait / no-trade. Provider failures or unusable candles fail to NO_TRADE, not synthetic chart output.
- `server/test/dual-intelligence-research.test.ts`: source validation, FAST safety exclusion, DEEP hypothesis consistency, missing data, spoofed source, and authenticated read-only access.

### Integration matrix and ownership

| Concern | Classification | Owner / next action |
| --- | --- | --- |
| DEX profile discovery and heuristics | REUSED, operational read-only | `market/fabric.ts`, `providers/dexscreener.ts`, `safety/safety.ts` |
| New mint/pool event stream and verifiable sell path | MISSING | Extend canonical DEX provider + safety; independent trusted on-chain RPC and route simulation are required |
| Closed-candle multi-timeframe analysis | REUSED | `chart/analysis.ts`, `chart/replay.ts` |
| Public futures chart research | ADDED | Dedicated read-only provider + `choice/dualResearch.ts`; authenticated API |
| Futures strategy hypothesis | RESEARCH ONLY | A deterministic non-executable hypothesis, not approved strategy or profitability claim |
| Adaptive FAST/DEEP router | EXISTING IN DRAFT PR #89 | Reconcile contract there, do not copy its router or bypass its abstention rules |
| Candidate ordering and DITAS shadow event | REUSED FROM THIS PR | `choice/arbitration.ts`, `ditas/memory.ts` unchanged |
| Futures mark/index/funding, liquidation and margin account | MISSING | Add validated financial model and exchange-specific data before tradable strategies |
| DEX and futures execution | NOT INSTALLED | Never activate signing or live accounts from this research increment |
| Risk, OMS, ledger, position monitor | UNCHANGED | Preserve canonical authority, tests and existing LIVE lock |

### Release blockers

1. This feature is **read-only**. It does not schedule new-token mint events or new futures analysis on a background lane; the authenticated owner API initiates the analysis. It is not an autonomous trader.
2. FAST candidates are intentionally never automation-eligible until on-chain identity, token permissions, sell simulation, and size-specific executable quote verification exist. DEX Screener profiles alone are not event-time mint evidence.
3. DEEP is chart-only: funding, open interest, margin, mark price, liquidation, order-book execution, robust futures backtesting and independent risk are missing. The reconstructed plan's entry trigger is observational, not permission.
4. No active cross-market Choice Management cutover, capital reservations or order-routing changes. Keep the original paper scanner and OMS untouched.
5. Compare with stacked THINK #89/#91, FAST/DEEP exit work #111 and atomic OMS #118/#119/#121 before any promotion.
6. Verify exact-head typecheck, tests, build, browser checks, security scan, full paper regression, independent risk/security review and owner approval. Do not merge with mandatory gates incomplete.

**Failure behavior:** Any absent/stale DEX snapshot or unavailable/invalid futures feed yields NO_TRADE. No order, fill, position, wallet, or policy state can be changed by these read endpoints.

**Rollback:** Revert only the research provider, projection and endpoints; historical Choice/Ditas records remain unchanged. No database migration is introduced.
