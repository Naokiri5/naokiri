# MIA Unified Exit Protection — Master Prompt, TypeScript Contract and 50-Problem Traceability

Status: **DRAFT / RESEARCH ONLY**. Source: user-supplied `Pasted text(20261122-021801).txt` (50 exit-protection problems, FAST 1–25 and DEEP 26–50). This document preserves the feature intent; the TypeScript implementation is a limited first slice, **not** a claim of all 50 implemented.

## Master prompt for Codex / engineering reviewers

You are MIA's senior trading-systems integration engineer. Inspect the existing repository and relevant open PRs before changes. Preserve all existing production features and branches. Do not replace or duplicate the existing decision engine, risk gate, OMS, ledger, exit capsule, bot scheduler, QCI workers, market fabric, venue adapters, or Trader Joe. Implement the following roadmap incrementally in their canonical ownership locations. Never claim rug prediction, guaranteed take-profit, liquidation avoidance, or a 100% win rate.

**Goal:** MIA FAST should detect verified memecoin sellability, liquidity withdrawal, insider distribution, executable exit depth, slippage, and degraded network conditions and proactively reduce exposure. MIA DEEP should continuously track venue-specific mark/index prices, liquidation distance, margin utilization, leverage, portfolio stress, funding, and protective order health. Protection must run independently of slow AI research. Both modes must share one canonical risk/OMS/ledger authority, with paper/live parity in rules; live requires separate explicit owner authorization, verified venue adapters and release gates.

**Required process:** (1) Inventory modules and PR overlaps. (2) Identify canonical owners. (3) Build deterministic, versioned evidence schemas with timestamps, provenance, and unknown-as-unknown handling. (4) Add pure assessment and fixtures. (5) Validate simulated FAST rug and DEEP margin stress scenarios, including stale data, unsellable tokens, insufficient depth, partial fills, order timeouts, reorgs and restarts. (6) Wire advisory signals into existing risk/OMS only after test evidence and code review. (7) Ensure idempotency, position reconciliation, audit logging, and alert escalation. (8) Run typecheck, focused tests, full tests, security scan and deployment checks. (9) Keep PR draft and do not merge if checks fail or have not run. (10) Never enable live trading from this feature.

## TypeScript implementation

Canonical additive file: [server/src/risk/exitProtection.ts](../../server/src/risk/exitProtection.ts)

- `assessExitProtection(evidence: ExitEvidence): ExitAssessment` is pure, deterministic, side-effect-free.
- FAST evaluates verified sellability, liquidity withdrawal, insider distribution, quote age, executable quantity and impact.
- DEEP evaluates venue-calculated liquidation price against mark, stress/reserve buffer, account-margin safety, and data freshness.
- Result `orderAuthorized: false` is a hard type contract. `EXIT_IF_EXECUTABLE` is **a recommendation**, not an executed or authorized trade.
- `PROTECTION_UNVERIFIED` means risk is not controlled: block new exposure and escalate operationally via the existing system when integration is approved; it must never be interpreted as `HOLD = safe`.
- Thresholds are provided by approved policy; no fixed +20/+40/+70 ladder is deployed.
- Current implementation has **no runtime call site** and **no venue integrations**. It must not be represented as active protection.

## 50-problem traceability — original numbering

