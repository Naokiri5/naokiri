# Autopilot tickets 001–035: baseline assessment and reuse contracts

Baseline inspected: integrated PR #7 commit `b624b52d7dc0bc87310e92193e8da276286b8976`; `main` remains `d7c6b0b725682d1fff6fc3bb96b925d23984d97e`. PR #8 (`7ca3328`) is already cherry-picked into PR #7. These statuses describe that pinned baseline **before** the selected monitor/density implementation. The coordinator's milestone report is the source for later runtime results.

All detailed user objectives and functional requirements remain in the original uploaded 100-feature blueprint; this inventory adds evidence and a nonduplicating implementation delta, rather than replacing or silently shortening that source. Every numbered entry below has been read in full. Tests named below are existing definitions inspected by this auditor; they are not claimed executed here. No uptime, hosting, provider or financial certification is inferred from a source file or test name.

`PARTIAL` means a similar service exists but does not satisfy every acceptance condition. `IN_PR_ONLY` means the central requested capability is in unmerged integrated PR #7; it does not prove production readiness. `BLOCKED` identifies external authorization/infrastructure. Missing features are not fabricated with new placeholder services. Notably, six-section navigation and a universal Trader Joe drawer **already exist** and must be preserved.

## 001. No single-glance autopilot status

- **Baseline status:** `PARTIAL`.
- **Existing behavior / evidence:** App.tsx Shell already reads authenticated /api/shell and renders mode, feed/risk badges and emergency banners; nav.ts/Navigation.tsx already implement the exact six groups on PR #7.
- **Frontend/backend ownership and smallest delta:** Reuse Shell; add only missing engine/scanner freshness presentation, not another status service or duplicate ribbon.
- **Data/API/persistence contract:** Existing /api/shell {mode,display,control,bot,account,dataHealth,policyAccepted}; no DB/API addition needed for this slice.
- **Security/failure/recovery boundary:** Unknown/null state must not become a green badge; mode and warnings stay visible in every density.
- **Proof required / tests:** e2e/navigation.spec.ts and dashboard.test.ts define existing contracts; add missing-field/stale/status navigation browser assertions.

## 002. Dense overview hides critical details

- **Baseline status:** `PARTIAL`.
- **Existing behavior / evidence:** Overview.tsx has authoritative account, market, risk, activity, briefing and provider sections on PR #7, but no saved Simple/Analyst/Engineer density.
- **Frontend/backend ownership and smallest delta:** Selected milestone: reuse Overview and its existing /api/overview request; group optional detail behind accessible disclosures.
- **Data/API/persistence contract:** UI-only viewMode local preference; existing server snapshot unchanged.
- **Security/failure/recovery boundary:** Emergency, protection incidents, policy, account origin and stale-data notices must never hide inside collapsed advanced content.
- **Proof required / tests:** Add desktop/mobile keyboard density tests, preference reload and same-account-value comparisons; baseline source alone is not completion.

## 003. No floating PnL during other work

- **Baseline status:** `MISSING`.
- **Existing behavior / evidence:** No Document Picture-in-Picture or MiniCockpit implementation found on pinned PR #7; existing Shell/API/SSE and fmt are reuse points.
- **Frontend/backend ownership and smallest delta:** Selected milestone: one read-only monitor component and user-click launcher using existing authenticated data; do not clone the account ledger.
- **Data/API/persistence contract:** Existing /api/shell and, if chart enabled, existing instrument route; capability detection and local component state, no trade route.
- **Security/failure/recovery boundary:** User activation/secure context; fallback in-page; opener closing also ends browser PiP; stale/unknown state explicit.
- **Proof required / tests:** Browser tests for launcher, unsupported/failure fallback, actual supported PiP where available, stale/error display and no mutation calls.

## 004. Browser PiP cannot survive a closed tab

- **Baseline status:** `BLOCKED`.
- **Existing behavior / evidence:** No apps/desktop or Tauri runtime exists; web PiP cannot satisfy independent desktop lifetime.
- **Frontend/backend ownership and smallest delta:** Separate owner-approved desktop milestone only; reuse monitor DTO/view, not a native signer.
- **Data/API/persistence contract:** Proposed scoped native-window permissions and existing HTTPS/session; no migration now.
- **Security/failure/recovery boundary:** Native installation/signing/host choice need approval; no wallet/withdrawal scope.
- **Proof required / tests:** NOT RUN: real desktop always-on-top/opener-close/process lifecycle tests required.

