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

## Operational readiness probe (continuation)
 
- The new `server/scripts/health-probe.mjs` is a **real external healthcheck**, not an advisory status model. Use `npm run health:check` from the repository root, or `node server/scripts/health-probe.mjs` from a container/supervisor.
- It queries the existing unauthenticated Fastify `GET /api/ready` at **loopback only** (`MIA_PORT`, default 8787), with a two-second default timeout (`MIA_HEALTH_CHECK_TIMEOUT_MS` can be 250–10000).
- Exit code **0** requires HTTP 200, `ready: true`, a nonempty check list, and no failing/unknown check status. It exits **1** on 503, invalid responses, network errors, or timeout. Output is redacted to `MIA_READY`/`MIA_NOT_READY`.
- `GET /api/health` remains liveness and must **not** be treated as trading readiness. The new branch Dockerfile and docker-compose.yml call this same CLI as their operational HEALTHCHECK. A systemd supervisor may call it explicitly; no systemd service is introduced by this branch.
- `server/test/health-probe-cli.test.ts` executes the actual Node CLI against a local HTTP fixture to verify successful, degraded, and malformed responses without exchange access.
- This does **not** certify a deployed container, prove a restart policy succeeds, or allow LIVE execution. Deployment smoke, actual service-manager restart behavior, and independent safety review remain release gates.

## Merge / release decision

**DRAFT: DO NOT MERGE without green CI, successful actual integration run, independent review and PR conflict checks.** Run repository's real `npm ci && npm run typecheck && npm run build && npm test` and verify critical /api/ready and risk paths against representative process/db failures. Keep current signed live trading locked. Never enable LIVE based only on `MIA_ALLOW_LIVE_TRADING=true`, and never treat paper simulation fills as real settlement evidence.

Follow-on work is best split into two independently reviewable changes: (1) safe worker runtime measurement tied to actual workers and deployment SLA evidence; (2) a ledger and transfer-authority audit before any treasury sweep implementation, with documented dry-run and idempotency proofs. Both should extend canonical owners and existing related PRs only after their base dependencies are reconciled.


## Continuation: startup preflight, reachable-module audit, and container adaptation (five later PDFs)

The owner subsequently supplied:
- **Pre-flight environment + SQLite (16 pages).** The PDF assumes Express, `packages/server`, `EXECUTION_MODE=live`, `MIA_ALLOW_LIVE_TRADING=true`, separate `mia_ledger.sqlite` and `mia_tca.sqlite`. **Implemented compatibly instead:** `server/src/ops/preflight.ts` checks Node >=22.13, rejects env-based LIVE enablement or silently ignored prototype knobs, validates real heap thresholds, checks the canonical data directory, and opens an **existing** `MIA_DATA_DIR/mia.db` read-only for WAL + `PRAGMA quick_check`. First boot is allowed without touching a nonexistent database; existing `db/db.ts` owns initialization/migrations.
- **Startup Vitest smoke (6 pages).** The PDF expects `bootstrapServer`, Express, `/api/bot/status` and `/api/ledger/summary`. **Implemented against the actual Fastify server:** `server/test/ops-preflight.test.ts` runs temporary real SQLite WAL tests and an ephemeral-port HTTP smoke for `/api/health`, `/api/ready`, and authentication on `/api/shell`. No alternative coordinator or seeded treasury.
- **SmartOrderRouter + watchdog (32 pages).** The PDF proposes CEX post-only maker chasing, IOC fallback, Jito transaction submission, and automated deployment rollback. **Not installed:** MIA lacks certified live venue adapters, custody, durable exchange-intent reconciliation and independent signing. An auto-executing router would bypass the canonical `exec/oms.ts` + `risk/gate.ts` authorization boundary. The proposed standalone watchdog duplicates the existing runtime health watcher; external rollback also requires trusted signed artifacts and tested recovery.
- **checkOrphans + Vitest (7 pages).** **Adapted:** `scripts/check-orphans.mjs` uses a comment-aware static import scanner compatible with TypeScript 7's removed classic AST API; roots default to **real** entrypoints `main.ts`, `index.ts`, and `ops/backup-cli.ts` (not just index). It distinguishes unresolved modules from disconnected islands, is read-only, and offers an **opt-in** `--strict` mode. `server/test/orphan-audit.test.ts` validates static/dynamic imports, re-export, worker URL, orphan islands, and missing modules on isolated fixtures. A static graph is advisory, not proof a module is productive; a strict zero-orphan check on the existing large staged repo would produce false release blockers before ownership review.
- **Multi-stage Docker/Compose (7 pages).** **Adapted to canonical architecture:** `Dockerfile` builds `server/` + `web/`, then runs `server/dist/main.js` as a non-root user with `/app/data` persistence. `docker-compose.yml` runs **one** Fastify service (already serves built web and authenticated `/api/stream` SSE), rather than introducing an Nginx web container and duplicate telemetry route. Local host binding is restricted to `127.0.0.1` by default, with no live env flags, and the existing `/api/ready` becomes the container readiness check. `.dockerignore` excludes credentials, data and SQLite sidecars from image builds.

### Actual startup and security invariants

1. Node version check -> `runPreflightChecks` in `server/src/main.ts` -> `buildApp()` (canonical DB startup + migrations) -> `app.listen()` -> `startBot()`; a failed preflight exits **before** listener and market-data engine startup.
2. No `MIA_ALLOW_LIVE_TRADING` opt-in can enable real orders. `EXECUTION_MODE=live`, `EXECUTION_MODE=replay`, truthy `MIA_ALLOW_LIVE_TRADING`, and prototype settings that would otherwise be silently ignored are rejected explicitly. Actual owner-controlled `OBSERVE`/`PAPER`/`APPROVAL` rules remain authoritative; PR #117 separately fixes a direct lower-level `BOUNDED_LIVE` bypass and must be reconciled before any production merge.
3. Do not run WAL checkpoints during preflight (especially when another process may be active). Canonical DB open/close, migration, backup, crash recovery and ledger reconciliation remain owned by their existing modules. Graceful process SIGTERM drain remains in `main.ts`.
4. Compose mounts only one persistent canonical `/app/data` SQLite directory. The image excludes secrets. For a real operator session, provide Privy owner configuration and a backup key through an external `.env` or secret manager; `MIA_SECURE_COOKIE=1` is appropriate **only** behind HTTPS/TLS. Never publicly expose the default loopback-only compose port without a reviewed TLS proxy and host/auth controls.
5. A Docker healthcheck returning HTTP 200 is not trading profitability evidence. `/api/ready` can legitimately return 503 while market lanes or runtime resources are unhealthy. Optional browser telemetry subscribers do not authorize orders.

### Verification / release blockers for this continuation

- [ ] Exact-head GitHub Actions typecheck, unit/integration, E2E, audit and secret scan
- [ ] Multi-stage image build and isolated offline container smoke on an actual Docker runner
- [ ] End-to-end process startup against a representative persistent restored SQLite WAL database
- [ ] Independent security/architecture/OMS review and reconciliation with #45/#116/#117; ensure no duplicate work
- [ ] Post-deploy baseline with real owner identity, TLS proxy, backup restore and rollback rehearsal

**NO MERGE / NO LIVE DEPLOYMENT** until all mandatory checks and review gates pass. The SmartOrderRouter remains explicitly *blocked*, not silently described as implemented.
