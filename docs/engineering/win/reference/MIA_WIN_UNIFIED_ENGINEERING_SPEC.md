# MIA Whale Intelligence Network (WIN) — Unified Engineering Specification

**Review-only release:** WIN-DESIGN-2026-11-22  
**Repository:** https://github.com/Naokiri5/naokiri  
**Observed `main` HEAD:** `7ecda93c6b5e74077d1ab87c3faf5b899cb28535`  
**Sources:** 26-page PDF with four documents; supplied 561-line WIN idea/text; read-only GitHub inspection of `main` and representative open PRs. Exact uploaded source files are preserved in `sources/`.  
**Implementation status:** DESIGN/CONTRACTS ONLY. No GitHub edits, no branches or PRs created, no broker orders executed, and no production certification performed.

## Executive decision

Develop **WIN-FAST / Whale Reflex** (one verified Solana memecoin wallet can be followed from a scalable wallet directory) and **WIN-DEEP / Whale Architect** (infer large-player footprints and independently reconstruct entry zones for crypto futures, forex, exchange-traded stock/index futures, stocks, and ETFs). WIN is **evidence and strategy generation**, not a second account, risk engine, execution core or settlement ledger. The user may select one wallet for FAST, or opt for a tightly constrained MIA recommendation. The corpus can index millions of public *addresses/records*; this is not a claim that millions of uniquely identified people or real-time individual trader positions are observable.

**Unifying flow:** Provider ingestion -> authenticated event normalization and immutable evidence -> FAST or DEEP research -> existing `workers/` and `qci/` -> existing `decision/engine.ts` -> existing `risk/gate.ts` -> canonical execution-intent and OMS ownership -> account-scoped positions/ledger -> DITAS outcomes and monitoring. **Every transition can abstain, quarantine or deny.** Live is explicitly unavailable on the audited baseline.

## Source inventory, fidelity and correction policy

The supplied PDF contains: (1) `docs/WHALE_INTELLIGENCE_UNIFIED.md` proposed specification; (2) TypeScript declaration catalog, with 10 grouped declaration sections, although its implementation list names 18 artifacts; (3) proposed GitHub Actions workflow; (4) master prompt for Codex and Claude. The separate text file repeats and expands the conceptual WIN architecture, outcomes, ranking and staged plan. The *original PDF and original TXT are copied byte-for-byte* into `sources/` to retain all wording without silently rewriting a source. `MIA_WIN_SOURCE_TYPESCRIPT_CATALOG.ts` is a normalized **declarations-only** extract of the supplied PDF section 2; see the PDF for the authoritative exact page layout.

This document **does not assert that the PDF's declared code is working**. Where the PDF conflicts with the actual repository, the original claim is retained in its original source and a correction is given here. Proposed hardcoded numerical values are labeled **hypotheses to benchmark**, not validated release thresholds.

## Catalog: existing canonical ownership and recommended integration

