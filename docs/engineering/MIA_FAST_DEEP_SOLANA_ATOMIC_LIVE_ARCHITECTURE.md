# MIA 5.x — FAST Memecoin Bundles + DEEP Watch Baskets + Certified LIVE Atomic Execution

**Status:** Architecture proposal added to draft PR #106. NON-EXECUTING. No live enablement, signer, real orders, removal of tests, or new OMS in this document.
**Date:** 2026-11-21
**Repo:** https://github.com/Naokiri5/naokiri
**Base ownership:** existing canonical risk/gate.ts, exec/oms.ts, decision/engine.ts, core/mode.ts, qa/gates.ts, portfolio/ledger.ts, market scanner/fabric, bot runtime/lease, Guardian and DITAS.

## Executive design decisions

1. Preserve ALL existing features, including TESTNET certification evidence. Expose two **user-facing** environments: DEMO and LIVE. TESTNET is an internal, isolated venue-certification lane within the DEMO→LIVE release process, **not** a deletion, credential alias, or a source of live positions.
2. Keep one **canonical decision, QCI, risk and accounting authority**. FAST and DEEP are reasoning/monitoring policies that can abstain/veto, never grant order or signing authority.
3. Distinguish three incompatible atomicity scopes:
   - PAPER_DB_ATOMIC: one SQLite transaction across canonical simulated orders/stops/fills/ledger (P1/P2 code on PR #106).
   - SOLANA_SINGLE_TX_ATOMIC and SOLANA_JITO_BUNDLE_ATOMIC: supported Solana network/relay semantics only after independent signer, venue, landing and chain-finality certification.
   - CEX_COORDINATED_BASKET: per-venue ordinary orders, NOT atomic across assets or venues. Recovery must represent partial fills and hedging/exposure without inventing rollback.
4. Reuse PR #106's assessment/preview/OMS/status; do **not** install a second scanner, market fabric, exchange adapter factory, ledger, release gate, stop watcher, scheduler or event bus.
5. Zero LIVE authority is added by this proposal. Current G01–G14, build-signature attestation, signer certification, owner-bounded permission, account reconciliation, security review and venue-specific tests must actually pass; do not set pass flags or toggle a hard lock.
6. Distinguish a **MonitorBasket** (a dynamic selection of tokens/positions, may contain more than 5) from an **ExecutionBundle** (ordered actions with exact venue semantics; Jito at most 5 transactions). NEVER let a monitor basket directly sign/send transactions.

## Verified current source inventory and reuse matrix

| Capability | Current owner | Actual state | Proposed delta |
| --- | --- | --- | --- |
| Paper atomic bundle preflight, commit, links, status and Portfolio UI | Draft PR #106, server/src/exec/bundles/* + exec/oms.ts | Implemented and CI checked on PR branch, not merged to main | Extend through typed venue policy, never duplicate |
| Canonical individual risk + paper sizing | main risk/gate.ts; policy.ts | PAPER spot Binance risk; market/venue allowance is conservative | Add bundle aggregate guard, venue-specific Solana safety overlay, unified risk-evidence adapter |
| Canonical decisions, QCI and bot scheduler | main decision/engine.ts; qci/*; bot/bot.ts | Main pipeline drives individual PAPER entries | FAST candidate evaluation and DEEP observer as consumers; keep singleton leader lease |
| FAST/DEEP/AUTO router and adaptation | Open draft #89 (stacked); reflex #91 | Not merged in main; existing route has no execution authority | Reuse routeThinking() and think-adapter.ts, do not recreate an LLM risk override |
| Solana Hunter | Open stacked #46 | Read-only; explicitly executionReady:false | Continue read-only fast candidate intake; no execution promotion by rank |
| Mint checks and Pump.fun launch/graduation monitoring | Open stacked #50 and #52 | Read-only; no signer | Reuse verifiable program/mint evidence, add token risk scoring after dependencies merge |
| Solana Helius, Jupiter Swap V2, GoPlus read-only evidence | Open stacked #95 | Data and quotes only; no order routing | Use original provider/http.ts for preflight; require fresh quote and contract verification |
| TESTNET venue validation | Open stacked #92 | Binance /order/test preflight only; no actual TESTNET order placement | Keep **internal certification lane**; remove only redundant top-level user mode, never tests |
| Live order state/reconciliation | Open stacked #97 and #72 | Pure reducer + read-only reconciliation, not a real executing OMS | Reuse only after provenance, dependencies and DB migration compatibility |
| Durable outbox | Open stacked #43 | DITAS topic only; not an execution outbox | Extend canonical outbox after safety review; never publish a phantom fill |
| Guardian Shield 2.0 | Open stacked #75 | Safety integration in another branch | Reuse unified kill switch, logging and security response; risk reducers only |
| Current LIVE venue + isolated signer | main / draft | NOT certified / NOT implemented | New adapter and signer behind safety certification; activation forbidden until gates pass |

Links: https://github.com/Naokiri5/naokiri/pull/106, /pull/89, /pull/91, /pull/46, /pull/50, /pull/52, /pull/95, /pull/92, /pull/97, /pull/72, /pull/43, /pull/75. Multiple stacks depend on PR #45 and have migration conflicts. Inventory must be regenerated against actual merge-base and head prior to changing source.

## Runtime layout: extend in place

~~~text
Existing MIA market/providers and scanners
  ├─ Binance, read-only DEX Screener
  ├─ Solana Hunter, Pump.fun events, mint safety, on-chain pools (stacked drafts)
  └─ Market quality and source/slot provenance
          ↓
Existing QCI + Decision Engine
          ├─ FAST (time-sensitive ranked candidate proposals)
          ├─ DEEP (monitor baskets, replay, risk and extended challenges)
          └─ NO_TRADE / deferred
          ↓
Existing canonical risk/gate.ts
          + unified basket-level exposure and token safety constraints
          + authorization and reservation proof (backend only)
          ↓
Shared Bundle Coordinator (one coordinator, no shadow OMS)
          ├─ DEMO → same canonical risk rules → PAPER_DB_ATOMIC simulator
          ├─ Internal certification → isolated TESTNET provider; NEVER real money
          └─ LIVE (LOCKED until certified) → venue capability adapter
                  ├─ Solana single-transaction or Jito atomic execution
                  └─ CEX coordinated best-effort batch (never falsely atomic)
          ↓
Canonical order/fill/position ledger + durable event journal + reconciler
          ↓
Existing Portfolio, Trader Joe, DITAS, Guardian and monitor/bot lanes
~~~

## FAST: memecoin bundle scanner

Goal: produce timely **candidates** and safe executable-intent proposals, not permission to trade.

Input: existing Solana Hunter and Pump.fun on-chain events, DEX Screener market data, Helius mint/holder evidence, Jupiter quote/instructions (after certification), GoPlus risk flags, chain slot and pool reserves. Each must record source, slot, timestamp, age and confidence. Missing or conflicting critical evidence means WATCH/INSUFFICIENT_DATA, not BUY.

Proposed pipeline:
1. Discover fresh launched/graduated pools; normalize by **mint address + chain ID**, never by ticker alone. Deduplicate a mint across multiple pools and scanners.
2. Pre-screen source/slot freshness, pool age, available/exit liquidity, volume/unique traders and signs of wash activity. Mark concentrated-holder, unknown admin, dynamic Token-2022 transfer tax, freeze/mint authority, upgrade authority, blacklist/honeypot-like behavior, suspect permissions and freeze risk as hard veto or manual-review evidence depending on policy.
3. Cross-check price impact and **sellability** (not just a buy quote); simulate the post-entry exit under conservative price/fee/liquidity assumptions, check token transfer restrictions, and ensure transaction recipient + program IDs match independently approved routers.
4. Run existing QCI/decision pipeline in FAST mode, with zero authority elevation; select only eligible assets and generate an execution **proposal**. One mint per group unless an independently risk-reviewed strategy needs multiple operations on that mint.
5. Build ordered Jito plan with <=5 valid transactions, explicit blockhash/expiry, compute/priority fees, capped tips, max spent SOL and worst-case slippage; simulate all transactions and verify their estimated effects. Log rejects and latency.
6. Once (and ONLY once) LIVE is certified, require scoped backend signing grant and independent wallet policy; send with idempotency, persist submission ID + transaction signatures before any retry, inspect getInflightBundleStatuses/getBundleStatuses and independent on-chain signatures/finality/actual token balances. UNKNOWN means freeze/reconcile, never blind resubmit.
7. Never execute bundles to distribute token ownership artificially, inflate trading volume, mislead markets or trigger deceptive coordinated wallet activity.

FAST latency budget should be measured as p50/p95/p99 per substage, with graceful NO_TRADE on stale evidence, RPC loss or missing testable route. Do not set a universal 1-second execution guarantee.

## DEEP: bundle monitoring / extended thinking

Goal: provide strong analysis for a **MonitorBasket** independent of any execution bundle size or chain.

- Maintain watch groups for new launch risk, existing positions, cross-token correlation/sector concentration, exit liquidity, developer/holder changes, price momentum and news signals.
- Use existing QCI, DITAS, the THINK deep challenge/horizon checks and existing scenario tools. A confidence score cannot override missing evidence or a core veto.
- For open positions, derive from canonical fills + positions + stops and venue confirmations. Monitor actual sell-route availability, deteriorating pool depth, admin changes, stale quotes, abnormal gas/tip spikes and protection gaps; raise notifications/pause appropriately through existing Guardian.
- Event-driven DEEP trigger examples: suspicious holder concentration, token authority change, data conflict, unknown submission state, failed liquidity reconciliation, correlated exposure spike and adverse fill/markout.
- DEEP recommendations are advice/research or a *new* reviewed decision intent. They cannot write directly into the OMS; existing trade authorization and risk checks remain obligatory.
- FAST→DEEP escalation is a decision transition, not a new wallet transaction. DEEP→FAST only resumes after new valid evidence, not from a previous stale approval.

## One typed contract (illustrative, non-executing)

~~~typescript
type UserEnvironment = 'DEMO' | 'LIVE';
type InternalValidationLane = 'BINANCE_TESTNET' | 'SOLANA_LOCAL_SIM' | 'REPLAY';
type ReasoningPolicy = 'FAST' | 'DEEP' | 'AUTO' | 'NO_TRADE';
type BundleAtomicity =
  | 'PAPER_DB_ATOMIC'
  | 'SOLANA_SINGLE_TX_ATOMIC'
  | 'SOLANA_JITO_BUNDLE_ATOMIC'
  | 'CEX_COORDINATED_BEST_EFFORT';

interface MonitorBasket {
  id: string;
  chainIds: readonly string[];
  instrumentIds: readonly string[];
  policy: ReasoningPolicy;
  /** Observation only; cannot place orders. */
  canAuthorizeTrade: false;
}

