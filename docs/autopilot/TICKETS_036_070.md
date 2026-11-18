# Autopilot ticket assessment 036–070

**Baseline:** integrated, unmerged PR #7 at `b624b52d7dc0bc87310e92193e8da276286b8976`; compare `main` at `d7c6b0b` and standalone PR #8 at `7ca3328`. PR #7 already includes PR #8 and prior DITAS/chart work. This report is an assessment/implementation contract, not completion of 35 new features. Original objectives and acceptance wording remain in `sources/MIA_Autopilot_100_Detailed_Functions_Code_Blueprint.md`, tickets 036–070.

**Evidence scope:** every ticket and cited implementation was read. Existing test names below identify executable coverage, not a claim this reviewer ran them. `IN_PR_ONLY` means working code/test definitions exist only in the unmerged stack; root-run runtime results belong in the milestone test report. `PARTIAL` means the full ticket is not met. `BLOCKED` explicitly includes LOCKED financial work and external credentials/authorization. No source, schema, API, credential, or execution code was changed by this assessment.

| Ticket | State | Existing owner / no-duplication decision |
|---|---|---|
| 036 — Hard to see whether waiting would improve a result | IN_PR_ONLY | PR #6 DITAS, integrated in PR #7: `ditas/twin.ts`, `ditas/service.ts:runDecisionTwin`, `ditas/routes.ts`; `ditas-twin.test.ts`, `ditas-api.test.ts`. Not on main. |
| 037 — Historical comparison can accidentally use future data | PARTIAL | Main `lab/backtest.ts` uses incremental features and next-bar-open entries. PR #5 adds chart prefix replay; PR #7 `knowledge/research.ts` adds purged walk-forward. None runs the full scanner/QCI/risk/OMS under a virtual clock. |
| 038 — Worker contribution is not continuously proven | PARTIAL | PR #7 `workers/effectiveness.ts`, `runtime.ts`, `/api/intelligence` and `workers-effectiveness.test.ts` measure capability/vote productivity. They do not link worker predictions to holdout trade outcomes. |
| 039 — A promising signal might be uneconomic after costs | PARTIAL | Main risk gate already sizes positions and checks fees, spread, book impact and `maxCostR`; PR #7 adds execution freshness and finite-input denial (`risk/gate.ts`, `market/quality.ts`, `repair.test.ts`). Validated net edge is not established by a cost cap. |
| 040 — Unverified news can trigger hasty reactions | PARTIAL | Main `news/news.ts` lexicon/credibility and QCI news evidence exist. Current `classify` trusts outlet keywords in source OR title; `recentNews/newsContext` do not exclude all future publication times. No verified-event cooling policy. |
| 041 — Order lifecycle may be hard to diagnose | PARTIAL | Main `orders.status` is free text with direct OMS writes; PR #7 strengthens transactional exits/incidents. Typed transition INTENT/PARTIAL/UNKNOWN state machine and persistent transition event history are absent. |
| 042 — Retrying timed-out submissions may duplicate orders | PARTIAL | Main has UNIQUE client_order_id and `entry-${candidateId}`; PR #7 adds deterministic `exit-${positionId}-${seq}` plus atomic exits and duplicate defenses in `exec/oms.ts`; OMS tests cover repeat protection. Timeout/UNKNOWN remote reconciliation is not implemented. |
| 043 — Concurrent opportunities could oversubscribe risk | MISSING | `risk/gate.ts` checks current cash/open risk and pending same-instrument entries; `exec/oms.ts` rechecks cash. No risk_reservations table or transactional reservation/release service exists in migration v4. |
| 044 — Partial fills can complicate balances | PARTIAL | Main entry/exit fills and ledger rows commit transactionally. PR #7 fixes partial-target accounting and combined-depth consumption (`oms.ts`, `repair.test.ts`, `oms.test.ts`). `fills` is not DB-immutable and has no unique venueFillId; actual partial venue fills are not supported. |
| 045 — A position may lack demonstrable exit protection | IN_PR_ONLY | PR #7 `exec/oms.ts:protectPositions/monitorPositions`, `exec/incidents.ts`, `/api/risk/incidents`, Overview/Risk displays and `incidents.test.ts` exist; main lacks durable incident/recovery path. |
| 046 — Stale books prevent trustworthy protective exits | PARTIAL | PR #7 strict exits refuse ticker fallbacks, persist protection incidents, and block new entries on the affected instrument (`oms.ts`, `incidents.ts`, `risk/gate.ts`). The ticket may mean global freeze; that broader policy is not automatically enacted. |
| 047 — Venue outage could be mistaken for harmless latency | PARTIAL | Main providers have LIVE/DEGRADED/DOWN health and scheduled polling; PR #7 prevents feed errors from skipping monitoring, retains incidents, and quality fails entries. No complete durable provider-outage/failover state machine or automatic global pause. |
| 048 — Actual trade size can exceed visible order-book liquidity | IN_PR_ONLY | Main has bookImpact by notional; PR #7 `exec/pricing.ts` quantity-aware walkBook plus strict OMS full-size/combined-target checks, `oms.test.ts` and `repair.test.ts`. Do not implement a second book walker. |
| 049 — Changing fees distort strategy comparisons | PARTIAL | Main policy versions store feeRate and each fill persists actual fee. There is no provider/tier/instrument/effective-date fee schedule registry or dedicated order feePolicyVersion. |
| 050 — Slippage estimates are not continuously audited | IN_PR_ONLY | PR #8 read-only `ditas/execution.ts` was cherry-picked into PR #7 (62e67f0); GET `/api/ditas/execution` and `ditas-execution.test.ts` exist. Main does not include it. |
| 051 — No verified live funding connection on main | BLOCKED | `providers/pending.ts` and Connections explicitly show read-only balance sync unconfigured; wallet NETWORKS are READ_ONLY_PENDING_RPC. No real account balance adapter or `/api/accounts/read-only` route. |
| 052 — Paper funding may be mistaken for real deposits | PARTIAL | Main labels paper Bot/Portfolio and global PAPER banner; PR #7 Overview and DITAS label paper/hypothetical. No generalized server AccountBalance.origin contract across real read-only accounts (not connected). |
| 053 — Pending transfers could be treated as settled | BLOCKED | No connected deposit provider/webhook/chain confirmation ledger. Current `/api/bot/allocation` is immediate virtual paper capital, not a pending real deposit. |
| 054 — Deposits may falsely boost performance charts | PARTIAL | Main `portfolio/ledger.ts` tracks net deposits and perf=equity-deposits; existing risk.test.ts asserts deposit-only PnL0. Current portfolio equityCurve adds closed results to current deposits, not a full time-weighted cashflow series. |
| 055 — Execution keys could accidentally have transfer rights | BLOCKED | No trade-capable or withdrawal-capable exchange credential adapter/signer exists. Security overview reports configuration booleans only; current quote adapters are public read-only. |
| 056 — Withdrawal preview is not real settlement | BLOCKED | Main `wallet.ts:previewWithdrawal`, release gates and `/api/wallet/withdraw/preview` exist; PR #7 hardens passphrase redaction. No transfer submission or signer. |
| 057 — One-click withdrawal may invite account takeover | BLOCKED | Owner step-up, verified address book and24h address cooldown exist on main/PR7; MFA challenge mechanism and real withdrawal submission do not. |
| 058 — Users may confuse gross balance with net proceeds | BLOCKED | Existing preview honestly returns fee:null/netReceipt:null plus BALANCE_UNAVAILABLE; no verified live balance or provider fee quote. |
| 059 — Pending withdrawal could be misreported as complete | BLOCKED | Current withdrawal_requests status is always BLOCKED_BY_RELEASE_GATE. Submitted/processing/chain-confirmed settlement adapter does not exist. |
| 060 — Instant withdrawal cannot be guaranteed | BLOCKED | Current wallet has no actual transfer and no promised network ETA; connected timing/eligibility infrastructure absent. |
| 061 — AI could accidentally gain a privileged execution pathway | PARTIAL | Main `joe.ts` explicit TOOLS allowlist and commandMode refuse trading/limits/funding/withdrawals; PR #7 adds untrusted-library search. Risk remains separate. Current core/mode non-owner disabled list check is length-based, not set inclusion. |
| 062 — Signer access might expand silently | BLOCKED | No isolated signer exists; gates G07/G12 remain NOT_IMPLEMENTED; wallet read-only/preview-only. |
| 063 — Incomplete token checks can create false safety | PARTIAL | Main `safety/safety.ts:assessDexPair` always adds missing sell simulation/RPC => UNVERIFIED or worse and eligibleForAutomation:false. providers/pending.ts records missing RPC capabilities. Full chain evidence absent. |
| 064 — Overnight operation needs tighter exposure policies | MISSING | RiskPolicy has single normal caps and UTC day/week loss windows. No overnight windows/timezone/effective-policy variant. |
| 065 — Runaway order creation could exhaust capital quickly | PARTIAL | Main emergencyStop/core.mode/risk gate block new entries, cancel pending eligible orders and retain monitoring; state persists in settings and owner clears via step-up in PR #7. Header currently links Risk Center rather than providing a direct emergency action. |
| 066 — Correlated trades can multiply one underlying bet | PARTIAL | Main correlation.ts and risk/gate.ts conservatively count unknown correlations and cap correlated positions. No atomic shared risk reservations/group-dollar budgets or parallel writers proof. |
| 067 — Daily loss counters can reset incorrectly | PARTIAL | Main ledger.ts uses UTC dayKey/weekKey and ledger-derived net perf; risk tests cover basic deposit/day loss behavior. Daily counters use stored marks and realized positions, not immutable fill-derived window events; deposit denominator can change. |
| 068 — Stale or manipulated data can reach decision layer | PARTIAL | PR #6 quality/fabric flags source integrity, PR #7 validates request-cutoff/sequence/fresh books and rebuild recovery; ctx excludes failed frames. No durable provider/asset Quarantine model with configurable clean-check count. |
| 069 — Credentials may be compromised without immediate warning | PARTIAL | Main auth.login.failed audit, lockout, Security Center checks/session list exist; PR #7 shared rate limits, per-session expensive route caps, session revocation and SSE logout handling. No anomaly origin model or permission-change detection service. |
| 070 — An audit trail stored only locally may be alterable | MISSING | Main core/audit.ts stores an unkeyed local SHA256 chain; no periodic HMAC/signature checkpoint or independent encrypted export/backup. Existing evidence.key signs worker packets, not off-host audit checkpoints. |