| Concern | Audited owner on `main` | WIN integration decision | Current status |
|---|---|---|---|
| Public large-print detection | `server/src/whales/prints.ts` | Preserve as `CEX_LARGE_PRINT`, never label as an identifiable wallet | EXISTS |
| Copy UI/API placeholder | `server/src/api/routes.ts` `GET /api/copy` | Replace existing handler through authorized route registration, maintaining API backwards compatibility; do not duplicate route | PLACEHOLDER |
| Solana DEX discovery | `server/src/market/discover.ts`, `providers/dexscreener.ts` | Reuse for mint universe only; read-only rank is not safe-trade approval | EXISTS |
| DEX safety | `server/src/safety/safety.ts` | Keep `eligibleForAutomation: false` for unverified DEX pairs; extend via checked Solana mint inspector, after PR reconciliation | EXISTS, INCOMPLETE |
| Main indicators | `server/src/features/indicators.ts` | Exactly one feature calculation authority | EXISTS |
| Worker registry / runtime | `server/src/workers/*` | Integrate bounded whale evidence as an existing domain or explicitly reviewed new domain | EXISTS |
| QCI | `server/src/qci/coordinator.ts` | Integrate with signed schema, coverage, dependency group and fixed domain-weight normalization | EXISTS |
| Decision authority | `server/src/decision/engine.ts` | Only authorizes candidate progression; no WIN-specific competing decision core | EXISTS |
| Risk authority | `server/src/risk/gate.ts` | Extend strategy, instrument, contract, venue and account capabilities without bypassing existing gate | EXISTS, SPOT-FOCUSED |
| OMS | `server/src/exec/oms.ts` | Keep existing paper OMS authoritative; add a narrow adapter only after semantics match | EXISTS, PAPER |
| Ledger | `server/src/portfolio/ledger.ts` | Do not create `whale_wallet_balance` as an accounting parallel | EXISTS |
| Execution controls | `server/src/core/mode.ts` | Map `OBSERVE`, `PAPER`, `APPROVAL`, `BOUNDED_LIVE` without inventing a separate owner-mode authority | EXISTS, LIVE LOCKED |
| Release gates | `server/src/qa/gates.ts` | G01–G14 remain mandatory; Win cannot change gate verdicts | EXISTS |
| DB migrations | `server/src/db/migrations.ts` | Append to existing `MIGRATIONS`, not fixed external `007`/`008` files | EXISTS, v5 on audited main |
| Server composition | `server/src/index.ts` (`buildApp`) | Reuse `openDb()` and `app.register(routes)`; register once before app ready | EXISTS |
| App UI | `web/src/App.tsx` | Introduce Whale Intelligence view within existing navigation/design system | EXISTS |
| Outcome knowledge | `server/src/ditas/*` | Record verified, decision-linked outcomes; never allow unverified feedback to self-promote a live model | EXISTS |
| Existing CI | `.github/workflows/ci.yml` | Extend CI with executable assertions and tests, not string scanning | EXISTS |
| Existing Solana hunter | PR #46, stacked on #45 | Read-only candidate ranking and optional GMGN research; preserve tests, avoid duplicate package | OPEN PR |
| Solana mint checks | PR #50, stacked on #46 | Integrate read-only mint authority checks without weakening safety | OPEN PR |
| Multi-market provider readers | PR #95, stacked on #92 | Reuse shared provider adapters; read-only does NOT imply broker execution | OPEN PR |
| Paper atomic bundles | PR #106 | Keep independent; validate OMS/migration interactions | OPEN PR |
| Strategy Lab accuracy corrections | PR #108 | Reconcile before relying on DEEP walk-forward evidence | OPEN PR |

## Architecture and evidence standards

```
Provider adapters / archive replays / signed public data
    │
    ▼
Canonical source envelopes (time/slot/finality/hash/expiry/license)
    │
    ├── Wallet registry / historical explorer / distinct-address index
    │       └── Whale profiler: realized + unrealized + lag-adjusted paper replication
    │
    ├── WIN-FAST: one followed Solana address
    │       └── swap delta proof → mint + exit-route safety → obtainable quote → candidate
    │
    └── WIN-DEEP: footprints, not anonymous trader identities
            └── historical availability → chart sweep/zone → walk-forward → candidate
    │
    ▼
Canonical market snapshots and instrument IDs
    ▼
Existing 100 deterministic workers + signed QCI coordinator
    ▼
Existing decision engine → portfolio allocator → existing deterministic risk gate
    ▼
Durable, fenced intent reservation → canonical OMS or future broker-certified adapter
    ├── PAPER simulated fills + ledger, distinct account ID
    └── LIVE (NOT IMPLEMENTED/CERTIFIED ON AUDITED MAIN)
    ▼
Order reconciliation + protective exits + incident monitoring + immutable audit
    ▼
DITAS verified outcomes / measured model versions / no ungated promotion
```