interface BundleIntent {
  id: string;
  environment: UserEnvironment;
  accountId: string;
  decisionIds: readonly string[];
  atomicity: BundleAtomicity;
  venueId: string;
  idempotencyKey: string;
  strategyId: string;
  expiresAtMs: number;
  requestedMaxSpendAtomic: string;
  maxFeesAtomic: string;
  maxTipAtomic: string;
  /** Issued by trusted backend on release; never accepted from client JSON. */
  signedAuthorizationRef?: string;
}

type BundleLifecycle =
  | 'PROPOSED' | 'RISK_DENIED' | 'RISK_APPROVED'
  | 'RESERVED' | 'SIGNED' | 'SUBMITTED' | 'LANDED'
  | 'PARTIALLY_FILLED' | 'RECONCILIATION_REQUIRED'
  | 'FINALIZED' | 'FAILED' | 'EXPIRED';

interface BundleObservation {
  bundleId: string;
  state: BundleLifecycle;
  environment: UserEnvironment;
  source: 'CANONICAL_OMS' | 'VERIFIED_CHAIN' | 'VERIFIED_VENUE';
  orderIds: readonly string[];
  signatures: readonly string[];
  lastObservedSlot?: number;
  requiresReconciliation: boolean;
  canBlindRetry: false;
}
~~~

