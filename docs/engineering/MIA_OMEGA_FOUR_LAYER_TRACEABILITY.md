# MIA Ω four-layer traceability

The [CSV register](MIA_OMEGA_FOUR_LAYER_TRACEABILITY.csv) preserves the 100 ticket IDs, priorities, proposed implementations, and acceptance conditions from the owner’s 2026-11-18 four-layer specification. Its source SHA-256 is `86612133a263639aad250826417d68142e9da8ff829feb414ddc53bc59ebce26`. The reviewed code starts from PR #26 at `51895284b9db392c069e6cfcf20775e45d13aea7`.

The rows are grouped by layer and canonical owner. A path in `canonical_owner` identifies the existing component that owns the responsibility, including where new work would extend that component. Semicolon-separated references in `prior_requirements` connect overlapping work to the [existing repository register](REQUIREMENTS_TRACEABILITY.csv). A reference means shared scope, which may cover only part of the current acceptance condition. The source specification’s earlier 300-ticket register was not available for an exact crosswalk.

| Status | Meaning |
|---|---|
| `TESTED_SCOPE` | A new or existing check exercises the stated scope. New providers and account types need their own evidence. |
| `PARTIAL_TESTED` | Tests cover the stated subset. The remaining acceptance work is recorded in the row. |
| `EXISTING_UNVERIFIED` | An existing implementation or open PR addresses the core behavior. Acceptance needs evidence on the reconciled revision. |
| `PARTIAL_UNVERIFIED` | An existing component covers part of the requirement. The remaining acceptance work is recorded in the row. |
| `PENDING_IMPLEMENTATION` | The required behavior needs implementation in its canonical component. |
| `BLOCKED_EXTERNAL` | A provider, data entitlement, source attribution, or other external prerequisite remains unresolved. |
| `DEFERRED_LIVE` | The behavior depends on a separately authorized execution, mandate, or account scope. |
| `BLOCKED_CI` | A required CI result is currently failing. |

An evidence pointer identifies the related path, existing test, or advisory. The `@PR18` and `@PR19` suffixes identify code on the reviewed PR heads at `74fa093517c3288493e62c676473f73ac1fc640c` and `f7477a5321d0d4ad98e3519acdada1fb1149ceba`, respectively. Those pointers establish ownership and overlap. Passing an individual test supplies only the acceptance evidence it exercises.

- **SENSE** uses the market fabric and provider registry. The order-book stream already has an owner in PR #18. Cached Titan ranking stays in PR #19. SEC filing metadata and provider coverage stay in PR #26. [PR #18](https://github.com/Naokiri5/naokiri/pull/18) · [PR #19](https://github.com/Naokiri5/naokiri/pull/19) · [PR #26](https://github.com/Naokiri5/naokiri/pull/26)
- **THINK** uses the scanner, deterministic workers, QCI, decision engine, and DITAS. The PR #26 chart comparisons are research evidence. [PR #26](https://github.com/Naokiri5/naokiri/pull/26)
- **DEFEND** uses the canonical risk gate, policy, mode, and token safety. PR #18 owns the fail-closed mode transition and Live lock. [PR #18](https://github.com/Naokiri5/naokiri/pull/18)
- **ACT** uses the Paper OMS, ledger, and supervised backend. PR #18 owns its migration guards and PR #25 carries the append-only Telegram v8 migration. [PR #18](https://github.com/Naokiri5/naokiri/pull/18) · [PR #25](https://github.com/Naokiri5/naokiri/pull/25)


## Security and dependency review

The checked baseline was `main` at `2627cd276d2108c15a47ba41d60cdb54fddf10ff`. The static review covered that baseline and the reviewed heads of PRs #18, #19, #25 and #26. Searches of tracked filenames, source markers, dependency resolutions and selected Git history found no matching excluded tutorial artifacts. That scope does not establish the provenance of unidentified artifacts. No tutorial links, contracts, external prototype files or funding instructions were used for this change. There are no package or lockfile changes.

