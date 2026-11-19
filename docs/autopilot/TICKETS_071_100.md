# Autopilot ticket audit — 071–100

**Frozen implementation baseline:** PR #7 `b624b52d7dc0bc87310e92193e8da276286b8976`, compared with `main` `d7c6b0b725682d1fff6fc3bb96b925d23984d97e` and PR #8 `7ca3328127d26bfe93428abf778d07f748dd4b28`. PR #7 contains earlier DITAS/chart/repair work and PR #8 cherry-pick; none of this authorizes merging.

**Source and status rule:** original user wording is preserved in [the blueprint](sources/MIA_Autopilot_100_Detailed_Functions_Code_Blueprint.md). Each item below is an assessment/extension contract, not an instruction to bypass existing controls. `PARTIAL` means some current implementation exists but the complete ticket is not proved. `MISSING` means the requested implementation was not found, even when related primitives exist. `BLOCKED` identifies external/time/authorization evidence. This reviewer executed no runtime suite; cited tests are existing definitions, and root verification is recorded separately. No feature is marked `VERIFIED_WORKING` merely because code exists.

| Ticket | Baseline status | Reuse decision |
|---|---|---|
| 071 — UI tests may miss popup-specific failures | MISSING | Extend existing services/components where named; never create another scanner, risk engine, OMS, ledger or assistant. |
| 072 — Short tests do not prove unattended stability | BLOCKED | Extend existing services/components where named; never create another scanner, risk engine, OMS, ledger or assistant. |
| 073 — Unexpected termination may corrupt order workflow | PARTIAL | Extend existing services/components where named; never create another scanner, risk engine, OMS, ledger or assistant. |
| 074 — Provider throttling may cause cascading failures | PARTIAL | Extend existing services/components where named; never create another scanner, risk engine, OMS, ledger or assistant. |
| 075 — Clock glitches can distort expiry and risk windows | PARTIAL | Extend existing services/components where named; never create another scanner, risk engine, OMS, ledger or assistant. |
| 076 — Ledger edge cases can escape example-based tests | MISSING | Extend existing services/components where named; never create another scanner, risk engine, OMS, ledger or assistant. |
| 077 — Parallel trade decisions can create races | PARTIAL | Extend existing services/components where named; never create another scanner, risk engine, OMS, ledger or assistant. |
| 078 — Withdrawal UI is a high-impact attack surface | BLOCKED | Extend existing services/components where named; never create another scanner, risk engine, OMS, ledger or assistant. |
| 079 — Users may experience slowness despite good API timing | PARTIAL | Extend existing services/components where named; never create another scanner, risk engine, OMS, ledger or assistant. |
| 080 — A green build may hide untested release gates | PARTIAL | Extend existing services/components where named; never create another scanner, risk engine, OMS, ledger or assistant. |
| 081 — Trade decisions are scattered across screens | PARTIAL | Extend existing services/components where named; never create another scanner, risk engine, OMS, ledger or assistant. |
| 082 — Headline PnL can hide actual costs | PARTIAL | Extend existing services/components where named; never create another scanner, risk engine, OMS, ledger or assistant. |
| 083 — Fees and spread are not visible as a story | PARTIAL | Extend existing services/components where named; never create another scanner, risk engine, OMS, ledger or assistant. |
| 084 — Simulated and real performance can be confused | PARTIAL | Extend existing services/components where named; never create another scanner, risk engine, OMS, ledger or assistant. |
| 085 — Users cannot audit why a recommendation appeared | PARTIAL | Extend existing services/components where named; never create another scanner, risk engine, OMS, ledger or assistant. |
| 086 — Rejected trades can seem like bugs | PARTIAL | Extend existing services/components where named; never create another scanner, risk engine, OMS, ledger or assistant. |
| 087 — Strategies can look good due to tiny samples | PARTIAL | Extend existing services/components where named; never create another scanner, risk engine, OMS, ledger or assistant. |
| 088 — Users cannot judge resilience to market shocks | PARTIAL | Extend existing services/components where named; never create another scanner, risk engine, OMS, ledger or assistant. |
| 089 — Daily activity is difficult to understand | PARTIAL | Extend existing services/components where named; never create another scanner, risk engine, OMS, ledger or assistant. |
| 090 — A live card may conceal its data origin | PARTIAL | Extend existing services/components where named; never create another scanner, risk engine, OMS, ledger or assistant. |
| 091 — Initial setup requires expert knowledge | PARTIAL | Extend existing services/components where named; never create another scanner, risk engine, OMS, ledger or assistant. |
| 092 — Connections require manual technical debugging | PARTIAL | Extend existing services/components where named; never create another scanner, risk engine, OMS, ledger or assistant. |
| 093 — Different skill levels need different views | MISSING | Extend existing services/components where named; never create another scanner, risk engine, OMS, ledger or assistant. |
| 094 — International markets use inconsistent clocks | PARTIAL | Extend existing services/components where named; never create another scanner, risk engine, OMS, ledger or assistant. |
| 095 — Trader Joe is primarily text-first | MISSING | Extend existing services/components where named; never create another scanner, risk engine, OMS, ledger or assistant. |
| 096 — Experimenting can contaminate the funded paper account | PARTIAL | Extend existing services/components where named; never create another scanner, risk engine, OMS, ledger or assistant. |
| 097 — User data is hard to move between tools | PARTIAL | Extend existing services/components where named; never create another scanner, risk engine, OMS, ledger or assistant. |
| 098 — System diagnostics are hidden from ordinary users | PARTIAL | Extend existing services/components where named; never create another scanner, risk engine, OMS, ledger or assistant. |
| 099 — Monitoring from a phone remains limited | MISSING | Extend existing services/components where named; never create another scanner, risk engine, OMS, ledger or assistant. |
| 100 — No single proof that autopilot is ready unattended | PARTIAL | Extend existing services/components where named; never create another scanner, risk engine, OMS, ledger or assistant. |

## Branch provenance

Most execution, portfolio, current auth/provider APIs, original QA gates, history CSV, command-mode Joe and lab capsule/backtester primitives already exist on `main`. PR #7 integrates repair changes, the six-group `nav.ts`/`Navigation.tsx`, protection incidents, expanded dashboard, worker effectiveness and Quant Academy. Chart intelligence and DITAS originate in unmerged PRs #5/#6; execution-quality projection originates in PR #8 and is already cherry-picked into #7. Presence on the selected integration branch does not imply merged release or runtime certification.