This is a DESIGN CONTRACT. Existing canonical types must be imported/aliased rather than duplicated when implementing. JS floating-point amounts must not determine signed Solana transfers; use token-decimal-aware integer units. The concrete LIVE execution capability cannot be inferred from the presence of a type or environment variable.

## End-to-end DEMO and LIVE parity

| Phase | DEMO | LIVE (after certification) |
| --- | --- | --- |
| Discovery | Same canonical market/safety evidence; replay as needed | Same canonical market/safety evidence |
| QCI/FAST/DEEP | Same required evidence + vetoes | Same required evidence + vetoes |
| Sizing & bundle risk | Same policy and correlated-exposure constraints | Same policy and correlated-exposure constraints, plus stricter venue costs |
| Submission | Deterministic atomic simulation against cloned snapshots and fees | Certified signer/adapter only; real network outcome distinct |
| Protection | Existing simulated stop monitoring, never exchange-native promise | Independent verified protective mechanism or exposure-reduction policy |
| Reconciliation | Compare canonical simulated fills/ledger | Match receipt, signatures, token balance, chain finality and/or CEX trades |
| Kill switch | Blocks new entries, never fabricates sells | Blocks signing/new orders; emergency actions require separately verified execution |
| Audit | Source, policy version, decision, legs, simulated effects | Same plus signed intent, wallet scope, chain/venue proofs and execution costs |

