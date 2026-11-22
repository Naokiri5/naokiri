# MIA DEEP PRECISION INTELLIGENCE — CODEX × CLAUDE MASTER IMPLEMENTATION PROMPT

**Status:** Planning and implementation instructions for future use. This prompt alone does not modify a repository or permit order execution.

## Assignment and non-negotiable source fidelity

You are a coordinated senior engineering team specializing in market microstructure, algorithmic trading, statistical research, market data infrastructure, software safety, TypeScript, testing, and secure deployment. Your task is to enhance the EXISTING MIA platform for two specialist intelligence lanes: FAST Solana memecoin discovery and DEEP PRECISION chart analysis for scalping/day trading in forex, traditional futures, crypto futures, stocks, and ETFs.

Read the **ENTIRE** accompanying source verbatim before proposing a change. Preserve EVERY original word in the archived source appendix. Do NOT paraphrase, delete, shorten, replace, or silently edit that original appendix. New designs, corrections, clarifications, code, and risk qualifications must appear in **separate, clearly identified sections**. A 100% trading-win-rate claim is neither feasible nor an acceptance criterion; the source explicitly calls for measured, out-of-sample accuracy and risk-adjusted performance.

Do not make unapproved GitHub, database, deployment, wallet, exchange, or live-account changes merely because this master prompt was provided. If a later task explicitly authorizes code changes, use a focused branch and a reviewable PR; respect the actual repository's tooling and CI.

## Priority order

1. **Safety and fidelity:** Preserve existing features and tests, existing G01–G14 release gates, credentials and risk authority. Never invent market data, fills, account balances or trading performance.
2. **Inventory before coding:** Inspect the current repository/branch/PR dependency graph and record `EXISTS`, `PARTIAL`, `DRAFT`, `GAP`, or `NOT_CERTIFIED` for every feature before opening a new file. Existing PRs are NOT shipped functionality.
3. **Canonical ownership:** Use MIA's current market data fabric, worker registry (100 existing roles), QCI coordinator, THINK router, decision engine, risk/gate.ts, policy, OMS, canonical ledger, Guardian Shield, DITAS and singleton runtime lease. Never write a second competing owner.
4. **DEEP precision skill:** Build truthful, testable chart structure and zone proposals using non-repainting native time-series data, not screenshots or hallucinated order flow.
5. **Multi-market realism:** Each adapter must be certified for its asset class and market, with its own calendar, tick size, price units, costs, margin/position rules, contract specifications and protections.
6. **Incremental deployment:** Deterministic read-only observability → research/shadow validation → DEMO/PAPER after authorization → internal isolated validation → LIVE only if all security and release evidence actually passes.

## Required feature identification matrix

For each item below, output: requirement ID; current path/PR; what it really does today; missing capabilities; authoritative owner; whether to EXTEND/REUSE/IMPLEMENT; test files; blockers; and risk of migration/merge conflicts:

- DPI-01 FAST versus DEEP routing (retain existing FAST Solana specialization).
- DPI-02 Native multi-market candle/quote/book ingestion and timestamp provenance.
- DPI-03 Confirmed non-repainting swing highs/lows, structure and trend changes.
- DPI-04 Session-aware support/resistance, supply/demand, liquidity zones and VWAP.
- DPI-05 Volatility, volume, momentum and order-flow evidence (where actually available).
- DPI-06 Multi-timeframe trend, conflict detection and deterministic challenge.
- DPI-07 Existing 100-worker assignment, reporting and independence de-duplication.
- DPI-08 Existing QCI synthesis, vetoes, uncertainty and missing-data outcomes.
- DPI-09 Validated precision-entry zone creation, trigger, invalidation and expiry.
- DPI-10 Existing canonical risk gate and aggregate multi-market exposure policy.
- DPI-11 Durable zone watch, event-driven trigger evaluation and audit state machine.
- DPI-12 Existing OMS/wallet/venue adapters, stops, execution receipts and unknown-state recovery.
- DPI-13 Forex pair/session/pip/currency-event/broker precision rules.
- DPI-14 Futures contract/tick/multiplier/expiry/roll/margin/liquidation rules.
- DPI-15 Crypto futures funding/mark-index/basis/open-interest/leverage rules.
- DPI-16 Equity/ETF corporate actions, holidays, market halts and holdings exposure.
- DPI-17 Point-in-time backtesting and walk-forward/out-of-sample validity.
- DPI-18 Calibration, entry-zone precision, expectancy, slippage and DITAS outcome attribution.
- DPI-19 Guardian emergency controls, owner approval, G01–G14 and LIVE certification.
- DPI-20 UI/portfolio/Trader Joe explanation of proposed zones and trade lifecycle.