## 071. UI tests may miss popup-specific failures
- **Main / PR provenance:** MISSING at main and inspected PR heads; selected monitor milestone is new work.
- **Status / current evidence:** `MISSING` — No PiP implementation/test exists at b624b52; `e2e/app.spec.ts`, `ditas.spec.ts`, `navigation.spec.ts` test the ordinary SPA only.
- **A–B. Objective and behavior:** Address the original ticket objective above; activate/read/update/fail only as specified in its preserved source. No separate implementation is needed for already-present behavior.
- **C–F. Frontend, backend, data/API and persistence contract:** UI: user gesture opens supported PiP, fallback panel otherwise. Backend/API: reuse `/api/shell` and `/api/overview`; no new authority/API/storage.
- **Reuse / exact change boundary:** Use the selected read-only monitor and shared `web/src/api.ts`; do not create a second account calculation.
- **G–H. Security and recovery:** Account origin and stale state visible; closing PiP restores/cleans the UI; a fixture screenshot is not a real-market demonstration. Preserve owner session/CSRF/step-up on any state change, paper/live separation and independent risk authority. Unknown/degraded dependencies cannot become fabricated success.
- **I. Required tests:** Test supported-capability stub and native supported browser separately, unsupported fallback, denied request, close/reopen, auth expiry, stale data and cleanup. Native support not tested must remain NOT TESTED.
- **J. Completion evidence:** Account origin and stale state visible; closing PiP restores/cleans the UI; a fixture screenshot is not a real-market demonstration. Record commit, actual executed commands/results and any missing browser/provider/host evidence before changing status.

## 072. Short tests do not prove unattended stability
- **Main / PR provenance:** Main has headless startup/timers; PR #7 improves independent failure handling. Soak/hosting proof absent.
- **Status / current evidence:** `BLOCKED` — `server/src/main.ts` calls `startBot()` independently of the SPA; `bot/bot.ts` owns three in-process timers. No committed 24-hour no-browser soak harness/report or always-on host evidence was found.
- **A–B. Objective and behavior:** Address the original ticket objective above; activate/read/update/fail only as specified in its preserved source. No separate implementation is needed for already-present behavior.
- **C–F. Frontend, backend, data/API and persistence contract:** Backend: record loop heartbeat/scans/monitor runs, pauses/stale periods, restart counts and RSS. Proposed SoakReport must identify commit, environment, duration and evidence. Store outside the authoritative trading ledger.
- **Reuse / exact change boundary:** Reuse those scheduler loops and QHEF metrics; add an isolated soak harness before claiming unattended operation.
- **G–H. Security and recovery:** Blocked until time, supervised host, operator-approved paper configuration and measured report exist; no live mode or profit claim. Preserve owner session/CSRF/step-up on any state change, paper/live separation and independent risk authority. Unknown/degraded dependencies cannot become fabricated success.
- **I. Required tests:** Run actual >=24h PAPER-only soak with all browser clients closed; controlled provider outage/restart and independent heartbeat collection. Do not substitute a short health200 test.
- **J. Completion evidence:** Blocked until time, supervised host, operator-approved paper configuration and measured report exist; no live mode or profit claim. Record commit, actual executed commands/results and any missing browser/provider/host evidence before changing status.

## 073. Unexpected termination may corrupt order workflow
- **Main / PR provenance:** Main has transaction/idempotency primitives; PR #7 adds repair/incident persistence tests; DITAS reopen evidence comes through PR #6.
- **Status / current evidence:** `PARTIAL` — `db/db.ts:tx`, `exec/oms.ts`, `repair.test.ts` and `incidents.test.ts` cover atomic exits/nested rollback and incident reopen. `ditas-memory.test.ts` covers persisted memory reopen. No complete crash-at-each-intent/submit/reconcile campaign exists.
- **A–B. Objective and behavior:** Address the original ticket objective above; activate/read/update/fail only as specified in its preserved source. No separate implementation is needed for already-present behavior.
- **C–F. Frontend, backend, data/API and persistence contract:** UI: expose unknown/recovery state through existing risk/history. Backend: explicit fault points around durable intent, fills and ledger commit; proposed recovery evidence relates stable order/position IDs. No automatic guessed fills.
- **Reuse / exact change boundary:** Extend existing OMS transaction boundaries/test fixtures; no second intent manager.
- **G–H. Security and recovery:** No duplicate debit/fill or lost open position; incomplete recovery remains visible and new unsafe entries stay blocked. Preserve owner session/CSRF/step-up on any state change, paper/live separation and independent risk authority. Unknown/degraded dependencies cannot become fabricated success.
- **I. Required tests:** Kill child process before/after each write phase, reopen actual temporary SQLite/WAL, reconcile orders/fills/positions/cash and retry same intent.
- **J. Completion evidence:** No duplicate debit/fill or lost open position; incomplete recovery remains visible and new unsafe entries stay blocked. Record commit, actual executed commands/results and any missing browser/provider/host evidence before changing status.

## 074. Provider throttling may cause cascading failures
- **Main / PR provenance:** Main provider bucket/timeout/health; full Retry-After/backoff behavior is missing.
- **Status / current evidence:** `PARTIAL` — `providers/http.ts` implements token bucket, abort timeout and health state; `hardening.test.ts` tests a different core/API token bucket. No provider Retry-After/exponential-backoff reset contract or deterministic full429 recovery test was found.
- **A–B. Objective and behavior:** Address the original ticket objective above; activate/read/update/fail only as specified in its preserved source. No separate implementation is needed for already-present behavior.
- **C–F. Frontend, backend, data/API and persistence contract:** UI: show DEGRADED/DOWN and last source time in Connections/monitor. Backend: parse bounded Retry-After, capped jitter/backoff and per-host budget. Proposed retry telemetry excludes secrets and cannot authorize OMS.
- **Reuse / exact change boundary:** Extend canonical `fetchProvider`, not every adapter independently.
- **G–H. Security and recovery:** A throttled provider is not hammered, risk stays fail-closed and normal traffic resumes only within budget. Preserve owner session/CSRF/step-up on any state change, paper/live separation and independent risk authority. Unknown/degraded dependencies cannot become fabricated success.
- **I. Required tests:** Mock429/date+seconds Retry-After, timeout, disconnect, recovery and concurrent requests; assert bounded attempts and stale/invalid data rejects.
- **J. Completion evidence:** A throttled provider is not hammered, risk stays fail-closed and normal traffic resumes only within budget. Record commit, actual executed commands/results and any missing browser/provider/host evidence before changing status.

