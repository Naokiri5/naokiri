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
