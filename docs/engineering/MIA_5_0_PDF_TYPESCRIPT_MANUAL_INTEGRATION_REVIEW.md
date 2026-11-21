# MIA 5.0 — Unified PDF-to-Repository Feature Enhancement Master Document

**Status: DOCUMENTATION ONLY. No production code, dependencies, database, trading mode, orders, exchange credentials or LIVE authority changed.**
**Review:** 2026-11-21 | **Repo:** [Naokiri5/naokiri](https://github.com/Naokiri5/naokiri) | **Baseline:** [unmerged PR #45](https://github.com/Naokiri5/naokiri/pull/45), branch `claude/mia-unified-01`.

This review uses the owner's complete uploaded **49-page PDF**, not a guessed feature list. It separates **unaltered source evidence** from **new review conclusions**. The PDF claims to be `server/src/mia-unified-core.ts` and proposes six core modules; that claim is not proof the implementation already runs in GitHub.

## One unified decision: what the PDF changes — and what it does not

The uploaded PDF is a **source-preserved technical proposal**, **not an installed MIA 5.0 engine**. Its six proposed modules must be assessed against the current MIA source of truth *before* any code is introduced. MIA already has NEXUS event contracts, a risk gate, paper OMS/ledger, monitored exits, supervised bot and owner-authenticated telemetry. The PDF cannot be pasted in as a second trading core.

This page is the **single canonical PDF-to-MIA enhancement specification**. It incorporates the PDF module audit, fifteen concrete risks, a nonduplicating implementation register, the user's eight selected priorities, PAPER/LIVE parity requirements, and acceptance gates. The pre-existing [eight-priority SENSE/THINK/DEFEND/ACT traceability](MIA_OMEGA_FOUR_LAYER_TRACEABILITY.md) remains the linked engineering owner inventory; do not duplicate the code or maintain conflicting plans.

| Decision | Modules / areas | Exact interpretation |
| --- | --- | --- |
| **REUSE — no replacement** | MIA-CORE-01 event fabric; CORE-02 financial ledger; CORE-03 risk authority; CORE-04 protective exits; CORE-05A paper OMS; CORE-06 boot/SSE | Canonical implementations already exist on unmerged PR #45. Change their existing owners only for verified gaps |
| **EVALUATE IN RESEARCH FIRST** | 5-second markout, VPIN/OFI context, regime sizing, five-stage exit challenger, queue/partial-fill modeling, operator telemetry | Treat PDF formulas/thresholds as unvalidated hypotheses. Require event-time data, backtesting, negative cases and reproducible evidence |
| **BLOCK UNCONDITIONALLY IN THIS BUILD** | MIA-CORE-05B signed Bybit LIVE orders, replacement ledger, second risk governor, automatic exchange-state overwrites, separate orchestration | No live-money trading or new order authority; MIA's `LIVE_EXECUTION_AVAILABLE=false` is unchanged |
| **OUTSIDE PDF SCOPE** | Hunt Radar, Solana safety completion, Social Calls Radar, B-MIND integration, full Trader Joe UI | Follow the separate existing/stacked code owners; PDF does not implement these features |

**Source-preservation rule:** Original PDF text and the unedited TypeScript are archived separately under `docs/engineering/sources/` and are not changed by updates to this review. Original words and line wrapping remain intact, including known extraction defects; this document contains *new analysis*, clearly separated from source material.

## 1. Original source preservation — no words silently removed or edited

| Reference | Contents / guarantee |
| --- | --- |
| [Entire 49-page PDF text transcription](sources/MIA_5_0_UNIFIED_CORE_PDF_VERBATIM.txt) | Every page was extracted, including the introductory module map, full TypeScript, the final Quick Integration Check, original line breaks, page breaks and invisible U+200B characters. The committed GitHub copy was fetched back and **exactly matched the complete extraction** (73,860 characters, 49 pages). |
| [TypeScript section only — unedited, non-executable](sources/MIA_5_0_UNIFIED_CORE_TYPESCRIPT_UNEDITED.ts.txt) | An exact contiguous substring of the full transcription, from the PDF's first code-like line to the final closing brace, with **no corrections or reorganizing** (68,717 characters). Saved as `.ts.txt` to avoid accidental compilation or importing a real-money adapter. |
| **Original 49-page uploaded PDF** | The original PDF attachment is the definitive source for any visual ambiguity. SHA-256 of original PDF bytes: `37750d5e195fa88bb6d4a29bb4b7e016aff43823a61da7da24ae822cf4993336`; size 335,235 bytes. The PDF binary was not claimed to be GitHub-hosted or byte-identical to text extraction. |

**Accuracy note:** PDF extraction cannot recover an underlying original .ts file byte-for-byte. The uploaded PDF itself has page wrapping that splits strings and a displaced block of TypeScript at the beginning. The archived text is strictly unedited *relative to the PDF extraction*; the original PDF remains authoritative. Any later corrected/compilable candidate must be kept in a **different** file and independently reviewed; do not modify either source-preservation file.

The PDF's instruction to drop its code into `server/src/mia-unified-core.ts` is preserved as **quoted original source**, NOT approved integration guidance.

## 2. Complete labeled feature inventory — matched to the existing MIA repository

| PDF module / pages | Manually identified features | Existing owner in PR #45 | Duplication decision |
| --- | --- | --- | --- |
| **MIA-CORE-01**, pp. 3–10 | `NexusFabricRouter`, strict-intent DAG publisher roles, typed market/regime/signal/exit/fill topics, Worker/MessagePort fan-out, five-second TCA markout | `server/src/fabric/contracts.ts`, `fabric/catalog.ts`, `fabric/outbox.ts`, `fabric/relay.ts`, `core/bus.ts`, `market/fabric.ts` | **Do not add another event fabric.** Five-second verified markout sampling is a possible research-only increment |
| **MIA-CORE-02**, pp. 10–19 | `CanonicalPositionLedger`, independent SQLite WAL tables, weighted fills/PnL, local position map, fill replay dedupe, exchange snapshot drift overwrite | `server/src/db/db.ts`, `db/migrations.ts`, `portfolio/ledger.ts`, `exec/oms.ts` | **Critical duplicate financial ledger.** Preserve existing account-specific ledger; use only safe reconciliation requirements |
| **MIA-CORE-03**, pp. 19–28 | `UnifiedRiskGovernor`, daily/hard drawdown breakers, macro veto, VPIN/markout toxicity, static correlated buckets, Kelly/regime sizing, emergency flatten intents | `risk/gate.ts`, `risk/policy.ts`, `core/mode.ts`, `portfolio/stress.ts`, `ditas/calibration.ts`; [PR #67](https://github.com/Naokiri5/naokiri/pull/67) overlaps | **Critical duplicate risk authority.** Investigate missing market-toxicity and sizing evidence in research/shadow scope only |
| **MIA-CORE-04**, pp. 28–34 | `ExitSupervisor`; five-stage hard/BE stop, regime-scaled partial TP/fee lock, ATR chandelier, OFI/VPIN exhaustion, time stop | `lab/exits.ts`, `exec/oms.ts` protective monitor, `exec/incidents.ts` | **Duplicate active exit supervisor.** Study proposed exits as challengers in Strategy Lab/DITAS |
| **MIA-CORE-05A**, pp. 34–39 | `PaperOmsAdapter`, in-memory order states, synthetic top-three depth, fabricated 60%/40% partial fills, post-only and IOC logic, fee timers | `exec/oms.ts`, `exec/environment.ts`, `market/quality.ts`, `portfolio/ledger.ts` | **Duplicate PAPER OMS.** Partial-fill/queue behavior belongs in research until reviewed |
| **MIA-CORE-05B**, pp. 39–46 | `LiveOmsAdapter`, signed Bybit V5 order/cancel REST, private WS executions, reconnect, reconciliation, client IDs, dead-man REST timer | `exec/environment.ts` contains **LOCKED** adapter; [PR #64](https://github.com/Naokiri5/naokiri/pull/64) contains read-only venue assessment | **Do not activate.** New real-money order authority conflicts with the existing LIVE lock |
| **MIA-CORE-06**, pp. 46–49 | `MiaUnifiedCore`, startup ledger/risk/OMS construction, boot order, Express SSE handler, status topics, heartbeat/shutdown | `server/src/index.ts`, `bot/bot.ts`, `ops/lease.ts`, `ops/readiness.ts`, `api/routes.ts`, `api/sse.ts` and `joe/live/*` | **Duplicate engine and SSE infrastructure.** Adapt only truthful operator-facing views to existing code |

The PDF's **six core IDs** are complete; `MIA-CORE-05` is split into PAPER `05A` and signed Bybit LIVE `05B`. The PDF is an **architecture proposal with code**, not a tested six-feature release.

### Features actually present in the PDF

1. Event topics with a caller-supplied role check and in-process Worker fan-out; five-second post-fill markout.
2. Second SQLite database/position table with fill deduplication, realized/unrealized PnL and exchange drift update.
3. Drawdown, macro, VPIN, adverse markout, fixed correlated buckets and quarter-Kelly/regime-based sizing.
4. Five-stage exit waterfall including ATR, OFI/VPIN and time-based rules.
5. Synthetic PAPER and signed Bybit LIVE order adapters, state machine, partial fills, REST/WS and dead-man requests.
6. New orchestrator and SSE telemetry endpoint.

### Features **not** supplied by the PDF

No complete implementation of **TITAN HUNTER/Hunt Radar**, **Solana holder/LP/sellability/Pump.fun safety**, **feed-provider failover**, **Social Calls Radar**, **B-MIND/decision certificates**, **robust historical challenger framework**, or **Trader Joe Live UI** appears in the PDF. These are separate priorities in [the existing unified eight-priority plan](MIA_OMEGA_FOUR_LAYER_TRACEABILITY.md). Do not claim the PDF completes them.

## 3. GitHub compatibility and authoritative file ownership

Reviewed on open PR #45:

- `server/package.json` currently identifies `@mia/server` v4.1.0 and depends on **Fastify**. It does **not** declare the PDF's `better-sqlite3`, `express`, or `ws` packages. The PDF's v5.0 banner is not the installed app version.
- `server/src/db/db.ts` uses `DatabaseSync` from **`node:sqlite`**, migrations, WAL and existing owner-only protections. The PDF's `new Database(sqlitePath)` would be an unrelated connection/schema.
- `portfolio/ledger.ts` already has account-specific PAPER entries and position state. `exec/oms.ts` already handles simulated PAPER fills, risk rechecks, lease fencing, transaction boundaries, protection and reconciliation assumptions.
- `risk/gate.ts` is the **canonical fail-closed risk gate**. A new `UnifiedRiskGovernor` must not independently approve trades.
- `exec/environment.ts` already has an adapter contract and `LockedLiveExecutionAdapter` that refuses commands. `core/mode.ts` explicitly sets `LIVE_EXECUTION_AVAILABLE = false`.
- `fabric/contracts.ts`, `fabric/catalog.ts`, `fabric/outbox.ts`, `fabric/relay.ts` and `core/bus.ts` already own event schema and delivery. A new EventEmitter/router cannot supersede their source-of-truth and import-boundary checks.
- `lab/exits.ts`, `exec/oms.ts` and `exec/incidents.ts` already handle exits and incidents.
- `index.ts`/`bot/bot.ts` already provide supervised startup/leader leases; `api/routes.ts` and `api/sse.ts` own Fastify and SSE lifecycle.
- `ditas/execution.ts` and `joe/live/*` already provide research execution-quality evidence and read-only committed PAPER event narration.

**Do not confuse existing paper orchestration with current LIVE execution:** the bot currently submits PAPER through the existing `exec/oms.ts` under the fencing/control flow. The locked LIVE adapter is not a licensed venue connector. No PDF class is present as the authoritative running implementation merely because it is now copied into docs.

## 4. Manual defects and unsafe assumptions — original PDF, unmodified

These findings describe the **proposal** and what would happen if it were installed, not a known failure in the current MIA code.

| ID | Severity | PDF evidence and actual concern |
| --- | --- | --- |
| PDF-01 | **BLOCKER** | Pages 2–3 contain displaced `takeProfitPrice`/`regimeAtEntry`/`riskUsd` lines before the banner. Many PDF wraps split single-quoted TypeScript SQL/error strings. The verbatim extraction contains roughly 1,962 U+200B zero-width characters. A diagnostic attempt to parse the extracted code with TypeScript reported `TS1002` unterminated-string errors. It is not a valid drop-in TypeScript module as extracted. |
| PDF-02 | **CRITICAL** | MIA-CORE-06 constructs `new LiveOmsAdapter(...)` whenever config says LIVE, and 05B sends signed Bybit `POST /v5/order/create`. It has no connection to MIA's `LIVE_EXECUTION_AVAILABLE` lock, owner release gates or existing paper bot authority. **Directly installing it could bypass LIVE safety.** |
| PDF-03 | **CRITICAL** | MIA-CORE-02 creates new `canonical_positions`, `processed_fills` and `account_state` on a separate finance DB. It keys position state by symbol, not scoped owner+account+venue. This is a competing ledger and cannot be merged into current PAPER/LIVE accounting. |
| PDF-04 | **CRITICAL** | `reconcileExchangeSnapshot` deletes locally held positions when absent from a passed remote list, without an explicitly verified complete snapshot, stable epoch, account scope or transactional cross-check. A partial response could erase a protected but still open position. |
| PDF-05 | **HIGH** | Fill dedupe uses `clientOrderId:tsMs:filledQty:avgFillPrice`, not a unique venue execution ID. Two distinct equal-sized/equal-price executions at the same time could collide, and reconnect replays need stronger identity. |
| PDF-06 | **HIGH** | LIVE `submitApprovedOrder` can set `REJECTED` after a REST exception, although the exchange might have accepted the order and the response was lost. This is an **UNKNOWN** order state requiring query/reconciliation, not automatic reject/retry. |
| PDF-07 | **HIGH** | Router's `publishFromRole(role,...)` accepts caller-asserted roles. A role string plus EventEmitter is not an authentication boundary, durable write log, independent risk gate or authoritative OMS. |
| PDF-08 | **HIGH** | Risk governor and ledger maintain separate equity/realized PnL numbers and exchange-derived state; paper entry fees and close transitions need account-specific double-entry reconciliation, not parallel finance calculations. |
| PDF-09 | **HIGH** | `resetDailyAnchor` directly calls `setGlobalHalt(false)` and clears drawdown halt, without an owner-reviewed recovery/active-incident guard. It must not silently resume trading. |
| PDF-10 | **HIGH** | Exit trail, partial-TP and in-flight timer are local Maps. Restart resets some state and the open duration is derived from a position update, not necessarily true entry time. Confirmed protective stops and unknown order outcomes are not proven. |
| PDF-11 | **HIGH** | The new PAPER OMS invents 60%/40% partial fills from a depth threshold; post-only matching ignores realistic queue priority. It could create misleading paper PnL if treated as real fills; use as explicit research model only. |
| PDF-12 | **HIGH** | SSE uses Express `Request/Response` rather than MIA Fastify, has no explicit owner authorization or field redaction in the method, and does not show bounded stream backpressure/replay. Never mount as a public financial endpoint. |
| PDF-13 | **HIGH** | The dead-man HTTP call and private WebSocket do not establish full durable order lifecycle, verified venue-native protective stops, signer isolation, unknown outcomes and recovery certification. Do not label LIVE "ready". |
| PDF-14 | **MEDIUM** | The module map promises `registerWorkers` during startup, while the visible `boot()` only reconciles risk, rebroadcasts positions and starts OMS. Documented pipeline is not wired as described. |
| PDF-15 | **MEDIUM** | The five-second markout timer reads the latest in-memory frame without an explicit provider-time freshness/quality check. Stale quotes should produce unavailable research results rather than misleading toxicity statistics. |

Risk thresholds and sizing numbers in the PDF are **untested design constants**, not validated MIA policy. No owner approval, provider license, live-trading venue readiness, OOS performance test or actual integrated build evidence accompanies this PDF.

## 5. Non-duplicating feature proposals extracted from the PDF

These are the **genuine candidates to develop later**, inside the existing system, not six new engines:

| Candidate improvement | Extend existing files (do not replace) | Scope / evidence required |
| --- | --- | --- |
| Verified five-second markout/TCA | `ditas/execution.ts`, `ditas/memory.ts`, `market/quality.ts`, `fabric/catalog.ts` | Read-only post-fill research with true source timestamps, stable event IDs, fee/slippage markout and abstention for stale books |
| Flow toxicity (VPIN/OFI) | `market/cexActivity.ts`, `features/`, `ditas/`, `decision/certificate.ts` | Initially watch/research-only; calibrated thresholds, input integrity, independent OOS test and uncertainty; no risk override |
| Macro and correlated risk | `risk/gate.ts`, `risk/policy.ts`, `portfolio/stress.ts`; reconcile PR #67 | Shadow-veto evaluation first; policy review, account isolation, missing-source behavior, fail closed |
| Regime/Kelly sizing | `lab/`, `ditas/calibration.ts`, `risk/policy.ts` | Compare with current sizing in a frozen challenger; no live/paper policy promotion by default |
| Five-stage exit waterfall | `lab/exits.ts`, `lab/backtest.ts`, `ditas/twin.ts` | Alternative research strategy only; include time stamps, depth, fees, gaps, partials and honest stop priority |
| Partial/queued fill simulation | `lab/backtest.ts`, `ditas/twin.ts`, `ditas/execution.ts` | Shadow execution scenarios, not a second financial ledger or live OMS |
| Account-scoped venue reconciliation | Future reviewed venue integration; `exec/environment.ts`; review PR #64 | Read-only evidence first, verified complete snapshots, order/exec IDs, no destructive unknown-state handling; LIVE stays locked |
| Operational telemetry | `api/routes.ts`, `api/sse.ts`, `joe/live/*`, `ops/readiness.ts` | Existing owner-protected endpoints, read-only PAPER truth, source freshness, backpressure, replay and LIVE LOCKED label |
| Producer DAG and ordered delivery | `fabric/contracts.ts`, `catalog.ts`, `outbox.ts`, `relay.ts` and `import-boundaries.test.ts` | Extend existing NEXUS contracts, never create a second routing authority |

## 6. PAPER and LIVE architecture requirements

**One source/analysis system; separate, independently validated financial accounts:**

~~~text
Current verified market observations, source/event/receive clocks
  -> Existing market scanner -> workers / QCI -> decision and DITAS evidence
  -> Existing independent risk check using a specific account/venue/policy
      -> PAPER: existing exec/oms.ts and PAPER ledger, simulated orders only
      -> LIVE: LockedLiveExecutionAdapter, NO REAL MONEY ORDERS
  -> Existing owner-only journal / Trader Joe / operations UI
~~~

Every proposed research capability may be visible in PAPER and LIVE **analysis views**, but LIVE order/position/fill/PnL records must never be synthesized from PAPER records. Source equality does not mean execution permission. No prediction, VPIN signal, Kelly result, PDF engine or owner deposit unlocks the current LIVE lock.

## 7. Relationship to the eight selected MIA development priorities

| Priority | How the PDF relates | Correct existing work |
| --- | --- | --- |
| 1 — PR reconciliation | **Required** before changing any canonical owner | Unified PR #45 first, plus #64 venue read-model, #67 macro/shadow risk, #44 Trader Joe and all relevant stacked PRs |
| 2 — TITAN HUNTER | **Not implemented by PDF** | `hunt/ranker.ts`, `market/discover.ts` and existing UI |
| 3 — Solana safety | **Not implemented by PDF** | Reconcile #46 → #50 → #51 → #52; never use a Bybit OMS as Solana safety validation |
| 4 — Market feeds | Markout/event-time ideas only | `market/fabric.ts`, `depthStream.ts`, `quality.ts`; preserve open-position priority |
| 5 — Social Calls Radar | **Not implemented by PDF** | Existing licensed sources / `news/` and DITAS research history |
| 6 — Certificates and B-MIND | VPIN/regime research input concept only | Existing certificate/DITAS plus B-MIND PRs #56/#61 |
| 7 — Historical challengers | Exit/Kelly/partial-fill **hypotheses** | Existing `lab/` and `ditas/`; do not treat PDF thresholds as OOS-tested |
| 8 — Trader Joe Live | SSE/telemetry idea only | Existing `joe/live/`, owner API, dashboard and PR #71 status UI |

Detailed ownership, PR graph and acceptance tests are in [MIA Ω four-layer traceability](MIA_OMEGA_FOUR_LAYER_TRACEABILITY.md).

## 8. Proposed documentation-first development order and test gates

1. **D0 — complete:** preserve PDF source without editing it, manually identify all `MIA-CORE-01..06` and `05A/05B`, map to GitHub, and record blockers.
2. **D1 — mandatory:** reconcile current PR #45 with #64/#67 and overlaps; compare changed-file owners, code behavior, schema migration order, CI and security review; record each candidate as `EXISTS`, `PARTIAL`, `DUPLICATE`, `RESEARCH_ONLY`, `BLOCKED`.
3. **D2 — review only:** design optional event-time markout/flow observations using the existing NEXUS catalog and DITAS schema (source+account+timestamp+event ID, no finance writes).
4. **D3 — research only:** verify toxicity and exit/Kelly challengers on frozen histories including rejected signals, stale market data, costs, gaps, delistings, fee assumptions, OOS and negative controls.
5. **D4 — safe UI:** enhance current Joe/readiness views with committed PAPER events, telemetry and explicit LIVE LOCKED status; test owner access, SSE disconnect, backpressure and replay.
6. **D5 — separate future project:** design LIVE venue/order/ledger isolation only after explicit owner approval and an independently reviewed certification plan; this PDF provides **no authorization** to activate real-money trading.

**Required tests before any later coding merge:** event publisher/import boundaries, source clock/replay, unique exchange execution IDs, partial/unknown fill and duplicate delivery, snapshot incompleteness, account/venue separation, crash/restart while a stop or partial exit is in flight, active halt over UTC reset, markout stale-quote abstention, risk vetoes, strategy champion/challenger cost and OOS, Joe privacy and load/fault tests, plus full repository CI and owner review. Preserve current `risk.test.ts`, `oms.test.ts`, `import-boundaries.test.ts`, `lab.test.ts`, `think-replay.test.ts`, `depth-stream.test.ts` and `joe-live.test.ts`.

**Final manual judgment:** Copy the entire proposed TypeScript **as a source reference**, **not as runnable code**. Most modules would duplicate your existing MIA engine and some introduce critical real-money risks. The defensible new work is narrowly scoped, research-first markout/TCA, flow context, challenger rules and read-only operational evidence through current modules. No production files were touched by this documentation effort.

## 9. Unified implementation register — exact work, existing owner, no duplicates

This register turns the PDF's six modules and the eight priority areas into **reviewable development candidates**, not permission to add a new trading engine. `PENDING` means **not delivered** by the documentation effort. Earlier code in PR #45 or stacked PRs must be reconciled first.

| ID / source | Minimal enhancement, not replacement | Extend existing code | Current reality / review gate |
| --- | --- | --- | --- |
| **UNI-01 — CORE-01** | Research-only five-second post-fill markout; return `UNAVAILABLE` if source time, 5s window or quote freshness cannot be verified | `ditas/execution.ts`, `market/quality.ts`, `fabric/catalog.ts`, existing read models | **PENDING.** Source/receipt clocks, actual committed PAPER fill IDs, replay stability, zero trading imports |
| **UNI-02 — CORE-01** | Enforce registered producer identity and event direction with existing NEXUS contract and static boundaries | `fabric/contracts.ts`, `fabric/catalog.ts`, `fabric/relay.ts`, `test/import-boundaries.test.ts` | **PARTIAL in #45.** Reject caller-asserted roles, duplicate event IDs, malformed provenance and unauthorized mutator imports |
| **UNI-03 — CORE-02** | Add read-only, account-scoped discrepancy classifications for position/order snapshots; never delete a position because an exchange response omitted it | `exec/environment.ts`, future verified venue read model, `ops/readiness.ts`; reconcile PR #64 | **PENDING.** Partial snapshot must yield `INCOMPLETE`; execution IDs, venue/account scope and epoch required |
| **UNI-04 — CORE-03** | Observe VPIN, OFI and post-fill adverse selection as *uncalibrated research*, without new risk approval authority | `market/cexActivity.ts`, `features/`, `ditas/`, `decision/certificate.ts` | **PENDING.** Data gaps and ambiguous samples abstain; OOS reliability before policy changes |
| **UNI-05 — CORE-03** | Assess macro veto and correlation-bucket ideas against existing policy using shadow outcomes | `risk/gate.ts`, `risk/policy.ts`, `portfolio/stress.ts`; reconcile PR #67 | **PARTIAL/STACKED.** Existing gate is sole authority; no synthetic policy bypass |
| **UNI-06 — CORE-03** | Compare regime-specific fractional-Kelly sizing with current sizing using independent validation | `lab/`, `ditas/calibration.ts`, `risk/policy.ts` | **PENDING research.** PDF multipliers are hypotheses, never auto-applied |
| **UNI-07 — CORE-04** | Test five-stage exit logic as a Strategy Lab challenger against current exit capsule | `lab/exits.ts`, `lab/backtest.ts`, `ditas/twin.ts` | **PENDING research.** Keep existing OMS stop/incident controls; simulate gaps, fees, slippage, insufficient depth and restarts |
| **UNI-08 — CORE-05A** | Investigate explicit queue, IOC/post-only and partial-fill models in *hypothetical* execution studies | `lab/backtest.ts`, `ditas/twin.ts`, `ditas/execution.ts` | **PENDING research.** Do not insert invented 60/40 fills into real PAPER order history |
| **UNI-09 — CORE-05B** | Review future LIVE venue lifecycle and credential/isolation requirements, **without** adding a signer | `exec/environment.ts`, `core/mode.ts`, review PR #64 | **LIVE LOCKED.** Unknown order outcomes, idempotency, real protected stops, reconciliation and owner authorization required before any future build |
| **UNI-10 — CORE-06** | Display truthful process/stream/recovery state and linked event evidence in existing operator UI | `ops/readiness.ts`, `api/sse.ts`, `joe/live/`, `web/src/` | **PARTIAL in #45.** Fastify owner authentication, redaction, bounded reconnect/replay and PAPER labels |
| **UNI-11 — Priority 2** | Connect existing cached TITAN HUNTER ranker to authenticated Asset Discovery watch-only results | `hunt/ranker.ts`, `market/discover.ts`, `market/store.ts`, existing Markets view | **PARTIAL in #45.** Authoritative provider timestamp required; no DEX timestamp fabrication or auto-order routing |
| **UNI-12 — Priority 3** | Integrate already-written Solana launch/mint/watch evidence into the existing safety model; add missing holder/LP/exit checks only after source verification | `safety/safety.ts`, `providers/dexscreener.ts`, `market/discover.ts`; reconcile #46/#50/#51/#52 | **STACKED OPEN.** Keep token vs pool identities distinct, unknown = unverified; no trade permissions |
| **UNI-13 — Priority 4** | Certify feed freshness, sequence recovery, failover and open-position priority under adverse conditions | `market/depthStream.ts`, `market/fabric.ts`, `market/quality.ts`, `bot/bot.ts` | **PARTIAL in #45.** Existing snapshot/gap resync already present; require outage and protection-lag tests |
| **UNI-14 — Priority 5** | Add historically attributable Social Calls Radar observations and retrospective outcomes **without social-to-OMS wiring** | Existing `news/`, source/provider registry and `ditas/` | **MISSING/UNVERIFIED.** Permissioned sources, original call time, deduplication, bias flags and cost-aware outcomes |
| **UNI-15 — Priority 6** | Connect source-validated B-MIND context as *optional frozen evidence* within the existing certificate/DITAS record | `decision/certificate.ts`, `ditas/`; reconcile #56/#61 | **STACKED OPEN.** Evidence absent = UNKNOWN, not zero or certainty; QCI/risk vetoes remain authoritative |
| **UNI-16 — Priority 7** | Test champion/challenger historical outcomes on matched event-time universes, including rejected and delisted assets | `lab/`, `ditas/twin.ts`, `ditas/replay.ts` | **PARTIAL in #45.** OOS, leakage checks, real costs, no silent promotion |
| **UNI-17 — Priority 8** | Complete existing Trader Joe event timeline, status panels and safe reconnect UX without fictitious LIVE records | `joe/live/`, `api/routes.ts`, `api/sse.ts`, `web/src/pages/Joe.tsx`; review #44/#71 | **PARTIAL in #45.** Committed PAPER state only, owner permissions, idempotent cursor, accessible UI |

### Standard acceptance record for every UNI ticket

Before implementing any UNI ticket, its owner shall record: **(a)** existing file/function and checked commit SHA, **(b)** why the requested behavior is not already available, **(c)** conflicts with open PRs and schema/version dependencies, **(d)** narrow code diff against the canonical owner, **(e)** negative and account-isolation tests, **(f)** performance/replay/fault evidence, **(g)** rollout/rollback and observability, and **(h)** explicit owner review. A PR having a name or code snippets is not evidence of runtime integration. **Do not mark a ticket complete because this document was committed.**

## 10. Manual code integration order — preserve PAPER and lock LIVE

1. **R0 — reconcile PR #45 and relevant stacked PRs first.** At a minimum review the actual heads and overlapping changed files for #19 (Hunter), #44 (Joe), #46/#50/#51/#52 (Solana), #56/#61 (B-MIND), #64 (venue read model), #66/#67 (risk), #71 (environment UI), and #75/#76 (security). Assign every candidate one actual owner: `EXISTING`, `ENHANCE`, `STACKED_AWAITING_RECONCILIATION`, `DUPLICATE_SKIP` or `LIVE_BLOCKED`.
2. **Research-first changes:** prioritize UNI-01/02 and UNI-04/06/07/08 as source-verified, deterministic and read-only calculations using the existing fabric, DITAS and lab. Never use PDF constants as production risk thresholds without independent evidence.
3. **Complete existing feature surfaces:** UNI-11 Hunter Radar, UNI-12 Solana safety and UNI-13 feed resilience. The currently scheduled paper bot and scanner remain canonical; research rankings never create orders themselves.
4. **Attach missing intelligence without authority:** UNI-14 social historical evidence and UNI-15 B-MIND source-backed hypotheses, then UNI-16 matched challenger evaluation. No replacement decision engine or risk gate.
5. **Complete truth-based operator reporting:** UNI-10/17 use the existing Fastify/SSE/Joe pages and committed PAPER records with live environment capability displayed honestly as `LOCKED`.
6. **Future, separately scoped LIVE work:** UNI-03/09 are *design/reconciliation tasks only* in this plan. LIVE execution is not enabled by paper tests, PDF source code, an approval score or a deposit. A signer, venue client, order recovery and account-specific financial ledger would require a separately approved release and safety certification.

## 11. Mandatory preservation and regression matrix

| Test family | What must remain true |
| --- | --- |
| **Canonical architecture** | One `market/scanner.ts`, one `qci/coordinator.ts`, one `risk/gate.ts`, one `exec/oms.ts` for PAPER, one `portfolio/ledger.ts`, current bot lease fence and current mode gate |
| **Source trust** | Untrusted social/on-chain strings, malformed timestamps, missing event clocks, stale books, duplicate IDs, inconsistent quote depths and provider gaps fail closed or become research-only |
| **Account boundaries** | PAPER writes may touch only the PAPER account; research in a LIVE screen never inherits PAPER balances, ledger entries, fill IDs, protected positions or authorization |
| **Order finality** | Lost acknowledgements are `UNKNOWN` until reconciled; replayed fills use venue execution identity, not wall-clock coincidence; incomplete position snapshots cannot erase an open position |
| **Exit safety** | Protective monitoring and incident reporting still work after restart/disconnect; local PDF timers are not a substitute for persisted order/protection state |
| **Quality and evaluation** | Backtests include fees/spread/slippage, missing data, walk-forward/holdout, survivorship/delistings, rejected opportunities, adverse market regimes and counterfactual assumptions |
| **UI truth** | Joe explains only committed PAPER activity; LIVE is displayed as unavailable/locked until certified; no synthetic wallet amounts, exchange fills, guaranteed return or implied endorsement |
| **Release** | Existing unit/integration/E2E/security CI passes on the actual target head, negative tests are included, owner signs off, no automatic PR merge or production deployment |

**Final boundary:** This entire master document and the accompanying source copies are documentation artifacts. Nothing here is a claim that the six PDF modules or all eight MIA priorities have been integrated, or that the PDF source is deployable, compiled, production-safe or trading-eligible.

## 12. Swarm PDF ingestion — 97-slot features, 100 agents and worker threads (2026-11-21)

**New owner-supplied sources:** a 104-page MIA5 Swarm Monolith PDF and a 59-page `agentDefinitions100.ts` PDF. Both have been inspected end-to-end and archived as **unedited PDF text extracts**, separate from the existing 49-page trading-core archive. The original uploaded PDF binary files remain the authoritative sources for precise formatting; extracted text is **not** asserted to be byte-identical to a TypeScript file.

- [Complete 104-page source extract](sources/MIA5_SWARM_MONOLITH_104P_PDF_VERBATIM.txt): `FeatureVectorBuilder`, 97 enumerated `FeatureSlot` values, 100 `ALL_100_AGENTS`, `SwarmThreadPool`, worker-thread aggregation and 4 ms asserted hard deadline.
- [Complete 59-page source extract](sources/MIA5_AGENT_DEFINITIONS_59P_PDF_VERBATIM.txt): the standalone 100-agent definitions from `AGT-001` through `AGT-100`, with the same 97 positional slot names. This overlaps the agent-definition section of the 104-page PDF; **do not install both**.

### Manual TypeScript identification and repository comparison

| PDF construct | Manual source identification | Existing MIA canonical owner | Decision |
| --- | --- | --- | --- |
| `FeatureVectorBuilder` and its 97 fixed slots | OHLCV/ring-buffer indicators, books, tape, derivatives, Solana, macro and on-chain provenance; code claims all 97 slots can be populated | `features/indicators.ts`, `market/fabric.ts`, `market/quality.ts`, `workers/indicators.ts` | **ENHANCE** existing FeatureEngine, no second builder. Compute only slots supported by verified inputs |
| `ALL_100_AGENTS` / `AGT-001..100` | 100 evaluators in 10 evidence buckets including a 10-agent adversarial critic group; required source feeds and `ABSTAIN` rules | `workers/registry.ts` already has **100 different `W-...` market workers across 11 domains**, `workers/types.ts`, `workers/effectiveness.ts` | **DUPLICATE / NOT EQUIVALENT.** Do not append 100 more workers, map IDs 1:1 or double-count correlated votes. Compare hypotheses as optional, frozen research only |
| `SwarmThreadPool` | Separate `node:worker_threads` shards, SharedArrayBuffer input and a claimed hard 4 ms deadline, experimental randomized calibration | `workers/runtime.ts` already has bounded 16-way worker evaluations, 250 ms deadline/fault/quarantine; `qci/coordinator.ts` owns vote aggregation | **DUPLICATE / BLOCKED** until independent latency/CPU/fairness evidence and compatibility review. Do not introduce a second coordinator or 4 ms promise |
| `SwarmConsensusDecision` | PDF imports non-existent `../qci/AdaptiveQciCoordinator.js` and `./AgentIntelligenceTypes.js` on the reviewed #45 tree | `qci/schemas.ts` and `qci/coordinator.ts` with signed evidence, dependency groups, required domains and fail-closed quorum | **DO NOT IMPORT.** Missing modules and consensus contracts are not interchangeable |
| Worker-to-market shared state | PDF assumes a NexusFabricRouter-managed SharedArrayBuffer layout and uses atomics | `fabric/contracts.ts`, `fabric/relay.ts`, `market/store.ts`, existing provider timestamps | **NOT YET PRESENT** as the claimed binary ABI. No fabricated zero-copy integration; require source-clock ordering/snapshot validation |

**PDF audit findings (not errors introduced into MIA):** the PDF text contains zero-width characters and hard line wraps; no source `AgentIntelligenceTypes.ts` or `AdaptiveQciCoordinator.ts` exists on the inspected branch; a 4 ms shard timer is not proof of bounded end-to-end latency; randomized Thompson exploration is not deterministic replay; hard-coded default feed metrics (such as VPIN, organic volume and holder proportions) are not verified source observations; the purported 100 agents overlap a separate existing 100-worker registry and have different voting semantics; a missing Solana oracle/LP lock must not count as a successful validation.

### Functional enhancement added to the existing files (not a second swarm)

**Scope of this narrow code increment:** `server/src/features/indicators.ts` now maintains EMA21, EMA55 and MACD histogram slope **inside the current canonical incremental FeatureEngine**. It exports `MIA5_SWARM_FEATURE_SLOTS` (the 97 names in their original source index order) and `projectMia5SwarmResearchFeatures()`, a read-only missingness-aware projection. The existing instrument endpoint in `server/src/api/routes.ts` exposes a `swarmFeatureResearch` field **only with the existing timeframe quality verdict**; if the quality gate fails, all 97 slots are `null` / `UNVERIFIED`, not fabricated signals. Tested in the existing `server/test/features.test.ts`.

**Contract:** up to 13 known slots are mapped after warm-up: EMA9, EMA21, EMA55, MACD histogram/slope, ADX, +DI, −DI, Ichimoku Tenkan/Kijun, Bollinger %B, Keltner position and EMA21/ATR extension. The other **84 or more** slots remain `null` because authoritative source timestamps or equivalent definitions/feeds are missing. In particular, the PDF's Donchian windows include the current bar whereas existing MIA Donchian breakout references exclude it; those slots are **not** copied under a misleading name. A populated slot is not a calibrated vote, source-finality guarantee or order permission.

**Important:** The PDF's `FeatureVectorBuilder`, `AGT-001..100` evaluators and `SwarmThreadPool` are **NOT** imported or running in the bot/QCI/OMS. Do not mark the PDF's 100 agents or its 4 ms latency objective as implemented. The code increment only improves read-only feature compatibility; original source text was not changed. Existing 100 production workers, strategy scanner, QCI, risk policy, ledger, paper OMS and LIVE lock retain exactly their responsibilities.

### Follow-on tickets (no duplicate implementation)

| ID | Future integration goal | Exit requirement |
| --- | --- | --- |
| SW-01 — source custody | Preserve both PDFs in full as text extracts; keep original PDFs available outside repository | **DONE:** 104/104 and 59/59 pages archived, source identifiers intact |
| SW-02 — honest 97-slot read model | Populate only supported, quality-gated indicators via existing FeatureEngine and instrument API | **CODE COMMITTED, CI/OWNER REVIEW REQUIRED:** 13 mapped / 84+ absent; no trading right |
| SW-03 — verified feed coverage | Map actual time-provenanced L2/prints, Solana, derivatives and macro fields into additional empty slots if supported | **PENDING:** provider event time, receipt time, no extrapolation, independent quality/contract checks |
| SW-04 — agent hypothesis audit | Classify each AGT definition against current 100 W-workers, identifying genuinely novel hypotheses | **PENDING:** proof of independent evidence, overlapping groups and feed requirements; no automatic duplicate worker registration |
| SW-05 — challenger experiments | Evaluate shortlisted novel PDF agent hypotheses off-path in DITAS/Strategy Lab | **PENDING:** point-in-time replay, costs, OOS/negative controls, calibration, deterministic results, no risk/OMS imports |
| SW-06 — concurrency certification | Benchmark optional bounded worker-thread execution only if workload justifies it | **PENDING:** per-symbol fairness, startup/worker-crash behavior, backpressure, actual p50/p95/p99; no unproven 4 ms hard SLA |
| SW-07 — PAPER/LIVE parity | Publish validated research data in PAPER and locked-LIVE analysis surfaces | **PENDING:** separate account scope/venue risk, no inferred LIVE fills, no signer, explicit owner review |

**Stop condition:** If implementing any next PDF feature requires creating a parallel `AgentIntelligenceTypes`, `AdaptiveQciCoordinator`, swap-in risk gate or a new order path, stop and revisit the current canonical owners and open PRs. Any later change must pass the full repository build/tests/security workflow and obtain owner review before merging. The current `LIVE_EXECUTION_AVAILABLE=false` remains untouched.