## 005. Floating chart can overwhelm a small window

- **Baseline status:** `MISSING`.
- **Existing behavior / evidence:** No floating monitor presets exist at baseline; Markets.tsx owns the current chart.
- **Frontend/backend ownership and smallest delta:** Extend the one selected monitor only when implementing presets; do not start one provider stream per preset.
- **Data/API/persistence contract:** UI preset union PNL_ONLY|SPARKLINE|MINI_CANDLES with symbol/timeframe; existing candle API and one SSE service.
- **Security/failure/recovery boundary:** Missing data -> unavailable chart, not manufactured points; switching preset has no financial authority.
- **Proof required / tests:** Assert preset changes preserve subscription count, true data values, null states and responsive legibility.

## 006. A widget could show old numbers as current

- **Baseline status:** `PARTIAL`.
- **Existing behavior / evidence:** api.ts exposes streamState.connected/lastEventAt; /api/shell has ticker/scan timestamps and stale flag. Those are not yet a widget freshness lifecycle.
- **Frontend/backend ownership and smallest delta:** Selected monitor slice must consume existing timestamps and distinguish loading, stale, disconnected and recent server response.
- **Data/API/persistence contract:** Reuse streamState + server timestamps; UI timer checks age, no artificial trade heartbeat or new provider subscription.
- **Security/failure/recovery boundary:** Socket-open alone is not proof of fresh data; display LAST KNOWN/UNKNOWN instead of presenting cached balances as live.
- **Proof required / tests:** Fake clock/browser offline and failed polling tests; assert stale warning even when SSE socket is technically open.

## 007. Sensitive balances may appear during screen sharing

- **Baseline status:** `MISSING`.
- **Existing behavior / evidence:** No cross-screen monetary privacy-mask preference found in App/Overview/API formatting.
- **Frontend/backend ownership and smallest delta:** One shared UI preference would feed existing financial views and monitor; do not mutate account state or duplicate formatter semantics.
- **Data/API/persistence contract:** Optional local privacyMask boolean; no server persistence or amount telemetry required.
- **Security/failure/recovery boundary:** Mask text, tooltips and accessible names consistently; masking is privacy presentation, not authorization.
- **Proof required / tests:** Screen-share/accessibility-tree tests across home/monitor/chart/preview; no raw amount leaks in visible names.

## 008. Users can confuse simulation profits with cash

- **Baseline status:** `PARTIAL`.
- **Existing behavior / evidence:** App.tsx permanently shows operating mode and a PAPER banner outside OBSERVE; Overview calls account paper, DITAS labels actual PAPER vs HYPOTHETICAL.
- **Frontend/backend ownership and smallest delta:** Reuse existing labels; make new monitor carry explicit PAPER account origin and LIVE LOCKED rather than creating a second mode authority.
- **Data/API/persistence contract:** Server /api/shell mode + authoritative account; account-origin label must describe existing paper-only adapter.
- **Security/failure/recovery boundary:** Missing source/mode -> UNKNOWN; green PnL never means real cash or available withdrawal.
- **Proof required / tests:** Existing API/live-lock tests plus screenshot assertions for all presentation modes/monitor; CSV origin label consistency remains to verify.

## 009. Moving between mini chart and full terminal is clumsy

- **Baseline status:** `PARTIAL`.
- **Existing behavior / evidence:** Existing /terminal/:symbol routes, global Search and Markets links already deep-link instruments; floating asset tile does not yet exist.
- **Frontend/backend ownership and smallest delta:** Reuse terminal routing from the single monitor; assess interval URL support before promising preserved timeframe.
- **Data/API/persistence contract:** URL-encoded validated symbol and supported interval union15m|1h|4h; no new execution API.
- **Security/failure/recovery boundary:** Unknown symbol gives unavailable/error state; never silently switch instrument.
- **Proof required / tests:** Click monitor tile and assert exact terminal symbol/timeframe; test malformed/unknown asset.

## 010. Too many equal-looking alerts distract users