## 075. Clock glitches can distort expiry and risk windows
- **Main / PR provenance:** Main Date.now/expiry logic and tests; PR #7 adds clock/future-price regressions, not a universal Clock.
- **Status / current evidence:** `PARTIAL` — Tests use `vi.useFakeTimers` in dashboard/incidents/DITAS paths; `core/util.ts:now` wraps Date.now. There is no uniform injected wall/monotonic Clock. `qci/coordinator.ts:isExpired` and `exec/oms.ts` compare Date.parse output without finite validation.
- **A–B. Objective and behavior:** Address the original ticket objective above; activate/read/update/fail only as specified in its preserved source. No separate implementation is needed for already-present behavior.
- **C–F. Frontend, backend, data/API and persistence contract:** UI: timestamp age must show invalid/future/unknown. Backend: optional Clock contract now()/monotonic(); finite absolute expiry and bounded provider-time rules. No persisted timestamps are silently rewritten.
- **Reuse / exact change boundary:** Harden and centralize expiry validation before broad clock abstraction; preserve existing time injection parameters.
- **G–H. Security and recovery:** Invalid or expired consensus must never become usable merely because NaN comparison is false. This acceptance is not established by file existence. Preserve owner session/CSRF/step-up on any state change, paper/live separation and independent risk authority. Unknown/degraded dependencies cannot become fabricated success.
- **I. Required tests:** Invalid expiry, backwards/forwards wall jump, exact session/candle/risk boundaries, monotonic duration and owner recovery.
- **J. Completion evidence:** Invalid or expired consensus must never become usable merely because NaN comparison is false. This acceptance is not established by file existence. Record commit, actual executed commands/results and any missing browser/provider/host evidence before changing status.

## 076. Ledger edge cases can escape example-based tests
- **Main / PR provenance:** Missing generative ledger suite; main has example-based tests.
- **Status / current evidence:** `MISSING` — `oms.test.ts`, `repair.test.ts`, `risk.test.ts` contain example-based accounting cases. `knowledge.test.ts` has seeded statistical checks, not randomized paper-ledger invariant sequences.
- **A–B. Objective and behavior:** Address the original ticket objective above; activate/read/update/fail only as specified in its preserved source. No separate implementation is needed for already-present behavior.
- **C–F. Frontend, backend, data/API and persistence contract:** UI unchanged. Backend/test-only generator creates partial fills/fees/cancels in isolated DB; contract includes seed, precision, account and failure trace. No new runtime API/table required initially.
- **Reuse / exact change boundary:** Reuse shared OMS exits, ledger/calendar reconciliation and fixtures; add a seeded property harness.
- **G–H. Security and recovery:** Any failure yields reproducible seed and minimal trace; no experiments alter the official paper account. Preserve owner session/CSRF/step-up on any state change, paper/live separation and independent risk authority. Unknown/degraded dependencies cannot become fabricated success.
- **I. Required tests:** Generate bounded random sequences, assert cash+marked positions/fees/proceeds identities, no negative inventory, replay determinism and saved counterexample seed.
- **J. Completion evidence:** Any failure yields reproducible seed and minimal trace; no experiments alter the official paper account. Record commit, actual executed commands/results and any missing browser/provider/host evidence before changing status.

## 077. Parallel trade decisions can create races
- **Main / PR provenance:** Main uniqueness/risk/OMS checks; PR #7 guards scheduler lanes; no cross-process reservation proof.
- **Status / current evidence:** `PARTIAL` — `orders.client_order_id` UNIQUE, `submitEntry`, risk duplicate/pending checks and ordinary OMS tests exist. `bot/bot.ts` guards in-process lane overlap. No portfolio-capital reservation model or demonstrated two-instance simultaneous intent capacity test exists.
- **A–B. Objective and behavior:** Address the original ticket objective above; activate/read/update/fail only as specified in its preserved source. No separate implementation is needed for already-present behavior.
- **C–F. Frontend, backend, data/API and persistence contract:** UI: pending/reserved capital shown from authoritative backend only. Backend: define atomic reservation and release lifecycle with stable IDs before new tables/routes; no AI agreement sizing multiplier.
- **Reuse / exact change boundary:** Use existing SQLite transactions/idempotency, extend them if real concurrent reservation support is required.
- **G–H. Security and recovery:** At most permitted capital/risk is committed; no double fill, leaked reservation or cross-account spend. Existing uniqueness alone is not full proof. Preserve owner session/CSRF/step-up on any state change, paper/live separation and independent risk authority. Unknown/degraded dependencies cannot become fabricated success.
- **I. Required tests:** Concurrent distinct intents sharing limited capital, same intent retry, cancellation, failure rollback and separate process restart.
- **J. Completion evidence:** At most permitted capital/risk is committed; no double fill, leaked reservation or cross-account spend. Existing uniqueness alone is not full proof. Record commit, actual executed commands/results and any missing browser/provider/host evidence before changing status.

## 078. Withdrawal UI is a high-impact attack surface
- **Main / PR provenance:** Main preview wallet; PR #7 hardens auth/step-up. Financial submission remains blocked.
- **Status / current evidence:** `BLOCKED` — `wallet/wallet.ts` validates address formats/owner/cooldown/freeze and always stores BLOCKED_BY_RELEASE_GATE previews. `wallet.test.ts` covers parts; no signer, full MFA, payout adapter or external security certification exists.
- **A–B. Objective and behavior:** Address the original ticket objective above; activate/read/update/fail only as specified in its preserved source. No separate implementation is needed for already-present behavior.
- **C–F. Frontend, backend, data/API and persistence contract:** UI must say PREVIEW/BLOCKED, never SENT. Backend: hypothetical threat-model contracts for destination scope, nonce/replay and MFA; no real submission endpoint in this milestone.
- **Reuse / exact change boundary:** Preserve preview-only controls and security center; real withdrawal testing is design-only pending separate authorization.
- **G–H. Security and recovery:** No funds or signing action; copying a destination cannot bypass controls. LOCKED ticket is not implementation authorization. Preserve owner session/CSRF/step-up on any state change, paper/live separation and independent risk authority. Unknown/degraded dependencies cannot become fabricated success.
- **I. Required tests:** Isolated negative tests for owner/CSRF/address substitution/cooldown/freeze; independent review before any future payout implementation.
- **J. Completion evidence:** No funds or signing action; copying a destination cannot bypass controls. LOCKED ticket is not implementation authorization. Record commit, actual executed commands/results and any missing browser/provider/host evidence before changing status.

## 079. Users may experience slowness despite good API timing
- **Main / PR provenance:** Main QHEF/backend timings; no frontend Web Vitals implementation in inspected branches.
- **Status / current evidence:** `PARTIAL` — `core/latency.ts`, QHEF and existing e2e provide backend timing/navigation evidence. No browser Web Vitals LCP/INP/CLS collector or representative hardware p95 interaction report exists.
- **A–B. Objective and behavior:** Address the original ticket objective above; activate/read/update/fail only as specified in its preserved source. No separate implementation is needed for already-present behavior.
- **C–F. Frontend, backend, data/API and persistence contract:** UI: optional privacy-preserving performance observer without account contents. Backend: aggregate only if a reviewed retention/consent need exists. Proposed PerformanceEvidence identifies scenario/device/commit/sample count.
- **Reuse / exact change boundary:** Reuse browser tests and server tracing; avoid another telemetry pipeline without a measured need.
- **G–H. Security and recovery:** No fabricated latency target achievement; rejected optimization if alerts/data correctness degrade. Preserve owner session/CSRF/step-up on any state change, paper/live separation and independent risk authority. Unknown/degraded dependencies cannot become fabricated success.
- **I. Required tests:** Measure startup, chart pan/zoom, filter typing and critical alert rendering on declared devices; record before/after samples.
- **J. Completion evidence:** No fabricated latency target achievement; rejected optimization if alerts/data correctness degrade. Record commit, actual executed commands/results and any missing browser/provider/host evidence before changing status.

