# Codex instructions — MIA unified repository

> Scope: MIA/Naokiri5/naokiri. This file is a short Codex entry point; **CLAUDE.md remains the canonical engineering and safety guide**. Do not create a second set of conflicting trading rules.

## Read before editing

1. Read **CLAUDE.md** and its trading/security invariants.
2. Read **docs/ARCHITECTURE.md**, **docs/SECURITY.md**, and **docs/engineering/CODEX_SYSTEM_MAP_AND_CONSOLIDATION_2026-11-21.md**.
3. Read **docs/engineering/MIA_DUPLICATION_AUDIT.md**, **docs/planning/REFACTORING_BACKLOG.md** and the relevant feature status/test reports.
4. Inspect the actual current branch, Git status, relevant imports/callers and open PRs. Historic audit documents are snapshots, not proof of current behavior.

## One canonical owner per concern

| Concern | Existing source of truth |
|---|---|
| External providers, market ingestion, freshness and market state | server/src/providers/, server/src/market/ |
| Durable domain event outbox / typed event contracts | server/src/fabric/ (NOT a replacement for market/fabric.ts) |
| Technical indicator calculations | server/src/features/indicators.ts |
| Indicator-readout adapters / worker evidence | server/src/workers/, server/src/qci/ |
| Decision authority | server/src/decision/ |
| Risk authority / policy | server/src/risk/gate.ts and server/src/risk/policy.ts |
| Account/environment selection and order execution | server/src/exec/environment.ts, server/src/exec/oms.ts |
| Financial accounting / positions | server/src/portfolio/ledger.ts |
| Persistence and append-only migrations | server/src/db/ |
| DITAS and research evidence (not execution authority) | server/src/ditas/, server/src/lab/, server/src/research/ |
| Guardian, auth and security | server/src/security/, server/src/api/auth.ts |
| Trader Joe | server/src/joe/ |
| HTTP composition and feature routes | server/src/api/routes.ts plus existing domain route modules |
| Web API, streams, shared components and pages | web/src/api.ts, web/src/ui.tsx, web/src/pages/ |
| CI / unit / e2e tests | .github/workflows/, server/test/, web/src/*.test.ts, e2e/ |

## Incoming TypeScript, PDF or feature request: merge into existing ownership

1. Preserve user-provided source **verbatim in an archive only when requested**; keep extracted, non-compiling text separate from executable source.
2. Identify each feature, types, call sites, integrations and tests; map it to an existing owner using the system map.
3. Classify each overlap: **REUSE**, **ENHANCE EXISTING**, **NEW GAP**, **RESEARCH ONLY**, or **REJECT/LOCKED**. Do not paste a competing risk gate, OMS, ledger, event fabric or indicator engine.
4. For each accepted gap, change the smallest existing module(s); add new files only when there is a distinct responsibility. Keep one implementation of each exact behavior.
5. Trace UI -> API -> service -> permissions/risk -> persistence. Keep model/worker votes as evidence, not authorization.
6. Add regression tests for both allowed and denied behavior, stale/malformed data, owner permissions, idempotency, order/ledger invariants, and browser contracts where affected.
7. Require green typecheck, build, tests, e2e, dependency audit and secret scan before proposing a merge. Report commands actually run versus prior CI evidence.
8. Work on a dedicated branch and **draft PR**; never auto-merge or rewrite main. Leave unrelated code and unmerged PRs untouched.

## PAPER / LIVE boundary

The inspected unified base is PAPER-only, with LIVE execution locked. Preserve this. Shared rules may be designed to apply equally to future PAPER and LIVE adapters, but **do not introduce signing, exchange orders, withdrawals, live release authority, or a bypass of risk/approval controls** under a cleanup task. Live rollout requires a separate, explicit security and release review.

## Do not perform destructive cleanup

No wholesale renames, deletion of archived source, mutation of historic migrations, flattened monoliths, speculative helpers, duplicate API clients or broad auto-formatting. A duplicate is removable only after checking semantic equivalence, all callers, and tests. Keep an explicit change log mapping old symbols to new owners.

## Required handoff with every PR

Provide: baseline SHA, feature-to-file ownership map, duplication classification with evidence, exact changed paths, preserved invariants, tests and CI outcomes, migration/rollback notes, unresolved risks, and whether PAPER/LIVE behavior changed. Link the applicable report in docs/engineering/.