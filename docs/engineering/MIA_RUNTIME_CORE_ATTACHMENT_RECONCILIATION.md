# MIA runtime core — attachment reconciliation and integration record

Date: 2026-11-22  
Scope: ten owner-provided PDF uploads (nine unique documents); `main` is the baseline.

## Architectural ownership observed on `main`

| Capability | Canonical owner | Decision |
| --- | --- | --- |
| Engine scheduler, lease, hot/scanning/background passes | `server/src/bot/bot.ts` | Reuse; do not create another BotCoordinator |
| Paper OMS, entry/exit fill simulation, idempotency | `server/src/exec/oms.ts` | Reuse; never redirect paper decisions into an unreviewed alternate OMS |
| Risk permission, limits and eligibility | `server/src/risk/gate.ts` | Extend the existing entry-only safety gate |
| Account positions and cash | `server/src/portfolio/ledger.ts` | Reuse; never create another competing account ledger |
| SQLite WAL, schema and transactions | `server/src/db/db.ts` | Reuse one `mia.db` in WAL mode; no second `mia_ledger.sqlite` |
| Runtime readiness and scan watchdog | `server/src/ops/readiness.ts` | Extend its existing /api/ready contract |
| Fastify HTTP + authenticated SSE | `server/src/index.ts`, `server/src/api/routes.ts` | Reuse /api/stream; no raw HTTP server or phantom /api/telemetry/stream |
| Notification dispatch | `server/src/notify/notify.ts` | Reuse existing in-app/Telegram notification facilities |
| CI | `.github/workflows/ci.yml` | Run the existing TypeScript/build/unit/e2e gates |

## Direct functional integration in this branch

- `server/src/ops/runtimeHealth.ts`: samples **real V8 heap** and **real canonical SQLite WAL** from the shared `getDb()` connection. Tracks **the actual authenticated SSE stream** only when clients are connected; no clients is not an outage. Does not checkpoint or write to WAL during checks.
- `server/src/ops/readiness.ts`: appends resource status to existing unauthenticated /api/ready. A critical heap, unavailable database, unexpected journal mode, or stalled connected stream makes readiness return HTTP 503.
- `server/src/api/routes.ts`: active stream open/write/close updates the resource monitor using **per-connection IDs**. The oldest outstanding client frame determines the liveness signal, so a working SSE client cannot hide a stalled peer; closing an ID is idempotent and a late emission cannot resurrect a closed connection. Preserves session revocation, backpressure, auth and the existing /api/stream path.
- `server/src/index.ts`: starts a 10-second periodic watchdog when Fastify is ready; stops it at close. Emits deduplicated alerts and internal health bus events on degraded/recovered status transitions.
- `server/src/risk/gate.ts`: critical V8 heap or canonical SQLite WAL failure rejects **new entries**. The existing OMS protective exit monitor is not blocked by a telemetry client or this new entry interlock.
- `server/test/ops-runtime-health.test.ts`: deterministic threshold, WAL, multi-client SSE stall/close, risk-interlock and actual Fastify readiness tests.
- `server/test/risk.test.ts`: proves that critical V8 utilization denies a **real canonical PAPER risk evaluation**, then clears without changing the risk policy or enabling LIVE.

This is **active server-side functionality**, not a preview panel or second trading engine. It does not certify the whole system for live settlement.

## Disposition of each PDF

1. **TreasurySweepGuard Vitest (8 pages)** — not copied. The proposed `TreasurySweepGuard` and `better-sqlite3` implementation are not MIA's canonical risk/ledger contract. No real money-movement adapter should be fabricated to make the tests pass.
2. **Worker resourceLimits / heartbeat drift Vitest (7 pages)** — pending mapping to the actual worker implementation. The proposal refers to a missing `miaChaosSuite.test.ts` and `mia-ci.yml`; do not introduce flaky, uncalibrated microsecond SLA enforcement into CI.
3. **GC-thrash heartbeat benchmark (14 pages)** — pending isolated benchmarking on supported deployment runners. No existing `server/src/benchmarks/gcThrashLatencyBench.ts` found on main. A benchmark alone cannot certify an execution path.
4. **Daily treasury sweep dry-run & idempotency matrix (7 pages)** — defer money movement until ledger settlement ownership, real custody/transfer rails, reconciliation evidence and legal authority are established. Existing paper account ledger must not be silently changed.
5. **Container health monitoring (9 pages)** — **adapted** to V8, current node:sqlite/WAL, real SSE and shared notification bus. Did not add incompatible better-sqlite3 or nonexistent `mia_tca.sqlite`.
6. **Wire ContainerHealthMonitor into startup (4 pages)** — **adapted** to actual Fastify lifecycle and existing /api/ready rather than creating raw Node HTTP routes.
7. **BotCoordinator integration suite (15 pages)** — not copied: references `packages/server`, a replacement test ledger, and a competing TreasurySweepGuard; cover existing OMS/lease/risk with their canonical suites instead.
8. **BotCoordinator TypeScript runtime coordinator (11 pages)** — not copied: MIA already has the market data lanes, lease/fencing, risk and paper OMS. Review coalescing and adapter failure behavior inside the existing owners before any change.
9. **Same BotCoordinator PDF (11 pages)** — byte-for-byte duplicate of attachment 8 (SHA-256 `a58ea30f59290ac77ca87f4a0a912ae64a909ffaf05f0904232a8453f84d050a`); do not implement twice.
10. **Operational Binance/OKX live adapters, SQLite and UI (25 pages)** — not copied: proposes a second ledger, strategy engine and execution adapters and an environment-variable live unlock. LIVE authority, signed order idempotency, real venue reconciliation, capital isolation and independent approval have not been certified.

## Merge / release decision

**DRAFT: DO NOT MERGE without green CI, successful actual integration run, independent review and PR conflict checks.** Run repository's real `npm ci && npm run typecheck && npm run build && npm test` and verify critical /api/ready and risk paths against representative process/db failures. Keep current signed live trading locked. Never enable LIVE based only on `MIA_ALLOW_LIVE_TRADING=true`, and never treat paper simulation fills as real settlement evidence.

Follow-on work is best split into two independently reviewable changes: (1) safe worker runtime measurement tied to actual workers and deployment SLA evidence; (2) a ledger and transfer-authority audit before any treasury sweep implementation, with documented dry-run and idempotency proofs. Both should extend canonical owners and existing related PRs only after their base dependencies are reconciled.