## 036 — Hard to see whether waiting would improve a result
**Status/origin/evidence:** IN_PR_ONLY. PR #6 DITAS, integrated in PR #7: `ditas/twin.ts`, `ditas/service.ts:runDecisionTwin`, `ditas/routes.ts`; `ditas-twin.test.ts`, `ditas-api.test.ts`. Not on main.
- **A/B — Objective/behavior:** retain the original ticket’s objective and failure-aware behavior; the remaining contract below extends its existing owner rather than instantiating a duplicate.
- **C — Frontend:** Reuse `pages/Ditas.tsx` hypothetical results, not a second Intel ledger.
- **D — Backend/API:** Reuse frozen-event Twin endpoint and shared `lab/exits.ts`; expand scenario UI only if needed.
- **E — Data/validation contract:** Existing `TwinResult`: HYPOTHETICAL shadow, delayed, WAIT; OPEN/NO_FILL/CLOSED and explicit assumptions.
- **F — Persistence:** Reuse `ditas_twin_runs`, snapshot/event links and history hash.
- **G — Security/authority:** Research evidence only; never call OMS or write actual orders/fills/ledger.
- **H — Failure/recovery:** Reject failed-data/invalid history; unknown contemporaneous depth is NO_FILL, open outcomes censored.
- **I/J — Tests/completion evidence:** Execute existing Twin/API isolation fixtures; assert actual cash/order/fill counts unchanged and no later bars alter completed results. Completion requires executed results and reviewed diff; file existence or a sample DTO is not proof.

## 037 — Historical comparison can accidentally use future data
**Status/origin/evidence:** PARTIAL. Main `lab/backtest.ts` uses incremental features and next-bar-open entries. PR #5 adds chart prefix replay; PR #7 `knowledge/research.ts` adds purged walk-forward. None runs the full scanner/QCI/risk/OMS under a virtual clock.
- **A/B — Objective/behavior:** retain the original ticket’s objective and failure-aware behavior; the remaining contract below extends its existing owner rather than instantiating a duplicate.
- **C — Frontend:** Reuse Strategy Lab and Academy run detail; add a replay timeline only after engine contract exists.
- **D — Backend/API:** Add a clock-injected replay coordinator around existing services; do not create another risk or execution engine.
- **E — Data/validation contract:** Proposed `ReplayRun {datasetHash,clock,seed,codeVersion,events,netResults}`; snapshots must include available-at news.
- **F — Persistence:** Reuse research experiments where semantics fit; append-only replay event namespace if required.
- **G — Security/authority:** Isolated database/account; no production paper ledger, live provider mutation or strategy promotion.
- **H — Failure/recovery:** Fail incomplete histories, chronology violations and unknown model context rather than treating them as valid results.
- **I/J — Tests/completion evidence:** Future-candle/news sentinels, deterministic replay, fee/slippage parity and all service boundary assertions; full-pipeline run NOT YET EXECUTED. Completion requires executed results and reviewed diff; file existence or a sample DTO is not proof.

## 038 — Worker contribution is not continuously proven
**Status/origin/evidence:** PARTIAL. PR #7 `workers/effectiveness.ts`, `runtime.ts`, `/api/intelligence` and `workers-effectiveness.test.ts` measure capability/vote productivity. They do not link worker predictions to holdout trade outcomes.
- **A/B — Objective/behavior:** retain the original ticket’s objective and failure-aware behavior; the remaining contract below extends its existing owner rather than instantiating a duplicate.
- **C — Frontend:** Keep existing Intelligence capability/productivity display; add outcome cohort sample/uncertainty later.
- **D — Backend/API:** Extend existing worker/QCI evidence linkage; do not clone worker registry or change weights automatically.
- **E — Data/validation contract:** Proposed `WorkerOutcome` with decision, regime, prediction, outcome and worker/model versions; preserve dependency groups.
- **F — Persistence:** Reuse `worker_stats` and stored consensus packets; append settled outcome links if needed.
- **G — Security/authority:** A productive vote is not accuracy; provider-blocked/constant-rule roles remain labeled separately.
- **H — Failure/recovery:** Missing version/outcome means UNCALIBRATED; minimum samples and degradation review, never one-trade promotion.
- **I/J — Tests/completion evidence:** Existing capability/productivity tests plus out-of-sample cohort calibration, duplicate-evidence and small-sample abstention tests. Completion requires executed results and reviewed diff; file existence or a sample DTO is not proof.