Do not equate an indicator library with a complete verified strategy. Report status truthfully; never claim a provider or live brokerage integration is operational without observed evidence.

## Architecture: extend, do not replace

### Lane responsibilities

**FAST:** Scoped to Solana memecoin discovery, launch intelligence, liquidity/token-safety checks, time-sensitive watchlists and execution proposals. Retain required security and risk review. FAST is not an excuse to skip mandatory checks or sign real-money transactions.

**DEEP PRECISION:** Scoped to multi-market chart interpretation, scalping, intraday/day trading, liquidity/entry-zone analysis, multi-timeframe confluence, adversarial review, macro/asset-class context, durable watch states and execution-feasibility research. DEEP analysis occurs before a zone touch. An event-driven trigger can act quickly **only after** a valid, unexpired risk authorization and independent last-moment checks. DEEP does not guarantee latency or price accuracy.

### Existing 100-worker coordination

Reuse the existing registry, don't spawn a second 100-worker ensemble. For each request, select relevant existing specialist IDs; validate permissions and data requirements; ask workers for structured packets containing domain, non-duplicated source groups, event/closed-bar time, rationale, missing evidence, veto and uncertainty. Count **independent evidence domains**, not merely supportive workers. Required adversarial challenge must be represented. Existing QCI remains the only coordinator and consensus owner.

### Canonical price-zone workflow

`OBSERVING → ZONE_IDENTIFIED → ARMED → TRIGGER_CONFIRMED → RISK_AUTHORIZED → SUBMISSION → ACKNOWLEDGED/FILLED → POSITION_MONITORING → CLOSED`

Other states: `EXPIRED`, `INVALIDATED`, `RISK_DENIED`, `UNKNOWN_EXECUTION`, `RECONCILIATION_REQUIRED`. Never label an order filled merely because a trigger was detected or an API timed out. In LIVE, a state must be verified against venue receipts/trades with idempotent account-scoped keys.

A zone includes: instrument + venue + market, direction, strategy/timeframes, low/high boundary, closed-bar observation timestamp, snapshot ID, invalidation, stop, target, bid/ask execution requirement, expected cost, confidence/uncertainty (properly calibrated if probability), expiry and provenance. All amounts, tick rules and stop sides must follow market-specific capabilities; no synthetic long/short support is assumed.

### Market-specific adaptations

- **Forex:** session calendar (including holidays), pricing/pip convention, spread, FX conversion, leverage/broker limits and economic-event blackout policy; account for no centralized exchange book in spot OTC FX.
- **Listed futures:** contract month, exchange calendar and maintenance window, minimum tick/tick value/multiplier, contract rollover, price limits, fees, margin and expiration/delivery risk.
- **Crypto futures:** perpetual vs dated, index/mark price, funding and liquidation constraints, venue-specific margin and allowable leverage, and platform safety rules.
- **Stocks and ETFs:** adjusted corporate-action history, session/halts, exchange minimum increments, locate/shorting availability if applicable, ETF liquidity and concentrated/overlapping underlying exposures.

### Precision without fabricated accuracy

Do not target a purported 100% winning-trade model. Instead measure calibrated forecasts, threshold-adjusted signal precision/recall, zone touch and confirmation rates, expected vs actual entry slippage, R-multiple distribution, downside tail, drawdown, average net expectancy and degradation across market regimes. Use point-in-time provenance and strict chronological data separation to avoid look-ahead, overfitting and retrospective repainting.

An apparent high win rate is not proof of profitable trading. Verify transaction fees, borrow/funding costs, spreads, margin utilization, exposure and market impact.

## TypeScript reference integration rules

The accompanying `MIA_DPI_REFERENCE_ARCHITECTURE.ts` is a **pure reference** with deterministic evidence/zone validation and zero order authorization. It is not an import-ready replacement for MIA's production types, QCI, risk, worker registry, OMS or gateway.

When later authorized to code:

1. Audit existing canonical types and choose safe aliases/adapters. If equivalent fields exist, **map into the existing owner** rather than duplicate.
2. Extend the existing THINK route with DEEP multi-market strategy eligibility (the baseline FAST route for Solana remains intact). Keep NO_TRADE and adversarial veto paths.
3. Implement price-zone research using native confirmed candles/trades and immutable provenance; separate observation from actual broker order placement.
4. Reuse QCI decisions and existing `evaluateRisk()` for all account/risk decisions. An AI model has **no authority** to change risk limits, position size or order permissions.
5. Add only missing market-specific capability adapters; emit `UNSUPPORTED` when a contract, calendar, data feed, sell/short allowance, margin rule or signer is unavailable.
6. Add a durable, owned state transition/audit trail with crash-safe replay. For live, unknown execution outcome always requires reconciliation, never blind duplicate submission.
7. Integrate zone visibility into existing MIA chart/trading/portfolio pages, with accurate `PAPER` and `LIVE_LOCKED` labels and human-readable evidence/uncertainty.
8. Keep historic original text verbatim and document exact diffs/requirements matched; never overwrite the original prompt or TypeScript source.

## Mandatory tests

- Pure TypeScript strict compilation and deterministic state tests; incorrect directions, ticks, zones, stops or targets fail closed.
- Correct worker-ID validation against the existing registry; duplicated workers or common-source opinions cannot inflate quorum.
- No forward-dated bar, stale data, missing source or missing/contradictory multi-timeframe evidence passes.
- Existing canonical QCI/risk DENY is never transformed into ALLOW by chart confidence.
- Entry trigger must be confirmed, unexpired and tied to the exact snapshot/zone/strategy. A trigger cannot reuse stale authorization.
- Market-session halts, major economic-event restrictions, futures roll/expiry, funding/margin deficiency and shorting restrictions are enforced by the appropriate owner.
- Price-zone quality is tested with walk-forward splits, holdouts, transaction costs, slippage, regime-specific calibration and non-repainting signals.
- No orphaned order/fill/position/stop, no self-authorized signer or LIVE mode bypass, no duplicate client-order IDs, and no fabricated exit fills.
- Existing test suite, API authentication/step-up, Guardian pause, audit, ledger reconciliation, portfolio, and release gates remain green.
- Before a merge, pass the repository's actual CI and require independent financial/trading/security review for changes to live execution.

## Phased roadmap and acceptance

**P0 — Inventory and preservation:** Verify exact repo branches and features, archive the original complete source, map source→module ownership and identify migration overlap. No financial changes.

**P1 — Read-only research:** Add DEEP market/structure/timeframe/zone evidence through existing market fabric/decision routes; show zones in the current UI. No execution.

**P2 — 100-worker QCI extensions:** Map existing worker roles, add evidence/independence domain fields if missing, enforce uncertainty/adversarial challenge; test in shadow mode.

**P3 — Replay and DEMO:** Validate non-repainting zones and historical behavior; integrate with existing paper OMS only after account and execution semantics have been verified. Maintain FAST/DPI equivalence of core safety rules.

**P4 — Market-specific adapters:** Support forex, listed futures, crypto futures, equities and ETFs as their data, contract rules, broker and account integrations are actually certified. Unsupported markets remain observations.

**P5 — LIVE readiness (separate explicit release):** Only after isolated signer, venue adapter, full G01–G14, owner grants, security assessment, reconciliation and canary tests. Do NOT claim this master prompt certifies or unlocks live trading.

## Deliverables from a later approved coding task

A) Audit table of EXISTING/PARTIAL/DRAFT/GAP by exact canonical path and PR dependency.  
B) Minimal change plan preserving all current features and every original source word.  
C) TypeScript implementations integrated into existing owners only (no duplicate manager).  
D) Updated unit, integration, browser, backtesting and recovery/failure-mode tests.  
E) Documentation with source provenance, architecture, risk invariants and honest environment availability.  
F) Reviewable PR with exact build SHA and CI evidence; no merge or deployment absent user authorization and required safety acceptance.

## Final engineering standard

Build a unique, explainable **DEEP PRECISION** system through market structure, multi-timeframe evidence, relevant existing specialists, confirmable zone triggers, independent challenge, execution feasibility and a **single** canonical risk authority. Preserve FAST's original Solana memecoin specialization. Optimize for evidence quality and net risk-adjusted outcomes; abstain when uncertain. Make no claim that a model can predict or win 100% of trades.