- **Baseline status:** `PARTIAL`.
- **Existing behavior / evidence:** notify.ts persists INFO/WARNING/CRITICAL; CRITICAL bypasses quiet hours. Overview shows protection incidents and critical alerts; notifications are existing service.
- **Frontend/backend ownership and smallest delta:** Reuse notification list and incident IDs; add only missing severity grouping/sticky-context UI and deduplication behavior.
- **Data/API/persistence contract:** Existing notifications table/API/SSE; normalize names rather than invent HIGH separate from WARNING without a contract.
- **Security/failure/recovery boundary:** Muting info must not hide active protection/emergency incidents; failed delivery remains visible.
- **Proof required / tests:** incidents.test.ts defines dedup/restart behavior; add persistent critical-over-info rendering and mutation-isolation browser cases.

## 011. MIA currently depends on a local/cloud session

- **Baseline status:** `BLOCKED`.
- **Existing behavior / evidence:** main.ts/run.mjs already launch a standalone server and docs describe deployment, but no approved host/deployment uptime evidence is present.
- **Frontend/backend ownership and smallest delta:** Choose approved always-on host/TLS/persistent volume/process supervisor later; retain existing compiled startup.
- **Data/API/persistence contract:** Deployment manifest plus env/runtime storage; existing /api/health is liveness, not full readiness.
- **Security/failure/recovery boundary:** A workspace/cloud session and a successful build do not prove24/7 hosting; no live authority introduced.
- **Proof required / tests:** UNKNOWN/NOT RUN: actual host outage, owner-laptop shutdown and independent uptime evidence.

## 012. Browser closure could be confused with bot shutdown

- **Baseline status:** `PARTIAL`.
- **Existing behavior / evidence:** main.ts calls startBot after listen; bot.ts owns polling timers independently of browser/SSE. App only subscribes; config.offline intentionally prevents market polling.
- **Frontend/backend ownership and smallest delta:** Keep single engine; add measured scheduler/monitor counters and browser-closed server integration proof, not a second frontend-owned loop.
- **Data/API/persistence contract:** Reuse startBot/stopBot and botStatus state; durable heartbeat optional only after audited design.
- **Security/failure/recovery boundary:** Closing tabs must only close viewers; host process shutdown still stops engine.
- **Proof required / tests:** Source architecture verified;24h all-clients-closed paper soak NOT RUN. Health200 alone insufficient.

## 013. An unhandled crash may leave the bot offline

- **Baseline status:** `MISSING`.
- **Existing behavior / evidence:** run.mjs starts a child process; main SIGINT/SIGTERM hooks stop timers/close app. No systemd/container supervised restart/backoff configuration found.
- **Frontend/backend ownership and smallest delta:** Add one approved host supervisor and startup reconciliation/readiness policy, not an in-app parallel bot.
- **Data/API/persistence contract:** Process exit codes/restart metadata; new durable record only if diagnostic requirement warrants it.
- **Security/failure/recovery boundary:** Crash loops must remain nonready, bounded and alerted before new intents; do not automatically escalate permissions.
- **Proof required / tests:** Forced crash/restart with isolated paper state and repeated failure/backoff tests; no observed external supervision yet.

## 014. Multiple replicas could submit duplicate jobs

- **Baseline status:** `MISSING`.
- **Existing behavior / evidence:** bot.ts guards overlapping lanes with process-local booleans, but has no DB lease/fencing across two Node processes.
- **Frontend/backend ownership and smallest delta:** Enforce single deployment instance now; add leader lease only when a multi-replica topology is intentionally supported.
- **Data/API/persistence contract:** Proposed transactional singleton lease holder/fence/expiry; append migration only if needed.
- **Security/failure/recovery boundary:** Unique order IDs alone are not a scheduler leader; stale holder must not resume with old fence.
- **Proof required / tests:** Two processes against isolated DB, lease expiry/clock/restart races and exactly one active scheduler; NOT RUN.

## 015. Restart could lose in-memory job progress