## 039 — A promising signal might be uneconomic after costs
**Status/origin/evidence:** PARTIAL. Main risk gate already sizes positions and checks fees, spread, book impact and `maxCostR`; PR #7 adds execution freshness and finite-input denial (`risk/gate.ts`, `market/quality.ts`, `repair.test.ts`). Validated net edge is not established by a cost cap.
- **A/B — Objective/behavior:** retain the original ticket’s objective and failure-aware behavior; the remaining contract below extends its existing owner rather than instantiating a duplicate.
- **C — Frontend:** Reuse decision/risk cost display; show unknown cost rather than zero.
- **D — Backend/API:** Extend `evaluateRisk` and existing book impact calculation only; no second economics gate.
- **E — Data/validation contract:** Existing `RiskDecision.evaluated` spreadBps/impactBps/costR and sizing; explicit source/asOf may be added to existing DTO.
- **F — Persistence:** Risk policy versions and saved decision/risk report; do not rewrite historical estimates.
- **G — Security/authority:** Independent deterministic veto; workers cannot waive costs or authorize size.
- **H — Failure/recovery:** Missing/stale/insufficient depth and nonfinite inputs deny entries.
- **I/J — Tests/completion evidence:** Run risk/repair/book tests; add after-cost edge reference and full-size depth sensitivity before asserting economic profitability. Completion requires executed results and reviewed diff; file existence or a sample DTO is not proof.

## 040 — Unverified news can trigger hasty reactions
**Status/origin/evidence:** PARTIAL. Main `news/news.ts` lexicon/credibility and QCI news evidence exist. Current `classify` trusts outlet keywords in source OR title; `recentNews/newsContext` do not exclude all future publication times. No verified-event cooling policy.
- **A/B — Objective/behavior:** retain the original ticket’s objective and failure-aware behavior; the remaining contract below extends its existing owner rather than instantiating a duplicate.
- **C — Frontend:** Reuse News & Events with explicit UNVERIFIED/STALE/disputed provenance; no new news screen.
- **D — Backend/API:** Harden canonical news ingestion/classification and add separately reviewed deterministic cooling policy in risk.
- **E — Data/validation contract:** Extend NewsItem provenance/availableAt and event verification status; never interpret headline text as commands.
- **F — Persistence:** Reuse `news`, notifications and policy audit; append verification/cooling changes if needed.
- **G — Security/authority:** Rumor/sentiment never grants execution authority; trusted metadata must not be inferred from title mentions.
- **H — Failure/recovery:** Unknown/future publication date quarantined; lack of calendar provider remains UNKNOWN.
- **I/J — Tests/completion evidence:** Adversarial headline trust, future/missing/stale dates, cooling expiry and rumor-only cannot authorize entry; current weakness is code-inspection evidence. Completion requires executed results and reviewed diff; file existence or a sample DTO is not proof.

## 041 — Order lifecycle may be hard to diagnose
**Status/origin/evidence:** PARTIAL. Main `orders.status` is free text with direct OMS writes; PR #7 strengthens transactional exits/incidents. Typed transition INTENT/PARTIAL/UNKNOWN state machine and persistent transition event history are absent.
- **A/B — Objective/behavior:** retain the original ticket’s objective and failure-aware behavior; the remaining contract below extends its existing owner rather than instantiating a duplicate.
- **C — Frontend:** Reuse orders/history detail with last transition/reason when durable events exist.
- **D — Backend/API:** Extend canonical OMS with validated transitions; do not introduce another order manager.
- **E — Data/validation contract:** Proposed OrderEvent and allowed transition map; existing order statuses need explicit compatibility mapping.
- **F — Persistence:** Append immutable lifecycle events beside `orders` via a new migration; preserve existing orders/fills.
- **G — Security/authority:** Only authorized paper OMS transitions; no AI or client-selected fill state.
- **H — Failure/recovery:** Crash/retry must reconcile persisted state before action; UNKNOWN cannot become an assumed fill.
- **I/J — Tests/completion evidence:** Every allowed/forbidden transition, rollback at each write, restart reconciliation and legacy compatibility fixtures. Completion requires executed results and reviewed diff; file existence or a sample DTO is not proof.

## 042 — Retrying timed-out submissions may duplicate orders
**Status/origin/evidence:** PARTIAL. Main has UNIQUE client_order_id and `entry-${candidateId}`; PR #7 adds deterministic `exit-${positionId}-${seq}` plus atomic exits and duplicate defenses in `exec/oms.ts`; OMS tests cover repeat protection. Timeout/UNKNOWN remote reconciliation is not implemented.
- **A/B — Objective/behavior:** retain the original ticket’s objective and failure-aware behavior; the remaining contract below extends its existing owner rather than instantiating a duplicate.
- **C — Frontend:** Reuse order status/reason in Bot/History; show duplicate as existing logical intent, not a second success.
- **D — Backend/API:** Extend existing `submitEntry`, `applyExit`, queue and reconciliation, keeping IDs stable across retries.
- **E — Data/validation contract:** Existing clientOrderId/idempotency key; formal stored intent/attempt identity needed for multi-process recovery.
- **F — Persistence:** Reuse unique order key and transactions; add intent state only if not representable safely.
- **G — Security/authority:** No repeated debit or fill; bot and owner action still pass mode/risk gates.
- **H — Failure/recovery:** After restart/timeout query persisted intent before submitting; no blind retry on 429.
- **I/J — Tests/completion evidence:** Current OMS idempotency tests plus interrupted-after-commit, replayed request and multi-writer retry tests; full network timeout proof pending. Completion requires executed results and reviewed diff; file existence or a sample DTO is not proof.

## 043 — Concurrent opportunities could oversubscribe risk
**Status/origin/evidence:** MISSING. `risk/gate.ts` checks current cash/open risk and pending same-instrument entries; `exec/oms.ts` rechecks cash. No risk_reservations table or transactional reservation/release service exists in migration v4.
- **A/B — Objective/behavior:** retain the original ticket’s objective and failure-aware behavior; the remaining contract below extends its existing owner rather than instantiating a duplicate.
- **C — Frontend:** Show reserved versus available paper capacity in existing Bot/Risk pages only when backed by actual reservations.
- **D — Backend/API:** Add reservations inside existing risk/OMS transaction boundary; no second allocator or ledger.
- **E — Data/validation contract:** Proposed reservation {decisionId,account,instrument,size,riskBudget,status,expiresAt}; validated release reasons.
- **F — Persistence:** Append migration with unique intent reservation and atomic reserve/consume/release.
- **G — Security/authority:** Owner policy bounds remain authority; prevent double spending across instruments/strategies/processes.
- **H — Failure/recovery:** Expire/reconcile orphan reservations after crash; never free capacity for an uncertain filled intent.
- **I/J — Tests/completion evidence:** Parallel candidates at remaining cash/risk boundary; cancel/reject release, crash recovery and duplicate reserve tests. Completion requires executed results and reviewed diff; file existence or a sample DTO is not proof.