Important: DEMO Jito simulation MUST model expiry, failed bundle, fee/tip cost, pool slippage, chain congestion, RPC timeouts and unknown status. Simulated success is never assumed to predict real landing or net profitability.

## TESTNET consolidation — without deleting protection

UI: only DEMO and LIVE. Internal service retains TESTNET and simulated execution accounts for staged certification. Do NOT alias testnet balances or RPC to live accounts. Keep existing PR #92 credentials, isolated host allowlist, tests and order/test route. Replace any future redundant *top-level trading tab* with a DEMO certification panel that clearly labels SIMULATION vs TESTNET_PREFLIGHT and never presents a TESTNET validation response as an actual order fill. QA may require tests there even when hidden from normal user navigation.

## Real-money release: unlock through evidence, not by toggling a boolean

LIVE remains locked until EVERY item exists and is demonstrably verified:
- Exact deployed build SHA and all G01–G14 release gates PASS, without manual status forgery.
- Independent human security/trading-risk review; signer isolation, no seed phrase in app, key scoping, spend ceilings, expiration and program-address restrictions.
- Fully certified Solana/Jito adapter; verified quotation, simulation, signed message construction, program allowlists, chain confirmation and balances.
- Durable intent reservation, idempotency fence and append-only submission records; restart/replay recovery and UNKNOWN reconciliation with no blind retry.
- Per-bundle, per-mint, per-wallet, per-day loss, concentration, gas/tip, liquidity, slippage and concurrent-bundle limits; account reservations include pending submissions.
- Fail-safe automatic pause on signer compromise indications, execution divergence, unknown delivery, stale status, major token-safety changes or absent protection.
- Owner-controlled, time-bound bounded-live grant (venue, chain, token allowlist, amounts and strategy limits) plus an explicit re-authentication and a separately scoped emergency stop.
- Canary release after passing DEMO and internal validation; staged exposure with human sign-off before broadening. No autonomous escalation of limits after profits.

Neither an LLM/FAST agent nor Trader Joe may remove those controls. Real-money orders across CEX markets have different partial-fill semantics from Jito; support best-effort basket policies with durable compensating procedures, never claim cross-chain or CEX atomicity.

## Proposed canonical file placement (future code, gap-only)

~~~text
server/src/decision/think-router.ts    # reuse stacked #89 FAST/DEEP evidence routing
server/src/decision/think-adapter.ts   # reuse stacked #89; attach Solana monitoring evidence
server/src/market/scanner.ts           # existing CEX scan; do not replace
server/src/market/discover.ts          # reuse Solana Hunter PR #46 and stacked mint/Pump.fun PRs
server/src/safety/                     # existing risk/safety checks; add Solana-specific evidence adapter only
server/src/risk/gate.ts                # single authoritative risk policy; add basket-level veto adapter
server/src/exec/bundles/assessment.ts  # existing PR #106 pure aggregate gate
server/src/exec/bundles/preview.ts     # existing PR #106 canonical evidence
server/src/exec/bundles/status.ts      # existing PR #106 grouped lifecycle
server/src/exec/oms.ts                 # existing PAPER canonical OMS, no replacement
server/src/exec/venues/solana-jito.ts  # future certified LIVE adapter, off by default
server/src/exec/venues/cex-basket.ts   # future non-atomic CEX venue capability, off by default
server/src/portfolio/ledger.ts        # single financial truth; no copy
server/src/qa/gates.ts                # existing G01–G14; never overwrite as TRUE
server/src/ops/lease.ts               # single writer/leader fence
server/src/ditas/                      # observe outcomes, markouts, calibration, not trade authority
web/src/pages/Trading.tsx             # existing owner Portfolio; DEMO/LIVE UI only after release
~~~