- **Baseline status:** `PARTIAL`.
- **Existing behavior / evidence:** OMS orders/fills/positions/ledger and DITAS decisions are durable; bot lane progress/counters are in-memory and there is no generic checkpoint table.
- **Frontend/backend ownership and smallest delta:** Reuse durable orders/decisions for reconciliation; add only missing long-task checkpoints after defining restart semantics.
- **Data/API/persistence contract:** Existing tables first; proposed job checkpoint includes id,version,stage,inputRef,updatedAt only for real scheduled tasks.
- **Security/failure/recovery boundary:** Restart must not replay a committed fill or skip position monitoring; do not create a competing ledger.
- **Proof required / tests:** Disk reopen, injected stage failure and process restart midway through a paper intent; current memory tests do not certify full scheduler recovery.

## 016. An interrupted request could be executed twice

- **Baseline status:** `PARTIAL`.
- **Existing behavior / evidence:** OMS uses entry-candidate client IDs with UNIQUE orders.client_order_id and existing-order checks; paper financial writes are transactional; oms.test.ts covers duplicate submit.
- **Frontend/backend ownership and smallest delta:** Reuse OMS intent identity and reconciliation; implement only missing ambiguous UNKNOWN/process-crash handling if a real asynchronous venue is added.
- **Data/API/persistence contract:** Existing orders/fills/positions/ledger transaction; no second intent table merely because blueprint proposes one.
- **Security/failure/recovery boundary:** Real venue unknown-status reconciliation is not implemented/authorized; never retry non-idempotent financial work blindly.
- **Proof required / tests:** Current duplicate logical submit fixture exists; crash-after-commit/reopen and two-process retry proof still needed.

## 017. Downtime may go unnoticed overnight

- **Baseline status:** `BLOCKED`.
- **Existing behavior / evidence:** notify.ts delivers in-app and optional Telegram alerts, but both depend on the same live process; no independent uptime checker configured.
- **Frontend/backend ownership and smallest delta:** External monitor must test both liveness and scheduler/readiness, then deliver owner-authorized alerts.
- **Data/API/persistence contract:** External uptime incident endpoint contract; no public balance/account leakage.
- **Security/failure/recovery boundary:** A stopped process cannot emit its own outage alert; third-party monitor/channel setup needs owner credentials/approval.
- **Proof required / tests:** Force host/loop outage and confirm external alert/rate limiting/recovery; NOT RUN.

## 018. SQLite backups are not automated

- **Baseline status:** `MISSING`.
- **Existing behavior / evidence:** DEPLOYMENT_GUIDE documents manual sqlite .backup and evidence.key backup, but no automated backup manifest/retention/encryption/restore drill exists.
- **Frontend/backend ownership and smallest delta:** Use consistent SQLite backup API/tooling and preserve DB plus signing evidence key; do not copy live WAL files naively.
- **Data/API/persistence contract:** Proposed backup manifest createdAt/schema/hash/keyRef/restoreTestedAt; no secrets committed.
- **Security/failure/recovery boundary:** Restore test uses a separate temporary destination and never replaces owner DB; encryption key storage external.
- **Proof required / tests:** Run isolated backup/restore and verify ledger, audit, schema and evidence key continuity; NOT RUN.

## 019. A deployment can interrupt position monitoring

- **Baseline status:** `PARTIAL`.
- **Existing behavior / evidence:** main.ts handles SIGINT/SIGTERM with stopBot then app.close, but stopBot only clears future timers and does not drain active async lane promises.
- **Frontend/backend ownership and smallest delta:** Extend existing lifecycle with explicit drain/readiness; choose host handover policy before adding replicas.
- **Data/API/persistence contract:** Existing main/bot interfaces; compatibility record/backup before schema rollback.
- **Security/failure/recovery boundary:** Never launch replacement while old leader can submit; maintain position monitoring or mark incident during handover.
- **Proof required / tests:** Restart with open paper position and in-flight lane, inject exit failure, assert no duplicate fill; full deployment drill NOT RUN.

## 020. Fresh startup may appear ready before market feeds arrive

- **Baseline status:** `MISSING`.
- **Existing behavior / evidence:** /api/health returns ok/version/schema/setup/offline; /api/shell/overview expose detailed runtime state but no separate readiness endpoint or consolidated readiness contract.
- **Frontend/backend ownership and smallest delta:** Derive readiness from existing DB/provider/policy/bot state; do not redefine liveness as safe-to-trade.
- **Data/API/persistence contract:** If needed authenticated GET /api/ready with checks/checkedAt; current risk gate still independently vetoes.
- **Security/failure/recovery boundary:** Unknown/stale/missing critical dependency => readyfalse; do not allow status UI to authorize trading.
- **Proof required / tests:** Startup unfunded/no-policy/stale feeds/inactive loop/error/recovery tests; no current readiness route to verify.