## 044 — Partial fills can complicate balances
**Status/origin/evidence:** PARTIAL. Main entry/exit fills and ledger rows commit transactionally. PR #7 fixes partial-target accounting and combined-depth consumption (`oms.ts`, `repair.test.ts`, `oms.test.ts`). `fills` is not DB-immutable and has no unique venueFillId; actual partial venue fills are not supported.
- **A/B — Objective/behavior:** retain the original ticket’s objective and failure-aware behavior; the remaining contract below extends its existing owner rather than instantiating a duplicate.
- **C — Frontend:** Reuse Trading History fill detail and explicit paper labeling.
- **D — Backend/API:** Extend existing OMS ledger-posting path with durable fill identity and append-only behavior.
- **E — Data/validation contract:** Proposed immutable fill event plus residual qty, weighted price and fee allocations; precision boundaries explicit.
- **F — Persistence:** New migration constraints/event records as necessary; never replace existing paper ledger.
- **G — Security/authority:** Hypothetical Twin fills remain isolated; no fake partial fill when depth is insufficient.
- **H — Failure/recovery:** Failure between fill/ledger/position writes rolls back or replays exactly once.
- **I/J — Tests/completion evidence:** Existing partial-TP/reconciliation tests plus duplicate external fill, injected transaction failure and immutable-update/delete/replace regressions. Completion requires executed results and reviewed diff; file existence or a sample DTO is not proof.

## 045 — A position may lack demonstrable exit protection
**Status/origin/evidence:** IN_PR_ONLY. PR #7 `exec/oms.ts:protectPositions/monitorPositions`, `exec/incidents.ts`, `/api/risk/incidents`, Overview/Risk displays and `incidents.test.ts` exist; main lacks durable incident/recovery path.
- **A/B — Objective/behavior:** retain the original ticket’s objective and failure-aware behavior; the remaining contract below extends its existing owner rather than instantiating a duplicate.
- **C — Frontend:** Keep existing Overview protection alert and Risk Center; extend age display from existing timestamps if needed.
- **D — Backend/API:** Reuse current protection reconciliation and incident service, not another governor.
- **E — Data/validation contract:** Existing Incident OPEN/RECOVERED/ACKNOWLEDGED with opened/last_seen/recovered times; display last check and book age explicitly if extending.
- **F — Persistence:** Reuse `protection_incidents` migration v4 and audit/journal.
- **G — Security/authority:** Fresh executable full exit depth required; owner acknowledgment does not create fill or resume a still-open incident.
- **H — Failure/recovery:** Keep position open when unknown; repeated detections deduplicate and re-alert at bounded rate; recovery awaits owner note.
- **I/J — Tests/completion evidence:** Run incidents restart/dedup/ack and repair fresh-book/depth tests; add protection-age UI assertions before claiming complete operational monitoring. Completion requires executed results and reviewed diff; file existence or a sample DTO is not proof.

## 046 — Stale books prevent trustworthy protective exits
**Status/origin/evidence:** PARTIAL. PR #7 strict exits refuse ticker fallbacks, persist protection incidents, and block new entries on the affected instrument (`oms.ts`, `incidents.ts`, `risk/gate.ts`). The ticket may mean global freeze; that broader policy is not automatically enacted.
- **A/B — Objective/behavior:** retain the original ticket’s objective and failure-aware behavior; the remaining contract below extends its existing owner rather than instantiating a duplicate.
- **C — Frontend:** Reuse critical Overview/Risk alerts; distinguish position still open from successfully exited.
- **D — Backend/API:** Use existing book freshness, OMS and incident paths; define global-versus-instrument entry pause policy explicitly.
- **E — Data/validation contract:** Existing incident reason/status/timestamps; no synthetic exit state.
- **F — Persistence:** Reuse incidents, notifications and journal with actual position/order records.
- **G — Security/authority:** No fill without fresh sufficient book; live remains locked.
- **H — Failure/recovery:** Retry only when executable data returns; retain incident across restarts and require owner acknowledgment.
- **I/J — Tests/completion evidence:** Existing stale/thin/missing-book and recovery fixtures; add outage across instruments and verify any chosen global freeze policy. Completion requires executed results and reviewed diff; file existence or a sample DTO is not proof.

## 047 — Venue outage could be mistaken for harmless latency
**Status/origin/evidence:** PARTIAL. Main providers have LIVE/DEGRADED/DOWN health and scheduled polling; PR #7 prevents feed errors from skipping monitoring, retains incidents, and quality fails entries. No complete durable provider-outage/failover state machine or automatic global pause.
- **A/B — Objective/behavior:** retain the original ticket’s objective and failure-aware behavior; the remaining contract below extends its existing owner rather than instantiating a duplicate.
- **C — Frontend:** Reuse Connections, Risk incidents and shell health; present outage distinctly from loading.
- **D — Backend/API:** Extend provider health/background retry and existing bot lanes; keep monitoring independent from failed ticker refresh.
- **E — Data/validation contract:** Proposed ProviderIncident {venue,status,startedAt,lastHealthyAt,retryAt}; use existing health events.
- **F — Persistence:** Persist outage transitions only if new incident kind is needed; reuse current journal/notifications.
- **G — Security/authority:** No absent data mapped to zero risk; failover data must pass identity/time/deviation checks.
- **H — Failure/recovery:** Bounded backoff, provider-specific recovery criteria; no duplicate order intent after retry.
- **I/J — Tests/completion evidence:** Mock 429/timeout/disconnect/recovery with open positions; assert monitoring continues and unsafe entries remain denied. Completion requires executed results and reviewed diff; file existence or a sample DTO is not proof.

## 048 — Actual trade size can exceed visible order-book liquidity
**Status/origin/evidence:** IN_PR_ONLY. Main has bookImpact by notional; PR #7 `exec/pricing.ts` quantity-aware walkBook plus strict OMS full-size/combined-target checks, `oms.test.ts` and `repair.test.ts`. Do not implement a second book walker.
- **A/B — Objective/behavior:** retain the original ticket’s objective and failure-aware behavior; the remaining contract below extends its existing owner rather than instantiating a duplicate.
- **C — Frontend:** Reuse spread/depth/impact fields in Market Terminal and risk plan.
- **D — Backend/API:** Reuse pricing/book validators and full quantity path in OMS/risk.
- **E — Data/validation contract:** Existing BookImpact and book lastUpdateId/ts; capture source/asOf in saved estimate if needed.
- **F — Persistence:** Use saved decision/execution context; no new balance ledger.
- **G — Security/authority:** No partial depth represented as full fill, and no stale or crossed book authorizes execution.
- **H — Failure/recovery:** Keep unexitable position/incident when depth insufficient; consumed depth accounted in a target pass.
- **I/J — Tests/completion evidence:** Run exact quantity walk, thin/crossed/stale book and combined-exit-depth regressions. Parent runtime verification pending. Completion requires executed results and reviewed diff; file existence or a sample DTO is not proof.