| # | FAST/DEEP problem | Planned integration | Status |
|---|---|---|---|
| 1 | Developer removes liquidity | Verified LP withdrawals | Assessment slice |
| 2 | Honeypot | Verified sellability and restrictions | Assessment slice |
| 3 | Developer wallet dumps | Verified linked-wallet distribution | Assessment slice |
| 4 | Holder concentration | Token safety policy | Pending |
| 5 | Coordinated insider selling | Wallet graph evidence | Pending |
| 6 | Volume collapses | Genuine-volume trend | Pending |
| 7 | Parabolic pump | Validated adaptive profit ladder | Pending |
| 8 | Sell pressure | Verified DEX/order-flow imbalance | Pending |
| 9 | Insufficient exit liquidity | Executable quantity | Assessment slice |
| 10 | Slippage | Execution impact ceiling | Assessment slice |
| 11 | Wash trading | Connected-wallet volume filtering | Pending |
| 12 | Mint authority | Token permission safety | Pending |
| 13 | Freeze/transfer restrictions | Token permission safety | Pending |
| 14 | LP lock expiry | Lock monitoring | Pending |
| 15 | Whale transfers | Provenance-aware wallet evidence | Pending |
| 16 | Parabolic peak | Liquidity-aware trailing exit | Pending |
| 17 | Profit reversal | Validated profit floor | Pending |
| 18 | Exit transaction fails | Idempotent bounded retry and reconcile | Pending |
| 19 | Congested network | Confirmation-aware transaction state | Pending |
| 20 | MEV/sandwich | Route protection where supported | Pending |
| 21 | LP migration | Verified multi-pool routing | Pending |
| 22 | Social hype fades | Non-authoritative sentiment evidence | Pending |
| 23 | Portfolio concentration | Canonical portfolio risk | Pending |
| 24 | Stop not executable | Verified exit route and incident | Assessment slice |
| 25 | Repeat rugs | Evidence-based deployer registry | Pending |
| 26 | Approaching liquidation | Venue mark/liquidation buffer | Assessment slice |
| 27 | Excess leverage | Venue-aware leverage caps | Pending |
| 28 | Stop near liquidation | Buffer and stop validation | Pending |
| 29 | Volatility spike | Stress-move buffer | Assessment slice |
| 30 | Margin ratio deterioration | Account margin health | Assessment slice |
| 31 | Funding drag | Funding forecast | Pending |
| 32 | Correlated positions | Portfolio stress engine | Pending |
| 33 | Overnight/weekend gap | Market-calendar gap stress | Pending |
| 34 | Economic announcements | Event-aware exposure reduction | Pending |
| 35 | Bad support/resistance | Explicit technical invalidation | Pending |
| 36 | Profit reversal | Regime-aware trailing exits | Pending |
| 37 | Stop unfilled | Venue ack/fill reconciliation | Pending |
| 38 | Exchange API disconnect | Degraded-mode incident | Pending |
| 39 | Mark vs last divergence | Venue mark required | Assessment slice |
| 40 | Averaging down | Canonical risk approval | Pending |
| 41 | Trend reversal during research | Independent deterministic guardian | Pending |
| 42 | Model drift | Strategy health checks | Pending |
| 43 | Deep research delays exit | Independent deterministic guardian | Pending |
| 44 | Cross-margin contagion | Account-margin safety input | Assessment slice |
| 45 | Stale liquidation model | Margin freshness check | Assessment slice |
| 46 | Duplicate stops on restart | Idempotent OMS reconciliation | Pending |
| 47 | Margin tier changes | Venue tier refresh | Pending |
| 48 | Insufficient exit depth | Executable quantity | Assessment slice |
| 49 | Loss cascade | Drawdown circuit breakers | Pending |
| 50 | Phantom closed position | Fill and ledger reconciliation | Pending |

## Release acceptance and architectural guardrails

1. Reuse `server/src/risk/gate.ts`, `server/src/exec/oms.ts`, `server/src/portfolio/ledger.ts`, `server/src/lab/exits.ts`, and `server/src/bot/bot.ts` instead of introducing duplicate authorities.
2. Never treat stale, missing, or uncertain evidence as proof of safety; fail closed for **new exposure**, but do not blindly close a position without an executable route.
3. No order submission from this module; the existing OMS remains the sole order authority.
4. Use venue-native liquidation models for cross margin, isolated margin, tiers, fees, and liquidation penalties; the current simple buffer is **research-only**.
5. Never assume token sellability or liquidation prevention can be guaranteed.
6. Verify replay, paper integration, and failure recovery before connecting this module to the scheduler.
7. Confirm PR readiness through actual CI evidence; do not merge unfinished work.

## Shared PAPER/LIVE monitoring integration (follow-up slice)

Added `server/src/exec/exitMonitor.ts` with `monitorExitProtection(source, sink)` and `server/test/exitMonitor.test.ts`. The same assessment contract accepts PAPER and LIVE position evidence, returns advisory recommendations, and emits degraded status on unavailable sources. The source and sink are injected; there is **no installed live source, no live execution adapter, and no background runtime wiring yet**. The existing paper OMS remains responsible for actual position protection. Do not treat this read-only integration port as a deployed trading feature.

**Next mandatory step before runtime wiring:** implement authoritative paper evidence mapping from existing market/ledger and independently verified live venue snapshots, with provenance, sellability/mark/margin inputs and strict freshness checks. Attach to the existing leader-only monitor lane; reconcile with canonical OMS/ledger and require integration tests and fresh CI. LIVE order execution remains prohibited without owner authorization and release certification.