## 080. A green build may hide untested release gates
- **Main / PR provenance:** Main QA service/view; PR #7 retains the generic test-evidence flaw.
- **Status / current evidence:** `PARTIAL` — `qa/gates.ts`, `/api/qa`, `Account.tsx:QA` already display gates, reconciliation and audit evidence. But G01/G02/G03/G04/G09 derive PASS from generic numFailedTests===0; G04 names nonexistent joe.test.ts.
- **A–B. Objective and behavior:** Address the original ticket objective above; activate/read/update/fail only as specified in its preserved source. No separate implementation is needed for already-present behavior.
- **C–F. Frontend, backend, data/API and persistence contract:** UI: distinguish PASS/FAIL/PENDING/NOT_CERTIFIED with named evidence. Backend/data: bind gate evidence to commit, suite, nonzero executed tests, skipped checks and human reviewer. Reuse audit storage; append migration only if durable attestation needed.
- **Reuse / exact change boundary:** Repair evidence attribution in existing release-gate service; never build a parallel certifier or unlock control.
- **G–H. Security and recovery:** Unrun/blocked tests cannot PASS; live adapter/signer/owner gates remain locked. Current code does not satisfy this ticket. Preserve owner session/CSRF/step-up on any state change, paper/live separation and independent risk authority. Unknown/degraded dependencies cannot become fabricated success.
- **I. Required tests:** Zero tests, wrong suite/commit, skipped live provider, stale/malformed reports, missing human sign-off, valid named evidence.
- **J. Completion evidence:** Unrun/blocked tests cannot PASS; live adapter/signer/owner gates remain locked. Current code does not satisfy this ticket. Record commit, actual executed commands/results and any missing browser/provider/host evidence before changing status.

## 081. Trade decisions are scattered across screens
- **Main / PR provenance:** Main journal/history; PR #6 DITAS memory; PR #7 expanded activity projection.
- **Status / current evidence:** `PARTIAL` — PR7 `dashboard/overview.ts:activityFeed` joins fills/orders and emits decisions, rejections, alerts, incidents. DITAS memory has snapshot/event lineage and `journal/history.ts` has orders/trades. Not every source→QCI→risk→execution is one durable end-to-end timeline.
- **A–B. Objective and behavior:** Address the original ticket objective above; activate/read/update/fail only as specified in its preserved source. No separate implementation is needed for already-present behavior.
- **C–F. Frontend, backend, data/API and persistence contract:** UI: expandable timeline in Overview/decision details. Backend/API: bounded TimelineEvent{id,decisionId,orderId,type,at,source,status}; preserve missing links as unknown. Existing DB relationships reused before proposing append-only events.
- **Reuse / exact change boundary:** Extend those bounded projections and existing stable IDs; do not add a second event authority.
- **G–H. Security and recovery:** Each recorded execution links to available originating decision and evidence; orphan/legacy references never guessed. Preserve owner session/CSRF/step-up on any state change, paper/live separation and independent risk authority. Unknown/degraded dependencies cannot become fabricated success.
- **I. Required tests:** One executed/rejected/no-trade flow, missing consensus/source IDs, historical restart, paging and repeated noisy incidents.
- **J. Completion evidence:** Each recorded execution links to available originating decision and evidence; orphan/legacy references never guessed. Record commit, actual executed commands/results and any missing browser/provider/host evidence before changing status.

## 082. Headline PnL can hide actual costs
- **Main / PR provenance:** Main ledger/calendar; PR #7 expanded Overview; full gross/net/mark-quality contract partial.
- **Status / current evidence:** `PARTIAL` — `portfolio/ledger.ts`, `dashboard/overview.ts`, Overview and Profit Calendar expose cash/equity/realized/unrealized/fees. Gross-versus-net/cash-flow decomposition is incomplete; markPrice uses cached market price without freshness enforcement, so all displayed marks are not proved fresh.
- **A–B. Objective and behavior:** Address the original ticket objective above; activate/read/update/fail only as specified in its preserved source. No separate implementation is needed for already-present behavior.
- **C–F. Frontend, backend, data/API and persistence contract:** UI: separate realized net, gross where supported, fees, cash flows and unrealized mark quality. Backend: PerformanceSummary with marksAsOf/quality and explicit nulls; account/environment scope must be retained.
- **Reuse / exact change boundary:** Extend canonical ledger projection; do not compute a separate browser PnL or blend simulated/real balances.
- **G–H. Security and recovery:** Totals reconcile and unknown valuations stay flagged; no actual withdrawable profit implied. Preserve owner session/CSRF/step-up on any state change, paper/live separation and independent risk authority. Unknown/degraded dependencies cannot become fabricated success.
- **I. Required tests:** Recompute from actual paper fills/fees and deposits/withdrawals; stale/future/missing marks, partial close and account isolation.
- **J. Completion evidence:** Totals reconcile and unknown valuations stay flagged; no actual withdrawable profit implied. Record commit, actual executed commands/results and any missing browser/provider/host evidence before changing status.

## 083. Fees and spread are not visible as a story
- **Main / PR provenance:** PR #8 read-only execution projection, cherry-picked into PR #7; main fee/history primitives.
- **Status / current evidence:** `PARTIAL` — PR8 `ditas/execution.ts` (cherry-picked into PR7) calculates fill fees/reference slippage/delays. `journal/history.ts` sums fees. No strategy/asset/period cost-breakdown chart with observed versus estimated spread/impact provenance exists.
- **A–B. Objective and behavior:** Address the original ticket objective above; activate/read/update/fail only as specified in its preserved source. No separate implementation is needed for already-present behavior.
- **C–F. Frontend, backend, data/API and persistence contract:** UI: grouped cost chart with fill drilldowns. Backend: bounded CostBreakdown{strategyId,instrument,period,fees,spreadCost:null|number,slippageEstimate:null|number,method}; existing fills/decision refs reused.
- **Reuse / exact change boundary:** Extend those read-only report/history services, not OMS financial records.
- **G–H. Security and recovery:** Every cost bar is traced or explicitly estimated; unknown cost is null rather than invented zero. Preserve owner session/CSRF/step-up on any state change, paper/live separation and independent risk authority. Unknown/degraded dependencies cannot become fabricated success.
- **I. Required tests:** Known weighted fills, unavailable reference, corrupt values, strategy/account filters and period boundary.
- **J. Completion evidence:** Every cost bar is traced or explicitly estimated; unknown cost is null rather than invented zero. Record commit, actual executed commands/results and any missing browser/provider/host evidence before changing status.