The full npm audit flags the development dependency `picomatch` at 4.0.7. The advisory covers versions through 4.0.7 and lists no patched release. Keep the required audit failure visible. PR #18 separates the security audit from the other checks and owns the mode-transition and schema hardening. [GitHub advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) · [PR #18](https://github.com/Naokiri5/naokiri/pull/18)

PR #18 owns schema migrations v6–v7. PR #25 retains them and adds the reconciled Telegram migration as v8. This increment makes no schema or deployment changes. Review it as a draft on the PR #26 branch. Reverting its commits removes the new boundaries and read-only views without requiring a database rollback. If testing a branch with v6–v8, use a separate disposable database or a validated pre-upgrade backup when returning to v5.

## Runtime scope

- The Market Terminal reads normalized Binance spot volume, taker flow and order-book depth through the existing bounded caches. Five-minute flow and missing book data appear as unavailable. These estimates supply research evidence.
- The decision record presents market and strategy evidence, the independent risk result, and the linked Paper OMS entry outcome. The order outcome can show a rejection after a favorable decision.
- DEX safety reports unverified sellability, executable depth, fees, pool controls and concentration. It rejects automation while critical evidence is missing.
- Paper rejects foreign-account order mutations and unsupported risk accounts. Entry checks bind the enrolled strategy version and any approval to the exact decision and venue. Protective exits continue through the existing monitor.
- One Trader Joe retains the existing read, explain and pause tools. The authority test checks direct and transitive runtime imports from research modules.

## Unified MIA development priorities — audited PAPER/LIVE integration plan (2026-11-20)

**DOCUMENTATION ONLY. No production code change, merge, deployment or LIVE authorization is made by this review.**
This is the canonical eight-priority section of the existing four-layer engineering register. Preserve the existing architecture rather than creating a second scanner, ranker-to-OMS pipeline, trading bot, QCI, risk gate, portfolio ledger, OMS, Trader Joe assistant or dashboard framework.

### 1. Verified baseline and vocabulary

