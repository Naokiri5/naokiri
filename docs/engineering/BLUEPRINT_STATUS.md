# Blueprint status — MIA Global Autonomous Trading Architecture

Maps each item of the owner's blueprint (`MIA_GLOBAL_AUTONOMOUS_TRADING_ARCHITECTURE_BLUEPRINT.md`, §C and §H) to code and tests on branch `claude/blissful-planck-lazglg` (PR #18). **Paper-trading only.** Nothing here enables real-money trading, signing, withdrawals, automatic merging or deployment.

Status words: **Done** = code + a regression test that fails on the old code. **Partial** = some of the proof exists. **Blocked** = needs an owner decision, a host, or another branch.

## §C — First defects and blockers

| ID | Status | What changed | Evidence |
|---|---|---|---|
| S-01 strategy step-up | **Done** | Any transition that lifts SUSPENDED/RETIRED (to RESEARCH, BACKTESTED, PAPER …) needs the passphrase; suspending and retiring stay one-click (risk-reducing). | `server/src/api/routes.ts` (`liftsSuspension`); `server/test/api.test.ts` |
| L-01 lease fencing | **Done** | `withWriteFence` / `assertWriteFence` run inside the OMS write transactions (BEGIN IMMEDIATE); a lost lease throws `LeaseLostError` and nothing commits. Acquire vs renew is distinguished. | `server/src/ops/lease.ts`, `exec/oms.ts`, `bot/bot.ts`; `test/lease-fence.test.ts`; **two real processes:** `test/ops-lease-fence.process.test.ts` + `test/fixtures/stale-writer-process.ts` (fails when the fence is disabled) |
| Q-01 QA evidence | **Done** | `scripts/qa.mjs` records exit code, report sha256, commit, clean/dirty tree, node version, invocation and times. The gate accepts the report only if exit = 0, hash matches, commit = the running build, tree was clean and the run is ≤ 7 days old. | `server/src/qa/gates.ts` (`runOutcomeProblem`); `server/test/gates.test.ts` |
| O-01 monitor CAS | **Done** | The monitor's compare-and-set update also guards `mfe` and `mae`, so a stale monitor cannot overwrite newer extremes or reopen a closed position. | `server/src/exec/oms.ts`; `server/test/oms.test.ts` ("stale monitor cannot overwrite newer excursion values") |
| A-01 lockout | **Done (options A+C)** | Strangers' failed guesses no longer block a direct-local owner sign-in or risk-reducing actions (close-all, revoke other sessions). Option B (recovery code) deferred. | `server/src/core/ratelimit.ts`, `api/auth.ts`; `server/test/auth-lockout.test.ts` |
| B-01 backups | **Blocked** | The hardening lives on Capy's PR #14 with its own CodeRabbit threads; not cherry-picked unreviewed (blueprint rule). This branch already verifies restores (integrity, schema, audit and DITAS chains). | PR #14; `server/src/ops/backup.ts` |
| R-01 24h soak | **Blocked** | Needs an always-on host with paper orders running for 24 h+. This cloud session cannot stay up that long. `PHASE1_SOAK.md` is ~6.6 min and is **not** a certification. | `docs/engineering/PHASE1_SOAK.md` |

## §H — Milestones

| Milestone | Status | Notes |
|---|---|---|
| 0. Baseline + reconcile PRs | **Done for #17** | Draft PR #17 (autopilot cockpit) merged into this branch (2c4f784). Its `useApi` aborted the in-flight request on every poll, re-introducing a PR #9 issue; the two versions were combined. PR #14/#15 belong to Capy and remain separate. |
| 1. Permission, lease, evidence defects | **Done** | S-01, L-01, Q-01 above. |
| 2. 24h hosting, alerts, backup | **Partial** | Supervisor, systemd unit, readiness, stall alarm, backups and restore checks exist. The 24h soak with real paper orders (R-01) still needs a host. |
| 3. Streaming ingest + instrumentation | **Partial (code done, live latency not yet measured)** | See below. |
| 4–7 | **Not started** | Replay/OOS tests, portfolio governance, multi-tenant release and the execution pilot need owner, legal and hosting decisions. Milestone 7 (real execution) stays locked. |

## Milestone 3 — streaming order books

**What is built** (`server/src/market/depthStream.ts`, wired in `market/fabric.ts` and `bot/bot.ts`):
- Binance diff-depth WebSocket (`data-stream.binance.vision`, public market data, no key) for **open positions + the deep tier** only, at most 200 symbols, on one combined connection.
- The documented synchronization: buffer events → REST snapshot (`lastUpdateId` L) → drop events with u ≤ L → the first event must overlap (U ≤ L+1 ≤ u) → each later event must continue exactly (U = previous u + 1).
- Gaps, malformed levels and crossed or empty books discard the local book and resync from a fresh snapshot. Duplicates and out-of-order events are ignored. A snapshot older than the buffer is refetched.
- Reconnects with exponential backoff and jitter (1 s → 60 s). Every reconnect starts every symbol again from a snapshot.
- Stream books go through the same `setBook` as REST (an older `lastUpdateId` or timestamp is refused) and carry the **local receive time**, so every existing freshness, depth, risk and OMS check applies unchanged. The risk gate is never bypassed.
- **REST fallback:** REST polling skips only symbols whose stream book is < 2 s old. When the stream stops, lags or loses sync, REST takes over automatically.
- Instrumentation: `stream.binance.eventLagMs` (provider event time → local receipt) in the QHEF latency recorder. Connection health (`connected`, `synced`, `resyncs`, `reconnects`, `lastMessageAt`) is in `GET /api/bot` as `depthStream`.
- **Off by default.** Turn it on with `MIA_STREAMING=1`. It never runs with `MIA_OFFLINE=1`.

**Tests (offline, deterministic):** `server/test/depth-stream.test.ts` (sync algorithm, old snapshot, gap, duplicates, malformed and crossed data, fake-socket transport with resync and stop) and `server/test/depth-stream-fabric.test.ts` (flag off = no connection, books land in `market.deep`, REST skips fresh symbols, older ids refused, stop hands back to REST).

**Not yet proven:** live latency numbers (p50/p95/p99), packet-loss and reconnect rates. These need a run with network access to `data-stream.binance.vision`, which this session's network policy does not include. Do not quote any streaming speed-up until that run exists.