## 049 — Changing fees distort strategy comparisons
**Status/origin/evidence:** PARTIAL. Main policy versions store feeRate and each fill persists actual fee. There is no provider/tier/instrument/effective-date fee schedule registry or dedicated order feePolicyVersion.
- **A/B — Objective/behavior:** retain the original ticket’s objective and failure-aware behavior; the remaining contract below extends its existing owner rather than instantiating a duplicate.
- **C — Frontend:** Show original estimated/paid fees in existing decision and order detail, with quote currency/origin.
- **D — Backend/API:** Extend canonical provider fee metadata and OMS estimate capture; do not recalculate historical fill fees from current defaults.
- **E — Data/validation contract:** Proposed FeePolicy {version,venue,instrument,tier,feeRate,effectiveAt}; unknown schedule distinct from zero fee.
- **F — Persistence:** Reuse risk_policy_versions and fills; append fee provenance reference if needed.
- **G — Security/authority:** Fee configuration owner-controlled; external data validated, no future schedule used in old replay.
- **H — Failure/recovery:** Missing/expired fee policy makes estimate unknown or conservative per reviewed policy.
- **I/J — Tests/completion evidence:** Fee-policy change preserves old order/fill accounting; tier/version transitions and unknown schedule fixtures. Completion requires executed results and reviewed diff; file existence or a sample DTO is not proof.

## 050 — Slippage estimates are not continuously audited
**Status/origin/evidence:** IN_PR_ONLY. PR #8 read-only `ditas/execution.ts` was cherry-picked into PR #7 (62e67f0); GET `/api/ditas/execution` and `ditas-execution.test.ts` exist. Main does not include it.
- **A/B — Objective/behavior:** retain the original ticket’s objective and failure-aware behavior; the remaining contract below extends its existing owner rather than instantiating a duplicate.
- **C — Frontend:** Reuse DITAS execution results; do not add another execution-quality page/API.
- **D — Backend/API:** Keep projection over paper-bot orders/fills; add validation/batching only as separately tested repairs.
- **E — Data/validation contract:** Existing report has weighted fill price, fees, nullable expected/slippage and local first/last recorded fill delays; no exchange ack claim.
- **F — Persistence:** Read existing orders/fills/decisions; no projection writes.
- **G — Security/authority:** Exclude hypothetical Twin and other accounts; malformed/mismatched references need explicit invalid state.
- **H — Failure/recovery:** Missing reference remains null; DB failures must not return fabricated performance.
- **I/J — Tests/completion evidence:** Run PR8 projection tests plus BUY/SELL, corrupt fill, reference ownership, query limits/auth and bounded query count regressions; benchmark not live validation. Completion requires executed results and reviewed diff; file existence or a sample DTO is not proof.

## 051 — No verified live funding connection on main
**Status/origin/evidence:** BLOCKED. `providers/pending.ts` and Connections explicitly show read-only balance sync unconfigured; wallet NETWORKS are READ_ONLY_PENDING_RPC. No real account balance adapter or `/api/accounts/read-only` route.
- **A/B — Objective/behavior:** retain the original ticket’s objective and failure-aware behavior; the remaining contract below extends its existing owner rather than instantiating a duplicate.
- **C — Frontend:** Keep paper allocation separate; add SETUP_REQUIRED origin-labelled real account panel only after credential scope verification.
- **D — Backend/API:** Later minimal-scope read-only adapter in existing provider layer, not trade/withdraw service.
- **E — Data/validation contract:** Proposed AccountBalance {venue,currency,available,total,asOf,verification,origin}; route is DESIGN ONLY.
- **F — Persistence:** Separate verified balance snapshots, not paper ledger credits.
- **G — Security/authority:** Server-side read-only credentials, no private key/seed collection; owner provider authorization needed.
- **H — Failure/recovery:** Disconnected/expired credentials show unavailable/last-known age, never paper-as-real.
- **I/J — Tests/completion evidence:** Mock scope validation and account separation; actual credential/network integration requires separately authorized environment. Completion requires executed results and reviewed diff; file existence or a sample DTO is not proof.

## 052 — Paper funding may be mistaken for real deposits
**Status/origin/evidence:** PARTIAL. Main labels paper Bot/Portfolio and global PAPER banner; PR #7 Overview and DITAS label paper/hypothetical. No generalized server AccountBalance.origin contract across real read-only accounts (not connected).
- **A/B — Objective/behavior:** retain the original ticket’s objective and failure-aware behavior; the remaining contract below extends its existing owner rather than instantiating a duplicate.
- **C — Frontend:** Preserve all PAPER/no-real-funds warnings in every presentation mode; use origin badges for every future account.
- **D — Backend/API:** Reuse server-authoritative account projection; no local equity or withdrawable balance calculation.
- **E — Data/validation contract:** Proposed origin PAPER/EXCHANGE_READONLY/UNVERIFIED in existing DTO when multiple origins actually exist.
- **F — Persistence:** Paper ledger unchanged; future external account snapshots separately stored.
- **G — Security/authority:** Virtual allocation cannot create real withdrawable funds; no widget signing/transfer authority.
- **H — Failure/recovery:** Unknown origin is UNVERIFIED rather than guessed from color/account name.
- **I/J — Tests/completion evidence:** Paper deposit-only display, hypothetical result separation and all-mode safety labels; external account fixtures do not grant live capability. Completion requires executed results and reviewed diff; file existence or a sample DTO is not proof.

## 053 — Pending transfers could be treated as settled
**Status/origin/evidence:** BLOCKED. No connected deposit provider/webhook/chain confirmation ledger. Current `/api/bot/allocation` is immediate virtual paper capital, not a pending real deposit.
- **A/B — Objective/behavior:** retain the original ticket’s objective and failure-aware behavior; the remaining contract below extends its existing owner rather than instantiating a duplicate.
- **C — Frontend:** Keep virtual allocation wording; future real deposit UI must show PENDING/CONFIRMING/CREDITED.
- **D — Backend/API:** Design a verified read-only settlement adapter only after provider authorization; do not extend paper deposit endpoint to imply real settlement.
- **E — Data/validation contract:** Proposed DepositRecord {providerTxId,network,state,confirmedAt,amount,accountId}; unique verified event ID.
- **F — Persistence:** Separate provider settlement evidence; only verified credited state affects corresponding real balance.
- **G — Security/authority:** No unverified webhook/replay or cross-account credit; credentials/source signature checked.
- **H — Failure/recovery:** Handle reorg/reversal/timeout explicitly without classifying pending funds as settled.
- **I/J — Tests/completion evidence:** Pending, duplicate, wrong-account, insufficient-confirmation and reorg fixtures; no actual settlement executed. Completion requires executed results and reviewed diff; file existence or a sample DTO is not proof.

## 054 — Deposits may falsely boost performance charts
**Status/origin/evidence:** PARTIAL. Main `portfolio/ledger.ts` tracks net deposits and perf=equity-deposits; existing risk.test.ts asserts deposit-only PnL0. Current portfolio equityCurve adds closed results to current deposits, not a full time-weighted cashflow series.
- **A/B — Objective/behavior:** retain the original ticket’s objective and failure-aware behavior; the remaining contract below extends its existing owner rather than instantiating a duplicate.
- **C — Frontend:** Reuse existing Portfolio funding/PnL labels; show funding events separately from performance.
- **D — Backend/API:** Extend authoritative performance projection using ledger timestamps; preserve current accounting definitions.
- **E — Data/validation contract:** Proposed PerformancePoint {equity,cumulativeDeposits,cumulativeWithdrawals,pnlNet,asOf}; no made-up FX conversion.
- **F — Persistence:** Reuse ledger_entries and fills/positions, optionally append verified historical marks.
- **G — Security/authority:** Do not mark paper gains withdrawable; define funding/breaker denominators before changing risk semantics.
- **H — Failure/recovery:** Missing price marks return unknown flags; deposits cannot be inferred as market profit.
- **I/J — Tests/completion evidence:** Deposit/withdraw-only PnL0, partial fees, funding time series and window-boundary tests; TWR requires independent reference fixtures. Completion requires executed results and reviewed diff; file existence or a sample DTO is not proof.