## 084. Simulated and real performance can be confused
- **Main / PR provenance:** Main paper branding/export filename; PR #6 hypothetical labels; PR #7 preserves them. Full watermark contract missing.
- **Status / current evidence:** `PARTIAL` — App shell brands paper/READ-ONLY, financial pages and DITAS separate hypothetical records; history export filename ends -paper.csv. Raw CSV columns do not include account environment metadata and every chart/export/widget lacks a persistent reusable watermark.
- **A–B. Objective and behavior:** Address the original ticket objective above; activate/read/update/fail only as specified in its preserved source. No separate implementation is needed for already-present behavior.
- **C–F. Frontend, backend, data/API and persistence contract:** UI: account-origin marker remains visible in every view/mode/monitor. Backend/API: carry PAPER/READ_ONLY/LOCKED environment in financial DTO and versioned export metadata without changing ledger units.
- **Reuse / exact change boundary:** Extend shared UI primitives and canonical CSV export; keep existing labels.
- **G–H. Security and recovery:** A detached chart/export cannot reasonably be mistaken for a live verified cash account. Preserve owner session/CSRF/step-up on any state change, paper/live separation and independent risk authority. Unknown/degraded dependencies cannot become fabricated success.
- **I. Required tests:** Desktop/mobile/screenshots, CSV export content and hypothetical-vs-paper fixtures; warning remains when collapsing details.
- **J. Completion evidence:** A detached chart/export cannot reasonably be mistaken for a live verified cash account. Record commit, actual executed commands/results and any missing browser/provider/host evidence before changing status.

## 085. Users cannot audit why a recommendation appeared
- **Main / PR provenance:** Main DecisionReport/QCI/detail view; PR #5 chart evidence and PR #6 snapshots integrated into PR #7.
- **Status / current evidence:** `PARTIAL` — `DecisionReport`, `ConsensusRecord`, immutable DITAS snapshots, `Intel.tsx:DecisionView` and chart evidence expose supporting/opposing signals, freshness and risk version. Source availability/precision varies and no guarantee that every displayed recommendation has fully sourced EvidenceCard exists.
- **A–B. Objective and behavior:** Address the original ticket objective above; activate/read/update/fail only as specified in its preserved source. No separate implementation is needed for already-present behavior.
- **C–F. Frontend, backend, data/API and persistence contract:** UI: timestamped expandable Why cards with citations/limitations. Backend: EvidenceCard{source,asOf,signal,direction,reason,limitations,snapshotId}; no AI private chain-of-thought. Existing immutable refs reused.
- **Reuse / exact change boundary:** Compose existing decision/consensus/snapshot detail instead of generating fresh explanations from memory.
- **G–H. Security and recovery:** Claims have source or explicit inference/unknown label and never gain trading authority. Preserve owner session/CSRF/step-up on any state change, paper/live separation and independent risk authority. Unknown/degraded dependencies cannot become fabricated success.
- **I. Required tests:** Trace a supported/contradictory/abstained recommendation, missing source/expired data and legacy records.
- **J. Completion evidence:** Claims have source or explicit inference/unknown label and never gain trading authority. Record commit, actual executed commands/results and any missing browser/provider/host evidence before changing status.

## 086. Rejected trades can seem like bugs
- **Main / PR provenance:** Main risk reasonCodes/rejection display; PR #6 durable memory and PR #7 activity/incident enhancements.
- **Status / current evidence:** `PARTIAL` — `risk/gate.ts` returns reasonCodes/policyVersion; scanner stores rejection/no-signal memory and `Intel.tsx` has rejected feed and decision explanation. Recent feed is partly in-memory; canonical user-friendly code→description action mapping is incomplete.
- **A–B. Objective and behavior:** Address the original ticket objective above; activate/read/update/fail only as specified in its preserved source. No separate implementation is needed for already-present behavior.
- **C–F. Frontend, backend, data/API and persistence contract:** UI: Not traded because with policy version/time and safe corrective route, transport errors separate. Backend/API: bounded RejectionReason{code,policyVersion,checkedAt,description}; use stored evidence rather than override endpoint.
- **Reuse / exact change boundary:** Reuse risk/decision reasons and DITAS memory; avoid another rejection engine.
- **G–H. Security and recovery:** Owner sees exact veto and provenance; corrective action never bypasses risk. Preserve owner session/CSRF/step-up on any state change, paper/live separation and independent risk authority. Unknown/degraded dependencies cannot become fabricated success.
- **I. Required tests:** Stale data, missing policy, unsuitable regime, denied sizing and API failure; ensure no bypass control exists.
- **J. Completion evidence:** Owner sees exact veto and provenance; corrective action never bypasses risk. Record commit, actual executed commands/results and any missing browser/provider/host evidence before changing status.

## 087. Strategies can look good due to tiny samples
- **Main / PR provenance:** Main strategy/backtest stats; PR #6 passports; PR #7 research/walk-forward lab.
- **Status / current evidence:** `PARTIAL` — `lab/backtest.ts` returns after-cost expectancy/profit-factor/drawdown/sample warnings; `ditas/passports.ts` has recent version-matched health/intervals; `knowledge/research.ts` provides immutable walk-forward results. UI shows several fields but not a single comprehensive scorecard across regimes.
- **A–B. Objective and behavior:** Address the original ticket objective above; activate/read/update/fail only as specified in its preserved source. No separate implementation is needed for already-present behavior.
- **C–F. Frontend, backend, data/API and persistence contract:** UI: scorecard with window, costs, OOS count, uncertainty and regime limits. Backend: Scorecard{sampleSize,period,expectancy,drawdown,costs,qualityFlags,version}; same dataset/strategy references.
- **Reuse / exact change boundary:** Project existing lab/research/passport evidence, not a new performance database.
- **G–H. Security and recovery:** Small/incomplete samples explicitly INSUFFICIENT_EVIDENCE; no winning-strategy claim from win rate alone. Preserve owner session/CSRF/step-up on any state change, paper/live separation and independent risk authority. Unknown/degraded dependencies cannot become fabricated success.
- **I. Required tests:** Positive tiny sample, negative OOS, unavailable loss denominator, version mismatch and clustered regime windows.
- **J. Completion evidence:** Small/incomplete samples explicitly INSUFFICIENT_EVIDENCE; no winning-strategy claim from win rate alone. Record commit, actual executed commands/results and any missing browser/provider/host evidence before changing status.