Do not blindly create every file above. Before coding a phase, discover what exists on the target merge branch and extend it. Branches #45, #89–#92, #95–#101 are highly stacked. First reconcile their exact ancestors and migration version order. Do not append v6 blindly where another branch has later schema versions.

## Release sequencing and test requirements

**Stage A — source merge readiness (NO real orders):** Move all related contracts into one canonical integration map. Reconcile #106, #89, #91, #92, #95, #97, Solana Hunter #46/#50/#52, #43 and #75 without duplicate ownership. Current PR #106 remains draft and its PAPER unit/E2E suite is not proof of on-chain execution.

**Stage B — monitoring and shadow FAST/DEEP:** Read-only memecoin watch bundles, mint security, liquidity, sell-route feasibility and event-triggered DEEP analysis; immutable token/slot evidence; no signer.

**Stage C — DEMO execution fidelity:** Reuse PAPER OMS and shared policy, extend simulated Solana bundle constraints, delays and fees; test 2–5 leg success, reject and atomic rollback; no chain send.

**Stage D — internal certification:** Keep independent TESTNET and local replay tests; deterministic signer-free simulation, then controlled signed test transactions ONLY in a non-production isolated environment by explicit review. Do not use production wallets or pretend CEX TESTNET proves Jito finality.

**Stage E — certified LIVE adapter:** Implement an isolated signer, Jito Block Engine transport, durable intents and verified on-chain finality. Add failure injection for signer rejection, RPC divergence, stale blockhash, abnormal tips, slippage failures, block reorganization/uncled-slot risks, duplicate responses and unknown submission.

**Stage F — bounded LIVE launch:** Independent manual authorization and policy ceilings, runtime attestation, rollout canary, reconciliation alarms, documented rollback/kill switch and externally auditable results. NEVER toggle BOUNDED_LIVE simply to make a UI appear functional.

### Must-pass regression matrix

- All current single-trade OMS, Guardian, emergency, portfolio and live-lock tests remain green.
- FAST/DEEP/NO_TRADE routes cannot turn DENY into ALLOW, cannot sign and cannot mutate canonical policy.
- No stale, future-dated, spoofed/unknown mint or token-pool evidence can enter a bundle.
- A confirmed safe BUY does not imply a valid SELL; missing exit quote always vetoes unattended memecoin execution.
- Aggregate cash, risk, fee/tip, slippage, overlap, wallet and token concentration limits are rechecked at the last possible authoritative moment.
- Missing signer certification, environment-account mismatch or TESTNET key in LIVE must fail closed.
- Jito sendBundle acceptance is SUBMITTED, not LANDED/FINALIZED; reconcile every transaction signature and amounts.
- UNKNOWN outcomes disable blind retry until chain/RPC evidence resolves the state.
- CEX basket partial fills remain accurately PARTIALLY_FILLED and cannot be mislabeled atomic.
- Outbox/database crash recovery cannot double-submit, invent a fill, or lose pending reservations.
- No output may claim production LIVE execution until exact deployed build + real certification evidence are verified.

## External primary-source references (verified 2026-11-21)

- Jito official bundle atomicity and constraints: https://docs.jito.wtf/bundles/
- Jito low latency send/status and uncled-block warning: https://docs.jito.wtf/lowlatencytxnsend/
- Solana transaction atomic instruction model: https://solana.com/docs/core/transactions
- Jupiter current Swap V2 order/build/execute guidance: https://github.com/jup-ag/docs/blob/main/swap/order-and-execute.mdx
- Jupiter managed landing vs custom build (do NOT assume the same transaction may be submitted both via managed /execute and Jito with no reconciliation): https://github.com/jup-ag/docs/blob/main/swap/index.mdx

**Implementation status:** This document is an architecture enhancement proposal ONLY. It does not create a live signer, alter release gates, remove testnet checks, place a trade, or deploy to production.