**Attribution types:** `VERIFIED_WALLET_SWAP` means identified on-chain token balance movement with verifiable transaction provenance and supported swap attribution. `ANONYMOUS_TRADE_PRINT` and `AGGREGATE_POSITIONING` never imply known wallet or actual individual institution fills. `DISCLOSURE_HOLDING` is dated published context (e.g. 13F), not real-time entry. `USER_CONSENTED_SIGNAL` may be supported separately with explicit provider authorization and terms. All sources retain an evidence confidence and a distinct *tradability/authorization* status.

**Immutable event identity:** `(source, chain/venue, transaction signature + instruction/leg or provider event ID, instrument, source revision)` -> stable dedupe hash. Store `observedAt`, `blockTime`, `availableAt`, `receivedAt`, `expiresAt`, finalized/confirmed level, credential-free provider ID, payload hash, input units, a canonical instrument ID, and audit trace ID. Keep provider raw payload in bounded archival storage; do not copy provider secrets into events.

**Instrument registry:** canonical IDs must include chain/venue, base/quote, contract type, expiry, exchange timezone and applicable contract multiplier. A `BTCUSDT` spot ticker is not identical to a perpetual futures contract, nor is a stock ETF the same as a futures product with similar exposure. Per-venue symbol mapping and tick/lot precision are required before risk authorization.

## WIN-01: whale registry and verified Solana balance-delta normalization

Purpose: build a data directory, not a million running bots. Use tiered indexing: historical public address corpus, incrementally refreshed active subset, and low-latency subscription for user-followed/eligible whales. Redis Streams/Kafka or equivalent can be considered after performance measurement; avoid introducing a broker merely to house a few thousand addresses.

**Source refinement preserved:** prefer net `preTokenBalances`/`postTokenBalances` by wallet owner and transaction signature to simply searching parsed `swap` instruction names. Explicitly distinguish wallet balance changes due to transfers, airdrops, token account closures, token burns, pool changes and swaps; a balance delta alone does not prove the action is a profitable swap. Reconcile native SOL, wrapped SOL, rent refunds, compute-unit and priority fees, tips and routing split legs before producing a directional swap. Handle token decimals using exact fixed-point/BigInt atomics, not JS floating point for token accounting. Discard unknown leg identity, inconsistent sign, missing owner association, reorg or insufficient finality. Never claim to transfer the original whale's fill or its ownership into another portfolio.

**Data model (proposed append-only extension to the current migrations API; names are not reserved until a PR exists):**

| Table | Ownership and minimum constraints |
|---|---|
| `whale_entities` | stable ID, chain, public address, source, first/last seen, consent/attribution class, latest profile status, unique `(chain, address)` where applicable |
| `whale_observations` | immutable source event, wallet/entity FK when verifiable, distinct transaction/signature leg key, canonical instrument, timestamps, source hash, side/amount/cost, finality and evidence coverage |
| `whale_follow_config` | account/owner ID, followed wallet, selection mode, sleeve, requested notional cap, risk-profile reference, observation-only flag, revision; uniqueness for one active selected wallet per account/FAST sleeve |
| `whale_strategy_hypotheses` | ID, evidence snapshot, lane, strategy version, entry trigger/zone, time-validity, calibration result, immutable research record |
| `whale_outcomes` | unique observation/decision/strategy/horizon key, paper or verified live fill evidence, fee model, measured realized and mark-to-market outcomes, provenance |
| `whale_intent_links` | optional only if canonical OMS needs a foreign-key reference to whale observations; **not** a second order/fill table |

Source PDF proposes `migrations/007_whale_intelligence.sql` and `migrations/008_whale_durable_oms.sql`. **Correction:** current `main` uses `server/src/db/migrations.ts` with `MIGRATIONS` array and v5. Determine the next free version at implementation time; preserve any migration already committed on the selected integration branch. Never run independent bootstrap SQL concurrently against an already initialized production ledger.

## WIN-02: audited wallet behavior and replicability