## 021. Polling can miss rapid market changes

- **Baseline status:** `BLOCKED`.
- **Existing behavior / evidence:** Current provider/fabric implementation uses REST polling and browser SSE; there is no exchange WebSocket client or sequence-resynchronization state.
- **Frontend/backend ownership and smallest delta:** Add licensed/approved stream adapter only after provider access requirements; reuse market store and deterministic quality gate.
- **Data/API/persistence contract:** Market envelope sourceTs/receiveTs/sequence; snapshot+delta reconciliation and bounded queues.
- **Security/failure/recovery boundary:** REST fallback cannot relabel inconsistent book as current; reconnect must resync sequence before execution.
- **Proof required / tests:** Network-drop/out-of-order/gap/snapshot-resync tests; no actual WebSocket reconnection proof now.

## 022. Provider bursts may trigger throttling

- **Baseline status:** `PARTIAL`.
- **Existing behavior / evidence:** providers/http.ts has per-provider token bucket, timeout, health and latency; no jittered429 Retry-After backoff or shared max-concurrency queue.
- **Frontend/backend ownership and smallest delta:** Extend existing fetchProvider rather than add another HTTP client or automatic execution retry layer.
- **Data/API/persistence contract:** Budget/concurrency/retryAt diagnostics may extend existing ProviderInfo; no DB table unless durable scheduling needed.
- **Security/failure/recovery boundary:** Retries only idempotent reads; execution ambiguity requires reconciliation, never generic retrier.
- **Proof required / tests:** Simulated429/Retry-After/provider bursts with deterministic clock; show bounded concurrency and no duplicate order submission.

## 023. Timestamp skew can invalidate trade decisions

- **Baseline status:** `PARTIAL`.
- **Existing behavior / evidence:** quality.ts validates source/receipt clocks, future quotes/books and stale data; raw/cached candle tests use controlled timestamps; local latency uses performance.now.
- **Frontend/backend ownership and smallest delta:** Keep canonical quality checks; add explicit host-clock/NTP offset diagnostics only if supported.
- **Data/API/persistence contract:** Existing DataQuality/source timestamps; no verified provider clock-offset tracker is present.
- **Security/failure/recovery boundary:** Future local book timestamps invalid; unknown clock health must not be claimed synchronized.
- **Proof required / tests:** quality/repair/hardening tests define clock adversaries; external host synchronization and drift alarms UNKNOWN.

## 024. Missing or out-of-order candles can distort indicators

- **Baseline status:** `PARTIAL`.
- **Existing behavior / evidence:** fabric.ts validates raw gaps/duplicates/order and now explicitly rebuilds from>=300 validated contiguous newer bars after a long outage; this PR7 change must not be duplicated.
- **Frontend/backend ownership and smallest delta:** Reuse ingestCandleBatch/FeatureEngine; add trusted historical backfill/provenance only where full gap reconstruction is required.
- **Data/API/persistence contract:** Existing integrityIssues per interval, health events and cached candles; durable source provenance remains incomplete.
- **Security/failure/recovery boundary:** No fabricated candles; forming data not admitted as closed; invalid history keeps gatefailed.
- **Proof required / tests:** quality.test.ts includes recovery/rebuild checks; exact historical gap-source and point-in-time provenance acceptance remains partial.

## 025. Large market snapshots can stall Node's event loop

- **Baseline status:** `PARTIAL`.
- **Existing behavior / evidence:** QHEF records event-loop/stage latency; fabric parallelizes independent feeds; no dedicated heavy-parse worker thread implemented.
- **Frontend/backend ownership and smallest delta:** Benchmark hot-stage payloads first; optimize only demonstrated bottleneck via bounded chunking/thread, preserving output parity.
- **Data/API/persistence contract:** Existing /api/qhef and latency histograms; benchmark commit/workload/hardware records.
- **Security/failure/recovery boundary:** Critical alert/execution paths cannot starve behind research/parsing; terminate overload safely.
- **Proof required / tests:** Before/after representative p95/CPU/memory and numeric parity; no proven lower p95 from offloading today.