## 055 — Execution keys could accidentally have transfer rights
**Status/origin/evidence:** BLOCKED. No trade-capable or withdrawal-capable exchange credential adapter/signer exists. Security overview reports configuration booleans only; current quote adapters are public read-only.
- **A/B — Objective/behavior:** retain the original ticket’s objective and failure-aware behavior; the remaining contract below extends its existing owner rather than instantiating a duplicate.
- **C — Frontend:** Keep live credentials unsupported/locked; future scope summary must omit secret values.
- **D — Backend/API:** Design credential-scope verification in existing security/provider boundary only after separate owner authorization.
- **E — Data/validation contract:** Proposed CredentialScope {accountId,read,trade,withdraw:false,expiresAt}; not an implemented permission-check API.
- **F — Persistence:** Dedicated protected server secret store and redacted scope metadata if authorized; never SQLite analysis prompts or browser payloads.
- **G — Security/authority:** Trading scope cannot imply withdrawals; restrict IP/provider permissions independently.
- **H — Failure/recovery:** Unable to verify scope means deny connection, not assume read-only.
- **I/J — Tests/completion evidence:** Read-only/trade/withdraw scope fixtures and redaction; real credential audit external/NOT RUN. Completion requires executed results and reviewed diff; file existence or a sample DTO is not proof.

## 056 — Withdrawal preview is not real settlement
**Status/origin/evidence:** BLOCKED. Main `wallet.ts:previewWithdrawal`, release gates and `/api/wallet/withdraw/preview` exist; PR #7 hardens passphrase redaction. No transfer submission or signer.
- **A/B — Objective/behavior:** retain the original ticket’s objective and failure-aware behavior; the remaining contract below extends its existing owner rather than instantiating a duplicate.
- **C — Frontend:** Reuse preview-only Wallet flow; do not duplicate payout service in this milestone.
- **D — Backend/API:** Document future separately authorized withdrawal architecture; keep preview blocked.
- **E — Data/validation contract:** Existing preview returns BLOCKED_BY_RELEASE_GATE, nullable fee/netReceipt and reasons.
- **F — Persistence:** Reuse withdrawal_requests as blocked preview history, not settlement evidence.
- **G — Security/authority:** No private keys, real send, Trader Joe withdrawal tool or live unlock authorized by blueprint.
- **H — Failure/recovery:** Unavailable balance/fee/provider stays explicitly unknown/blocked.
- **I/J — Tests/completion evidence:** Run wallet/API preview and no-tool/no-signer boundary tests; no financial transaction test on real account. Completion requires executed results and reviewed diff; file existence or a sample DTO is not proof.

## 057 — One-click withdrawal may invite account takeover
**Status/origin/evidence:** BLOCKED. Owner step-up, verified address book and24h address cooldown exist on main/PR7; MFA challenge mechanism and real withdrawal submission do not.
- **A/B — Objective/behavior:** retain the original ticket’s objective and failure-aware behavior; the remaining contract below extends its existing owner rather than instantiating a duplicate.
- **C — Frontend:** Reuse address list/verify and StepUp components; future MFA confirmation must be separate and explicit.
- **D — Backend/API:** Design future owner withdrawal authorization around existing security boundary; do not add signer now.
- **E — Data/validation contract:** Proposed WithdrawalAuthorization {ownerId,destinationId,challengeId,expiresAt,approvedAt}; not current route.
- **F — Persistence:** Keep existing address_book/audit and future immutable approvals isolated.
- **G — Security/authority:** New/unverified destination, failed MFA or review mismatch blocks; bot/assistant no path.
- **H — Failure/recovery:** Expired challenge/destination edit requires a new review; do not auto-resubmit payout.
- **I/J — Tests/completion evidence:** Current cooldown/owner mismatch tests plus future MFA replay/expiry/binding fixtures; actual payout remains locked. Completion requires executed results and reviewed diff; file existence or a sample DTO is not proof.

## 058 — Users may confuse gross balance with net proceeds
**Status/origin/evidence:** BLOCKED. Existing preview honestly returns fee:null/netReceipt:null plus BALANCE_UNAVAILABLE; no verified live balance or provider fee quote.
- **A/B — Objective/behavior:** retain the original ticket’s objective and failure-aware behavior; the remaining contract below extends its existing owner rather than instantiating a duplicate.
- **C — Frontend:** Keep unknown values as dashes/blocked, not zero or instant net proceeds.
- **D — Backend/API:** Future provider-backed WithdrawalQuote design only; reuse wallet preview, no fabricated fee calculator.
- **E — Data/validation contract:** Proposed {quoteId,asset,network,fee,net,expiresAt}; values require matching provider/account/network.
- **F — Persistence:** Persist quote identity with future approved request if separately authorized.
- **G — Security/authority:** No confirmation/submission without verified fee and scope; simulated cash excluded.
- **H — Failure/recovery:** Expired/unavailable quote must refresh/fail closed, not silently reuse cached numbers.
- **I/J — Tests/completion evidence:** Null fee/net, quote expiry/network mismatch and zero-vs-unknown UI fixtures; no claim preview matches live settlement. Completion requires executed results and reviewed diff; file existence or a sample DTO is not proof.

## 059 — Pending withdrawal could be misreported as complete
**Status/origin/evidence:** BLOCKED. Current withdrawal_requests status is always BLOCKED_BY_RELEASE_GATE. Submitted/processing/chain-confirmed settlement adapter does not exist.
- **A/B — Objective/behavior:** retain the original ticket’s objective and failure-aware behavior; the remaining contract below extends its existing owner rather than instantiating a duplicate.
- **C — Frontend:** Continue showing blocked preview history; no COMPLETE toast for preview creation.
- **D — Backend/API:** Design later authoritative provider-status synchronization, no actual send in current scope.
- **E — Data/validation contract:** Proposed explicit requested/approved/submitted/processing/confirmed/failed/reviewRequired transition events.
- **F — Persistence:** Future append-only settlement events linked to provider tx ID; current blocked previews preserved.
- **G — Security/authority:** Owner separately authorizes submissions; status polling never resubmits money.
- **H — Failure/recovery:** Timeout remains UNKNOWN/REVIEW_REQUIRED until provider confirms; duplicated webhook idempotent.
- **I/J — Tests/completion evidence:** Current blocked status fixture; future reordered/duplicate/failure/confirmation tests before production status claims. Completion requires executed results and reviewed diff; file existence or a sample DTO is not proof.