Reconstruct trades with chronological lots including partial fills and token transfers. Calculate (1) realized PnL after defensible fees; (2) mark-to-exitable-value for unsold bags, separately from realized PnL; (3) max drawdown and duration exposure; (4) availability of input data; (5) follower profitability at **the price actually available after observed detection, feed, decision, quote and execution delay**; (6) liquidity and concentration; (7) detected wash/MEV behavior, which reduces trust rather than being used to label a person; (8) strategy stability across regimes; and (9) uncertainty and minimum sample size.

**Original PDF baseline constants — research-only until benchmarked:** `MIN_CALIBRATED_TRADES=25`, `MIN_COVERAGE_RATIO=0.85`, `SIMULATED_COPY_LAG_MS=2500`, `SIMULATED_COPY_ROUNDTRIP_COST_BPS=180`, `medianHoldingMs<3000` quarantine, whale score `40 PnL + 35 lag resilience + 25 drawdown`. Retain as named experimental defaults in tests/config. The original source also sets illiquid bags to zero when liquidity disappears; this is a conservative liquidation-value stress case, **not** a replacement for valuation accounting. Test multiple venue sizes, latency percentiles, per-token impact and fees; no single lag or fixed fee makes a live profitability claim.

Whales are ineligible for autonomous following if reconstruction coverage, source quality, tradability, lag robustness or conservative solvency fail. A historical winning streak alone is not approval.

## WIN-03: FAST one-wallet memecoin follow, safety and paper shadow

User can select exactly one Solana wallet per supported account/sleeve (or accept an MIA-proposed wallet), enable observation/PAPER, and set caps once. On each relevant confirmed swap: verify signature, identity and intent; dedupe durably; screen mint and token extensions; verify both buy and obtainable sell quote; estimate round-trip impact, tip, priority fee, pool depth, and current versus historical entry drift; build **evidence packet only**. If incomplete, `RESEARCH_ONLY` or `REJECTED`; no order.

**Never violate `safety/safety.ts`**: a source's `WATCH` status or token metadata `UNASSESSED` cannot elevate to automation-safe. Token-2022 delegate, transfer hook, freeze/mint authorities, restrictions, liquidity, pool ownership and sell-route constraints require complete checks or explicit risk denial. A current quote is not a guaranteed fill, and a successful sell quote is not proof that an arbitrary future unwind is possible.

**QCI correctness:** PDF asks for `weight=0.28<0.30`; the current coordinator uses domain weight caps and HMAC schema with flow 0.10/onchain 0.04/risk 0.08/execution 0.06. Its existing authentication, quorum, dependency-group deduplication, challenge and veto semantics take precedence. Register a whale evidence input under a reviewed domain/cap, or version a reviewed policy; do **not** inject an unauthenticated 0.28 vote or make one source able to dominate consensus.

**API:** reuse existing `/api/copy`. `GET /api/copy` must continue to return a truthful capability/status report when disabled; extend with cursor-paginated followed wallet and profile records. `POST /api/copy/follow` is owner-authenticated, rate-limited, CSRF protected and validates address/network/config against a supported policy; changing whom to follow must not be a trade approval. Separate any future autonomous-execution enablement behind owner authorization, step-up, audit and G01–G14. No wallet private keys returned by APIs.

**Shadow execution:** must reuse canonical OMS/risk/ledger and obtain fill prices from available follower-side liquidity. If current paper OMS cannot model Solana token routing, implement a pure quote-based simulator within its existing execution authority or add an account-scoped paper venue adapter with equivalent lifecycle semantics; never mislabel a synthetic or whale-priced fill as a real follower execution.

## WIN-04: DEEP institutional footprint and strategy DNA