## 026. Redundant subscriptions waste bandwidth

- **Baseline status:** `PARTIAL`.
- **Existing behavior / evidence:** MarketStore shares provider snapshots and api.ts maintains one EventSource; separate useApi consumers still have independent refetch/poll calls and no in-flight-key cache.
- **Frontend/backend ownership and smallest delta:** Add canonical request-coalescing only if selected metrics demonstrate duplicatework; reuse shared api.ts rather than clone request hooks.
- **Data/API/persistence contract:** Request key provider/symbol/timeframe/version and bounded TTL; no new provider authority.
- **Security/failure/recovery boundary:** Do not cache auth failures or obsolete values as fresh; invalidate on input/version changes.
- **Proof required / tests:** Two consumers -> one actual in-flight request, then expiry/reconnect/update still fresh; current implementation lacks that test.

## 027. Recomputing full histories wastes CPU

- **Baseline status:** `PARTIAL`.
- **Existing behavior / evidence:** FeatureEngine incrementally updates each newer closed candle and retains bounded history; features.test.ts compares batch and incremental ingestion.
- **Frontend/backend ownership and smallest delta:** Reuse canonical engine; explicit algorithmVersion/inputHash and historical-correction invalidation are additions, not another featurecalculator.
- **Data/API/persistence contract:** Existing FeatureSnapshot/t/lastT; proposed version/hash metadata only after required design.
- **Security/failure/recovery boundary:** Validated repair/rebuild may replace engine after gap; no future values enter earlier predictions.
- **Proof required / tests:** Batch-vs-incremental/gap/replay/parameter-version parity; existing fixture definitions present, this auditor has not executed them.

## 028. Rapid SSE events may trigger wasteful React rerenders

- **Baseline status:** `PARTIAL`.
- **Existing behavior / evidence:** api.ts debounces subscribed SSE events600ms; chart lifecycle is separate effects. No general virtualized table/memoization profiling proof.
- **Frontend/backend ownership and smallest delta:** Extend existing hooks/components with cleanup and measured batching; do not duplicate SSE connection per view.
- **Data/API/persistence contract:** Existing topics/every/useStream interface; lightweight typed view models as needed.
- **Security/failure/recovery boundary:** Risk/emergency notification latency must remain bounded while charts background; last-known state explicit.
- **Proof required / tests:** Render profiler before/after burst updates, unmount/timer cleanup, critical-event visibility and request counts.

## 029. Speed claims lack consistent evidence

- **Baseline status:** `PARTIAL`.
- **Existing behavior / evidence:** core/latency.ts and QHEF expose p50/p95/p99 and budget views; baseline chart benchmark exists, but no general representative workload regression artifact gate per commit.
- **Frontend/backend ownership and smallest delta:** Reuse existing histogram/report service; add deterministic benchmark harnesses where feature changes warrant it.
- **Data/API/persistence contract:** Artifact commit/hardware/workload/percentiles, explicit noise thresholds; no invented global p95 target.
- **Security/failure/recovery boundary:** Fast wrong data is not improvement; keep correctness tests and data gates independent from speed.
- **Proof required / tests:** Repeat seeded workload baselines and significant-regression comparison; CI artifact exists only for tests currently.

## 030. Failover can silently mix inconsistent prices

- **Baseline status:** `PARTIAL`.
- **Existing behavior / evidence:** quality.ts uses valid fresh primary/cross venue sources and deviation warning/fail thresholds; invalid sources do not count as independent.
- **Frontend/backend ownership and smallest delta:** Reuse cross-source reconciliation; trust-tier configuration and full per-source age envelope remain gaps.
- **Data/API/persistence contract:** Existing DataQuality {sources,independentSources,maxDeviationPct,issues}; add provenance fields only with source semantics.
- **Security/failure/recovery boundary:** Different currencies/venues are not identical markets; no alternate endpoint treated verified merely because reachable.
- **Proof required / tests:** Known conflicting/stale/nonfinite source fixtures and failover identity tests; licensed source qualification remains external.

## 031. No-trade decisions are less visible than entries