## 088. Users cannot judge resilience to market shocks
- **Main / PR provenance:** Main Monte Carlo helper; PR #6 Twin; full named stress view missing.
- **Status / current evidence:** `PARTIAL` — `lab/backtest.ts:monteCarlo` provides seeded bootstrap outcome scenarios; DITAS Twin includes fixed cost/delay hypotheses. No explicit gap/outage/wide-spread stress-scenario engine and account drawdown view exists.
- **A–B. Objective and behavior:** Address the original ticket objective above; activate/read/update/fail only as specified in its preserved source. No separate implementation is needed for already-present behavior.
- **C–F. Frontend, backend, data/API and persistence contract:** UI: scenario selector and prominently hypothetical results. Backend: ScenarioReport{scenario,seed,assumptions,lossDistribution,limitBreaches}; isolated storage separate from actual ledger.
- **Reuse / exact change boundary:** Extend research-only lab/Twin common exit functions; do not introduce another trade executor.
- **G–H. Security and recovery:** Assumptions and missing model dimensions visible; outputs are not forecasts or actual outcomes. Preserve owner session/CSRF/step-up on any state change, paper/live separation and independent risk authority. Unknown/degraded dependencies cannot become fabricated success.
- **I. Required tests:** Repeatable gap/thin book/spread/volatility/outage cases, source data hashes and no actual account writes.
- **J. Completion evidence:** Assumptions and missing model dimensions visible; outputs are not forecasts or actual outcomes. Record commit, actual executed commands/results and any missing browser/provider/host evidence before changing status.

## 089. Daily activity is difficult to understand
- **Main / PR provenance:** Main current Joe briefing/journal; PR #7 activity feed; durable retrospective/missed-run evidence missing.
- **Status / current evidence:** `PARTIAL` — `joe/joe.ts:dailyBriefing`, Overview activity feed and journal/history exist. Briefing is a current-state summary, not a durable audited 24-hour retrospective including scheduler missed runs.
- **A–B. Objective and behavior:** Address the original ticket objective above; activate/read/update/fail only as specified in its preserved source. No separate implementation is needed for already-present behavior.
- **C–F. Frontend, backend, data/API and persistence contract:** UI: daily digest drilldown. Backend: DailyDigest{day,scans,decisions,filledPaperOrders,netPnl,alerts,sourceIds,missingRuns}; persist daily evidence only when counts have durable sources.
- **Reuse / exact change boundary:** Compose existing immutable decision events, actual ledger and incidents; no free-form invented history.
- **G–H. Security and recovery:** Distinguish recorded activity, forecasts and unknown scheduler history; no fabricated daily count. Preserve owner session/CSRF/step-up on any state change, paper/live separation and independent risk authority. Unknown/degraded dependencies cannot become fabricated success.
- **I. Required tests:** No events, timezone boundary, repeated alerts, restart, open incidents and all-offline interval.
- **J. Completion evidence:** Distinguish recorded activity, forecasts and unknown scheduler history; no fabricated daily count. Record commit, actual executed commands/results and any missing browser/provider/host evidence before changing status.

## 090. A live card may conceal its data origin
- **Main / PR provenance:** Main source metadata; PR #6 structural quality checks and PR #7 freshness repairs.
- **Status / current evidence:** `PARTIAL` — `market/quality.ts` retains age/sources; terminal cross-venue/provider/freshness and Connections health are displayed. Not every financial/card DTO includes consistent sourceTs/receivedAt/asOf/quality details.
- **A–B. Objective and behavior:** Address the original ticket objective above; activate/read/update/fail only as specified in its preserved source. No separate implementation is needed for already-present behavior.
- **C–F. Frontend, backend, data/API and persistence contract:** UI: details on provider/source/age plus stale/unknown color. Backend: DataProvenance{provider,sourceTs,receivedAt,quality,reason}; never replace publication/source time with receipt time.
- **Reuse / exact change boundary:** Extend existing source metadata through current DTOs, reuse Freshness; no new feed.
- **G–H. Security and recovery:** A source outage visibly removes LIVE certainty; age is known or explicitly unknown. Preserve owner session/CSRF/step-up on any state change, paper/live separation and independent risk authority. Unknown/degraded dependencies cannot become fabricated success.
- **I. Required tests:** Provider outage, stale/future/reordered source, missing metadata and cached updates.
- **J. Completion evidence:** A source outage visibly removes LIVE certainty; age is known or explicitly unknown. Record commit, actual executed commands/results and any missing browser/provider/host evidence before changing status.

## 091. Initial setup requires expert knowledge
- **Main / PR provenance:** Main setup/risk/allocation/strategy pages; PR #7 six-category navigation. Guided checklist missing.
- **Status / current evidence:** `PARTIAL` — App Login, Bot allocation, Risk policy and Strategy Lab provide owner-controlled steps. `SETUP_GUIDE_BEGINNER.md` documents them; no server-derived interactive completion checklist ties them together.
- **A–B. Objective and behavior:** Address the original ticket objective above; activate/read/update/fail only as specified in its preserved source. No separate implementation is needed for already-present behavior.
- **C–F. Frontend, backend, data/API and persistence contract:** UI: OBSERVE-to-PAPER checklist links existing routes. Backend/API: OnboardingChecklist{step,complete,actionHref,blockedReason}; reuse /api/shell,/api/risk,/api/bot,/api/lab initially, no duplicate setup state.
- **Reuse / exact change boundary:** Add a guided projection over existing owner/policy/account/strategy state, preserving step-up.
- **G–H. Security and recovery:** No silent mode/strategy activation; completion reflects authoritative state and explicit owner actions. Preserve owner session/CSRF/step-up on any state change, paper/live separation and independent risk authority. Unknown/degraded dependencies cannot become fabricated success.
- **I. Required tests:** Fresh install, existing owner, rejected policy, no funds/strategy evidence, resume and keyboard/mobile journey.
- **J. Completion evidence:** No silent mode/strategy activation; completion reflects authoritative state and explicit owner actions. Record commit, actual executed commands/results and any missing browser/provider/host evidence before changing status.