Market classes: crypto perpetuals; forex spot/CFD where permitted; exchange-traded stock/index futures; stocks; ETFs. A DEEP data packet is **not** proof of a particular named whale. Use anonymous large prints, funding/open-interest deltas, forced-liquidation statistics, order-flow imbalance, liquidity, regulated trade reports, aggregate CFTC COT and published SEC holdings with exact `availableAt` timestamps. 13F filings can lag the underlying holdings and COT is aggregated/published on a schedule: the **actual publication/availability timestamp**, not a hardcoded 45-day or Friday timestamp alone, is the gate for historical replay. Respect holidays and exchange calendar/DST.

**Strategy reconstruction:** use canonical feature snapshots (`features/indicators.ts`), price-volume structure, VWAP, liquidity sweeps, range pivots, regime, and cost models. Produce a versioned `entryZone`, **actual trigger**, invalidation, stop, targets, product-specific maximum hold, estimated spreads/funding/rollover/commissions/slippage, underlying data snapshot, and expiry. Wait for the trigger; no exact-top/bottom promise. Determine whether the strategy has positive net expectancy on embargoed walk-forward holdouts and across market regimes; explicitly report no-trade and abstention when not supported.

**PDF research settings:** 45-minute decay half-life, 75/25 impulse/structural blend, `Brier<=0.235`, `n>=30`, Wilson 95% confidence. Use as **candidate values to tune via held-out benchmarking**; unconditional Brier cutoff isn't meaningful without comparison to base rate and proper baseline models. Wilson bounds are valid for binomial outcome proportions, not as a universal calibrated-score uncertainty procedure. Group overlapping samples by instrument/session and embargo outcome horizons to avoid leakage.

**Execution session controls:** use `America/New_York` and actual exchange/holiday/early-close calendars rather than a flat 09:30-16:00 UTC conversion. Stocks/ETFs, crypto futures, forex and index futures have different trading calendars, contract multipliers, margin and roll handling. Current `STRATEGIES` long-only spot returns cannot be reused unchanged for futures shorts; define explicit market adapters with independent certified risk policies under the one central authority.

## WIN-05: one durable execution authority, not a second OMS

The existing `risk/gate.ts` defines canonical `evaluateRisk`, and `exec/oms.ts` writes canonical orders, fills and ledger for paper Binance spot. The PDF's `UnifiedRiskGovernor` and `DurableWhaleOmsBridge` are **proposed names**, not verified existing runtime owners on main. Treat them as bridges/adapters to canonical functions; do not add a second vote/risk governor, second ledger or second order-state machine. Existing `exec/demoLiveParity.ts` is only a standalone spec, not operational venue execution.

**Proposed lifecycle:** Candidate -> decision -> fresh QCI/risk evaluation -> account-scoped durable reservation keyed by `(environment, accountId, strategy, unique source event, purpose)` -> canonical OMS submission -> broker acknowledgement -> partial/full fill or explicit unknown -> reconciliation -> stop/position monitoring -> outcome. Recovery before new intake; broker requests must be idempotent and fenced; a network timeout means UNKNOWN, not NOT_EXECUTED. Never hold a SQLite write transaction open while awaiting a network call. Use short atomic transactions for reservations and state transitions with outbox ownership; reconcile unknown broker state before retrying. An intent link only references canonical orders, fills, positions and ledger entries.

**Accounting:** separate PAPER and LIVE account IDs, venue, contract, currency, multipliers, fees, margin, open orders and reserved capital. Mark prices must include timestamps and source quality. One consolidated exposure allocator must consider correlated multi-strategy positions and account-wide loss limits, not only the followed whale's per-order cap. New financial account writers require the same transaction and reconciliation invariant as existing OMS.

**Important PDF risk rule corrections:** `maintenanceMarginRatio >= 0.75` is not a universally valid futures margin veto; its definition and polarity vary by broker, instrument and broker margin policy. `currentSpreadBps > 8.0` is an example forex threshold, not a universal currency-pair policy. Rolling 30-trade expectancy below 0 is a useful circuit-breaker input, not a validated live release trigger. Product rules must be explicit, typed, tested against venue specifications and auditable.