## 060 — Instant withdrawal cannot be guaranteed
**Status/origin/evidence:** BLOCKED. Current wallet has no actual transfer and no promised network ETA; connected timing/eligibility infrastructure absent.
- **A/B — Objective/behavior:** retain the original ticket’s objective and failure-aware behavior; the remaining contract below extends its existing owner rather than instantiating a duplicate.
- **C — Frontend:** Keep preview/initiation wording and UNKNOWN ETA; never instant-success promise.
- **D — Backend/API:** Future provider eligibility/timing read-only projection only after authorization.
- **E — Data/validation contract:** Optional provider settlement range and blockers with source/asOf; no artificial countdown.
- **F — Persistence:** Persist provider status evidence when service exists; no new storage for a guessed ETA.
- **G — Security/authority:** Does not grant live/withdraw/signing permissions or request real funds.
- **H — Failure/recovery:** Missing provider/network information remains unavailable.
- **I/J — Tests/completion evidence:** UI copy and blocked-preview tests; actual provider timing evaluation explicitly outside this milestone. Completion requires executed results and reviewed diff; file existence or a sample DTO is not proof.

## 061 — AI could accidentally gain a privileged execution pathway
**Status/origin/evidence:** PARTIAL. Main `joe.ts` explicit TOOLS allowlist and commandMode refuse trading/limits/funding/withdrawals; PR #7 adds untrusted-library search. Risk remains separate. Current core/mode non-owner disabled list check is length-based, not set inclusion.
- **A/B — Objective/behavior:** retain the original ticket’s objective and failure-aware behavior; the remaining contract below extends its existing owner rather than instantiating a duplicate.
- **C — Frontend:** Reuse globally available Joe and existing explanations; no second assistant/tool bridge.
- **D — Backend/API:** Retain tool allowlist plus deterministic owner/risk APIs; strengthen internal capability checks when separately scoped.
- **E — Data/validation contract:** Existing JOE_TOOL_NAMES and tool schemas; proposed actor/capability metadata only if needed.
- **F — Persistence:** Reuse chat/audit/evidence; do not store secret tool context.
- **G — Security/authority:** No prompt text can create a privileged tool; read/untrusted inputs remain data.
- **H — Failure/recovery:** Invalid tool/unknown capability abstains; model outage falls back/reports failure.
- **I/J — Tests/completion evidence:** Existing Joe no-order tool/API tests and knowledge untrusted-text tests; add adversarial permission-set substitution and provider-output tests. No real LLM factuality certification. Completion requires executed results and reviewed diff; file existence or a sample DTO is not proof.

## 062 — Signer access might expand silently
**Status/origin/evidence:** BLOCKED. No isolated signer exists; gates G07/G12 remain NOT_IMPLEMENTED; wallet read-only/preview-only.
- **A/B — Objective/behavior:** retain the original ticket’s objective and failure-aware behavior; the remaining contract below extends its existing owner rather than instantiating a duplicate.
- **C — Frontend:** Show live/signing LOCKED in existing Release Gates; no unlock toggle in this milestone.
- **D — Backend/API:** Design a separate narrowly scoped signer only after explicit future authorization and independent review.
- **E — Data/validation contract:** Proposed SignerRequest {intentHash,policyHash,nonce,expiresAt}; actual methods/assets/venues/destinations allowlisted.
- **F — Persistence:** Separate key custody and immutable approvals, never React/LLM/Git or general analysis DB.
- **G — Security/authority:** No actual signing code or credentials authorized by attached backlog.
- **H — Failure/recovery:** Any unknown method/asset/amount/nonce/policy mismatch denied independently.
- **I/J — Tests/completion evidence:** Current absent-signer/live-lock tests; future firewall/nonce/expiry/redaction tests do not permit real transfer deployment. Completion requires executed results and reviewed diff; file existence or a sample DTO is not proof.

## 063 — Incomplete token checks can create false safety
**Status/origin/evidence:** PARTIAL. Main `safety/safety.ts:assessDexPair` always adds missing sell simulation/RPC => UNVERIFIED or worse and eligibleForAutomation:false. providers/pending.ts records missing RPC capabilities. Full chain evidence absent.
- **A/B — Objective/behavior:** retain the original ticket’s objective and failure-aware behavior; the remaining contract below extends its existing owner rather than instantiating a duplicate.
- **C — Frontend:** Reuse safety badges/reason checks; distinguish CAUTION vs UNVERIFIED/missing check rather than safe label.
- **D — Backend/API:** Extend canonical chain-specific provider/asset assessment only after RPC scope/data available.
- **E — Data/validation contract:** Existing SafetyResult checks/reasons/eligibleForAutomation; add checkedAt/chain/evidence references without implying proof.
- **F — Persistence:** Store sourced check snapshots if required; never synthetic holder/sellability values.
- **G — Security/authority:** Unknown contract permissions/sell simulation cannot become automation-eligible.
- **H — Failure/recovery:** Stale/RPC failure returns unverified; revalidation policy explicit.
- **I/J — Tests/completion evidence:** Missing sell simulation and low-liquidity/honeypot heuristic fixtures; actual chain sellability tests BLOCKED by provider. Completion requires executed results and reviewed diff; file existence or a sample DTO is not proof.

## 064 — Overnight operation needs tighter exposure policies
**Status/origin/evidence:** MISSING. RiskPolicy has single normal caps and UTC day/week loss windows. No overnight windows/timezone/effective-policy variant.
- **A/B — Objective/behavior:** retain the original ticket’s objective and failure-aware behavior; the remaining contract below extends its existing owner rather than instantiating a duplicate.
- **C — Frontend:** Extend existing Risk Center policy editor only after reviewed schema/policy behavior.
- **D — Backend/API:** Resolve effective scheduled stricter caps in existing policy/gate, never duplicate risk engine.
- **E — Data/validation contract:** Proposed normalCaps/overnightCaps/windows/zone/version; overnight caps must not loosen hard maximums.
- **F — Persistence:** Version via existing risk_policy_versions; append schema migration only if separate schedule entity required.
- **G — Security/authority:** Owner step-up accepts policy; AI cannot increase risk or silently choose nighttime relaxation.
- **H — Failure/recovery:** Unknown timezone/DST policy must deny configuration or choose reviewed conservative behavior.
- **I/J — Tests/completion evidence:** DST/UTC rollover, crossing window, restart and hard-cap monotonicity tests; no current overnight readiness claim. Completion requires executed results and reviewed diff; file existence or a sample DTO is not proof.

## 065 — Runaway order creation could exhaust capital quickly
**Status/origin/evidence:** PARTIAL. Main emergencyStop/core.mode/risk gate block new entries, cancel pending eligible orders and retain monitoring; state persists in settings and owner clears via step-up in PR #7. Header currently links Risk Center rather than providing a direct emergency action.
- **A/B — Objective/behavior:** retain the original ticket’s objective and failure-aware behavior; the remaining contract below extends its existing owner rather than instantiating a duplicate.
- **C — Frontend:** Reuse existing Risk Center controls and optionally expose accessible header launcher; preserve status globally across modes.
- **D — Backend/API:** Existing emergencyStop only; no second kill-switch state or AI action authority.
- **E — Data/validation contract:** ControlState.emergency/pausedNewOrders + existing event bus and owner-authenticated endpoint.
- **F — Persistence:** Reuse settings/audit/journal; tighten atomic control+audit consistency in a separate repair if needed.
- **G — Security/authority:** AI may reduce risk, not resume; emergency does not auto-liquidate positions.
- **H — Failure/recovery:** Restart retains emergency; monitoring continues when new entries are blocked.
- **I/J — Tests/completion evidence:** Existing OMS/risk/API emergency tests plus restart and non-owner resume negatives; header-specific keyboard test if added. Completion requires executed results and reviewed diff; file existence or a sample DTO is not proof.

