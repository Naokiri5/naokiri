# MIA Autonomous Intelligence — Integration-First Engineering Plan

Status: **DRAFT / REVIEW ONLY**. This document does not enable live trading or change runtime behavior.

## Non-destructive scope
Preserve the existing repository, open PRs, production contracts, paper OMS, ledger, risk gate, security controls, and live G01–G14 locks. Never duplicate an owner module, close a PR, or merge an unverified change. Existing work must be inspected and reconciled before implementation.

## Observed canonical ownership (main)
- Paper OMS: `server/src/exec/oms.ts` — explicitly simulates fills using live Binance book data; not a live venue.
- Risk: `server/src/risk/gate.ts` and `server/src/risk/policy.ts` — reuse, never create a second risk authority.
- Portfolio ledger: `server/src/portfolio/ledger.ts` — reuse for all position/account evidence.
- Decision: `server/src/decision/engine.ts` — inspect before connecting research outputs.
- Market: `server/src/market/store.ts` and `server/src/market/quality.ts` — enforce freshness and validity.
- Notifications: `server/src/notify/notify.ts`; events: `server/src/core/bus.ts`; audit: `server/src/core/audit.ts`.
- Exit logic: `server/src/lab/exits.ts`.
These references are based on imports and comments in the existing main-branch OMS; actual runtime behavior and complete module coverage require further verification.

## Existing PR coordination (avoid parallel duplicates)
- #21: 100-agent engineering roster; enhance this roster, do not create a second independent team spec.
- #101 / #100: autonomous product, THINK/emotion overlay; reconcile and reuse.
- #108: Strategy Lab accuracy; treat its holdout failures as release blockers, not as proof of profitability.
- #106: paper bundle execution and lifecycle; preserve its canonical OMS and migration design.
- #109: Whale Intelligence Network; use evidence for research, not direct execution authorization.
- #87: ownership and consolidation map; reconcile before changing ownership.
- #92/#95/#97/#98: execution environment, provider and live certification work; do not bypass their staged safety gates.
- #45: broad stacked integration; do not bulk merge.
- #41/#43: data fabric/outbox proposals; inspect before adding a second event system.
Open PR titles and summaries are discovery evidence, not verification that code is merged or passing.

## Desired connected flow
Market ingestion -> validated market snapshot -> discovery -> existing QCI/THINK research -> Strategy Lab candidate and holdout evaluation -> existing decision engine -> canonical risk gate -> authorized PAPER OMS -> ledger/order reconciliation -> exits -> journal/audit -> measured learning and operator notification.

Every transition must have a typed, versioned contract, provenance, timestamps, idempotency key, correlation ID, explicit rejection state, and durable recovery behavior where needed. No language model or agent directly writes orders or bypasses risk.

## 100-agent engineering program (roles, not 100 live processes)
Use ten workstreams with ten specialist responsibilities each: (1) architecture/contracts, (2) market data, (3) quantitative research, (4) QCI/THINK orchestration, (5) strategy validation, (6) risk and portfolio, (7) OMS/venue adapters, (8) security/identity, (9) reliability/observability, (10) frontend/QA/release. Assign actual work only to available agents; do not claim that 100 agents have been instantiated. Integrate with #21.

## Delivery slices, ordered by dependency
1. **Evidence baseline:** inventory modules, tests, active PR branch bases, migrations, provider credentials, environment gates, and capability statuses. Deliver requirements-to-code matrix.
2. **Single flow contract:** extend existing event/decision types only after examining #41/#43 and current consumers; add contract and compatibility tests.
3. **Paper end-to-end replay:** connect discovery -> decision -> risk -> OMS -> exits -> ledger -> audit with deterministic fixture, rejection/timeout/restart tests, and no duplicate fills.
4. **Strategy research:** connect candidate generation to existing Strategy Lab, with frozen train/test boundaries, cost-aware holdouts, model registry and paper-only promotion.
5. **Worker coordination:** connect existing QCI workers via bounded queues, health, conflict resolution and no-trade quorum; avoid introducing a competing orchestrator.
6. **Multi-market adapters:** extend existing providers only with verified market-data entitlements, symbol mapping, calendars, instrument constraints, reconciliation, and PAPER parity.
7. **Operations and notifications:** reuse existing notification/audit channels; expose incident, recovery, and operator approvals through Trader Joe/control center.
8. **Live certification (separate):** never unlock real-money execution automatically. Require explicit owner authorization, verified signer/venue, full reconciliation, security review, staged limits, rollback and independent release approval.

## Acceptance evidence per slice
- A specific owner module and no-duplication audit.
- Before/after dependency graph and minimal file diff.
- Typecheck, unit, integration, E2E and adversarial failure tests, run against exact head SHA.
- Real observed test outputs, not promises.
- Paper trading evidence with realistic costs and no lookahead.
- Security and authorization proof; live remains locked.
- Reviewer approval and rollback instructions.
- No merge until all required checks pass.

## First two engineering actions
1. Audit main plus #21, #41, #43, #45, #87, #101, #106, #108, #109 and live-readiness stack; produce a verified ownership and migration conflict matrix.
2. Implement the smallest missing **paper-only** end-to-end integration test using existing decision, risk, OMS, ledger, and exits; prove failure/restart safety before any autonomous scheduler is added.

## Outcome measures
Prioritize reproducible net expectancy, drawdown, tail risk, fill accuracy, calibration, missed/invalid trade rates, service uptime and safe recovery. No guarantee of winning trades or accuracy target unsupported by out-of-sample evidence.