**Execution modes:** do not invent a new mode authority using only `READ_ONLY|PAPER|LIVE_LOCKED`. Expose that as WIN capability/display state while the real account control remains `OBSERVE|PAPER|APPROVAL|BOUNDED_LIVE`. `BOUNDED_LIVE` must remain untraded until G01–G14 and verified real broker signing, native protective orders, restart reconciliation, limits, security review and explicit owner authorization are in place. Any exception/fault must deny new entries, not turn a timeout into a fallback LIVE fill.

## WIN-06: operations, UI, chaos and measurable acceptance

Integrate the panel into existing `web/src/App.tsx` navigation, preserving Privy and owner authorization behavior. Show a searchable directory, selected one-wallet follow rule, direct-vs-inferred evidence label, history coverage, true executable quote drift, model calibration, candidate explanation, live capability status, and audit trail. Human-facing copy must say "verified public wallet transaction" versus "inferred institutional flow" and never "guaranteed winner". For LIVE, show locked until certified, not an enabled button connected to a demo service.

Keep ingestion I/O off the synchronous/bounded workers. **The source PDF's "4ms SwarmThreadPool" and `NexusFabricRouter` cannot be treated as verified main implementations** from this audit: main has `workers/runtime.ts` and an in-process `core/bus.ts`; inspect the relevant PRs before choosing these names. Use queues with backpressure, bounded retry, explicit dead-letter or quarantine outcomes, lease/leadership controls, versioned events and measurable latency percentiles. Do not claim a 4 ms end-to-end service-level agreement from unmeasured source assumptions.

### Mandatory invariants and executable test matrix

| ID | Acceptance case | Expected result |
|---|---|---|
| WIN-T01 | Unconfirmed or reorganized on-chain signature | no candidate/order; quarantine |
| WIN-T02 | Duplicate signature with different ingestion receipt | one normalized event and at most one canonical intent |
| WIN-T03 | Multi-hop route and wrapped SOL/token-account close | correct delta attribution or `UNVERIFIED` |
| WIN-T04 | Missing Token-2022 extension / failed sell quote | hard deny |
| WIN-T05 | Pool pull, creator sell, high concentration or price drift | deny under policy; record reason |
| WIN-T06 | Historical 100% win-rate but missing inventory/sell history | `INSUFFICIENT_EVIDENCE`, not high-confidence copy |
| WIN-T07 | Whale execution price differs from obtainable follower quote | simulate follower price and actual costs |
| WIN-T08 | Whale packet attempts QCI weight bypass or unsigned injection | signed-schema rejection or capped, reviewed evidence |
| WIN-T09 | 13F/COT evidence received after historical replay decision | not visible to model before `availableAt` |
| WIN-T10 | Overlapping training and evaluation outcomes | purge/embargo; no inflated calibration |
| WIN-T11 | Low calibration count/negative holdout edge | no autonomous candidate promotion |
| WIN-T12 | Futures short/contract multiplier and margin differences | product-aware sizing and stop protection |
| WIN-T13 | Session holiday/DST and early close | exchange-calendar correct result |
| WIN-T14 | Multiple simultaneous strategies exceed portfolio cap | one portfolio-wide veto/reservation policy |
| WIN-T15 | Crash after intent reserve but before API submit | reconcile, no duplicate submit |
| WIN-T16 | Timeout after broker accepts but before MIA sees ACK | UNKNOWN then query/reconcile; never double place |
| WIN-T17 | Partial fill, stale book or missing native stop | protection incident / pause new entries |
| WIN-T18 | Emergency stop or missing G01–G14 certification | no LIVE order or sign, even with valid wallet signal |
| WIN-T19 | Migration applied twice or two startup leaders | safe idempotent database and lease ownership |
| WIN-T20 | GET `/api/copy` and POST follow under old/new clients | one route, authenticated, no regression, no CSRF bypass |
| WIN-T21 | Two modes and accounts share same source observation | independent account risk; no cross-ledger writes |
| WIN-T22 | Provider degradation and hundreds of thousands of indexed wallets | bounded intake, prioritization, backpressure, measurable lag |