## 066 — Correlated trades can multiply one underlying bet
**Status/origin/evidence:** PARTIAL. Main correlation.ts and risk/gate.ts conservatively count unknown correlations and cap correlated positions. No atomic shared risk reservations/group-dollar budgets or parallel writers proof.
- **A/B — Objective/behavior:** retain the original ticket’s objective and failure-aware behavior; the remaining contract below extends its existing owner rather than instantiating a duplicate.
- **C — Frontend:** Reuse Risk Center correlation matrix/exposure display; show stale/unknown correlation honestly.
- **D — Backend/API:** Extend existing portfolio/risk checks with reservations; no duplicate allocator or agent-based sizing multiplier.
- **E — Data/validation contract:** Proposed ExposureSummary {group,correlatedUsd,riskPct,limit,asOf}; define group membership/provenance.
- **F — Persistence:** Use existing positions plus ticket043 reservations; append migration only for durable reservations.
- **G — Security/authority:** Hard portfolio policy retains veto; unknown correlations conservative.
- **H — Failure/recovery:** Stale/missing histories cannot weaken exposure cap; release only reconciled cancelled capacity.
- **I/J — Tests/completion evidence:** Correlated/uncorrelated/unknown histories and true concurrent candidates; existing counts alone are not parallel-cap proof. Completion requires executed results and reviewed diff; file existence or a sample DTO is not proof.

## 067 — Daily loss counters can reset incorrectly
**Status/origin/evidence:** PARTIAL. Main ledger.ts uses UTC dayKey/weekKey and ledger-derived net perf; risk tests cover basic deposit/day loss behavior. Daily counters use stored marks and realized positions, not immutable fill-derived window events; deposit denominator can change.
- **A/B — Objective/behavior:** retain the original ticket’s objective and failure-aware behavior; the remaining contract below extends its existing owner rather than instantiating a duplicate.
- **C — Frontend:** Reuse Portfolio/Risk windows with documented UTC boundary and separate display timezone.
- **D — Backend/API:** Define authoritative risk window capital baseline in current ledger/gate before altering semantics.
- **E — Data/validation contract:** Proposed RiskWindow {periodStartUtc,periodEndUtc,realizedNet,capitalBase,policyVersion}; no UI-clock reset.
- **F — Persistence:** Reuse ledger_entries/fills and settings marks; immutable event provenance remains ticket044 dependency.
- **G — Security/authority:** No automatic weakening after funding or midnight; owner reviews policy semantics.
- **H — Failure/recovery:** Clock rollback/restart/cross-midnight must preserve auditable window state.
- **I/J — Tests/completion evidence:** UTC midnight/week rollover, deposits/withdrawals before/after threshold, missing marks and process restart; current test is not complete invariance certification. Completion requires executed results and reviewed diff; file existence or a sample DTO is not proof.

## 068 — Stale or manipulated data can reach decision layer
**Status/origin/evidence:** PARTIAL. PR #6 quality/fabric flags source integrity, PR #7 validates request-cutoff/sequence/fresh books and rebuild recovery; ctx excludes failed frames. No durable provider/asset Quarantine model with configurable clean-check count.
- **A/B — Objective/behavior:** retain the original ticket’s objective and failure-aware behavior; the remaining contract below extends its existing owner rather than instantiating a duplicate.
- **C — Frontend:** Reuse Connections/Intelligence/Risk health reasons; show quarantine distinctly only when implemented.
- **D — Backend/API:** Extend existing validation/provider status and shared context gating, not a parallel market-data pipeline.
- **E — Data/validation contract:** Proposed Quarantine {entity,reason,openedAt,cleanChecksRequired,lastGoodAt}; existing integrityIssues and data quality reused.
- **F — Persistence:** Persist source-specific transitions if required; current flags partly in-memory, incidents durable for positions.
- **G — Security/authority:** Bad clocks/identity/crossed books cannot feed QCI/OMS; recovery must not imply live authorization.
- **H — Failure/recovery:** Require validated clean frames and rebuild provenance; no guessed missing candles.
- **I/J — Tests/completion evidence:** Run existing quality/ditas-frames/repair tests; add persistent quarantine restart and repeated-clean-check recovery cases. Completion requires executed results and reviewed diff; file existence or a sample DTO is not proof.

## 069 — Credentials may be compromised without immediate warning
**Status/origin/evidence:** PARTIAL. Main auth.login.failed audit, lockout, Security Center checks/session list exist; PR #7 shared rate limits, per-session expensive route caps, session revocation and SSE logout handling. No anomaly origin model or permission-change detection service.
- **A/B — Objective/behavior:** retain the original ticket’s objective and failure-aware behavior; the remaining contract below extends its existing owner rather than instantiating a duplicate.
- **C — Frontend:** Reuse Security Center/Notifications with redacted reviewable security events.
- **D — Backend/API:** Extend existing auth/security monitoring rather than new authentication layer.
- **E — Data/validation contract:** Proposed SecurityEvent {type,actor,ts,risk,redactedMetadata}; collect origin minimally with privacy scope.
- **F — Persistence:** Reuse audit_log/sessions/notifications; append event table only if normalized evidence needed.
- **G — Security/authority:** Never log raw credentials/tokens; anomaly handling cannot grant trade/withdraw privileges.
- **H — Failure/recovery:** Provider outage/false positive reviewable; session revocation independently enforced.
- **I/J — Tests/completion evidence:** Current rate-limit/revoke/step-up tests plus unusual-origin/key-scope alerts and redaction; full anomaly detection not certified. Completion requires executed results and reviewed diff; file existence or a sample DTO is not proof.

## 070 — An audit trail stored only locally may be alterable
**Status/origin/evidence:** MISSING. Main core/audit.ts stores an unkeyed local SHA256 chain; no periodic HMAC/signature checkpoint or independent encrypted export/backup. Existing evidence.key signs worker packets, not off-host audit checkpoints.
- **A/B — Objective/behavior:** retain the original ticket’s objective and failure-aware behavior; the remaining contract below extends its existing owner rather than instantiating a duplicate.
- **C — Frontend:** Reuse Security Center audit integrity and expose checkpoint/export health only when sourced.
- **D — Backend/API:** Design separate checkpoint/export worker around canonical audit chain; do not duplicate audit event recording.
- **E — Data/validation contract:** Proposed AuditCheckpoint {lastEventId,chainHash,signature,ts,keyVersion}; remote destination owner-approved.
- **F — Persistence:** Append checkpoint metadata and encrypted independent storage; backup DB plus evidence key under reviewed custody.
- **G — Security/authority:** Signing secret isolated from public/LLM context; never reuse unrestricted execution keys.
- **H — Failure/recovery:** Tamper/delete/reorder/missing exports fail validation and raise a durable incident.
- **I/J — Tests/completion evidence:** Independent tamper verification, key rotation, failed export/retry and full restore drill; no off-host checkpoint currently exists. Completion requires executed results and reviewed diff; file existence or a sample DTO is not proof.
