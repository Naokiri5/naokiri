# Autopilot 100 — Phase 0 inventory

This lists each of the 100 backlog items from the Autopilot master prompt and checks it against the code on `main` after PR #7 merged, plus the Phase 1 slice on this branch. It is a code review, not a certification. **DONE** means the code and tests exist in this repository. Nothing here claims that the system is deployed, or that any test ran unless it is recorded in this repository.

Statuses: **DONE**, **PARTIAL** (some of the item exists), **MISSING**, **BLOCKED** (needs an external dependency or credentials), **OWNER** (needs an owner decision), **LOCKED** (deliberately disabled: real money and withdrawals).

Summary: BLOCKED 4, DONE 21, LOCKED 6, MISSING 20, PARTIAL 49.

| # | Status | Evidence / gap |
|---:|---|---|
| 001 | PARTIAL | Top-bar mode badge and Overview risk/pipeline panels. A persistent status ribbon is in progress by Capy in **open PR #9** (`capy/status-ribbon`), not yet on main. |
| 002 | PARTIAL | Overview has a summary plus detail panels; e2e/navigation.spec.ts covers mobile navigation. No dedicated density test. |
| 003 | MISSING | No Document Picture-in-Picture. This is Phase 2 (floating cockpit). |
| 004 | MISSING · OWNER | No desktop companion. Needs an approved packaging and update approach. |
| 005 | MISSING | There is no widget yet, so no widget presets. |
| 006 | PARTIAL | Freshness/age display on pages. The stale and link indicator in the ribbon is in Capy's open PR #9. No widget yet. |
| 007 | MISSING | No privacy masking of amounts. |
| 008 | PARTIAL | PAPER mode badge and paper labels. LIVE stays locked. A live-lock ribbon is in Capy's open PR #9. Exports are not watermarked everywhere (see 84). |
| 009 | PARTIAL | /terminal/:symbol deep links exist. Preserving the timeframe across the link is not verified. |
| 010 | PARTIAL | Notifications carry INFO/WARNING/CRITICAL severity. The Overview feed hides INFO. No contextual explainers. |
| 011 | BLOCKED · OWNER | The code is ready for an always-on host (supervisor, systemd unit, readiness, backups). Deploying needs an owner-approved host. Nothing is deployed. |
| 012 | DONE | The engine runs inside the server process and needs no browser. The headless soak (docs/engineering/PHASE1_SOAK.md) ran with zero UI clients. |
| 013 | DONE | server/scripts/supervise.mjs: restarts with exponential backoff and stops after a crash loop. deploy/mia.service. Tested in test/ops-supervise.test.ts and with a live forced crash in the soak. |
| 014 | DONE | Migration v5 runtime_leases and server/src/ops/lease.ts. Bot lanes run only while the engine lease is held. Tested in test/ops-lease.test.ts (two holders, expiry takeover, release). |
| 015 | PARTIAL | Orders, fills, positions and approvals are durable in SQLite before they take effect. Scanner progress is not checkpointed; a cycle simply re-runs. |
| 016 | PARTIAL | The risk gate denies a reused client_order_id (DUPLICATE_REQUEST). Paper fills are synchronous in one transaction, so there is no external ambiguous submit to reconcile yet. |
| 017 | PARTIAL | /api/ready (503 when not ready) and an in-process scanner-stall CRITICAL alert. No external uptime monitor; that needs a host (11). |
| 018 | DONE | server/src/ops/backup.ts: VACUUM INTO, sha256 manifest, optional AES-256-GCM (MIA_BACKUP_KEY), retention, leader-scheduled runs. The restore check verifies integrity, schema, the audit chain and the DITAS chain. Tests include tampering. |
| 019 | PARTIAL | Graceful drain on SIGTERM (lanes finish, lease released, DB closed) plus readiness. No deploy or rollback pipeline, because there is no host. |
| 020 | DONE | GET /api/ready checks the database/schema, the engine role, and ticker and scanner freshness, and fails closed with 503. Provider and risk-policy status are reported as information only. |
| 021 | MISSING | Market data is REST polling only (market/fabric.ts). No WebSocket streams. |
| 022 | MISSING | Provider health is tracked (providers/http.ts). There are no per-provider request budgets, queues or 429 backoff. |
| 023 | PARTIAL | Future-dated and stale quotes are rejected (exec/oms.ts quoteAgeOk; market/quality.ts). Host clock sync is not monitored. |
| 024 | DONE | Candle batch validation and gap-recovery rebuild (market/fabric.ts validateCandleBatch, REBUILD_MIN_BARS). |
| 025 | PARTIAL | QHEF measures event-loop p50/p99. Heavy work has not been moved off the main loop. |
| 026 | PARTIAL | One SSE bus is shared by all clients. Per-widget subscription dedupe does not apply yet (no widgets). |
| 027 | DONE | Incremental FeatureEngine (features/indicators.ts), with tests matching batch calculation. |
| 028 | MISSING | Render cost has not been profiled. No virtualization. |
| 029 | PARTIAL | QHEF reports p50/p99 per stage. CI does not store baselines. |
| 030 | PARTIAL | Cross-venue quotes and divergence checks (market/quality.ts). No per-feed trust tier. |
| 031 | PARTIAL | Scanner rejection list (/scanner) and the Overview activity feed. No per-instrument board with expiry. |
| 032 | PARTIAL | DITAS strategy passports (ditas/passports.ts) are evidence. Entry gating by regime eligibility has not been verified. |
| 033 | PARTIAL | QCI consensus states and dissent counts. No adversarial challenge step. |
| 034 | DONE | DITAS calibration with Brier score and cohort sample sizes, labelled as uncalibrated when samples are small (ditas/calibration.ts). |
| 035 | DONE | DITAS immutable snapshots and hash-chained events are on main (merged via PR #7). |
| 036 | DONE | DITAS Decision Twin; hypothetical records are separate from the OMS (ditas/twin.ts). |
| 037 | PARTIAL | Bounded blind-prefix chart replay API (chart/replay.ts). No strategy arena. |
| 038 | PARTIAL | Worker effectiveness report with capability classes (workers/effectiveness.ts). No uncertainty or dependency control. |
| 039 | PARTIAL | Fee and spread costs are in the policy and OMS. No order-size-aware capacity gate. |
| 040 | PARTIAL | News classification exists. No verified-event cooling state. |
| 041 | PARTIAL | Order states NEW / PENDING_APPROVAL / FILLED / CANCELLED / REJECTED / EXPIRED (PARTIALLY_FILLED is used by the risk gate). No UNKNOWN state, because no external venue exists. |
| 042 | DONE | Deterministic client_order_id idempotency enforced by the risk gate (paper). |
| 043 | PARTIAL | The gate checks open risk and position limits. Scans are serial in one leader (lease). No explicit transactional reservation. |
| 044 | DONE | Fills and ledger updates are written in one transaction; partial fills are tested. |
| 045 | DONE | Per-position protection verification and persistent protection incidents (exec/incidents.ts). The risk gate denies new entries while one is open. |
| 046 | DONE | A stale or thin book never produces a fill. A CRITICAL incident is raised and the position is preserved. |
| 047 | PARTIAL | The risk gate fails closed on stale data. No outage-specific state machine. |
| 048 | DONE | Depth-aware fill pricing against the full order size, including combined exits. |
| 049 | MISSING | No fee schedule version is stored with execution estimates. |
| 050 | DONE | DITAS execution-quality report treats missing references as unknown (ditas/execution.ts). |
| 051 | BLOCKED · OWNER | Read-only balance adapters need provider credentials set up through secure setup. |
| 052 | PARTIAL | Paper allocation is labelled as virtual. There is no real-deposit source to contrast it with. |
| 053 | BLOCKED | No real deposits exist, so there are no confirmation states yet. |
| 054 | PARTIAL | Deposits are tracked separately from realized PnL in the ledger. Time-weighted returns are not computed. |
| 055 | BLOCKED · OWNER | No exchange credentials are configured. The permission audit depends on them. |
| 056 | LOCKED | Withdrawals are locked by design. Only the address book exists. |
| 057 | PARTIAL | Step-up authentication exists (api/auth.ts). Withdrawals remain locked. |
| 058 | LOCKED | Real withdrawals are out of scope. |
| 059 | LOCKED | Real withdrawals are out of scope. |
| 060 | LOCKED | Real withdrawals are out of scope. |
| 061 | DONE | Trader Joe, workers, QCI and the knowledge base have no execution path. The deterministic risk gate stays authoritative. |
| 062 | LOCKED | No signer exists in this build. |
| 063 | DONE | Token safety defaults to UNVERIFIED without evidence (safety/safety.ts). |
| 064 | MISSING | No overnight-specific policy. |
| 065 | DONE | Emergency stop and pause new orders (exec/oms.ts emergencyStop). The gate denies EMERGENCY_STOP_ACTIVE. |
| 066 | DONE | Correlation and concentration limit in the risk gate. Unknown correlation is treated as correlated. |
| 067 | DONE | UTC day and week keys for loss counters (portfolio/ledger.ts). |
| 068 | PARTIAL | Data-quality checks and QHEF/DITAS quarantine. No provider quarantine with explicit recovery criteria. |
| 069 | MISSING | No anomalous-login detection. |
| 070 | PARTIAL | Hash-chained audit log, HMAC evidence packets, and backups that verify the chain. No periodic signed checkpoints exported off the machine. |
| 071 | MISSING | No PiP yet (Phase 2). |
| 072 | PARTIAL | A headless soak of about 6.6 min ran in the container (planned for 15 min, stopped early) (docs/engineering/PHASE1_SOAK.md): forced crash, restart, standby and handover all observed. A 24 h run needs a host. |
| 073 | PARTIAL | Process crash and restart are tested (supervisor). No crash injection inside the OMS steps. |
| 074 | MISSING | No 429 or rate-limit simulation. |
| 075 | PARTIAL | Most domain functions take an injectable nowTs. No frozen-clock integration suite. |
| 076 | MISSING | No property-based accounting tests. |
| 077 | PARTIAL | Idempotency and lease tests exist. No load test of the risk gate and OMS. |
| 078 | LOCKED | There is no withdrawal UI to attack (locked). |
| 079 | MISSING | No web-vitals collection. |
| 080 | PARTIAL | Release Gates page shows pass/fail per gate. Untested gates are not separated out. |
| 081 | PARTIAL | The Overview activity feed links decisions (/decision/:id) and fills. No single per-trade timeline. |
| 082 | PARTIAL | Realized PnL and fees on Overview, unrealized on Portfolio. No reconciled breakdown view. |
| 083 | MISSING | No cost breakdown charts. |
| 084 | PARTIAL | UI paper badges. CSV exports are not watermarked consistently. |
| 085 | PARTIAL | Decision detail page with worker evidence. Source links are not shown everywhere. |
| 086 | PARTIAL | Rejection reasons with stage. The policy version is not shown with each veto. |
| 087 | PARTIAL | Strategy Lab out-of-sample validation. Sample-size warnings are not shown everywhere. |
| 088 | MISSING | No scenario sensitivity views. |
| 089 | PARTIAL | Trader Joe daily briefing. No audited 24 h retrospective. |
| 090 | PARTIAL | Provider status and last-OK time on the Connections and Overview pipeline. |
| 091 | PARTIAL | First-run setup and risk-policy acceptance. No guided checklist. |
| 092 | PARTIAL | Connections Hub health checks. Credentials never reach the frontend. |
| 093 | MISSING | No Simple / Analyst / Engineer presets. |
| 094 | PARTIAL | UTC ledger with local display in places. DST tests are not complete. |
| 095 | MISSING | No voice summaries. |
| 096 | MISSING | No isolated sandbox ledgers. |
| 097 | PARTIAL | CSV history export and signed evidence packets. No import round trip. |
| 098 | PARTIAL | /api/ready and the stall alert give the cause. No friendly "why MIA is waiting" page yet. |
| 099 | MISSING | No PWA or offline cache. |
| 100 | PARTIAL | Release gates and the evidence packet keep live trading locked. No owner-reviewed autopilot readiness checklist. |

## Selected milestone

Phase 1 (24/7 PAPER-only server) was implemented on `claude/blissful-planck-lazglg`. It covers items 12, 13, 14, 18, 19 (partial) and 20, and the soak covers part of 72. Hosting (11) and the 24-hour soak on a real host need an owner-approved host. Phase 2 (the floating cockpit, items 3, 5, 6, 7 and 71) is next only if the owner selects it.

## Parallel work by Capy (capy.ai)
Capy works on its own `capy/*` branches and pull requests. To avoid duplicate implementations:
- **PR #9 (open), status ribbon** (items 001, 006, 008). Not duplicated here. The ribbon could show the new `role` and `/api/ready` states once both are on main.
- **PR #10 (closed, not merged), verified backups (018), and PR #11 (closed, not merged), headless engine lease and readiness (012/013/014/020).** These overlapped with the Phase 1 work that merged into main via PR #7. They were closed, so main has a single implementation of each. Ideas from them worth porting later as small follow-ups:
  - a cross-process lease test with two real OS processes
  - fenced writes, which reject a write from a holder whose lease has lapsed
  - staged restore verification before a restored database is promoted