### Verification commands for the future actual PR

Use the repo's own scripts first, after ensuring they exist on the selected branch: `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`, `npm run scan:secrets`, `npm audit --audit-level=high`. Add isolated WIN acceptance suites under the repo's current `server/test` convention (or follow an adopted branch's test layout) rather than assuming the PDF's `server/src/whales/__tests__/` paths. Add tests for broker error injection, switch off/on, replay determinism, restoration after crash and all caps. The PDF-proposed workflow scans for hardcoded strings like `liveExecutionLocked: true`; replace those assertions with **behavioral tests** proving live calls cannot happen when gates are blocked, plus fixture-driven static checks where useful. Do not claim these tests have run before the PR exists.

## Feature-phase build plan (scoped PRs)

| Phase | Scope and done criteria | Writes permitted at implementation time? |
|---|---|---|
| WIN-00 | Inventory current main, stacked PR ancestry, source-file reuse matrix, baseline CI, migrations, product requirements, data licenses | read-only |
| WIN-01 | Wallet registry, verified Solana event normalization, append-only evidence, source fidelity and replay; read-only | no financial writes |
| WIN-02 | Wallet profiling, cost/lag simulation, uncertainty, benchmarks and scalable indexing | no financial writes |
| WIN-03A | Authenticated follow configuration, quote safety and QCI evidence; deterministic read-only path | config only |
| WIN-03B | Paper OMS adapter integration and actual paper trading acceptance tests | canonical PAPER only |
| WIN-04 | DEEP market-footprint sources, chart DNA, calibrated walk-forward, market-specific adapters | research data only |
| WIN-05 | Shared durable intents, account scope, broker state reduction, chaos recovery; separately scoped per-market PAPER work | canonical PAPER only |
| WIN-06 | UI, telemetry, threat model, chaos/drills, deployment and full CI | no live bypass |
| WIN-LIVE (later) | Independent venue-specific execution cert, broker rules, licensing, owner authorization, G01–G14 and bounded canary | separate explicit approval only |

No milestone may silently merge an open draft PR or modify main without reviewed architecture and successful checks. Prefer 1 source-of-truth per function; each PR describes exact files altered, consequences for existing features, migration impacts and rollback. Rebase/reconcile against the *actual* current target branch, not historical PR assumptions.

## Current PR dependency graph and hazards

- PR #45 (`claude/mia-unified-01`) is open and nonmergeable against main at review.
- PR #46 (read-only Solana Hunter) is stacked **on #45**. PR #50 (mint checks) is stacked **on #46**. Therefore #46/#50 are not independently mergeable directly into main by a simple chronological move.
- PR #92 is stacked on an additional foundation branch. PR #95 (multi-market read-only adapters) is stacked **on #92**; PR #97 depends on #95. The PDF's instruction to merge "#95 -> #46 -> #50" misses this cross-stack ancestry and must be treated as *desired capability order*, not literal Git merge instructions.
- PR #106 introduces a separate paper bundle feature that may affect migrations and financial order paths; inspect for overlap before adding WIN intents.
- PR #108 makes important Strategy Lab/backtest correctness changes; use its outcomes only once reconciled and validated.
- Migration v6 may be taken on an open PR by the time WIN is built. Assign the next free version **on the chosen integration target** with unique constraints and migration regression tests.

## Risk/threat model

Adversaries can pump a token through linked wallets to lure followers; poison whale-score histories through partial archives; spoof token ticker metadata; send unauthenticated or duplicate provider events; exploit SOL/token ownership confusion; force stale-price approvals; attack API configuration/CSRF; trigger partial order timeouts or replay requests; and induce unrestricted strategy promotion through synthetic DITAS results. Defensive controls: provenance, trace IDs, immutable archival hashes, signer-independent data validation, fee/size-independent follower profitability, correlated-wallet detection, two-sided sell-route screening, fixed-point amounts, time/finality gates, policy caps, HMAC packet validation, canonical risk veto, idempotent reservations, independent read-back, account scoping, redacted logs, rate limits, role checks, and CI that tests actual blocked trading behavior.

## Specific conflicts to resolve before implementation

1. **Source PDF says `NexusFabricRouter`, `SwarmThreadPool`, `UnifiedRiskGovernor`:** not verified as main owners. Discover their branches, if any, and choose aliases/adapters to main; never create duplicate authorities.
2. **PDF fixed migration paths `007`/`008`:** main uses in-code ordered migrations and was at v5; numbering must be assigned after PR reconciliation.
3. **PDF path `server/src/routes/copyRoutes.ts`:** main routes exist under `server/src/api/routes.ts`; preserve existing handler contract and register only once.
4. **PDF calls `PAPER Shadow Mode Enabled`:** conceptually proposed WIN PAPER integration is **not running** on audited main.
5. **PDF weight 0.28:** incompatible with current 11-domain QCI weights unless reviewed/re-normalized.
6. **PDF hardcoded release heuristics:** 25/30 trades, 0.235 Brier, 180bps fee, 2.5s lag, 8bps forex spread, maintenance margin 0.75 are configurable research candidates, not general production thresholds.
7. **PDF `LIVE_LOCKED` enum:** display/capability state only, not a replacement for canonical `Mode` and G01–G14 checks.
8. **PDF `normalizeSolanaSwapFromBalances`:** finite `number` UI units can corrupt precision; use atomic quantity strings/BigInt and explicit token decimals.
9. **PDF static string-scan CI lock:** insufficient to enforce live safety. Use test doubles that fail if a real adapter is called.
10. **PDF `register...Routes` with `unknown` arguments:** actual Fastify types and owner auth hooks must be preserved.
11. **Source "18 files" vs 10 catalog sections:** only the functions actually declared in the PDF are transcribed into `MIA_WIN_SOURCE_TYPESCRIPT_CATALOG.ts`. The remaining 8 slots require concrete code contracts during implementation, not invented "already implemented" declarations.
12. **Research data rights:** provider terms, broker country eligibility, professional exchange market-data licenses and delayed filings can limit production redistribution or operation.

## Decision register before live certification

| Decision | Recommended default | Reason |
|---|---|---|
| Address matching | exact public address, no assumed legal identity | prevents false attribution |
| Single whale | one followed wallet per account and FAST sleeve | meets desired UX and limits duplicates |
| Wallet suggestion | analysis-only until explicit enablement | avoid algorithm silently choosing risk exposure |
| Fast strategy sizing | capped follower account risk, never whale notional | whales may have vastly more liquidity |
| On-chain finality | risk-appropriate verified commitment; pending never executable without a separately reviewed policy | prevent phantom trades |
| Missing token-safety check | DENY | fail closed |
| Fast latency target | measure p50/p95/p99 from observe→decision→quote→fill | no 4ms promise |
| Deep attribution | INFERRED, unless individually consented/verified | preserve market truth |
| Deep probability | `INSUFFICIENT_EVIDENCE` if uncalibrated | avoid fabricated precision |
| Strategy promotion | versioned holdout/review and kill switch | protect autonomy |
| Core rule parity | same deterministic risk authority in paper and future live | stop demo-only safety |
| Live | locked until independently certified and explicitly authorized | audited baseline lacks signer and live OMS |

## Acceptance and delivery rule

The design package is complete when the source copies, reconciled spec, exact declaration catalog, illustrative fail-closed TypeScript foundation, feature CSV, engineering prompt and manifest are present and the TypeScript files compile in isolation. **That is not operational MIA integration.** Actual WIN functionality needs its own reviewed source PRs, unit/e2e/chaos tests, provider smoke tests and staged paper observations. No action in this package authorizes a live trade.