## 092. Connections require manual technical debugging
- **Main / PR provenance:** Main provider registry/Connections; PR #7 protected/rate-limited APIs; guided credential capability check missing.
- **Status / current evidence:** `PARTIAL` — Connections page reads provider health/latency/license and optional credential-presence booleans; provider registry distinguishes pending credentials. No guided scoped read-only credential Test Connection endpoint exists.
- **A–B. Objective and behavior:** Address the original ticket objective above; activate/read/update/fail only as specified in its preserved source. No separate implementation is needed for already-present behavior.
- **C–F. Frontend, backend, data/API and persistence contract:** UI: per-provider diagnostics without key echo. Backend: ConnectionCheck{provider,status,scopes,checkedAt,reason}; only allowlisted read-only operations; no arbitrary URL/proxy or browser-secret storage.
- **Reuse / exact change boundary:** Reuse canonical provider registry/fetch path and existing server-side secret configuration.
- **G–H. Security and recovery:** Only verified capabilities displayed; absent balance/RPC/license remains pending. Actual external check requires owner-authorized credentials. Preserve owner session/CSRF/step-up on any state change, paper/live separation and independent risk authority. Unknown/degraded dependencies cannot become fabricated success.
- **I. Required tests:** Missing/bad credentials, rate limit, wrong scope, provider outage and redaction across UI/logs/LLM.
- **J. Completion evidence:** Only verified capabilities displayed; absent balance/RPC/license remains pending. Actual external check requires owner-authorized credentials. Record commit, actual executed commands/results and any missing browser/provider/host evidence before changing status.

## 093. Different skill levels need different views
- **Main / PR provenance:** Missing at frozen main/PR #7/PR #8; parent selected implementation milestone.
- **Status / current evidence:** `MISSING` — At frozen b624b52 App has theme and navigation preferences only; Overview has one expanded composition. No Simple/Analyst/Engineer view-mode preference/component exists. This is selected milestone work by parent, not a completed baseline feature.
- **A–B. Objective and behavior:** Address the original ticket objective above; activate/read/update/fail only as specified in its preserved source. No separate implementation is needed for already-present behavior.
- **C–F. Frontend, backend, data/API and persistence contract:** UI: validated localStorage viewMode simple|analyst|engineer and a clear selector; collapse/reorder only advanced details. Backend/API/schema: none, unchanged authoritative DTOs.
- **Reuse / exact change boundary:** Extend existing App/Overview composition; reuse all current navigation, risk and Joe components.
- **G–H. Security and recovery:** Presentation changes only; no hidden safety alert, backend state or financial-control difference. Preserve owner session/CSRF/step-up on any state change, paper/live separation and independent risk authority. Unknown/degraded dependencies cannot become fabricated success.
- **I. Required tests:** Persist/reload, invalid/unavailable localStorage, keyboard/mobile, identical account totals, all routes reachable, emergency/protection/origin still visible in every mode.
- **J. Completion evidence:** Presentation changes only; no hidden safety alert, backend state or financial-control difference. Record commit, actual executed commands/results and any missing browser/provider/host evidence before changing status.

## 094. International markets use inconsistent clocks
- **Main / PR provenance:** Main browser-local formatting and fixed-offset calendar; no complete IANA/currency contract.
- **Status / current evidence:** `PARTIAL` — `fmt.time` uses browser locale; calendar persists a numeric offset and changes daily attribution. This is not an IANA-zone/DST-aware global display contract. Settings unchanged Save currently sends tz??0 rather than displayed saved value.
- **A–B. Objective and behavior:** Address the original ticket objective above; activate/read/update/fail only as specified in its preserved source. No separate implementation is needed for already-present behavior.
- **C–F. Frontend, backend, data/API and persistence contract:** UI: zone/locale/display-currency selector only for supported conversions. Backend/settings: preserve UTC instants/base units; provenance for any conversion; unknown rates stay unavailable.
- **Reuse / exact change boundary:** Fix canonical preference use and separate display formatting from UTC ledger data; do not convert balances without sourced rates.
- **G–H. Security and recovery:** Timezone/currency presentation cannot alter true event instants or monetary ledger units. Preserve owner session/CSRF/step-up on any state change, paper/live separation and independent risk authority. Unknown/degraded dependencies cannot become fabricated success.
- **I. Required tests:** Untouched saved offset, explicit0, DST spring/fall, date boundary, missing FX rate and original-unit export.
- **J. Completion evidence:** Timezone/currency presentation cannot alter true event instants or monetary ledger units. Record commit, actual executed commands/results and any missing browser/provider/host evidence before changing status.

## 095. Trader Joe is primarily text-first
- **Main / PR provenance:** Missing text-to-speech implementation in inspected heads; existing Joe remains reusable.
- **Status / current evidence:** `MISSING` — Trader Joe page/drawer are text-first; no SpeechSynthesis/TTS/audio route, audio data type or voice-summary test found.
- **A–B. Objective and behavior:** Address the original ticket objective above; activate/read/update/fail only as specified in its preserved source. No separate implementation is needed for already-present behavior.
- **C–F. Frontend, backend, data/API and persistence contract:** UI: explicit optional listen action with text/source timestamp. Backend: optional BriefingAudio{textId,generatedAt,language} if server audio is selected; no microphone/trade command route.
- **Reuse / exact change boundary:** Reuse verified textual briefing and existing permission-safe Joe tools; no second assistant.
- **G–H. Security and recovery:** Read-only voice accurately corresponds to the same verified text; cannot trade or change permissions. Preserve owner session/CSRF/step-up on any state change, paper/live separation and independent risk authority. Unknown/degraded dependencies cannot become fabricated success.
- **I. Required tests:** Unsupported TTS, playback error, stale briefing, stop/unmount and redacted content; verify no order/policy calls.
- **J. Completion evidence:** Read-only voice accurately corresponds to the same verified text; cannot trade or change permissions. Record commit, actual executed commands/results and any missing browser/provider/host evidence before changing status.

## 096. Experimenting can contaminate the funded paper account
- **Main / PR provenance:** Main isolated backtest; PR #6 Twin; PR #7 Quant Academy immutable research experiments. General sandbox ledger clone missing.
- **Status / current evidence:** `PARTIAL` — Lab backtest/Twin use isolated research arrays/results; PR7 Quant Academy stores immutable experiments and dataset hashes separately, tested in knowledge.test.ts. No arbitrary separate virtual-ledger sandbox clone/namespace exists.
- **A–B. Objective and behavior:** Address the original ticket objective above; activate/read/update/fail only as specified in its preserved source. No separate implementation is needed for already-present behavior.
- **C–F. Frontend, backend, data/API and persistence contract:** UI: research origin badges and scoped runs. Backend: SandboxRun{id,datasetHash,strategyVersion,isolatedLedgerId,createdAt}; strict account/namespace ownership; no writes to PAPER_ACCOUNT.
- **Reuse / exact change boundary:** Reuse lab/Twin/research experiment stores and existing strategies; only add sandbox ledger namespace if new use actually needs one.
- **G–H. Security and recovery:** Research actions never change official paper orders/positions/cash; hypothetical outputs cannot become production strategy promotion. Preserve owner session/CSRF/step-up on any state change, paper/live separation and independent risk authority. Unknown/degraded dependencies cannot become fabricated success.
- **I. Required tests:** Snapshot clone/replay, failed experiment, namespace crossover and authoritative balance unchanged.
- **J. Completion evidence:** Research actions never change official paper orders/positions/cash; hypothetical outputs cannot become production strategy promotion. Record commit, actual executed commands/results and any missing browser/provider/host evidence before changing status.