- **Baseline status:** `PARTIAL`.
- **Existing behavior / evidence:** DecisionReport includes WAIT/REJECT/MONITOR and supporting/opposing/missing evidence; scanner board, DITAS events and rejected tab exist.
- **Frontend/backend ownership and smallest delta:** Extend these views with stable reason/expiry codes as needed; do not create a second decision-memory store or recommend trades to fill empty state.
- **Data/API/persistence contract:** Existing decisions/ditas_events and report consensus expiry; normalized reason code board may adapt existing response.
- **Security/failure/recovery boundary:** Stale explanations remain timestamped and not actionable; rejected opportunities as visible as accepted proposals.
- **Proof required / tests:** Existing API/DITAS/decision tests plus UI empty/no-signal/rejected/expired evidence fixtures; one-click rejection navigation still to verify.

## 032. Strategies may operate outside tested regimes

- **Baseline status:** `PARTIAL`.
- **Existing behavior / evidence:** lab/strategies.ts defines version/regime suitability; scanner checks regimes, current-version OOS filtering and DITAS passports exist; owner controls promotion.
- **Frontend/backend ownership and smallest delta:** Reuse passports and strategy registry; add validatedBy/validFrom/expiry/instrument constraints only if supported by independent validation records.
- **Data/API/persistence contract:** Existing strategies/backtests/decisions, suitableRegimes and version.
- **Security/failure/recovery boundary:** Never treat weak OOS record as approval or silently promote; risk remains final veto.
- **Proof required / tests:** ditas-market/lab/risk tests define version filters/promotion; expiry and independent regime validation not complete.

## 033. Conflicting worker signals may look like consensus

- **Baseline status:** `PARTIAL`.
- **Existing behavior / evidence:** QCI already uses signed/schema-validated, candidate-scoped, dependency-capped packets, mandatory domain/quorum rules and challengePanel; UI exposes disagreement.
- **Frontend/backend ownership and smallest delta:** Reuse coordinator/challengers; independently verify constant-rule contribution policy and evidence persistence before claiming fully independent AI consensus.
- **Data/API/persistence contract:** Existing ConsensusRecord support/opposition/abstain/domains/veto/expiry; no parallel vote engine.
- **Security/failure/recovery boundary:** Any safety veto or missing mandatory evidence wins; current roles are deterministic evaluators, not100independent LLMs.
- **Proof required / tests:** qci.test.ts defines signature/replay/quorum/veto tests; do not interpret passing packet tests as calibrated predictive performance.

## 034. Confidence numbers lack outcome calibration

- **Baseline status:** `PARTIAL`.
- **Existing behavior / evidence:** ditas/calibration.ts computes Brier/log-loss/ECE/bins/Wilson intervals; service preserves model/version/horizon/remaining-quarter-bars/lag cohorts and uncalibrated small samples.
- **Frontend/backend ownership and smallest delta:** Reuse these metric/cohort services; source-backed outcome linkage and enough prospective observations remain missing.
- **Data/API/persistence contract:** Existing ditas_forecasts/outcomes and exact cohort query; no new probability model inferred from votes.
- **Security/failure/recovery boundary:** Owner-reported outcomes stay unverified; EVALUATED is not certified probability of profit.
- **Proof required / tests:** ditas-calibration/ditas-api tests define metric/reference/chronology/dedupe/cohort cases; no live calibrated model certified.

## 035. Main branch lacks durable decision forensics

- **Baseline status:** `IN_PR_ONLY`.
- **Existing behavior / evidence:** PR7 already integrates DITAS from PR5/6, with immutable new snapshots/events, correction append, pre-QCI snapshot reuse and transactional central decisions; main lacks these tables.
- **Frontend/backend ownership and smallest delta:** Keep integrated DITAS; no second snapshot service/schema. Improve only identified immutability/lineage gaps in a separate safety increment.
- **Data/API/persistence contract:** Existing migration2 ditas_snapshots/events and hashes; new events link original snapshot; legacy records not retroactively fabricated.
- **Security/failure/recovery boundary:** Do not silently overwrite historical evidence; hash chain is tamper evidence, not protection against a privileged DB admin.
- **Proof required / tests:** ditas-memory.test.ts defines disk reopen, mutation guards, hash/transaction failure and pre-QCI capture tests; inspect replacement/privileged-write limits separately.