- **Repository:** [Naokiri5/naokiri](https://github.com/Naokiri5/naokiri).
- **main:** `2627cd276d2108c15a47ba41d60cdb54fddf10ff`.
- **Unified integration head:** `claude/mia-unified-01`, commit `376ad743e16b74684526bf5eb90bae8abfb9d6e6`, [PR #45](https://github.com/Naokiri5/naokiri/pull/45), **OPEN / NOT MERGED** at the time of review.
- **Method:** inspected live GitHub PR metadata and the actual unified-branch source for market fabric, streaming, Discovery, Hunter, safety, bot, execution adapters, THINK certificate/replay, Strategy Lab, Trader Joe and documentation; reviewed selected stacked PR file patches. **Not a complete per-line security audit or end-to-end certification of unmerged stacks.**
- **Prior draft:** [#77](https://github.com/Naokiri5/naokiri/pull/77) was closed unmerged. Its proposed bot/test refactor was not carried into #45. The topic is docs-first.

Definitions used below:

| Status | Precise meaning |
| --- | --- |
| `UNIFIED_EXISTS` | Source code for the specified subset is present on the #45 head; not necessarily on main or operationally certified |
| `UNIFIED_PARTIAL` | Existing canonical implementation covers part of the request; integration/validation remains |
| `STACKED_OPEN` | Code exists in a separate, open and **unmerged** PR; do not count it as part of #45 |
| `MISSING_OR_UNVERIFIED` | Not found as a complete, demonstrably working feature in the reviewed #45 scope |
| `LIVE_LOCKED` | LIVE execution is refused; research may be displayed in LIVE context, but real order flow is not available |

### 2. Preserve one canonical pipeline, with environment-specific risk and money

~~~text
SENSE — Existing provider registry, market/fabric + market/store + market/quality
  |     Cached Titan ranking, existing discovery, optional verified Solana/social research
  v
THINK — ONE market/scanner -> ONE workers/QCI -> ONE decision/DITAS/certificate history
  |     Analysis is evidence, not trading authority
  v
DEFEND — ONE risk implementation, evaluated with THIS account/venue/policy at decision/submit time
  |
  v
ACT — Existing exec/environment.ts boundary
  |--> PAPER -> existing exec/oms.ts -> PAPER-only orders, fills, positions, ledger
  '--> LIVE  -> LockedLiveExecutionAdapter (no signer, no venue orders, no account funds)
  |
  v
Existing journal / DITAS / lab comparisons / read-only Trader Joe and dashboard
~~~

**Important current reality:** `server/src/bot/bot.ts` still imports and calls the canonical paper `submitEntry` directly, guarded by the existing leader/write fence, when control mode is PAPER. `server/src/exec/environment.ts` already defines a PAPER adapter and a locked LIVE adapter for controlled use by other surfaces. **Do not falsely claim that the bot has been migrated to the adapter.** A future routing change needs a separate, reviewed architectural test update and is not authorized by this document.

**Reuse ownership map** (authoritative module first; later changes stay within these owners):

| Responsibility | Existing owner | No-duplicate rule |
| --- | --- | --- |
| Sources, timestamps, depth | `server/src/providers/`, `market/fabric.ts`, `market/store.ts`, `market/depthStream.ts`, `market/quality.ts` | No second market cache, web socket manager or quality truth |
| Discovery and fast ranking | `market/discover.ts`, `hunt/ranker.ts`, existing Discover UI in `web/src/pages/Markets.tsx` | Ranking is watch-only; no second trading scanner |
| Chain safety | `safety/safety.ts`, existing DEX Screener provider; Solana PR stack | Reuse source-class/chain identities and fail-closed safety |
| Proposals, consensus and decisions | `market/scanner.ts`, `workers/`, `qci/`, `decision/`, `ditas/` | Research-only sources cannot import execution mutators |
| Risk/authorization | `risk/gate.ts`, `risk/policy.ts`, `core/mode.ts`, `qa/gates.ts` | Independent risk gate remains final authority; no bypass |
| Order and portfolio accounting | `bot/bot.ts`, `exec/environment.ts`, `exec/oms.ts`, `portfolio/ledger.ts` | Reuse paper OMS and ledger; future LIVE account must be isolated |
| History and challengers | `lab/`, `ditas/twin.ts`, `ditas/replay.ts`, `journal/` | Shadow evidence cannot self-promote or write financial history |
| Operator experience | `joe/`, `api/routes.ts`, `web/src/` | Narrate committed records only; no autonomous trade tools |

### 3. Open-PR reconciliation: review before ANY feature implementation

The PRs below are **not** an independent feature inventory to copy and paste. Classify by actual file changes, ancestry, integration status and test coverage.

| PRs | What was inspected / overlap | Reconciliation decision |
| --- | --- | --- |
| [#45](https://github.com/Naokiri5/naokiri/pull/45) unified branch | Already includes existing canonical scanner, risk, paper OMS, DITAS, streaming, `hunt/ranker.ts`, certificates, Joe lifecycle backend and other prior work | Integration baseline only; verify its CI and review before main merge |
| [#18](https://github.com/Naokiri5/naokiri/pull/18), [#19](https://github.com/Naokiri5/naokiri/pull/19) | Streaming/safety and the cached Hunt ranker have corresponding code in #45; #19 is still an open draft against main | Compare source/tests; do not cherry-pick duplicate modules or override #45 blindly |
| [#33](https://github.com/Naokiri5/naokiri/pull/33), [#35](https://github.com/Naokiri5/naokiri/pull/35), [#36](https://github.com/Naokiri5/naokiri/pull/36) | THINK certificate, evidence replay and timeframe-conflict stack have code overlapping #45 | Verify exact parity and gaps; extend existing certificate/replay/QCI instead of another decision authority |
| [#44](https://github.com/Naokiri5/naokiri/pull/44) | Trader Joe event contract, projection, narrator and API routes are present on #45 | Treat M1 backend as present; implement only remaining read-only UI/live-refresh scope |
| [#46](https://github.com/Naokiri5/naokiri/pull/46) → [#50](https://github.com/Naokiri5/naokiri/pull/50) → [#51](https://github.com/Naokiri5/naokiri/pull/51) → [#52](https://github.com/Naokiri5/naokiri/pull/52) | Separate, stacked Solana Hunter, RPC mint/freeze audit, watch alerts and Pump.fun log subscriptions; all open | **Do not declare merged into #45.** Review stack bottom-up; avoid separate duplicate Titan scanner; maintain read-only safety |
| [#56](https://github.com/Naokiri5/naokiri/pull/56), [#61](https://github.com/Naokiri5/naokiri/pull/61) | B-MIND observation foundation and DITAS frozen evidence, on different PR ancestry | Reconcile evidence contracts/provenance and branch bases, then integrate only validated observations |
| [#64](https://github.com/Naokiri5/naokiri/pull/64), [#66](https://github.com/Naokiri5/naokiri/pull/66) → [#67](https://github.com/Naokiri5/naokiri/pull/67) | Read-only venue reconciliation, portfolio historical tail-risk diagnostics, optional macro veto / shadow Kelly | Review independently and preserve account-scoped risk; these do NOT constitute a LIVE OMS |
| [#71](https://github.com/Naokiri5/naokiri/pull/71), [#75](https://github.com/Naokiri5/naokiri/pull/75), [#76](https://github.com/Naokiri5/naokiri/pull/76) | Environment-status UI, Guardian Shield hardening and provider egress controls | Reconcile UI/security changes with #45 and each other; no new risk gate or duplicate Guardian |

**Integration gate R0:** Before selecting a change for implementation, compare the candidate head with the latest #45 head, including tests, migration order, changed-file conflicts, duplicate functions, and open findings. If a prerequisite head changes, repeat the comparison. Existing merged code must be enhanced in place. One new PR per **genuine missing integration increment**, only after owner review of the plan.

### 4. Exact assessment of the eight chosen priorities

#### P1 — Reconcile the unified development branch (first dependency)

**Verified:** PR #45 is open, targets main and contains materially more code than main. It is **not** proof that every later stacked PR is integrated. Multiple live PR heads target earlier ancestors, including the Solana sequence and B-MIND work.

**Still needed:** file-level and behavior-level conflict matrix, migration ordering, code ownership, current CI, security review, anti-duplication review, and explicit owner merge decision. **Exit:** every proposed line has one owner, one branch/PR disposition (`ALREADY_IN_45` / `BRING_FORWARD` / `SUPERSEDED` / `DEFER`), passing checks on its actual target head, and rollback notes. No blind merge.

#### P2 — TITAN HUNTER cached ranker and Hunt Radar

**UNIFIED_EXISTS:** `server/src/hunt/ranker.ts` provides deterministic `screenCachedTokens`, dedupes by ID/time, rejects stale/future records, ranks cached 1,000-token fixtures, emits `WATCH_ONLY` and `tradeEligible:false`. `server/test/hunt-ranker.test.ts` covers those core properties. Existing `market/discover.ts` produces CEX leaders and DEX launches.

**MISSING_OR_UNVERIFIED:** the reviewed `market/discover.ts` does **not** call `screenCachedTokens`; no complete Hunt Radar tab or trusted provider-time bridge appears in the reviewed #45 UI/API. Ranking success on synthetic cached data is not evidence of a 1,000-token live intake or of trading profitability.

**Targeted enhancement:** map authoritative CEX ticker `providerTs/receivedAt` into the existing HuntObservation format; use DEX pair event time only when actually available, otherwise mark it unavailable and keep it out of timestamp-required ranking until an approved policy exists. Expose authenticated watch-only research through the **existing** Discover API/view. Solana Hunter's separate pool scoring from #46 must enrich the same discovery surface, not create a competing trade scanner.

**Exit:** traceable IDs, exact clocks, rate limits, duplicate handling, invalid/stale rejection, stable benchmark and a UI that never presents a Hunt score as an entry permission. PAPER and LIVE research views may both display it; neither may directly order.

#### P3 — Solana token safety intelligence

**UNIFIED_PARTIAL:** `providers/dexscreener.ts` provides DEX pair discovery; `safety/safety.ts` explicitly marks critical DEX sellability, reserves, concentration and contract controls unverified and refuses automated DEX trading.

**STACKED_OPEN:** #46 has read-only Solana ranking and mint-audit foundations; #50 adds batched RPC mint authority/freeze/Token-2022 checks; #51 adds opt-in Telegram watch alerts; #52 adds Pump.fun on-chain launch/graduation observation. Presence in these PRs is **not** main or #45 availability.

**MISSING_OR_UNVERIFIED:** independently verified holder and deployer concentration, longitudinal LP drain/lock status, executable route/sellability/fee evidence and chain finality/slot reorg treatment. DEX Screener's reported USD liquidity is not enough to prove exit liquidity.

**Targeted enhancement:** integrate stacked source observations into the **existing** safety/Discover model, without treating unknown as safe. Keep token and pool identity distinct, use bounded provider quotas and tracked evidence timestamps. No DEX orders or wallet signing from the research adapter.

**Exit:** adversarial fixtures for fake liquidity, malicious quotes, mint/freeze authority, low depth, ownership changes, stale RPC, reorg and provider failure. Unknown safety => `UNVERIFIED`, not `PASS`.

#### P4 — Market-feed freshness and recovery

**UNIFIED_EXISTS:** `market/depthStream.ts` implements a Binance diff-book snapshot/sequence protocol, gap detection, resync/backoff and counters. `market/fabric.ts` rejects backward/future tickers and supports REST books and candle repair. `bot/bot.ts` already refreshes books of **open PAPER positions first** in its hot lane and requests position streams alongside deep-tier streams. `server/test/depth-stream.test.ts` and `server/test/quality.test.ts` exist.

**MISSING_OR_UNVERIFIED:** sustained fault-tested reconnect/failover objectives, venue-specific restoration proofs, provider fallback equivalence, starvation tests under a very large watchlist, and actual LIVE position priority when a future LIVE account exists. Do not describe basic stream/gap handling as missing.

**Targeted enhancement:** expand existing depth-stream/fabric telemetry and faults; prioritize held positions over scans/discovery; forbid new entries on stale or sequence-broken books; verify protective monitoring still reports incidents during outages. Do not infer that a Coinbase/Kraken cross-check provides drop-in Binance execution-book failover.

**Exit:** reproducible disconnect, out-of-order, replay, snapshot mismatch, partial outage, rate-limit and stale-held-position tests; instrument-level latency/quality and repair counters.

#### P5 — Social Calls Radar (research only)

**UNIFIED_PARTIAL:** `news/`, notification/Telegram support and DITAS evidence memory exist. These do **not** implement a reliable social caller track record or performance-qualified call feed.

**MISSING_OR_UNVERIFIED:** licensed/authorized X/Telegram/Reddit call ingestion, normalized original-source identities, immutable call timestamps, deduplication of reposts, caller reputation and historical cost-aware outcomes.

**Targeted enhancement:** fit social-call provenance, timestamps, invalidations and retrospective outcomes into existing source registration, news/research context and DITAS snapshots. Record source credibility based on point-in-time events and disclose selection bias. No new QCI coordinator; no social-to-OMS route.

**Exit:** research-only outcomes on both environment dashboards with an original-source link, unverified flags, lag, recency and evidence gaps; no command capable of submitting orders.

#### P6 — Decision certificates and B-MIND

**UNIFIED_EXISTS:** `decision/certificate.ts` already provides bull/bear evidence, no-trade reasons, costs, uncertainty and independent risk authority labels. `ditas/replay.ts` replays frozen evidence/consensus, **not** the full risk and OMS lifecycle. Both have tests. Full trained win probabilities are **not** certified.

**STACKED_OPEN:** #56 includes a 32-construct **read-only** B-MIND observation atlas/validation, explicitly not wired to decisions; #61 adds frozen B-MIND evidence to DITAS. Do not rebuild the atlas or assume either PR is merged.

**Targeted enhancement:** map only supported behavioral hypotheses and dissent into the existing THINK/DITAS certificate, preserving source and evaluation clock. If B-MIND evidence is absent, label UNKNOWN rather than inventing emotions, forecasts or a certainty score. Keep risk vetoes and exposure limits in canonical risk/QCI authorities.

**Exit:** frozen replay yields reproducible provenance; unavailable inputs cause abstention; model/version changes show differences; no direct B-MIND import of OMS/wallet/risk mutators; LIVE remains locked.

#### P7 — Historical evaluation and strategy challengers

**UNIFIED_EXISTS:** `lab/backtest.ts` includes fee/spread/slippage assumptions, IS/OOS split and Monte Carlo; `lab/lab.ts` has strategy lifecycle, OOS sample requirements and paper decay auto-suspension. DITAS has a bounded frozen Decision Twin and evidence replay. `server/test/lab.test.ts`, `server/test/ditas-twin.test.ts` and `server/test/think-replay.test.ts` cover existing scopes.

**MISSING_OR_UNVERIFIED:** fully independent head-to-head champion/challenger on the **same point-in-time universe**, delisted/failed assets, all rejected opportunities, queue/partial-fill and exit-depth constraints, leakage/multiple-testing controls, and long enough prospective evaluation.

**Targeted enhancement:** extend the existing lab and DITAS shadow outcomes; preserve the real PAPER journal as truth; make rejected/no-signal proposals visible. No automatic production strategy enrollment based solely on backtest or shadow profit.

**Exit:** deterministic point-in-time replay with explicit OOS embargo/walk-forward, survivorship and cost stress, matched cohorts, confidence intervals, selection-bias disclosure and supervised strategy promotion.

#### P8 — Trader Joe Live and operational dashboard

**UNIFIED_EXISTS:** `joe/live/events.ts`, `projection.ts` and `narrator.ts` produce owner-only, read-only PAPER lifecycle events from committed decisions, orders, fills, ledger and incidents. Endpoints `/api/joe/events` and `/api/joe/events/by-position/:id` exist. Narration uses deterministic templates and correctly describes simulated PAPER fills.

**MISSING_OR_UNVERIFIED:** the complete animated/interactive Trader Joe lifecycle interface, reliable live push/catch-up, feed-quality/Hunt/social/guardian cards, source-backed cross-environment reporting, and future actual LIVE events. Current Joe lifecycle events explicitly have PAPER-only mode; do not label them real LIVE fills.

**Targeted enhancement:** improve the existing Joe page, Web UI, SSE and event projection; use committed-record IDs, replay cursors, notification preferences and clear timestamps. Show LIVE as `LOCKED/NOT_CERTIFIED` until an independent real venue integration is reviewed. PR #71 has a separate environment-status UI proposal that must be reconciled.

**Exit:** no hallucinated fills or PnL, accessible/reduced-motion views, reconnect/cursor idempotency, incident priority and scope-correct paper/live labels, with browser tests.

### 5. What “EVERY feature in LIVE and PAPER” actually means

Every **research** enhancement should have one source contract and consistent capabilities across both environment *views*. That does **not** justify a second decision pipeline or make the currently nonexistent LIVE executor operational.

| Capability | PAPER now / planned | LIVE now / planned |
| --- | --- | --- |
| Market/Hunt/Solana/social research | Shared, read-only observations; missing integrations are future work | The **same** shared research when implemented; no claim of live execution readiness |
| Scanner, QCI, certificate, B-MIND, challenger research | Reuse one canonical research stack; account-specific risk on entry | Reuse source/algorithm contracts later, with separately certified venue and account rules; **analysis only now** |
| Place and close positions | Existing paper-only OMS/ledger, explicit approved policies and protection controls | `LOCKED`: no venue signer, real orders or venue-native stops |
| Portfolio, orders, PnL and Joe event history | Paper ledger and committed simulation only | Separate LIVE account/ledger/reconciliation **not implemented**; UI must say LOCKED/NO LIVE DATA, not duplicate PAPER fills |
| Alerts, watchlists, safety warnings | Shared read-only facts with correct account labels and source freshness | Same observations in a locked environment view; account-specific alerts only if true LIVE account data eventually exists |

The source of truth for LIVE eligibility is `server/src/core/mode.ts` (`LIVE_EXECUTION_AVAILABLE = false`) and `server/src/exec/environment.ts` (`LockedLiveExecutionAdapter`). Funding an account, a positive social call, a strong QCI vote, a high Hunt score or a profitable paper backtest **never** unlocks LIVE. Real trading requires independently reviewed trade-only credentials, isolated signer, client-order ID/idempotent reconciliation, partial/unknown-fill support, confirmed protective exits, incident recovery, account-scope audit, release gates and explicit owner consent.

### 6. Implementation order, acceptance and no-duplication rules

| Order | Phase | Dependencies | Required objective evidence |
| --- | --- | --- | --- |
| M0 | PR #45 reconciliation and canonical ownership matrix | current main, open PR metadata, exact file deltas | clean dependency map; migration/security conflicts resolved; no duplicate modules |
| M1 | Feed freshness/protection certification | existing stream, cache and OMS risk tests | held-position-first recovery with injected failures and controlled p95 metrics |
| M2 | Titan cached-observation bridge + Discover Hunt Radar | #19 code already in #45, real provider clocks | honest watch-only results, deterministic ranking, bounded I/O and UI no-order regression |
| M3 | Solana watchlist/source safety integration | stacked #46→#50→#51→#52 reconciliation, RPC permissions | data provenance, mint/freeze and liquidity unknown-state tests; no DEX signing |
| M4 | Social Calls Radar research capture | source contracts/license/provider health, DITAS | immutable source calls, historical outcomes, opt-in and bias flags, no OMS path |
| M5 | Certificate + B-MIND evidence enrichment | THINK foundation plus #56/#61 conflict review | confidence/uncertainty calibration, frozen evidence and import-boundary tests |
| M6 | Cost-aware challenger/strategy arena | current lab, DITAS, frozen datasets | same-cohort OOS, delistings/rejections, controlled promotion gates |
| M7 | Trader Joe UI and operations views | #44 backend in #45, #71 UI review, preceding data feeds | committed PAPER narration, incident badges, SSE catch-up and LIVE locked display |
| M8 | LIVE execution design/certification (separate scope) | all required safety/reconciliation/credential gates + owner authorization | **no rollout from this document**; independent written owner approval, simulation and recovery certification |

**Release rule for every later coding PR:** target existing file owners, document lines reused and exact missing behavior, avoid modules with overlapping responsibilities, include negative tests (stale/missing/offline/untrusted/cross-account), preservation tests for scanner/QCI/risk/OMS/ledger, an explicit risk/security review, runnable CI evidence, rollback and owner review. Do not merge, deploy or switch mode automatically.

Suggested existing tests to extend by scope: `server/test/hunt-ranker.test.ts`, `depth-stream.test.ts`, `quality.test.ts`, `risk.test.ts`, `oms.test.ts`, `import-boundaries.test.ts`, `think-certificate.test.ts`, `think-replay.test.ts`, `ditas-twin.test.ts`, `lab.test.ts` and `joe-live.test.ts`. Stacked Solana/B-MIND branches have their own tests; reconcile them before modifying these core tests.

### 7. Documentation and review outcome

- This document is the **single reviewed eight-priority plan**, not proof that the eight upgrades are complete.
- **In unified now:** cached ranking foundation; stream gap/resync; existing open-position monitoring; THINK certificate/replay; DITAS and Strategy Lab foundations; committed PAPER Joe lifecycle feed.
- **Awaiting stacked-PR reconciliation:** Solana on-chain watchlist/Pump.fun, B-MIND, venue assessment, advanced risk diagnostics, environment UI and Guardian upgrades.
- **Genuinely incomplete:** watch-only cached Hunter integration in Discover, credible Social Calls Radar, deep Solana holder/LP/sellability validation, operational feed recovery certification, robust champion/challenger evaluation and finished Joe UI.
- **LIVE:** planned cross-environment research parity; live-money execution and live-record UI **NOT IMPLEMENTED / LOCKED**.

Links to detailed existing canonical documents: [TITAN HUNTER architecture](TITAN_HUNTER_ARCHITECTURE.md), [duplication audit](MIA_DUPLICATION_AUDIT.md), [NEXUS current vs target](../architecture/MIA_NEXUS_CURRENT_VS_TARGET.md), [DITAS implementation status](../ditas/IMPLEMENTATION_STATUS.md) and [Trader Joe Live milestones](../architecture/TRADER_JOE_LIVE.md).