## 097. User data is hard to move between tools
- **Main / PR provenance:** Main CSV history; PR #6 evidence hashes; PR #7 document originals/store. Versioned portable bundle import missing.
- **Status / current evidence:** `PARTIAL` — History CSV export and spreadsheet-formula guard exist; Quant Academy document originals/hash and DITAS snapshot hashes exist. No standard versioned all-evidence JSON/CSV import/export bundle with validated round-trip exists.
- **A–B. Objective and behavior:** Address the original ticket objective above; activate/read/update/fail only as specified in its preserved source. No separate implementation is needed for already-present behavior.
- **C–F. Frontend, backend, data/API and persistence contract:** UI: explicit export/import scope and preview. Backend: ExportBundle{schemaVersion,generatedAt,environment,items,checksum}; authenticated bounded routes only if needed; validate type/version/relationships and redact secrets.
- **Reuse / exact change boundary:** Extend canonical history/export and existing provenance stores, not a new ledger serializer.
- **G–H. Security and recovery:** Export retains environment/source IDs and import cannot overwrite immutable records or grant financial authority. Preserve owner session/CSRF/step-up on any state change, paper/live separation and independent risk authority. Unknown/degraded dependencies cannot become fabricated success.
- **I. Required tests:** Formula injection, bad checksum/schema/orphan IDs, duplicate import, limits and exact round-trip.
- **J. Completion evidence:** Export retains environment/source IDs and import cannot overwrite immutable records or grant financial authority. Record commit, actual executed commands/results and any missing browser/provider/host evidence before changing status.

## 098. System diagnostics are hidden from ordinary users
- **Main / PR provenance:** Main shell warnings; PR #7 expanded Overview/risk/worker/incident state. Unified explainer incomplete.
- **Status / current evidence:** `PARTIAL` — Expanded Overview shows risk policy/mode/incidents/scanner age/worker availability and empty states; App shows stale/policy/emergency banners. No single versioned OperationalExplainer reason map covers every waiting/degraded state.
- **A–B. Objective and behavior:** Address the original ticket objective above; activate/read/update/fail only as specified in its preserved source. No separate implementation is needed for already-present behavior.
- **C–F. Frontend, backend, data/API and persistence contract:** UI: friendly top next-step reason with safe route; emergency takes precedence. Backend: OperationalExplainer{state,reasonCodes,actionHref,since,latestEvidence} may extend current DTO if necessary; no state mutation.
- **Reuse / exact change boundary:** Compose existing /api/shell,/api/overview/bot/risk status; do not duplicate risk decisions in the browser.
- **G–H. Security and recovery:** Explain real blockers without calling every zero-candidate scan an error or masking danger as routine waiting. Preserve owner session/CSRF/step-up on any state change, paper/live separation and independent risk authority. Unknown/degraded dependencies cannot become fabricated success.
- **I. Required tests:** No policy, no funding, stale feed, no signal, strategy disabled, provider error, scheduler not run and emergency; unknown stays unknown.
- **J. Completion evidence:** Explain real blockers without calling every zero-candidate scan an error or masking danger as routine waiting. Record commit, actual executed commands/results and any missing browser/provider/host evidence before changing status.

## 099. Monitoring from a phone remains limited
- **Main / PR provenance:** Missing PWA manifest/service worker; main responsive SPA and PR #7 mobile navigation reusable.
- **Status / current evidence:** `MISSING` — Responsive CSS/mobile navigation and session auth exist. No application manifest, service worker/PWA offline cache or push capability found in source.
- **A–B. Objective and behavior:** Address the original ticket objective above; activate/read/update/fail only as specified in its preserved source. No separate implementation is needed for already-present behavior.
- **C–F. Frontend, backend, data/API and persistence contract:** UI: opt-in install/push; last-known timestamp when offline. Backend: secure subscription endpoint only if approved; service worker caches static assets, never authenticated API data publicly.
- **Reuse / exact change boundary:** Keep responsive SPA; evaluate separately whether PWA adds value before new infra/dependencies.
- **G–H. Security and recovery:** Offline cached data visibly LAST KNOWN; emergency operations never silently queue and browser gets no signer/withdrawal authority. Preserve owner session/CSRF/step-up on any state change, paper/live separation and independent risk authority. Unknown/degraded dependencies cannot become fabricated success.
- **I. Required tests:** Mobile offline/reconnect/auth expiry/cache clearing, user opt-in, replay/rejected queued emergency action.
- **J. Completion evidence:** Offline cached data visibly LAST KNOWN; emergency operations never silently queue and browser gets no signer/withdrawal authority. Record commit, actual executed commands/results and any missing browser/provider/host evidence before changing status.

## 100. No single proof that autopilot is ready unattended
- **Main / PR provenance:** Main QA/audit/reconciliation; PR #7 incident/evidence additions. Signed complete readiness/24h evidence absent.
- **Status / current evidence:** `PARTIAL` — Current Release Gates display, audit/reconciliation checks and owner live lock exist; no signed unified AutopilotCertification includes host uptime, actual24h soak, restored backup and independent sign-off. Generic test evidence currently overstates several gates.
- **A–B. Objective and behavior:** Address the original ticket objective above; activate/read/update/fail only as specified in its preserved source. No separate implementation is needed for already-present behavior.
- **C–F. Frontend, backend, data/API and persistence contract:** UI: owner-reviewed readiness checklist with explicit UNTESTED/BLOCKED. Backend: AutopilotCertification{version,gitSha,checks,reviewer,status,evidenceIds,issuedAt}; append evidence/signature scope only after trust model review.
- **Reuse / exact change boundary:** Extend current QA/evidence system after fixing ticket080 attribution; do not add a parallel release authority.
- **G–H. Security and recovery:** One untested safety-critical item prevents unattended certification. This UI milestone and green CI do not certify live trading or24h operation. Preserve owner session/CSRF/step-up on any state change, paper/live separation and independent risk authority. Unknown/degraded dependencies cannot become fabricated success.
- **I. Required tests:** Missing/skipped/wrong-commit evidence, expired signature, partial soak, failed restore, stale feeds and owner refusal; assert no live mode unlock.
- **J. Completion evidence:** One untested safety-critical item prevents unattended certification. This UI milestone and green CI do not certify live trading or24h operation. Record commit, actual executed commands/results and any missing browser/provider/host evidence before changing status.
