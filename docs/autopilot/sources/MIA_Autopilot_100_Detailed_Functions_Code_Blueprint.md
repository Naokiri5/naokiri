# MIA AUTOPILOT — 100 FEATURE IMPLEMENTATION BLUEPRINT
## Questions, reality tests, copy-ready Claude/Codex master prompt, code contracts, and detailed tickets

**Project:** [Naokiri5/naokiri](https://github.com/Naokiri5/naokiri)  
**Source:** user-provided `MIA_Autopilot_100_Upgrades_and_Engineering_Master_Prompt (1).md`  
**Prepared:** November 17, 2026  
**Nature:** code-translation design; no repository changes, deployments, tests, financial transactions, or PR merges were performed in producing this specification.

> **Interpretation:** “translate it into code” means turning each product idea into a technical implementation contract. This is NOT an Internet-of-Things device integration plan. If physical IoT devices are intended, that is a separate architecture.

## A. The question that should drive the project

> **If the owner closes every browser, loses internet access overnight, and the market-data provider drops while a paper position is open, can MIA preserve exact account state, reject unsafe new entries, recover without duplicate fills, and show a truthful timeline the next morning?**

### Hard realities an engineering AI must acknowledge

1. **Feature counts are not a trading edge.** The repository documentation reports disappointing out-of-sample performance for initial strategies. It takes validated after-cost performance and risk controls, not 100 additional widgets, to justify financial trust.
2. **A web tab is not an unattended service.** Always-on requires a hosted, supervised backend, durable storage, independent monitoring, and restart/reconciliation tests.
3. **“Fully autonomous” must be permission-bounded.** MIA's deterministic risk veto, audit log, release gates, and disabled live signer are not optional convenience features.
4. **A smooth dashboard can still tell misleading financial stories.** PAPER, READ-ONLY exchange balances and hypothetical backtests must never be blended.
5. **Instant withdrawals are a misleading promise.** The UI can quickly create a *request*, but actual transfer settlement requires provider authorization, security checks and network/bank confirmation; current main has preview-only workflows.
6. **More agents do not equal more independent reviewers.** Assign distinct responsibilities; use parallel agents only when supported and limit shared-file collisions.
7. **Do not confuse design with proof.** A proposed endpoint or class below is not a verified existing API. All unmerged PRs must be reconciled before implementation.

## B. Required question bank (engineering prompts, not questions that block the owner)

**Product and user experience**

1. Can a brand-new user tell PAPER from real funds within two seconds?
2. What are the three things the owner must know when opening MIA in the morning?
3. Which dashboard sections can be collapsed without hiding safety warnings?
4. Can a user find a trade's *reason for rejection* with one click?
5. If there are zero candidate trades, does MIA explain why instead of inventing a recommendation?
6. Can a user access the same account state in web, phone, and floating widget without divergent calculations?
7. Can every visible control be operated by keyboard and read aloud meaningfully?
8. What does Trader Joe know from verified data, and what does it have to say it does **not** know?

**Architecture, performance, and continuous operation**

9. What exact process runs when every browser tab is closed?
10. What happens if that process crashes while a paper order is UNKNOWN?
11. Can two instances of MIA submit the same job at the same time?
12. Which state is persisted before, during and after each order transition?
13. Does /api/health mean server alive, or does it prove the bot scheduler is operating?
14. What happens if 100 workers share one corrupt market snapshot?
15. Does a WebSocket reconnection restore sequence integrity, or just reconnect the socket?
16. Are charts re-rendering more frequently than the user can perceive?
17. What p95 latency matters most: screen interaction, ingest, consensus or risk-to-paper execution?
18. What evidence is needed to prove a 24-hour paper-only soak succeeded?

**Trading integrity and safety**

19. Can every PnL number be recomputed from immutable fills and fees?
20. Can a pending funding transfer accidentally appear as trading profit?
21. What happens to an open paper position when no fresh executable order book exists?
22. Does a NO-TRADE signal have equal visibility to a trade signal?
23. Are model scores honestly marked as uncalibrated when outcome data are insufficient?
24. Can a strategy that lost out of sample be silently promoted by AI?
25. Which rules can stop a trade even when 100 workers agree?
26. Is every simulated Decision Twin result isolated from the real paper ledger?
27. Could a provider HTTP 429 cause repeated trade submissions?
28. Does a fake news headline ever change execution permissions?

**Funding, security, and withdrawal boundaries**

29. Is any trading credential able to withdraw funds?
30. How does MIA prove a wallet balance is verified instead of simulated?
31. Can a copied/new withdrawal destination bypass multi-factor authorization?
32. Who can sign a transaction and what is the maximum authorization scope?
33. Are credentials exposed in browser payloads, errors, telemetry or LLM messages?
34. When a withdrawal is pending, does the UI label it PENDING rather than COMPLETE?

**Quality, release and business reality**

35. Which backlog features already exist on main versus only on PR #7/#8?
36. What is the smallest independently shippable vertical slice?
37. Can one rejected risk policy or failed test prevent real-money unlock?
38. Is a green CI pipeline hiding skipped, unrun, or network-dependent checks?
39. Can the team restore its backup and prove ledger/audit integrity?
40. What would convince an independent auditor that this system is not ready yet?
41. What provider accounts, licenses and hosting services must the owner personally authorize?
42. What is the rollback plan if a navigation refactor breaks a risk alert?
43. Can the UX state uncertainty without substituting a made-up value?
44. Is each feature worth its ongoing cloud, support and API cost?
45. What concrete evidence would justify moving from paper-only evaluation to a separate live-trading certification program?

## C. MASTER PROMPT — copy into Claude Code or Codex

```text
ACTIVATE MIA AUTOPILOT ENGINEERING REVIEW AND IMPLEMENTATION MODE.

Repository: https://github.com/Naokiri5/naokiri
Authoritative product specification: MIA 4.1 Unified Master Prompt Parts 1–33.
Feature-ticket source: the 100-item MIA Autopilot backlog in this document.
Goal: a compact, beginner-friendly, fully observable, persistent PAPER-only autopilot, with a floating read-only cockpit, independently running backend, truthful financial state, and durable recovery. Real-money execution, signing and withdrawal remain LOCKED.

YOUR FIRST RESPONSIBILITY IS TO ANSWER THE 45 ENGINEERING QUESTIONS IN SECTION B WITH EVIDENCE OR UNKNOWN/NOT_TESTED. DO NOT CLAIM SUCCESS FROM FILE EXISTENCE OR DOCUMENTATION ALONE.

1. Read the actual branch and repository state. Inspect main, PR #7, PR #8 and all prerequisite stacked PRs and the latest open PRs. Record branch SHAs and compare changes before selecting a baseline. Never overwrite unmerged features. Don't merge without owner approval.
2. Read web/src/App.tsx, web/src/pages/Overview.tsx, web/src/pages/Joe.tsx, web/src/api.ts, web/src/ui.tsx, server/src/main.ts, server/src/api/routes.ts, server/src/bot/bot.ts, server/src/core/mode.ts, server/src/db/migrations.ts, server/src/risk/gate.ts, server/src/exec/oms.ts, server/src/portfolio/ledger.ts, server/src/qa/gates.ts and all relevant docs/tests.
3. For each ticket 001–100, report VERIFIED_WORKING, IN_MAIN_UNTESTED, IN_PR_ONLY, PARTIAL, BLOCKED, MISSING or NOT_INSPECTED. Include exact file and PR evidence. Do not implement existing functionality a second time.
4. Prioritize P0 correctness and safety. Propose one vertical slice at a time (frontend, API, persistence, events, tests). Begin with navigation/compact dashboard if UX is selected, or with 24/7 paper-only host if reliability is selected. Do not silently start real-money work.
5. Create a task contract for each selected ticket: problem, owner story, event trigger, backend state, UI component, request/response schema, persistence, failure states, observability, changed files, security checks, Playwright/Vitest regression, and rollback.
6. Preserve React/Vite, Fastify/Node, SQLite, SSE, 100 deterministic workers, 50 indicators, QCI, decision authority, fail-closed risk, paper OMS and ledger. No second scanner, risk engine, order manager, account ledger, auth layer, or Trader Joe clone.
7. Separate the browser and floating UI lifecycle from the headless server. Test 24-hour paper monitoring with browser closed. Reject stale books; never invent executions; implement idempotency and reconciliation. All 100 upgrade numbers remain requirements, not completed features.
8. Use TypeScript and schema validation consistent with repo conventions. Any new API is authenticated and capability checked; risk-changing actions use existing owner step-up flow; PnL is server-authoritative. Use append-only DB migrations. Use provider credentials only through secure server-side setup.
9. For floating UI, use user-initiated Document PiP with capability detection and in-page fallback. It does not outlive the opener. Consider a separately approved Tauri companion only for persistent always-on-top desktop behavior. No wallet signing or withdrawal authority in widgets.
10. Avoid claims such as '100 developers ran', 'instant withdrawals', 'guaranteed profit', 'live trading enabled', or 'production certified' without evidence.
11. Run npm ci, npm run typecheck, npm test, npm run test:e2e, npm run build, npm run scan:secrets, and npm audit --audit-level=high when available. Record actual results, skipped tests, environment, before/after latency, screenshots and error logs. Verify desktop/mobile/keyboard UI, auth, data age, browser-closed operations, restart safety and security boundaries.
12. Produce a non-destructive GitHub PR only on an owner-approved working branch. Never change main, merge, deploy to real accounts, or request real funds absent explicit approval. If tool limitations block code execution, report the limitation and provide reviewable patches rather than pretending tests passed.

REQUIRED OUTPUT IN ORDER:
A. Reality-check answers to 45 questions (VERIFIED / FAILED / UNKNOWN + file evidence)
B. 100-ticket implementation status matrix (main/PR-only/planned)
C. Chosen milestone, dependency graph, file ownership and read/write boundaries
D. TypeScript interface and Fastify route contracts for the milestone
E. Actual small, testable implementation diff (where authorized)
F. Unit, integration, Playwright, security and recovery results
G. Screenshots and evidence of functionality, not fabricated demonstrations
H. Exact remaining risks, user approvals needed, cost/hosting implications, rollback plan
I. Pull-request URL for review if a PR was actually created

PRIORITY ORDER: correctness > security > understandability > reliability > performance > visual polish > feature count.
```

## D. How a product idea translates into code

For each item below, use a **vertical slice**:

```text
Human goal → observable user action/event → authoritative domain state
→ existing service or new small module → validated API or SSE contract
→ frontend component → durable records (if needed) → failure response
→ automated test with explicit expected result → evidence/rollback.
```

**Naming rule:** Paths labeled `web/src/...` and `server/src/...` are existing touchpoints if already present in the selected branch; entries marked `(new)`, `apps/desktop/`, or `server/src/ditas/` may be proposed or PR-only. **Always compare against the chosen branch.**

**Status rule:** P0 and P1 below are proposed urgency; `LOCKED` means documentation/design only, not permission to implement actual financial transfers.

## E. 100 tickets — functional behavior, exact implementation touchpoints and acceptance

### 01–10. Cockpit and floating window
#### 001. No single-glance autopilot status  
**Priority:** `P1` · **Requested improvement:** Add a persistent status ribbon with mode, data freshness, engine health and risk state.

**What the user sees / how it operates:** Fetch /api/shell on mount and relevant SSE events; render mode, scanner age, provider health, emergency state and open risk, with each badge opening its authoritative page.

**Existing code touchpoints or proposed location:** `web/src/App.tsx, server/src/api/routes.ts (existing); web/src/components/StatusRibbon.tsx (new)`.

**Data / API / storage contract:** Reuse /api/shell fields; only propose GET /api/autopilot/status if existing DTO cannot support the component.

**Failure behavior / financial boundary:** If any field is missing/stale, show UNKNOWN or STALE rather than a green status.

**Proof of completion:** Verify each status reflects authenticated server state. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 002. Dense overview hides critical details  
**Priority:** `P1` · **Requested improvement:** Build a two-level overview: compact health summary and optional advanced detail.

**What the user sees / how it operates:** Present equity, mode, safety, and one recommended next step in primary view; move worker diagnostics, movers and technical metrics behind expandable sections and a saved Simple/Expert preference.

**Existing code touchpoints or proposed location:** `web/src/pages/Overview.tsx, web/src/styles.css`.

**Data / API / storage contract:** No new API initially; preserve backend /api/overview and all original routes.

**Failure behavior / financial boundary:** Keyboard and mobile layouts must reveal all information; do not hide emergency alerts.

**Proof of completion:** Playwright validates desktop and mobile density. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 003. No floating PnL during other work  
**Priority:** `P1` · **Requested improvement:** Create user-activated Document Picture-in-Picture (PiP) mini cockpit.

**What the user sees / how it operates:** On explicit user click and supported secure browser, open Document PiP; render read-only account value, daily PnL, connection status, and chart from existing API/SSE client.

**Existing code touchpoints or proposed location:** `web/src/App.tsx (trigger), web/src/components/MiniCockpit.tsx (new)`.

**Data / API / storage contract:** Use existing authenticated /api/shell and /api/overview; no new trade-authorizing endpoints.

**Failure behavior / financial boundary:** Unsupported browsers show normal in-app mini panel; PiP cannot outlive opener tab.

**Proof of completion:** Supported browser shows live PnL without switching tabs. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 004. Browser PiP cannot survive a closed tab  
**Priority:** `P3` · **Requested improvement:** Offer an optional Tauri desktop mini-window with always-on-top support.

**What the user sees / how it operates:** If independent always-on-top window is essential, package a minimal Tauri application that logs in to the authorized backend and displays only read-only views.

**Existing code touchpoints or proposed location:** `apps/desktop/ (proposed Tauri companion only), web/src/components/MiniCockpit.tsx`.

**Data / API / storage contract:** Scoped Tauri window permission; use existing HTTPS API contracts and a short-lived session design.

**Failure behavior / financial boundary:** No native signer or withdrawal scope; failure to reach server displays DISCONNECTED without cached-as-live PnL.

**Proof of completion:** Widget remains open after its dashboard window closes. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 005. Floating chart can overwhelm a small window  
**Priority:** `P2` · **Requested improvement:** Offer sparkline, mini-candles and PnL-only widget presets.

**What the user sees / how it operates:** Offer preset state: PNL_ONLY, SPARKLINE, MINI_CANDLES; switch display without starting additional provider subscriptions.

**Existing code touchpoints or proposed location:** `web/src/components/MiniCockpit.tsx, web/src/pages/Markets.tsx`.

**Data / API / storage contract:** Read-only props {symbol,timeframe,preset}; reuse one frontend SSE service.

**Failure behavior / financial boundary:** Missing candle data shows unavailable state; never fabricate mini-price series.

**Proof of completion:** Switch presets without breaking live subscriptions. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 006. A widget could show old numbers as current  
**Priority:** `P0` · **Requested improvement:** Add timestamp, connection badge, stale warning and reconnect indicator.

**What the user sees / how it operates:** Track last event timestamp, latest server asOf and reconnect lifecycle; compare with freshness threshold that matches backend policy; show reconnecting/stale/online visually.

**Existing code touchpoints or proposed location:** `web/src/api.ts, web/src/components/MiniCockpit.tsx`.

**Data / API / storage contract:** Existing streamState plus server-provided timestamps and status; no artificial heartbeat-as-trade.

**Failure behavior / financial boundary:** Do not mark healthy based solely on browser event-stream socket being open.

**Proof of completion:** Disconnect test visibly marks data stale. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 007. Sensitive balances may appear during screen sharing  
**Priority:** `P2` · **Requested improvement:** Introduce one-click privacy masking of monetary values.

**What the user sees / how it operates:** Implement in-memory privacyMask state, optionally persisted locally as a preference; mask account values across home, tooltips, mini widget and exports preview where appropriate.

**Existing code touchpoints or proposed location:** `web/src/App.tsx, web/src/components/MiniCockpit.tsx`.

**Data / API / storage contract:** Only display preference; source values remain unchanged and never logged by analytics.

**Failure behavior / financial boundary:** Screen-share test must find no raw amounts in visible labels or accessible name leaks.

**Proof of completion:** All widget modes conceal amounts when enabled. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 008. Users can confuse simulation profits with cash  
**Priority:** `P0` · **Requested improvement:** Show permanent PAPER / READ-ONLY / LIVE-LOCKED badges and balance origin.

**What the user sees / how it operates:** Create authoritative mode watermark component using server status; use consistent PAPER/READ-ONLY/LIVE-LOCKED labels on cards, charts, CSV header and mini window.

**Existing code touchpoints or proposed location:** `web/src/ui.tsx, web/src/pages/Overview.tsx, widget and export components`.

**Data / API / storage contract:** Mode from /api/shell plus accountOrigin field when necessary; never infer live from green PnL.

**Failure behavior / financial boundary:** Missing origin always renders UNKNOWN; no simulated values labeled cash available for withdrawal.

**Proof of completion:** Screenshots and tests never mislabel paper PnL. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 009. Moving between mini chart and full terminal is clumsy  
**Priority:** `P2` · **Requested improvement:** Add deep links from floating asset tiles to the existing terminal route.

**What the user sees / how it operates:** Pass selected instrument/timeframe through typed navigation route or URL query parameter and open existing /terminal/:symbol view.

**Existing code touchpoints or proposed location:** `web/src/components/MiniCockpit.tsx, web/src/App.tsx routing`.

**Data / API / storage contract:** Validate symbol against /api/markets/search or existing terminal loader; URL encode symbol.

**Failure behavior / financial boundary:** Invalid assets show clear error, not a crash or silent chart switch.

**Proof of completion:** Selected instrument and timeframe are preserved. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 010. Too many equal-looking alerts distract users  
**Priority:** `P1` · **Requested improvement:** Use severity-based notification center with contextual explainers.

**What the user sees / how it operates:** Group alerts by CRITICAL/HIGH/INFO; dedupe by stable event id; show sticky critical events and link to root-cause view.

**Existing code touchpoints or proposed location:** `web/src/pages/Account.tsx, web/src/App.tsx, existing notifications data`.

**Data / API / storage contract:** Existing notifications API; add normalized alert severity only if missing.

**Failure behavior / financial boundary:** Muting informational alerts must never suppress unprotected-position/emergency warnings.

**Proof of completion:** Critical risk alerts remain visible above informational noise. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.

### 11–20. 24/7 cloud operations
#### 011. MIA currently depends on a local/cloud session  
**Priority:** `P0` · **Requested improvement:** Deploy a persistent backend to an approved always-on host, initially PAPER-only.

**What the user sees / how it operates:** Package production entrypoint as supervised PAPER-only service; run backend on approved always-on host with TLS ingress and persistent database mount.

**Existing code touchpoints or proposed location:** `server/src/main.ts, server/scripts/run.mjs; infrastructure/ (new after host approval)`.

**Data / API / storage contract:** Deploy manifest, environment variables, /api/health plus separate readiness probe.

**Failure behavior / financial boundary:** Do not imply cloud deployment occurred before host is chosen and an actual uptime test passes.

**Proof of completion:** Backend health checks respond after client computer shutdown. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 012. Browser closure could be confused with bot shutdown  
**Priority:** `P0` · **Requested improvement:** Make headless engine and dashboard lifecycles explicitly independent.

**What the user sees / how it operates:** Prove backend scanner and risk-monitor loops start at server boot independently of browser SSE connections; browser remains optional client.

**Existing code touchpoints or proposed location:** `server/src/bot/bot.ts, server/src/main.ts, web/src/App.tsx`.

**Data / API / storage contract:** Lifecycle contract startBot()/stopBot(); instrumentation counts scans with no viewers.

**Failure behavior / financial boundary:** Close every tab for a 24-hour paper soak and confirm monitored positions remain serviced.

**Proof of completion:** Close all tabs and prove scanning plus paper monitoring continues. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 013. An unhandled crash may leave the bot offline  
**Priority:** `P0` · **Requested improvement:** Use a supervised service or container restart policy with bounded backoff.

**What the user sees / how it operates:** Use systemd or container restart policy and bounded exponential restart backoff; on every restart run startup integrity checks before resuming new paper orders.

**Existing code touchpoints or proposed location:** `server/scripts/run.mjs, deployment supervisor configuration`.

**Data / API / storage contract:** Process exit codes and health events; persistent restart_counter for diagnostics if desired.

**Failure behavior / financial boundary:** Crash loops should trigger operator alert and remain nonready, not continuously place orders.

**Proof of completion:** Forced process crash triggers observed restart. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 014. Multiple replicas could submit duplicate jobs  
**Priority:** `P1` · **Requested improvement:** Use leader election or DB-backed renewable lease for singleton schedulers.

**What the user sees / how it operates:** For a single-instance install enforce one process; if replicas are introduced, acquire renewable database/infra lease before scheduling jobs; fencing token guards stale leaders.

**Existing code touchpoints or proposed location:** `server/src/bot/bot.ts, server/src/db/ (new leader lease only if multi-instance)`.

**Data / API / storage contract:** Lease {name,holder,fence,expiresAt}; transactionally renew and release.

**Failure behavior / financial boundary:** Test two simultaneous processes: at most one schedules paper entry checks; expired leader cannot resume using stale token.

**Proof of completion:** Two-instance test produces one active scheduler. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 015. Restart could lose in-memory job progress  
**Priority:** `P1` · **Requested improvement:** Persist task checkpoints and pending order intents before execution.

**What the user sees / how it operates:** Before running a long task, commit job ID, input snapshot, state and next checkpoint; after restart reconcile external/paper status rather than blindly restarting.

**Existing code touchpoints or proposed location:** `server/src/bot/bot.ts, server/src/db/migrations.ts (append-only)`.

**Data / API / storage contract:** New durable job_progress table if no equivalent exists: jobId,stage,version,updatedAt,reference.

**Failure behavior / financial boundary:** Crash between stages must not skip a stop check or repeat a fill.

**Proof of completion:** Restart resumes safely from durable state. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 016. An interrupted request could be executed twice  
**Priority:** `P0` · **Requested improvement:** Reconcile ambiguous orders by client ID before any retry.

**What the user sees / how it operates:** Allocate stable client order IDs; persist intent before submission; on unknown result compare durable order/fill state and venue reference before retry.

**Existing code touchpoints or proposed location:** `server/src/exec/oms.ts, server/src/db/migrations.ts`.

**Data / API / storage contract:** orderIntent {clientOrderId,decisionId,status,attempt,createdAt}; unique DB index.

**Failure behavior / financial boundary:** Crash-after-submit test results in exactly one logical order and one set of ledger postings.

**Proof of completion:** Crash-after-submit test produces no duplicate paper fill. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 017. Downtime may go unnoticed overnight  
**Priority:** `P1` · **Requested improvement:** Use independent uptime checks and owner alerts for hard failures.

**What the user sees / how it operates:** Set independent uptime checker on health/readiness endpoint; alert owner if backend unreachable or monitoring loop stalls.

**Existing code touchpoints or proposed location:** `server/src/notify/notify.ts and external monitoring service after approval`.

**Data / API / storage contract:** Uptime events {endpoint,lastSeen,incidentId,severity}; avoid public account leakage.

**Failure behavior / financial boundary:** External checks must distinguish website alive from bot loop healthy; alerts rate-limited to prevent storms.

**Proof of completion:** Monitor detects forced outage and delivers alert. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 018. SQLite backups are not automated  
**Priority:** `P0` · **Requested improvement:** Use consistent SQLite backup snapshots with encryption and retention.

**What the user sees / how it operates:** Use SQLite backup API or transactionally consistent .backup snapshots (including WAL state), encrypt at rest, set retention, test restoring in isolated instance.

**Existing code touchpoints or proposed location:** `server/src/db/db.ts, deployment/backup scripts`.

**Data / API / storage contract:** Backup manifest {createdAt,schemaVersion,checksum,restoreTestedAt}; no keys inside repo.

**Failure behavior / financial boundary:** Corrupt/missing backup raises incident; never overwrite current database as part of test.

**Proof of completion:** Restore test recreates database and audit trail. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 019. A deployment can interrupt position monitoring  
**Priority:** `P1` · **Requested improvement:** Implement graceful drain, readiness gates and rollback with position-safe handover.

**What the user sees / how it operates:** On shutdown stop new intents, let in-flight state persist, close app gracefully; rollback requires matching compatible schema or prior snapshot.

**Existing code touchpoints or proposed location:** `server/src/main.ts, server/src/bot/bot.ts, host supervisor`.

**Data / API / storage contract:** Readiness/drain contract and deployment version record; preserve paper OMS state.

**Failure behavior / financial boundary:** Rolling restart with open paper position must maintain monitoring and not double-apply fills.

**Proof of completion:** Update while paper position open preserves monitoring. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 020. Fresh startup may appear ready before market feeds arrive  
**Priority:** `P0` · **Requested improvement:** Add readiness states for DB, feeds, strategy and risk gates.

**What the user sees / how it operates:** Keep liveness lightweight, add authenticated or tightly scoped readiness answering DB migration, market age, policy and executor loop readiness separately.

**Existing code touchpoints or proposed location:** `server/src/api/routes.ts, server/src/index.ts`.

**Data / API / storage contract:** Proposed GET /api/ready with {ready,checks,checkedAt}; /api/health remains existing.

**Failure behavior / financial boundary:** Ready=false must block automation where critical evidence is missing; no empty 200 interpreted as safe.

**Proof of completion:** API reports not-ready until required dependencies pass. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.

### 21–30. Market feed speed
#### 021. Polling can miss rapid market changes  
**Priority:** `P1` · **Requested improvement:** Add authorized WebSocket streams with REST fallback and freshness checks.

**What the user sees / how it operates:** Add licensed/approved streaming provider for real-time book/trades, sequence-check deltas, reconnect with snapshot resync, and REST failover.

**Existing code touchpoints or proposed location:** `server/src/providers/binance.ts, server/src/market/fabric.ts`.

**Data / API / storage contract:** ProviderEvent {venue,symbol,sequence,sourceTs,receivedAt,payload}; existing market fabric consumes.

**Failure behavior / financial boundary:** Out-of-order delta, reconnect gap, stale book => invalidate execution freshness and pause entries.

**Proof of completion:** Network drop falls back and reconnects without fake ticks. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 022. Provider bursts may trigger throttling  
**Priority:** `P1` · **Requested improvement:** Create per-provider request budgets, queueing and exponential backoff.

**What the user sees / how it operates:** Implement per-host token budgets, jittered exponential backoff and shared queues; respect Retry-After, maximum concurrency and request deadlines.

**Existing code touchpoints or proposed location:** `server/src/providers/http.ts, provider adapters`.

**Data / API / storage contract:** ProviderBudget {tokens,refill,concurrency,retryAt}; health metrics in existing Connections Hub.

**Failure behavior / financial boundary:** Never retry a non-idempotent execution request without reconciliation.

**Proof of completion:** Load test stays within documented provider limits. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 023. Timestamp skew can invalidate trade decisions  
**Priority:** `P0` · **Requested improvement:** Track provider clocks and host time synchronization; reject implausible timestamps.

**What the user sees / how it operates:** Record source timestamp versus receive timestamp and bounded clock offset; reject future or implausibly delayed samples before indicator computation.

**Existing code touchpoints or proposed location:** `server/src/market/quality.ts, server/src/core/latency.ts`.

**Data / API / storage contract:** MarketEnvelope {sourceTs,receiveTs,clockSkewMs,verified}; monotonic processing clock for local measurements.

**Failure behavior / financial boundary:** Freeze-clock tests ensure future-dated book or expired signal cannot become valid accidentally.

**Proof of completion:** Clock-skew tests fail closed. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 024. Missing or out-of-order candles can distort indicators  
**Priority:** `P1` · **Requested improvement:** Implement gap detection and replay from a verified historical provider.

**What the user sees / how it operates:** Check candle sequence and expected interval; fetch missing closed bars from trusted provider; rebuild affected incremental indicators only after confirmed repair.

**Existing code touchpoints or proposed location:** `server/src/market/fabric.ts, server/src/features/indicators.ts`.

**Data / API / storage contract:** CandleHealth {gaps,duplicates,outOfOrder,repairedAt}; stored provenance.

**Failure behavior / financial boundary:** Do not synthesize candles as real exchange bars or use a still-forming candle as closed.

**Proof of completion:** Gap repair matches point-in-time candle sequence. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 025. Large market snapshots can stall Node's event loop  
**Priority:** `P1` · **Requested improvement:** Move parsing or heavy transforms off the hot loop; benchmark first.

**What the user sees / how it operates:** Measure actual event-loop delay and large payload stages; move heavy parsing to bounded worker thread or chunked parser only if data supports it.

**Existing code touchpoints or proposed location:** `server/src/market/fabric.ts, server/src/qhef/qhef.ts`.

**Data / API / storage contract:** Latency stage histograms and before/after p95, memory, CPU measurements.

**Failure behavior / financial boundary:** Guard backpressure and termination; optimization must produce numerically identical market snapshots.

**Proof of completion:** Measure lower p95 event-loop delay without correctness loss. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 026. Redundant subscriptions waste bandwidth  
**Priority:** `P2` · **Requested improvement:** Deduplicate requests and share subscriptions across consumers.

**What the user sees / how it operates:** Collapse identical in-flight symbol/timeframe requests and fan out results through existing market store and browser SSE.

**Existing code touchpoints or proposed location:** `server/src/providers/http.ts, web/src/api.ts`.

**Data / API / storage contract:** Cache key provider+symbol+timeframe+version with short TTL and invalidation.

**Failure behavior / financial boundary:** Prove two cards request the same data once, while still receiving timely updates.

**Proof of completion:** Multiple widgets create only one provider subscription per symbol. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 027. Recomputing full histories wastes CPU  
**Priority:** `P2` · **Requested improvement:** Extend incremental feature caching and invalidation.

**What the user sees / how it operates:** Update moving indicators on verified closed candle events and cache by symbol+interval+lastCandleId+algorithmVersion.

**Existing code touchpoints or proposed location:** `server/src/features/indicators.ts, server/src/workers/indicators.ts`.

**Data / API / storage contract:** IndicatorSnapshot {inputsHash,version,computedAt,features}; existing deterministic outputs.

**Failure behavior / financial boundary:** Run reference batch comparison on gaps and replays; invalidation on historical correction.

**Proof of completion:** Outputs match batch calculation in deterministic tests. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 028. Rapid SSE events may trigger wasteful React rerenders  
**Priority:** `P2` · **Requested improvement:** Batch UI updates, memoize heavy chart regions and virtualize large tables.

**What the user sees / how it operates:** Batch noncritical SSE-driven refreshes on animation frame or stable debounce; memoize chart layers and window large tables.

**Existing code touchpoints or proposed location:** `web/src/api.ts, web/src/pages/Markets.tsx, tables/charts`.

**Data / API / storage contract:** useApi event filters + typed lightweight view models; subscription belongs to one service.

**Failure behavior / financial boundary:** Critical risk alerts are delivered promptly even when a chart is backgrounded.

**Proof of completion:** Profiling shows lower render time and no dropped critical events. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 029. Speed claims lack consistent evidence  
**Priority:** `P1` · **Requested improvement:** Publish per-stage p50/p95/p99 budgets and regression benchmarks.

**What the user sees / how it operates:** Capture representative replay workloads with seeded inputs; publish p50,p95,p99 by ingest/scan/QCI/risk/OMS and budget table.

**Existing code touchpoints or proposed location:** `server/src/core/latency.ts, server/src/qhef/qhef.ts, CI`.

**Data / API / storage contract:** Benchmark artifacts tagged {commit,hardware,workload,percentiles}; avoid invented targets until baseline.

**Failure behavior / financial boundary:** Regression gates must separate noisy CI variance from significant measured deterioration.

**Proof of completion:** CI stores repeatable baseline measurements. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 030. Failover can silently mix inconsistent prices  
**Priority:** `P0` · **Requested improvement:** Record source identity, trust tier, divergence and freshness per feed.

**What the user sees / how it operates:** Compare fresh quotes across qualified sources by same instrument and time tolerance; explicitly record uncertainty and reject when spread diverges outside policy.

**Existing code touchpoints or proposed location:** `server/src/market/quality.ts, server/src/providers/*`.

**Data / API / storage contract:** DataQuality {primary,secondary,deviation,sourceAges,decision}; source tier configuration.

**Failure behavior / financial boundary:** Provider failover never makes price appear verified simply because another endpoint answered.

**Proof of completion:** Conflicting sources trigger caution or no-trade state. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.

### 31–40. Autonomous intelligence
#### 031. No-trade decisions are less visible than entries  
**Priority:** `P1` · **Requested improvement:** Create a no-trade reason board with evidence and expiry.

**What the user sees / how it operates:** Persist reason codes for WAIT, REJECT and INSUFFICIENT_DATA; display explainable no-trade board alongside opportunities.

**Existing code touchpoints or proposed location:** `server/src/decision/engine.ts, web/src/pages/Intel.tsx`.

**Data / API / storage contract:** DecisionStatus {candidateId,reasonCodes,evidenceAt,expiresAt}; existing decision feed where possible.

**Failure behavior / financial boundary:** Avoid inventing a recommended trade in an empty period; stale reason markers must expire.

**Proof of completion:** Operator sees why MIA abstained on each instrument. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 032. Strategies may operate outside tested regimes  
**Priority:** `P1` · **Requested improvement:** Enforce versioned strategy passports and regime eligibility.

**What the user sees / how it operates:** Record versioned strategy eligibility by regime, data quality, out-of-sample validation and instrument; gate candidates before risk assessment.

**Existing code touchpoints or proposed location:** `server/src/lab/strategies.ts, server/src/decision/engine.ts`.

**Data / API / storage contract:** StrategyPassport {strategyId,version,regimes,validFrom,validatedBy,expiry}; reuse PR DITAS if present.

**Failure behavior / financial boundary:** Unvalidated/regime-mismatched strategies return WAIT/REJECT, never auto-promote.

**Proof of completion:** Out-of-regime paper entries are rejected in tests. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 033. Conflicting worker signals may look like consensus  
**Priority:** `P0` · **Requested improvement:** Require adversarial challenge evidence and dissent display.

**What the user sees / how it operates:** Require independent bull/bear/liquidity/data-auditor evidence with mandatory-domain coverage; preserve disagreement in response for UI.

**Existing code touchpoints or proposed location:** `server/src/qci/challenge.ts, server/src/qci/coordinator.ts`.

**Data / API / storage contract:** Consensus {support,oppose,abstain,missingDomains,vetoReason,expiresAt}.

**Failure behavior / financial boundary:** Majority consensus cannot override safety veto, forged signature, or missing mandatory evidence.

**Proof of completion:** Contradiction test results in review or no-trade. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 034. Confidence numbers lack outcome calibration  
**Priority:** `P1` · **Requested improvement:** Measure cohort-based reliability, sample size and Brier scores.

**What the user sees / how it operates:** Collect forecast probabilities with time horizons, record realized outcome by exact cohort, compute Brier score and calibration bins only after samples exist.

**Existing code touchpoints or proposed location:** `server/src/ditas/ (from unmerged PR if approved), web/src/pages/Intel.tsx`.

**Data / API / storage contract:** Forecast {modelVersion,issuedAt,horizon,target,outcomeAt,cohort}; no new model inferred from confidence score.

**Failure behavior / financial boundary:** Small cohorts show NOT CALIBRATED; never label score as win probability without validation.

**Proof of completion:** Uncalibrated scores are labeled, not presented as probabilities. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 035. Main branch lacks durable decision forensics  
**Priority:** `P1` · **Requested improvement:** Review and integrate compatible DITAS decision snapshots from open PRs.

**What the user sees / how it operates:** Compare existing snapshot services in unmerged branches; select one compatible schema and write immutable decision receipt transactionally when decision occurs.

**Existing code touchpoints or proposed location:** `PR #7/#8 DITAS diffs, server/src/db/migrations.ts`.

**Data / API / storage contract:** DecisionSnapshot {decisionId,dataHashes,inputs,policyVersion,ts,correctionChain}.

**Failure behavior / financial boundary:** Verify restart persistence and exact source clocks; do not create a second DITAS store.

**Proof of completion:** Restart retains immutable decision evidence. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 036. Hard to see whether waiting would improve a result  
**Priority:** `P2` · **Requested improvement:** Integrate research-only Decision Twin shadow alternatives without ledger writes.

**What the user sees / how it operates:** For each recorded decision, simulate WAIT/DELAY alternatives using frozen decision-time book, fees and exit rules; label simulations as research.

**Existing code touchpoints or proposed location:** `server/src/ditas/ twin service (PR branch), web/src/pages/Intel.tsx`.

**Data / API / storage contract:** TwinResult {baseDecisionId,scenario,status,hypotheticalPnL,assumptions}; separate table namespace.

**Failure behavior / financial boundary:** Never write hypothetical fills to actual paper ledger or claim future fills were known.

**Proof of completion:** Hypothetical records never change paper balance. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 037. Historical comparison can accidentally use future data  
**Priority:** `P1` · **Requested improvement:** Implement point-in-time replay and blind strategy arena.

**What the user sees / how it operates:** Replay immutable historical snapshots through actual scanner→QCI→decision→risk→paper OMS at accelerated virtual clock.

**Existing code touchpoints or proposed location:** `server/src/lab/backtest.ts, server/src/market/fabric.ts`.

**Data / API / storage contract:** ReplayRun {datasetHash,clock,seed,codeVersion,events,netResults}.

**Failure behavior / financial boundary:** Assert no future candle, post-decision news, or hindsight price enters prior decision state.

**Proof of completion:** Leakage tests detect future candle access. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 038. Worker contribution is not continuously proven  
**Priority:** `P2` · **Requested improvement:** Score outcomes by evidence cohort with uncertainty and dependency control.

**What the user sees / how it operates:** Attribute closed paper outcomes to each worker evidence snapshot, compare cohorts by regime, and report sample size and uncertainty before considering adjusted weights.

**Existing code touchpoints or proposed location:** `server/src/workers/registry.ts, server/src/workers/runtime.ts`.

**Data / API / storage contract:** WorkerOutcome {workerId,decisionId,regime,prediction,outcome,modelVersion}; dependency group metadata.

**Failure behavior / financial boundary:** Do not reward workers only on raw realized PnL or one trade; quarantined workers cannot approve.

**Proof of completion:** Report does not equate one trade with worker accuracy. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 039. A promising signal might be uneconomic after costs  
**Priority:** `P1` · **Requested improvement:** Add order-size-aware pre-trade expected-cost and capacity gates.

**What the user sees / how it operates:** Before approving candidate, estimate venue fees + expected spread + depth-aware slippage for the proposed quantity; require viable net edge under policy.

**Existing code touchpoints or proposed location:** `server/src/decision/scoring.ts, server/src/risk/gate.ts`.

**Data / API / storage contract:** CostEstimate {quoteSize,spread,fees,slippage,impact,asOf,source}; authoritative market book.

**Failure behavior / financial boundary:** Missing order depth causes rejection, not zero estimated cost.

**Proof of completion:** Candidate is rejected when net economics fail policy. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 040. Unverified news can trigger hasty reactions  
**Priority:** `P1` · **Requested improvement:** Introduce verified-event cooling and source credibility states.

**What the user sees / how it operates:** Categorize news as verified, disputed, stale, or unverified; gate entries only via independent risk rules, never auto-buy from sentiment.

**Existing code touchpoints or proposed location:** `server/src/news/news.ts, server/src/risk/gate.ts`.

**Data / API / storage contract:** NewsEvent {source,sourceTs,verifiedAt,credibility,affectedSymbols}; provenance shown UI.

**Failure behavior / financial boundary:** Unverified rumor never authorizes action; cooling expires by policy and audit entry.

**Proof of completion:** Rumor alone cannot authorize a new trade. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.

### 41–50. Paper execution
#### 041. Order lifecycle may be hard to diagnose  
**Priority:** `P0` · **Requested improvement:** Use explicit intent, accepted, partial, complete, cancelled and unknown states.

**What the user sees / how it operates:** Define valid state transitions INTENT→PENDING→PARTIAL→FILLED/CANCELLED/UNKNOWN with typed transition function and persistent events.

**Existing code touchpoints or proposed location:** `server/src/exec/oms.ts, server/src/db/migrations.ts`.

**Data / API / storage contract:** OrderEvent {id,orderId,from,to,ts,reference}; durable unique transition IDs.

**Failure behavior / financial boundary:** Illegal transitions throw safely and are logged, never quietly counted as fills.

**Proof of completion:** State transition tests cover every edge. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 042. Retrying timed-out submissions may duplicate orders  
**Priority:** `P0` · **Requested improvement:** Assign deterministic idempotency keys and reconcile before retry.

**What the user sees / how it operates:** Persist clientOrderId unique to decision+attempt and return existing status for duplicate submission; query reconciled state on timeout.

**Existing code touchpoints or proposed location:** `server/src/exec/oms.ts, server/src/db/db.ts`.

**Data / API / storage contract:** Unique(client_order_id) and idempotencyKey on paper requests.

**Failure behavior / financial boundary:** Duplicate API requests may not double debit cash or create extra fills.

**Proof of completion:** Repeat request remains one logical order. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 043. Concurrent opportunities could oversubscribe risk  
**Priority:** `P0` · **Requested improvement:** Reserve available risk budget transactionally before approval.

**What the user sees / how it operates:** Reserve cash and portfolio exposure atomically for approved order intents before paper OMS submits; release on cancel/reject.

**Existing code touchpoints or proposed location:** `server/src/risk/gate.ts, server/src/portfolio/ledger.ts`.

**Data / API / storage contract:** risk_reservations {decisionId,size,riskBudget,status}; DB transaction.

**Failure behavior / financial boundary:** Two simultaneous candidates cannot both consume same remaining capital.

**Proof of completion:** Parallel candidates cannot exceed capital limits. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 044. Partial fills can complicate balances  
**Priority:** `P0` · **Requested improvement:** Post immutable fill events and atomic ledger adjustments.

**What the user sees / how it operates:** Represent each partial fill as immutable event; debit cash, allocate fees, update weighted price and residual quantity together.

**Existing code touchpoints or proposed location:** `server/src/exec/oms.ts, server/src/portfolio/ledger.ts`.

**Data / API / storage contract:** fills.orderId + unique venueFillId, precision-safe amounts and ledger journal.

**Failure behavior / financial boundary:** A crash between fill and ledger must rollback or replay exactly once.

**Proof of completion:** Independent ledger reconciliation matches partial fills. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 045. A position may lack demonstrable exit protection  
**Priority:** `P0` · **Requested improvement:** Add per-position protection verification and age indicators.

**What the user sees / how it operates:** Regularly verify every open paper position has fresh quote and determinable protective action; expose protection age and severity.

**Existing code touchpoints or proposed location:** `server/src/exec/oms.ts, server/src/risk/gate.ts, Overview`.

**Data / API / storage contract:** ProtectionStatus {positionId,state,lastCheckAt,bookAge,reason}; existing incidents if available.

**Failure behavior / financial boundary:** No fresh executable book => UNVERIFIED/CRITICAL; don't silently count protected.

**Proof of completion:** Dashboard flags any unprotected or unverified position. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 046. Stale books prevent trustworthy protective exits  
**Priority:** `P0` · **Requested improvement:** Freeze new entries; preserve open-position risk with critical alert.

**What the user sees / how it operates:** On stale book block new entries; keep open position recorded; generate CRITICAL protection incident and retry checks when data resumes.

**Existing code touchpoints or proposed location:** `server/src/market/quality.ts, server/src/exec/oms.ts`.

**Data / API / storage contract:** RiskIncident {positionId,reason,openedAt,resolvedAt}; publish SSE alert.

**Failure behavior / financial boundary:** Never create a synthetic stale-price exit simply to clean up red status.

**Proof of completion:** No fabricated exit appears during stale-book test. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 047. Venue outage could be mistaken for harmless latency  
**Priority:** `P0` · **Requested improvement:** Use outage-specific state transitions and auto-pause entries.

**What the user sees / how it operates:** Escalate provider DOWN into entry pause and failover attempts; preserve positions for recovery with explicit states.

**Existing code touchpoints or proposed location:** `server/src/providers/http.ts, server/src/bot/bot.ts`.

**Data / API / storage contract:** ProviderIncident {venue,status,startedAt,lastHealthyAt}; use existing notification bus.

**Failure behavior / financial boundary:** Lack of external market data must not be represented as zero volatility or zero risk.

**Proof of completion:** Fault injection blocks new entries while preserving records. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 048. Actual trade size can exceed visible order-book liquidity  
**Priority:** `P0` · **Requested improvement:** Compute depth-aware impact against the full intended order size.

**What the user sees / how it operates:** Walk full requested quantity through fresh book levels, estimate marginal price impact and reject before paper entry when depth insufficient.

**Existing code touchpoints or proposed location:** `server/src/market/quality.ts, server/src/exec/oms.ts`.

**Data / API / storage contract:** BookImpact {qty,filledQty,vwap,expectedFees,slippage,bookAt}.

**Failure behavior / financial boundary:** Partial depth cannot be used to claim whole-size fill; timestamp must pass freshness rule.

**Proof of completion:** Insufficient depth returns reject, not optimistic fill. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 049. Changing fees distort strategy comparisons  
**Priority:** `P2` · **Requested improvement:** Store provider fee schedule version with each execution estimate.

**What the user sees / how it operates:** Version fee tables by venue, instrument, tier and effective date; capture fee schedule used at evaluation and fill.

**Existing code touchpoints or proposed location:** `server/src/providers/*, server/src/exec/oms.ts`.

**Data / API / storage contract:** FeePolicy {version,venue,feeRate,effectiveAt}; order stores feePolicyVersion.

**Failure behavior / financial boundary:** Historical PnL retains original fees, not rewritten after today's fee update.

**Proof of completion:** Historical orders retain their original fee assumptions. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 050. Slippage estimates are not continuously audited  
**Priority:** `P1` · **Requested improvement:** Compare intended, observed and reconciled fill prices and delays.

**What the user sees / how it operates:** Integrate PR #8 read-only execution-quality projection if compatible; report slippage, latency, fill ratio and costs on reconciled paper fills.

**Existing code touchpoints or proposed location:** `server/src/ditas/execution.ts (PR #8), server/src/exec/oms.ts`.

**Data / API / storage contract:** GET /api/ditas/execution from PR #8 if merged; handle null reference price honestly.

**Failure behavior / financial boundary:** Unknown market reference remains NULL; hypothetical Twin outcomes excluded.

**Proof of completion:** Execution quality report handles missing references as unknown. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.

### 51–60. Funding/withdrawal boundaries
#### 051. No verified live funding connection on main  
**Priority:** `P2` · **Requested improvement:** Start with read-only exchange or wallet balance adapters.

**What the user sees / how it operates:** Request minimum-scope read-only account balances using external provider credentials held server-side; show separate account grouping.

**Existing code touchpoints or proposed location:** `server/src/providers/ (new read-only balance adapter), web/src/pages/Account.tsx`.

**Data / API / storage contract:** GET /api/accounts/read-only with {venue,currency,available,total,asOf,verification}; future only.

**Failure behavior / financial boundary:** Unconfigured credentials show SETUP_REQUIRED; no paper allocation counted as real account.

**Proof of completion:** Verified external balances remain separate from paper cash. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 052. Paper funding may be mistaken for real deposits  
**Priority:** `P0` · **Requested improvement:** Label virtual allocation and real deposits differently across UI.

**What the user sees / how it operates:** Add badge per amount origin PAPER, EXCHANGE_READONLY, or UNVERIFIED; derive never from UI color or guessed account name.

**Existing code touchpoints or proposed location:** `web/src/pages/Overview.tsx, web/src/pages/Account.tsx`.

**Data / API / storage contract:** AccountBalance {origin,amount,currency,asOf}; server is authoritative.

**Failure behavior / financial boundary:** A simulated top-up must not increase any withdrawable balance label.

**Proof of completion:** Balance-origin tests enforce distinct labels. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 053. Pending transfers could be treated as settled  
**Priority:** `P2` · **Requested improvement:** Use chain/venue confirmation states and reconciliation.

**What the user sees / how it operates:** For connected real deposits, track pending→confirming→credited based on verified provider/chain events and required confirmations.

**Existing code touchpoints or proposed location:** `server/src/providers/ and portfolio ledger, separate read-only settlement store`.

**Data / API / storage contract:** DepositRecord {providerTxId,network,state,confirmedAt,amount}; unique id.

**Failure behavior / financial boundary:** Pending transfers do not become settled capital; ignore unverified webhook duplicates.

**Proof of completion:** Unconfirmed deposit cannot inflate withdrawable cash. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 054. Deposits may falsely boost performance charts  
**Priority:** `P1` · **Requested improvement:** Exclude funding flows from PnL and calculate time-weighted context.

**What the user sees / how it operates:** Compute investment return from cash-flow-adjusted equity curve; display funding transactions separately, with net return after costs.

**Existing code touchpoints or proposed location:** `server/src/portfolio/ledger.ts, web/src/pages/Trading.tsx`.

**Data / API / storage contract:** PerformancePoint {equity,cumulativeDeposits,cumulativeWithdrawals,pnlNet,asOf}.

**Failure behavior / financial boundary:** Adding funds to paper account with no trades must not create positive trading PnL.

**Proof of completion:** Deposit-only scenario reports zero trading profit. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 055. Execution keys could accidentally have transfer rights  
**Priority:** `P0` · **Requested improvement:** Use separate exchange credentials with trading-only privileges and IP restrictions.

**What the user sees / how it operates:** Use separately generated server-only read/trade credentials with withdrawal disabled; expose permission check summary without secret values.

**Existing code touchpoints or proposed location:** `server/src/security/security.ts, external venue adapter design`.

**Data / API / storage contract:** CredentialScope {accountId,read,trade,withdraw=false,expiresAt}; encryption/key store.

**Failure behavior / financial boundary:** Reject credential whose provider reports withdrawal scope where read/trade-only was requested.

**Proof of completion:** Permission audit denies withdrawals through bot credentials. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 056. Withdrawal preview is not real settlement  
**Priority:** `LOCKED` · **Requested improvement:** Design a separate owner-controlled withdrawal service behind release gates.

**What the user sees / how it operates:** Keep existing preview-only withdrawal code; design independently authorized payout module after separate certification, never wire it to Trader Joe tools.

**Existing code touchpoints or proposed location:** `server/src/wallet/wallet.ts, server/src/qa/gates.ts`.

**Data / API / storage contract:** Future /api/withdrawals/preview + owner-confirm service; no actual submission in this milestone.

**Failure behavior / financial boundary:** No signer, custody key, or live send operation may be introduced by backlog prompt alone.

**Proof of completion:** No transfer is possible until service and controls are independently certified. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 057. One-click withdrawal may invite account takeover  
**Priority:** `LOCKED` · **Requested improvement:** Require step-up authentication, MFA and confirmed destination allowlist.

**What the user sees / how it operates:** For future owner withdrawal, require MFA, passphrase step-up, trusted beneficiary allowlist, amount/fee review and final explicit confirmation.

**Existing code touchpoints or proposed location:** `server/src/security/security.ts, web/src/pages/Account.tsx`.

**Data / API / storage contract:** WithdrawalAuthorization {ownerId,destinationId,challengeId,expiresAt,approvedAt}.

**Failure behavior / financial boundary:** Any new beneficiary, failed challenge, or mismatched review blocks submission.

**Proof of completion:** Unauthorized or new-address requests cannot submit. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 058. Users may confuse gross balance with net proceeds  
**Priority:** `LOCKED` · **Requested improvement:** Show withdrawable amount, holds, fees and expected net before confirmation.

**What the user sees / how it operates:** Display gross, holds, fee estimate, network, amount receivable and time range; quote may expire and must be refreshed before final confirmation.

**Existing code touchpoints or proposed location:** `web/src/pages/Account.tsx, future settlement reconciliation`.

**Data / API / storage contract:** WithdrawalQuote {quoteId,asset,network,fee,net,expiresAt}; all from provider.

**Failure behavior / financial boundary:** Missing fee quote cannot be replaced with zero or infinite precision claims.

**Proof of completion:** Preview matches reconciled provider values. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 059. Pending withdrawal could be misreported as complete  
**Priority:** `LOCKED` · **Requested improvement:** Track submitted, processing, confirmed, failed and review-required statuses.

**What the user sees / how it operates:** Track status only from authoritative provider/chain events and maintain audit chain; use polling with backoff when webhook unavailable.

**Existing code touchpoints or proposed location:** `server/src/wallet/wallet.ts, future provider-status sync`.

**Data / API / storage contract:** WithdrawalStatus {requested,approved,submitted,processing,confirmed,failed,reviewRequired}.

**Failure behavior / financial boundary:** No success message until definitive confirmation; backend retry does not resubmit payout automatically.

**Proof of completion:** UI updates only from authoritative provider/chain events. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 060. Instant withdrawal cannot be guaranteed  
**Priority:** `LOCKED` · **Requested improvement:** Display realistic provider/network timing and recheck eligibility before submitting.

**What the user sees / how it operates:** Describe withdrawal as request initiation; show provider-specific settlement status, blockers, confirmations and realistic guidance.

**Existing code touchpoints or proposed location:** `web/src/pages/Account.tsx`.

**Data / API / storage contract:** withdrawal ETA may be unknown; no artificial count-down.

**Failure behavior / financial boundary:** Never guarantee instant completion; real-money service stays disconnected in current plan.

**Proof of completion:** No UI promises immediate settlement. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.

### 61–70. Security and risk
#### 061. AI could accidentally gain a privileged execution pathway  
**Priority:** `P0` · **Requested improvement:** Enforce separate tool permissions and independent deterministic authorization.

**What the user sees / how it operates:** Keep assistant command tool allowlist limited to read-only and risk-reducing tasks; action requests go through deterministic permission check.

**Existing code touchpoints or proposed location:** `server/src/joe/joe.ts, server/src/risk/gate.ts`.

**Data / API / storage contract:** ToolPolicy {toolName,allowedModes,capability,actor}; tests assert deny for trades/withdrawals.

**Failure behavior / financial boundary:** Prompt-injected website/news text cannot create privileged tool calls.

**Proof of completion:** AI prompt-injection tests cannot bypass risk or signer. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 062. Signer access might expand silently  
**Priority:** `LOCKED` · **Requested improvement:** Use isolated signing with method/asset/amount/venue allowlists.

**What the user sees / how it operates:** If authorized later, put signer in separate process with chain, asset, venue, amount and destination allowlists; require transaction firewall validation.

**Existing code touchpoints or proposed location:** `server/src/qa/gates.ts, future isolated signer service`.

**Data / API / storage contract:** SignerRequest {intentHash,policyHash,nonce,expiresAt}, immutable approvals.

**Failure behavior / financial boundary:** No keys in React, LLM process or Git; signer does not exist in current release.

**Proof of completion:** Forbidden signing operations are rejected independently. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 063. Incomplete token checks can create false safety  
**Priority:** `P0` · **Requested improvement:** Default to UNVERIFIED and require chain-specific safety evidence.

**What the user sees / how it operates:** Return UNVERIFIED until chain-specific holder privileges, sellability, taxes and liquidity pass; map evidence and missing checks to user-facing labels.

**Existing code touchpoints or proposed location:** `server/src/safety/safety.ts, server/src/providers/pending.ts`.

**Data / API / storage contract:** AssetSafety {verdict,reasonCodes,evidence,checkedAt,chain}.

**Failure behavior / financial boundary:** Unknown sell simulation or missing provider => no 'safe to trade' classification.

**Proof of completion:** Missing sell simulation cannot generate safe label. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 064. Overnight operation needs tighter exposure policies  
**Priority:** `P2` · **Requested improvement:** Add optional overnight loss, drawdown and position caps.

**What the user sees / how it operates:** Offer opt-in overnight stricter caps by schedule and time zone; risk gate resolves effective policy per decision.

**Existing code touchpoints or proposed location:** `server/src/risk/policy.ts, server/src/risk/gate.ts`.

**Data / API / storage contract:** RiskPolicy {normalCaps,overnightCaps,windows,zone,version}.

**Failure behavior / financial boundary:** Never automatically increase risk after midnight; handle DST boundaries and server UTC.

**Proof of completion:** Night policy overrides normal entry allowance. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 065. Runaway order creation could exhaust capital quickly  
**Priority:** `P0` · **Requested improvement:** Implement an independent emergency kill switch with narrow authority.

**What the user sees / how it operates:** Keep emergency pause independent of AI; owner can activate from header; backend rejects all new order intents immediately and records reason.

**Existing code touchpoints or proposed location:** `server/src/core/mode.ts, server/src/risk/gate.ts`.

**Data / API / storage contract:** Existing control.emergency, event bus, append-only audit.

**Failure behavior / financial boundary:** Emergency must not be removed by restart or by AI, and does not imply automatic closing positions.

**Proof of completion:** Fault test stops new entry intents promptly. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 066. Correlated trades can multiply one underlying bet  
**Priority:** `P1` · **Requested improvement:** Use portfolio correlation and concentration risk reservations.

**What the user sees / how it operates:** Convert rolling correlations and instrument grouping into conservative shared exposure budget before new paper orders.

**Existing code touchpoints or proposed location:** `server/src/portfolio/correlation.ts, server/src/risk/gate.ts`.

**Data / API / storage contract:** ExposureSummary {group,correlatedUsd,riskPct,limit,asOf}; stale correlation raises caution.

**Failure behavior / financial boundary:** Two same-direction correlated trades cannot bypass cap by racing.

**Proof of completion:** Concurrent correlated entries respect portfolio caps. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 067. Daily loss counters can reset incorrectly  
**Priority:** `P0` · **Requested improvement:** Use UTC-aware period boundaries and immutable realized ledger events.

**What the user sees / how it operates:** Derive daily realized loss from immutable ledger events using documented trading-day boundary and UTC storage; never reset counters by UI timestamp.

**Existing code touchpoints or proposed location:** `server/src/portfolio/ledger.ts, server/src/risk/gate.ts`.

**Data / API / storage contract:** RiskWindow {periodStartUtc,periodEndUtc,realizedNet,capitalBase}; versioned policy.

**Failure behavior / financial boundary:** Cross-midnight and timezone tests prove consistent breaker behavior.

**Proof of completion:** Timezone and midnight regression tests pass. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 068. Stale or manipulated data can reach decision layer  
**Priority:** `P0` · **Requested improvement:** Quarantine suspicious providers/assets with explicit recovery criteria.

**What the user sees / how it operates:** Quarantine provider/asset on impossible clocks, crossed books, identity conflicts or integrity mismatch; require source-specific recovery criteria.

**Existing code touchpoints or proposed location:** `server/src/market/quality.ts, server/src/providers/http.ts`.

**Data / API / storage contract:** Quarantine {entity,reason,openedAt,cleanChecksRequired,lastGoodAt}; metrics visible.

**Failure behavior / financial boundary:** Quarantined data excluded from QCI and OMS until revalidated.

**Proof of completion:** Injected bad feed cannot authorize trades. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 069. Credentials may be compromised without immediate warning  
**Priority:** `P1` · **Requested improvement:** Detect anomalous logins, token use and permission changes.

**What the user sees / how it operates:** Detect unusual session origin, failed auth bursts, privilege changes and key validation failures; notify owner and allow session revocation.

**Existing code touchpoints or proposed location:** `server/src/security/security.ts, server/src/api/auth.ts`.

**Data / API / storage contract:** SecurityEvent {type,actor,ts,risk,redactedMetadata}; no raw credential logs.

**Failure behavior / financial boundary:** False positives should be reviewable; no automatic withdrawal privilege granted.

**Proof of completion:** Unusual session triggers owner alert and revocation option. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 070. An audit trail stored only locally may be alterable  
**Priority:** `P2` · **Requested improvement:** Add signed periodic audit checkpoints and independent encrypted export.

**What the user sees / how it operates:** Periodically sign or HMAC hash-chain checkpoints with independent protected secret and export immutable snapshots outside app host.

**Existing code touchpoints or proposed location:** `server/src/core/audit.ts, backup scripts`.

**Data / API / storage contract:** AuditCheckpoint {lastEventId,chainHash,signature,ts}; remote storage distinct from DB.

**Failure behavior / financial boundary:** Deletion/tampering/reordering yields validation failure and incident.

**Proof of completion:** Tampered checkpoint fails verification. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.

### 71–80. Testing and certification
#### 071. UI tests may miss popup-specific failures  
**Priority:** `P1` · **Requested improvement:** Add Playwright coverage for PiP support, fallback and widget state.

**What the user sees / how it operates:** In browser supporting PiP, click mini widget and validate it renders correct account origin and reconnect state; elsewhere verify in-page fallback.

**Existing code touchpoints or proposed location:** `e2e/app.spec.ts, new e2e/pip.spec.ts`.

**Data / API / storage contract:** Playwright browser capability/feature detection and deterministic fixture values.

**Failure behavior / financial boundary:** Do not fail unsupported engines for missing PiP; never use fake data as real trading demonstration.

**Proof of completion:** Supported/unsupported browser behavior is verified. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 072. Short tests do not prove unattended stability  
**Priority:** `P0` · **Requested improvement:** Run 24-hour PAPER-only soak tests with telemetry and no UI clients.

**What the user sees / how it operates:** Run continuous PAPER-only scan/position monitoring with no browser for at least 24h; collect uptime, loop delay, memory trend and incident log.

**Existing code touchpoints or proposed location:** `server/test/ (new soak harness), infrastructure monitoring`.

**Data / API / storage contract:** SoakReport {duration,scans,missedJobs,staleEvents,restarts,peakRss}; owner evidence.

**Failure behavior / financial boundary:** Report must distinguish paused/stale periods from successful active operation.

**Proof of completion:** Report uptime, restarts, leaks, event lag and missed jobs. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 073. Unexpected termination may corrupt order workflow  
**Priority:** `P0` · **Requested improvement:** Inject crashes during intent, submit and reconcile steps.

**What the user sees / how it operates:** Inject crash before/after order intent, partial fill and ledger commit; reopen DB and reconcile with persisted state.

**Existing code touchpoints or proposed location:** `server/test/oms.test.ts, server/test/recovery.test.ts (new)`.

**Data / API / storage contract:** Fault injection points around transactions; deterministic test clock.

**Failure behavior / financial boundary:** No phantom fills, duplicate debits, or orphan open orders after recovery.

**Proof of completion:** Restart recovers without double-counting or unknown fills. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 074. Provider throttling may cause cascading failures  
**Priority:** `P1` · **Requested improvement:** Simulate HTTP 429, rate-limit resets, and exponential backoff.

**What the user sees / how it operates:** Simulate HTTP 429, Retry-After, slow responses and network disconnect; verify bounded backoff and per-host budget.

**Existing code touchpoints or proposed location:** `server/test/live.providers.test.ts, server/src/providers/http.ts`.

**Data / API / storage contract:** Provider test doubles expose retry counts, request times and circuit states.

**Failure behavior / financial boundary:** Never hammer blocked provider and never let provider outage authorize trade.

**Proof of completion:** System degrades safely and resumes within budget. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 075. Clock glitches can distort expiry and risk windows  
**Priority:** `P1` · **Requested improvement:** Use injectable clock and frozen-time integration tests.

**What the user sees / how it operates:** Inject fake clock across decision expiration, candle close, session expiry and risk window boundaries.

**Existing code touchpoints or proposed location:** `server/test/phase1.test.ts, server/src/core/util.ts`.

**Data / API / storage contract:** Clock interface now()/monotonic(); test freezer, not real sleeping.

**Failure behavior / financial boundary:** An expired or future-dated decision must fail even during clock changes.

**Proof of completion:** Expired decisions are denied regardless of clock jumps. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 076. Ledger edge cases can escape example-based tests  
**Priority:** `P1` · **Requested improvement:** Apply property-based accounting invariants on random fill sequences.

**What the user sees / how it operates:** Generate random partial fills and fee schedules; assert accounting identities, no negative inventory without allowed shorting, and deterministic replay.

**Existing code touchpoints or proposed location:** `server/test/ledger.property.test.ts (new), server/src/portfolio/ledger.ts`.

**Data / API / storage contract:** Property-based inputs with seeded generator; use integer minor units/precision handling.

**Failure behavior / financial boundary:** Counterexample seed saved as regression test rather than discarded.

**Proof of completion:** Cash + positions reconcile within defined precision. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 077. Parallel trade decisions can create races  
**Priority:** `P0` · **Requested improvement:** Run concurrency/load tests on risk reservation and OMS.

**What the user sees / how it operates:** Fire concurrent intents and cancellations against same available paper capital and risk budget; assert transactional serialization.

**Existing code touchpoints or proposed location:** `server/test/oms.test.ts, server/test/risk.test.ts`.

**Data / API / storage contract:** Parallel Promise.all test on separate requests and state snapshots.

**Failure behavior / financial boundary:** At most approved capacity reserved; no over-allocation or double fill.

**Proof of completion:** No double reservations or conflicting order IDs. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 078. Withdrawal UI is a high-impact attack surface  
**Priority:** `LOCKED` · **Requested improvement:** Independent security review with simulated malicious transactions.

**What the user sees / how it operates:** Threat-model hypothetical payout flows; test IDOR, replay, CSRF, session theft, beneficiary substitution and MFA bypass before service exists.

**Existing code touchpoints or proposed location:** `server/src/wallet/wallet.ts, server/src/security/security.ts, independent external audit`.

**Data / API / storage contract:** Separate security certification evidence, not just UI tests.

**Failure behavior / financial boundary:** Any unresolved critical path keeps withdrawal submission locked.

**Proof of completion:** Privilege escalation and arbitrary withdrawal tests fail safely. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 079. Users may experience slowness despite good API timing  
**Priority:** `P2` · **Requested improvement:** Collect privacy-preserving web vitals and frontend performance traces.

**What the user sees / how it operates:** Profile startup, chart pan/zoom and list filtering; measure LCP, INP, CLS, rerenders and subscriptions on representative hardware.

**Existing code touchpoints or proposed location:** `web/src/App.tsx, web/src/pages/Markets.tsx, e2e/`.

**Data / API / storage contract:** Performance evidence {scenario,device,metric,p50,p95,commit}; avoid invented benchmark claims.

**Failure behavior / financial boundary:** Performance change rejected if it delays critical alerts or corrupts data.

**Proof of completion:** p95 page interaction and chart update targets are measured. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 080. A green build may hide untested release gates  
**Priority:** `P0` · **Requested improvement:** Create evidence-based certification dashboard with pass/fail/untested.

**What the user sees / how it operates:** Display each release gate with PASS/FAIL/PENDING/UNTESTED and exact evidence links; permit independent reviewer sign-off only where required.

**Existing code touchpoints or proposed location:** `server/src/qa/gates.ts, web/src/pages/Account.tsx`.

**Data / API / storage contract:** GateRecord {id,status,evidenceUri,reviewer,updatedAt}; existing gate statuses respected.

**Failure behavior / financial boundary:** Skipped/unrun tests are never PASS; real-money unlock remains prohibited without approvals.

**Proof of completion:** Unrun or skipped tests cannot count as certified. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.

### 81–90. Transparency
#### 081. Trade decisions are scattered across screens  
**Priority:** `P1` · **Requested improvement:** Create one event timeline: source to workers to risk to paper order.

**What the user sees / how it operates:** Join candidate→QCI→decision→risk→paper order→fill→journal by stable references; display one drillable event timeline.

**Existing code touchpoints or proposed location:** `web/src/pages/Overview.tsx, server/src/journal/history.ts`.

**Data / API / storage contract:** TimelineEvent {id,decisionId,orderId,type,at,source,status}; bounded page queries.

**Failure behavior / financial boundary:** Missing link shows explicit unknown instead of guessed attribution.

**Proof of completion:** Each execution links to the originating decision ID. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 082. Headline PnL can hide actual costs  
**Priority:** `P0` · **Requested improvement:** Show gross PnL, realized net, unrealized, and cash flows separately.

**What the user sees / how it operates:** Present gross/net PnL, realized/unrealized, fees and cash movement separately; derive from backend ledger, never client-local arithmetic.

**Existing code touchpoints or proposed location:** `server/src/portfolio/ledger.ts, web/src/pages/Overview.tsx`.

**Data / API / storage contract:** PerformanceSummary {netPnl,realized,unrealized,fees,flows,marksAsOf}.

**Failure behavior / financial boundary:** If position mark is stale/missing, unrealized result becomes flagged not verified.

**Proof of completion:** Summary reconciles with ledger and fee totals. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 083. Fees and spread are not visible as a story  
**Priority:** `P2` · **Requested improvement:** Add cost breakdown charts per strategy and asset.

**What the user sees / how it operates:** Aggregate reconciled fee, spread and impact by strategy, instrument and period with drilldown to each fill.

**Existing code touchpoints or proposed location:** `web/src/pages/Trading.tsx, server/src/journal/history.ts`.

**Data / API / storage contract:** CostBreakdown {strategyId,asset,feeNet,spreadCost,slippageEstimate,period}; estimated fields labeled.

**Failure behavior / financial boundary:** Unknown spread/impact is NULL, not fabricated $0.

**Proof of completion:** Every cost bar traces back to actual fill or labeled estimate. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 084. Simulated and real performance can be confused  
**Priority:** `P0` · **Requested improvement:** Add persistent environment watermark to charts, exports and widgets.

**What the user sees / how it operates:** Attach environment/watermark to every financial view and CSV export; keep origin in payload and export metadata.

**Existing code touchpoints or proposed location:** `web/src/ui.tsx, server/src/journal/history.ts`.

**Data / API / storage contract:** AccountEnvironment PAPER/READ_ONLY/LOCKED; CSV metadata header.

**Failure behavior / financial boundary:** Never let copy/paste screenshot misrepresent paper results as cash gains.

**Proof of completion:** Screenshots and CSVs identify their data environment. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 085. Users cannot audit why a recommendation appeared  
**Priority:** `P1` · **Requested improvement:** Offer timestamped expandable evidence cards and source links.

**What the user sees / how it operates:** For a candidate show structured evidence, time, provider attribution, challenge dissent and policy version behind 'Why?' control.

**Existing code touchpoints or proposed location:** `server/src/decision/engine.ts, web/src/pages/Intel.tsx`.

**Data / API / storage contract:** EvidenceCard {source,asOf,signal,direction,reason,limitations}; preserve immutable reference.

**Failure behavior / financial boundary:** If source missing, explicitly mark inference and display warning.

**Proof of completion:** No displayed claim lacks a source or labeled inference. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 086. Rejected trades can seem like bugs  
**Priority:** `P1` · **Requested improvement:** Show risk veto, data quality and no-trade explanation feed.

**What the user sees / how it operates:** Expose risk veto codes separately from transport errors; render 'Not traded because...' explanation and corrective nonrisk action.

**Existing code touchpoints or proposed location:** `server/src/risk/gate.ts, web/src/pages/Intel.tsx`.

**Data / API / storage contract:** RejectionReason {code,policyVersion,checkedAt,description}; no direct override action.

**Failure behavior / financial boundary:** User cannot click bypass for stale feed or safety rejection.

**Proof of completion:** User can inspect exact reason and policy version. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 087. Strategies can look good due to tiny samples  
**Priority:** `P1` · **Requested improvement:** Create risk-adjusted scorecards with sample-size warnings.

**What the user sees / how it operates:** Generate scorecards using net expectancy after costs, drawdown, trade count, confidence intervals and regime windows.

**Existing code touchpoints or proposed location:** `server/src/lab/lab.ts, web/src/pages/Trading.tsx`.

**Data / API / storage contract:** Scorecard {sampleSize,period,oosReturn,maxDrawdown,costs,qualityFlags}.

**Failure behavior / financial boundary:** Small sample marked insufficient evidence even when headline return is positive.

**Proof of completion:** Small samples never imply proven profitability. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 088. Users cannot judge resilience to market shocks  
**Priority:** `P2` · **Requested improvement:** Build research-only scenario sensitivity views.

**What the user sees / how it operates:** Run isolated scenario assumptions (gap, volatility spike, outage, spread widening) and show distribution of hypothetical account drawdowns.

**Existing code touchpoints or proposed location:** `server/src/lab/backtest.ts, web/src/pages/Trading.tsx`.

**Data / API / storage contract:** ScenarioReport {scenario,seed,assumptions,lossDistribution,limitBreaches}.

**Failure behavior / financial boundary:** Clearly separate simulated stress results from forecasts or actual outcomes.

**Proof of completion:** Assumptions and hypothetical nature are prominent. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 089. Daily activity is difficult to understand  
**Priority:** `P1` · **Requested improvement:** Generate a 24-hour retrospective digest from audited events.

**What the user sees / how it operates:** Create daily retrospective from immutable events and account ledger; include open incidents and missed runs, not fabricated market predictions.

**Existing code touchpoints or proposed location:** `server/src/journal/history.ts, server/src/joe/joe.ts`.

**Data / API / storage contract:** DailyDigest {day,scans,decisions,filledPaperOrders,netPnl,alerts,sourceIds}.

**Failure behavior / financial boundary:** No event records => 'no recorded activity', not an invented brief.

**Proof of completion:** Report separates realized activity from forecasts. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 090. A live card may conceal its data origin  
**Priority:** `P1` · **Requested improvement:** Put provider provenance and last-updated status in details.

**What the user sees / how it operates:** Add source, snapshot age, asOf and reliability status on demand near every chart/price/PnL; hover reveals provenance.

**Existing code touchpoints or proposed location:** `server/src/market/quality.ts, web/src/pages/Markets.tsx`.

**Data / API / storage contract:** DataProvenance {provider,sourceTs,receivedAt,quality,readableReason}.

**Failure behavior / financial boundary:** A stale quote cannot retain visual green LIVE state.

**Proof of completion:** Provider outage visibly changes data confidence state. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.

### 91–100. Product accessibility
#### 091. Initial setup requires expert knowledge  
**Priority:** `P1` · **Requested improvement:** Add a guided OBSERVE-to-PAPER onboarding checklist.

**What the user sees / how it operates:** Add guided owner setup→risk policy→paper allocation→test strategy→observe flow; each step reads authoritative completion state.

**Existing code touchpoints or proposed location:** `web/src/App.tsx, web/src/pages/Account.tsx`.

**Data / API / storage contract:** OnboardingChecklist {step,complete,actionHref,blockedReason}; derived from server state.

**Failure behavior / financial boundary:** No silent activation of paper trades; obtain required owner confirmation.

**Proof of completion:** Novice completes paper setup without reading source code. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 092. Connections require manual technical debugging  
**Priority:** `P1` · **Requested improvement:** Offer read-only guided credential validation and health diagnostics.

**What the user sees / how it operates:** Build 'Test Connection' flow that asks backend to validate read-only provider capability and report scope/error safely.

**Existing code touchpoints or proposed location:** `web/src/pages/Account.tsx, server/src/providers/http.ts`.

**Data / API / storage contract:** ConnectionCheck {provider,status,scopes,checkedAt,reason}; secrets only server-side.

**Failure behavior / financial boundary:** Never echo API keys to UI, logs, analytics or Trader Joe.

**Proof of completion:** No credentials leak into frontend logs or AI prompts. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 093. Different skill levels need different views  
**Priority:** `P1` · **Requested improvement:** Provide Simple / Analyst / Engineer view presets.

**What the user sees / how it operates:** Persist UI-only Simple/Analyst/Engineer density preset; same routes and backend contracts, different ordering/visibility of advanced details.

**Existing code touchpoints or proposed location:** `web/src/App.tsx, web/src/pages/Overview.tsx`.

**Data / API / storage contract:** Preference {viewMode:'simple'|'analyst'|'engineer'} in local storage initially.

**Failure behavior / financial boundary:** Risk notices and account origin remain visible in every mode; no hidden safety control.

**Proof of completion:** Same backend state is shown with selectable detail levels. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 094. International markets use inconsistent clocks  
**Priority:** `P2` · **Requested improvement:** Offer localized timezone and currency display without altering ledger units.

**What the user sees / how it operates:** Format timezone/currency per user preference; retain original UTC event instant and base-currency ledger amounts unchanged.

**Existing code touchpoints or proposed location:** `web/src/api.ts, web/src/ui.tsx`.

**Data / API / storage contract:** Settings {zone,displayCurrency,locale}; conversion rate provenance if supported.

**Failure behavior / financial boundary:** Avoid misleading FX conversions when rate unavailable, and verify DST transitions.

**Proof of completion:** Timestamp tests pass across DST and date boundaries. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 095. Trader Joe is primarily text-first  
**Priority:** `P3` · **Requested improvement:** Add optional read-only voice summaries generated from verified data.

**What the user sees / how it operates:** Offer optional read-only generated briefing with TTS, using the same verified text response and source timestamps.

**Existing code touchpoints or proposed location:** `server/src/joe/joe.ts, web/src/pages/Joe.tsx`.

**Data / API / storage contract:** BriefingAudio {textId,generatedAt,language}; no voice-to-trade authority.

**Failure behavior / financial boundary:** Never let voice transcript trigger order, withdrawal or policy limit changes.

**Proof of completion:** Voice summaries cannot issue trades or change permissions. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 096. Experimenting can contaminate the funded paper account  
**Priority:** `P1` · **Requested improvement:** Create isolated strategy sandbox copies with separate virtual ledgers.

**What the user sees / how it operates:** Clone historical data snapshots into research sandbox with separate namespace and paper-only ledger, so experiments do not affect official paper account.

**Existing code touchpoints or proposed location:** `server/src/lab/lab.ts, server/src/portfolio/ledger.ts`.

**Data / API / storage contract:** SandboxRun {id,datasetHash,strategyVersion,isolatedLedgerId,createdAt}.

**Failure behavior / financial boundary:** Cross-account writes rejected by DB/application guard; sandbox results labeled hypothetical.

**Proof of completion:** Sandbox actions never affect authoritative paper balance. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 097. User data is hard to move between tools  
**Priority:** `P2` · **Requested improvement:** Export standard JSON/CSV evidence bundles with provenance and schema version.

**What the user sees / how it operates:** Export versioned JSON/CSV with event IDs, source timestamps, dataset hash and environment metadata; import validates schema and provenance.

**Existing code touchpoints or proposed location:** `server/src/journal/history.ts, web/src/pages/Account.tsx`.

**Data / API / storage contract:** ExportBundle {schemaVersion,generatedAt,environment,items,checksum}.

**Failure behavior / financial boundary:** Formula-injection guard for CSV; no secrets or live keys in export.

**Proof of completion:** Export-import round trip passes integrity checks. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 098. System diagnostics are hidden from ordinary users  
**Priority:** `P1` · **Requested improvement:** Add a friendly "Why MIA is waiting" operational health explainer.

**What the user sees / how it operates:** Convert health reason codes into plain language: waiting for risk policy, stale data, no candidate, disabled strategy, provider error.

**Existing code touchpoints or proposed location:** `server/src/api/routes.ts, web/src/pages/Overview.tsx`.

**Data / API / storage contract:** OperationalExplainer {state,reasonCodes,actionHref,since,latestEvidence}.

**Failure behavior / financial boundary:** Never mask an emergency as routine waiting, and link only to legitimate corrective action.

**Proof of completion:** User sees cause and required action for each degraded state. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 099. Monitoring from a phone remains limited  
**Priority:** `P2` · **Requested improvement:** Add secure mobile-friendly PWA monitoring, offline read-only cache and alerts.

**What the user sees / how it operates:** Provide secure responsive PWA read-only monitoring with offline cached last-known state distinctly marked and secure push only after owner opt-in.

**Existing code touchpoints or proposed location:** `web/src/App.tsx, web/src/styles.css, PWA scaffolding (new)`.

**Data / API / storage contract:** App manifest, service worker limited to static assets; authenticated API never cached as public data.

**Failure behavior / financial boundary:** Offline must show LAST KNOWN with timestamp; emergency operations cannot be silently queued offline.

**Proof of completion:** Mobile remains useful without granting unsafe browser trading authority. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.
#### 100. No single proof that autopilot is ready unattended  
**Priority:** `P0` · **Requested improvement:** Create owner-reviewed Autopilot Readiness checklist and signed evidence packet.

**What the user sees / how it operates:** Combine host uptime, replay/regression, risk, data freshness, ledger integrity, security, backup restore and owner sign-off into readiness checklist with auditable evidence.

**Existing code touchpoints or proposed location:** `server/src/qa/gates.ts, web/src/pages/Account.tsx`.

**Data / API / storage contract:** AutopilotCertification {version,gitSha,checks,reviewer,status,evidenceIds,issuedAt}.

**Failure behavior / financial boundary:** One untested safety-critical item => not certified; do not flip BOUNDED_LIVE automatically.

**Proof of completion:** Unmet safety, uptime or data gates keep real execution locked. Confirm with executable test evidence and a reviewed diff; do not infer completion from the existence of a file.

## F. Worked code translation examples (illustrative, not verified repository patches)

### Example F1. Six-section navigation without deleting routes

The selected branch's `web/src/App.tsx` currently has grouped route lists. Keep every underlying `<Route>` but change visible menu groups. The typed object below is a **proposed config**, not an instruction to replace every route.

```tsx
// web/src/navigation.ts (new)
export const sections = [
  { id: 'home',       label: 'Home',            paths: ['/', '/notifications'] },
  { id: 'markets',    label: 'Markets',         paths: ['/terminal', '/scanner', '/discover', '/bubbles', '/whales', '/copy', '/holders', '/news'] },
  { id: 'autopilot',  label: 'Autopilot',       paths: ['/bot', '/risk', '/lab'] },
  { id: 'portfolio',  label: 'Portfolio',       paths: ['/portfolio', '/history', '/journal', '/calendar', '/wallet'] },
  { id: 'intelligence', label: 'AI Intelligence', paths: ['/intelligence', '/ditas', '/academy', '/qhef', '/joe'] },
  { id: 'settings',   label: 'Settings & Security', paths: ['/settings', '/connections', '/security', '/qa'] },
] as const;
```

**Important:** `/ditas` and `/academy` are present on the inspected PR #7 branch, not guaranteed on `main`; preserve original routes and only render links for actually available screens. Current status/emergency messages must remain global, not be hidden inside tabs.

### Example F2. A read-only status ribbon using existing data

```tsx
import { useApi } from '../api';

export function AutopilotStatusRibbon() {
  const { data, error, loading } = useApi('/api/shell', {
    topics: ['mode', 'bot', 'risk', 'position', 'health'], every: 15000,
  });
  if (loading && !data) return <div role="status">Checking MIA…</div>;
  if (!data) return <div role="alert">Status unavailable: {error ?? 'No response'}</div>;
  const stale = data.dataHealth?.stale;
  const blocked = data.control?.emergency || !data.policyAccepted || stale;
  return (
    <section aria-label="Autopilot status">
      <strong>{data.control?.emergency ? 'EMERGENCY' : data.display}</strong>
      <span>{stale ? 'Market data stale' : 'Market feed current'}</span>
      <span>{blocked ? 'New entries unavailable' : 'Risk state: see Risk Center'}</span>
      <span>Feeds: {data.dataHealth?.live ?? 'unknown'}</span>
    </section>
  );
}
```

This is a **UI example** consuming the existing `GET /api/shell` route; it does not change execution mode. The `blocked` variable is an explanatory UI summary, **not the backend risk gate**. Use exact inferred server fields only after verifying branch types.

### Example F3. Floating cockpit in supported browsers

```ts
// Triggered ONLY directly by a user clicking "Float monitor".
// Actual React integration must handle style copying, component lifecycle and cleanup.
type PipCapableWindow = Window & {
  documentPictureInPicture?: { requestWindow: (options: {width:number;height:number}) => Promise<Window> }
};

export async function openReadOnlyMiniWindow(content: HTMLElement) {
  const pip = (window as PipCapableWindow).documentPictureInPicture;
  if (!pip) return { supported: false as const }; // Show in-app fallback.
  const win = await pip.requestWindow({ width: 360, height: 280 });
  const placeholder = document.createComment('mini-widget position');
  content.before(placeholder);
  win.document.body.append(content);
  const restore = () => { placeholder.replaceWith(content); };
  win.addEventListener('pagehide', restore, { once: true });
  return { supported: true as const, close: () => win.close() };
}
```

This is not a promise that the PiP survives tab closure. Browser support is limited and user activation/secure context is required. A Tauri desktop process is a **separate, later** implementation with explicit native permissions.

### Example F4. Durable independent backend loop (pseudocode, not drop-in patch)

```ts
// server/src/bot/supervisor.ts (proposed)
// Do not create a second decision/risk/OMS authority.
async function supervisedPaperTick() {
  const lease = await acquireSingletonLeaseAtomically('paper-loop');
  if (!lease) return; // Another process owns scheduling.
  try {
    const snapshot = await getVerifiedMarketSnapshot();
    if (!snapshot.ok) return recordBlocked('STALE_MARKET_DATA');
    const candidates = await runExistingScannerAndQCI(snapshot);
    for (const candidate of candidates) {
      const decision = await runExistingDecisionEngine(candidate);
      const risk = await runExistingRiskGate(decision);
      if (!risk.allowed) continue;
      const intent = await persistUniquePaperIntent(decision, risk);
      await existingPaperOMSReconcileThenExecute(intent);
    }
  } finally {
    await releaseLeaseIfCurrent(lease);
  }
}
```

Names such as `acquireSingletonLeaseAtomically` in this pseudocode are **design intentions, not repository exports**. Translate them to actual existing engine interfaces and SQLite transactional APIs. Avoid running even PAPER orders in the real user's data during integration tests; use an isolated test DB.

### Example F5. Critical test: a closed browser must not stop the bot

```ts
// Playwright verifies UI behavior; a separate server-side integration/soak test
// must monitor the running paper loop after all browser clients disconnect.
test('closing dashboard does not stop the headless PAPER service', async ({ browser, request }) => {
  const page = await browser.newPage();
  await page.goto('http://localhost:8787/');
  await page.close();
  const response = await request.get('http://localhost:8787/api/health');
  expect(response.ok()).toBeTruthy();
  // NOT SUFFICIENT: also assert server-side scan and position-monitor counters advance,
  // after authenticated test setup and a deterministic test-market event.
});
```

**Critical distinction:** An HTTP 200 health response after closing the browser does NOT prove the bot is still scanning. Add scheduler heartbeat and processed-event assertions in a separate test; avoid using `request.get('/api/health')` as the sole operational proof.

## G. Phase order and engineering release gates

| Phase | High-value deliverable | Minimum proof |
|---|---|---|
| 0 | Branch + technical baseline | SHA, code inventory, unit/browser baseline, risk gating confirmed |
| 1A | Compact MIA cockpit + universal Trader Joe | Desktop/mobile keyboard + all old routes work, zero lost emergency notices |
| 1B | PAPER-only always-on service | All tabs closed, 24h soak, scan counters + risk monitoring advance, crash recovered |
| 2 | PiP mini cockpit | User-activated supported browser, fallback, stale visibility and read-only scope |
| 3 | Market-data correctness + speed | Source sequence validation, backpressure, measured p95 improvements |
| 4 | Paper OMS recovery + trading intelligence | No duplicate fills, risk veto intact, accurate cost accounting |
| 5 | Read-only real balances | Provider-permission verification; paper and real accounts strictly separate |
| 6 | Future live/withdrawal feasibility review | Independent external security, regulatory/provider requirements, separate authorization; no unlock implied |

**Start with one user-visible vertical slice, not 100 concurrent code branches.** A practical first PR is a compact navigation + global Trader Joe drawer that preserves every existing route and surfaces READ-ONLY/PAPER/risk state consistently; an independent reliability branch can address the headless service after the branch integration baseline is agreed.

## H. Source boundaries and external references

- User-supplied 100 upgrade plan (the 100 problem/solution/acceptance rows above)
- Existing repository examined through GitHub connector: `main` and `claude/blissful-planck-lazglg` branches; PR #7 open, PR #8 stacked/draft at time of review. Branch status can change.
- [Document Picture-in-Picture API — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Document_Picture-in-Picture_API): limited support; user activation, secure context, opener lifetime.
- [Tauri v2 window API](https://v2.tauri.app/reference/javascript/api/namespacewindow/): `setAlwaysOnTop` requires explicit permission.
- [Fastify routing and schema](https://fastify.dev/docs/latest/Reference/Routes/): schema-based validation and route lifecycle.
- [Core Web Vitals — Google](https://developers.google.com/search/docs/appearance/core-web-vitals): LCP, INP, CLS measured performance.

**Completion rule:** A contract, mock, screenshot, or code generation output is not evidence that MIA has a working, certified, autonomous financial system. Live execution and payouts remain locked without separate approval and verified release gates.
