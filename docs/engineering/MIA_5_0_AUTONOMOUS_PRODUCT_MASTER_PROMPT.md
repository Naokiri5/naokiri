# MIA 5.0 — AUTONOMOUS PRODUCT MASTER PROMPT (SOURCE-FAITHFUL, NO DUPLICATES)

For Codex, Claude and the MIA TypeScript engineering team.

Repository: https://github.com/Naokiri5/naokiri
Canonical original user prompt, archived in this branch: docs/source-archive/MIA_5_0_AUTONOMOUS_PRODUCT_ROADMAP_USER_ORIGINAL.md
Base engineering branch: feat/mia-live-certification-order-state-20261121 (draft PR #97).
This enhancement branch: feat/mia-autonomy-product-emotion-overlay-20261121.
Audited main commit: 6476391f4d7e8f8884c76ac4e31bb3779c444d77 on 2026-11-21.

## AUTHORITATIVE PRODUCT GOAL

Deliver SIX connected capabilities, preserving the attached roadmap's original scope:
A. MEMECOIN HUNTER: fast Solana discovery, screening, eventually safe/certified execution.
B. FUTURES SCALPER: eligible crypto and financial futures, short/long margin safety, verified stops.
C. EMOTION-AWARE TRADING INTELLIGENCE: detect observed hype/fear/panic/uncertainty/recovery, risk-reducing only.
D. DEEP THINKING: existing 100-worker QCI + FAST/DEEP/AUTO; abstain on insufficient confidence.
E. SPOT INVESTMENT ANALYST: ranked assets, official project facts, tokenomics, risk, source timestamps and WAIT decisions.
F. YIELD RESEARCH ASSISTANT: defensible APY and risk comparison with MANUAL execution only.

MIA's owner should only need to configure accounts, approved strategies, maximum exposure, authorization windows and emergency recovery. After formal certification it may autonomously execute only routine orders INSIDE these preset bounds. AI is NEVER allowed to raise limits, grant LIVE access, withdraw, or move funds.

100% win rate is not an achievable guarantee. Do not claim it. Optimize AFTER-COST risk-adjusted expectancy, maximum drawdown, tail-loss control, fill quality, operational reliability and conservative abstention.

## STOP: IDENTIFY BEFORE IMPLEMENTING

Before editing ANY code, do these steps in order:

1. Read the WHOLE archived original user prompt. Do not delete, abridge or silently rewrite it.
2. Read main HEAD and EVERY relevant draft branch; a draft is NOT a deployed feature. Check PR #45 (unified), PR #47/#52 (Solana Omega), PR #89/#91 (THINK), PR #92 (three execution environments), PR #95 (market data) and PR #97 (live readiness/order state). Verify their current base/head and run CI after any merge.
3. Build a feature manifest: ID, user requirement, observed status, implementation owner, evidence file/function/test/commit, missing behavior, safe extension point and external prerequisites. This matrix is a snapshot, NOT proof that items are fully deployed.
4. Status must be one of IN_MAIN, PARTIAL_IN_MAIN, DRAFT_STACK, DRAFT_OTHER, IN_THIS_PR, NEW_REQUIRED, NOT_CERTIFIED, REQUIREMENT_NOT_CODE. Re-audit for changes; never mark a branch feature "IN_MAIN" unless merged and validated.
5. If IN_MAIN, enhance the same function with minimal diffs. If DRAFT, reconcile the existing implementation instead of duplicating it. If NEW_REQUIRED, create only the smallest missing module at the owner boundary.
6. Do not add a second worker pool, scanner, risk gate, QCI, regime classifier, OMS, portfolio ledger, indicator engine, research feed, provider-health registry or signer. Do not import an external trading framework wholesale.
7. Preserve original database data and schema. Only add append-only migrations after verifying current schema and rollback constraints. Do not apply destructive migrations.
8. Test each change in isolation, compare source hashes/exports/API contracts, run typecheck, regression tests, Playwright and security scan, and provide exact CI results before a draft PR is considered reviewable.

## VERIFIED REUSE / EXTEND / BUILD DECISION MATRIX

These paths are under server/src unless otherwise indicated. The status is source-derived as of the audited commit and draft PRs; it must be refreshed by the implementation agent.

| ID | Capability | Status | Existing owner / branch evidence | Required action |
|---|---|---|---|---|
| INT-01 | 100-worker QCI consensus | IN_MAIN | qci/coordinator.ts; workers/registry.ts | EXTEND source quality/calibration; no second QCI |
| INT-02 | Regime classification | IN_MAIN | regime/regime.ts | REUSE deterministic regime; no emotion oracle |
| INT-03 | FAST/DEEP/AUTO thinking | DRAFT_STACK | decision/think-router.ts; think-adapter.ts; PR #89/#91 | EXTEND current THINK and preserve risk veto |
| INT-04 | Emotion risk interpretation | IN_THIS_PR | decision/emotion-evidence.ts; think-adapter.ts | EXTEND THINK with risk-reducing SHADOW evidence |
| INT-05 | Verified external sentiment | NEW_REQUIRED | news/news.ts + source provenance | BUILD licensed timestamped attributed sources only |
| INT-06 | Model calibration and drift | PARTIAL_IN_MAIN | qci/coordinator.ts; decision/scoring.ts | EXTEND using actual OOS outcomes, abstain on missing |
| MEM-01 | Solana Hunter ranking | DRAFT_OTHER | solana/hunting.ts; PR #47 | REUSE read-only watcher and compare with market/hunt ranker |
| MEM-02 | Pump.fun launch and graduation feed | DRAFT_OTHER | solana/pumpFeed.ts; PR #52 | REUSE socket, add gap/reconnect and backpressure evidence |
| MEM-03 | Mint authority/token checks | DRAFT_OTHER | solana/mint-audit.ts; PR #50 | EXTEND holder, pool, Token-2022, sellability checks |
| MEM-04 | Helius/Jupiter/GoPlus | DRAFT_STACK | providers/helius.ts; jupiter.ts; goplus.ts; PR #95 | REUSE read-only adapters; no sign/execute |
| MEM-05 | Low-latency quote-to-signal path | PARTIAL_DRAFT | market/fabric.ts; decision/think-router.ts; QHEF | BENCHMARK actual p95/p99 latency, without LLM hot-path |
| MEM-06 | Simulated executable buy/sell routes | NEW_REQUIRED | solana/* + exec/venues/* | BUILD only when token and route checks are verifiable |
| MEM-07 | Signed swaps, chain confirmation and recovery | NEW_REQUIRED | exec/venue adapter + isolated signer | BUILD later behind hard authorization and durable receipts |
| FUT-01 | Financial/crypto futures contract catalog | NEW_REQUIRED | market/types.ts + venue capabilities | BUILD multipliers, ticks, margin, sessions, expiry, settlement |
| FUT-02 | Short/long futures scalping strategies | NEW_REQUIRED | lab/strategies.ts | EXTEND capsules, do not reuse spot long-only signal type |
| FUT-03 | Margin, liquidation and funding risk | NEW_REQUIRED | risk/gate.ts + futures venue facts | EXTEND ONE canonical risk gate and limits |
| FUT-04 | Reduce-only protection and positions | NEW_REQUIRED | exec/venues/* | BUILD explicit futures account-scoped state |
| FUT-05 | Paper/testnet and future certified live | NEW_REQUIRED | exec/environment.ts + venue adapters | TEST PAPER->TESTNET first, separate LIVE approval |
| SPOT-01 | Crypto spot scanner and 3 strategies | IN_MAIN | market/scanner.ts; lab/strategies.ts | REUSE and improve OOS economics, data truth and exits |
| SPOT-02 | Spot project fundamentals/tokenomics | NEW_REQUIRED | research/* | BUILD sourced disclosures, unlocks, security and timestamps |
| SPOT-03 | Stock/ETF paper broker metadata | DRAFT_STACK | providers/regulatedBrokers.ts; PR #95 | EXTEND only when licensed, eligible data known |
| SPOT-04 | Trader Joe sourced explanations | PARTIAL_IN_MAIN | joe/joe.ts | EXTEND factual tool results, no signing authority |
| YLD-01 | DefiLlama APY/TVL research | DRAFT_OTHER | research/defillama.ts; PR #31/#45 | REUSE existing module before adding another API |
| YLD-02 | Net and risk-adjusted yield comparison | NEW_REQUIRED | research/defillama.ts (after merge) | EXTEND base/reward/IL/depeg/lockup/gas risk |
| YLD-03 | Manual-only yield execution | REQUIREMENT_NOT_CODE | wallet restrictions + research routes | NO auto deposits, approvals, withdrawals or yield trading |
| OPS-01 | One deterministic risk gate | IN_MAIN | risk/gate.ts; risk/policy.ts | REUSE, never create a second independent permission system |
| OPS-02 | Paper OMS and paper ledger | IN_MAIN | exec/oms.ts; portfolio/ledger.ts | REUSE; prove parity before async contract refactor |
| OPS-03 | PAPER/TESTNET/LIVE contexts | DRAFT_STACK | exec/environment.ts; PR #92 | REUSE isolated account/env types, no shared funds |
| OPS-04 | Binance testnet signed diagnostics | DRAFT_STACK | exec/venues/binanceTestnet.ts; PR #92 | EXISTS preflight only; no actual testnet orders |
| OPS-05 | Exchange order state and live readiness | DRAFT_STACK | exec/venueOrderState.ts; liveReadiness.ts; PR #97 | REUSE reducer/witness, still non-executing |
| OPS-06 | Durable order-intent/reconciliation OMS | NEW_REQUIRED | exec/* + db/migrations.ts | BUILD persistence, unknown response handling, confirmed fills |
| OPS-07 | Guardian Shield, risk incidents and emergency | PARTIAL_DRAFT | exec/incidents.ts; guardian branches | EXTEND original controls and adversarial security tests |
| OPS-08 | Signer, release certificate and transaction firewall | NEW_REQUIRED | security/* + exec/* | BUILD isolated sign-only permission, no withdrawals |
| OPS-09 | G01-G14 release gating | IN_MAIN | qa/gates.ts | REUSE real evidence, independent human review, fail-closed |
| OPS-10 | 24x7 deployment and disaster recovery | PARTIAL_IN_MAIN | ops/readiness.ts; docs/DEPLOYMENT_GUIDE.md | BUILD monitored hosting, backup/restore drills, failover fencing |
| OPS-11 | Provable strategy viability | NOT_CERTIFIED | docs/KNOWN_LIMITATIONS.md; lab/strategies.ts | 3 strategy OOS samples lost; require defensible extended evidence |

## ARCHITECTURE — ONE CORE, THREE EXECUTION ENVIRONMENTS

MARKET FABRIC (CEX, Solana, equities, futures, FX, macro/fundamentals)
  -> DATA QUALITY (source, timestamp, order-book gaps, liquidity and venue eligibility)
  -> FAST deterministic reflex / DEEP QCI evidence challenge
  -> EMOTION EVIDENCE overlay using existing QCI, regime and sourced news
  -> CANONICAL DECISION ENGINE
  -> CANONICAL DETERMINISTIC RISK GATE (can DENY)
  -> transaction firewall + expiring signed release certificate + isolated signer
  -> durable outbox, clientOrderId, leader fencing, account-scoped OMS
  -> PAPER simulation / TESTNET virtual venue / LIVE separately authorized
  -> authenticated exchange fills + balances + protective-order reconciliation
  -> existing Guardian incidents, QHEF, audit, Trader Joe explanations

Yield Scout is read-only and outside the order path. Research reports and AI outputs are untrusted evidence, NOT signer commands.

Never conflate an owner's control MODE with an execution ENVIRONMENT. PAPER/TESTNET/LIVE must not share credentials, ledgers, real money, orders, positions or signing privileges. A passing mock test cannot authorize production funds.

## SLEEVE A — EMOTION-AWARE INTELLIGENCE

Existing: regime/regime.ts, decision/think-router.ts and decision/think-adapter.ts, news/news.ts, qci/coordinator.ts, risk/gate.ts. Do not recreate any of them.

Implement deterministic states CALM, HYPE_FOMO, PANIC_SHOCK, UNCERTAINTY and RECOVERY from verified source snapshots. The new pure emotion-evidence.ts extends ThinkingAnalysis. Default THINK mode is SHADOW and may only display explanations. ENFORCED may ABSTAIN or request deeper review, but CANNOT approve any order, override a canonical veto or raise allocation/leverage. Missing social provenance, account loss streak or incident state must be reported as missing—not guessed.

Follow-on: authoritative incident/loss inputs from canonical owners, time-stamped sentiment evidence, quantitative calibration and drift testing. An emotion is a market heuristic, not artificial sentience or a probability of profit.

## SLEEVE B — MEMECOIN HUNTER

Reuse Omega solana/hunting.ts, pumpFeed.ts, mint-audit.ts, watch alerts and existing DEX Screener/Helius/Jupiter/GoPlus providers. Compare and merge overlapping rankers first. Add durable real-time streaming with backpressure and gap detection, contract authority/Token-2022 extensions, holder concentration, pool custody, buy AND sell routing, liquidity-withdrawal alarms, transaction simulation and real measured slippage. Implement deterministic bounded reflex decisions, not synchronous LLM calls.

No token can be traded while mint, pool, holder or executable sell-route safety is UNKNOWN. No live swap signer until account-specific policy, transaction simulation, durable order reconciliation, independent security release and owner certification exist.

## SLEEVE C — FUTURES SCALPER

Current main is SPOT-only, long-only and no shorting/leverage/derivatives. Do not toggle a boolean or repurpose spot fill accounting. Introduce independent venue capability and contract metadata: multiplier, tick value, margin schedule, mark price, liquidation buffer, funding/financing, expiration/roll, permitted sessions/halts, stop/reduce-only type and actual broker eligibility. Extend the ONE canonical risk policy for account-scoped futures exposure. Define separate long/short strategy capsules under existing strategy research, validate every strategy in PAPER and authentic TESTNET/PRACTICE before a separately reviewed production pilot.

Stocks and ETFs are securities, not futures contracts. Treat futures on financial indexes/eligible securities as distinct regulated instruments. Broker and API entitlement must be verified, not inferred from a stock-asset metadata response.

## SLEEVE D — SPOT RESEARCH AND PROJECT REPORTS

Reuse current scanner, asset safety, Strategy Lab, cost/impact estimate, QCI/risk and Trader Joe. Extend results with sourced project facts, token unlocks, ownership, audits, financial fundamentals where relevant, current liquidity, issuer disclosure, independent data freshness, valuation caveats, scenarios and clear invalidation levels. WAIT and NO SUITABLE ASSET must be valid first-class outcomes. Scores are not probabilities of win.

## SLEEVE E — YIELD SCOUT, MANUAL EXECUTION

Review and reuse DefiLlama yield adapter in the unmerged unified research work. Source base APY, reward APY, TVL, chain/protocol risk, stablecoin depeg, impermanent loss, withdrawal queue/lockup, variable rates, reward token depreciation, gas and net yield. Missing audits, custody or lockup data => UNKNOWN.

Keep execution MANUAL. No auto deposits, wallet approvals, staking, borrowing or withdrawals from MIA Yield Scout. Never promote a high APY into a safe trade or a forecast.

## SLEEVE F — AUTONOMY, GUARDIAN AND RELEASE

Existing qa/gates.ts owns G01-G14. core/mode.ts owns pause/emergency and currently hard-locks LIVE. exec/oms.ts is the existing PAPER OMS. PR #92 preflight cannot place testnet orders. PR #97 order reducer is pure and non-durable.

Implement real durable order intents, UNIQUE(environment,account,venue,clientOrderId), per-venue receipts, fee-asset exact accounting, network UNKNOWN status, account balance reconciliation, partial fill+cancel, stop order support, leader fencing and crash recovery. Do not blindly resubmit a lost-response order. Isolate signer and hard-block transfer/withdrawal scopes; agent/Trader Joe cannot access credentials. Independent reviewed transaction firewall must enforce account, instrument, venue, policy version, limits, owner release certificate and expiry before each order.

Require independent security review and written incident plan. G01-G14 must pass with actual current-build evidence, including 30 days and 50 closed paper trades, before any owner-controlled real-money pilot. Those minimums DO NOT demonstrate profitability; separate strategy OOS and forward evidence is required.

## IMPLEMENTATION SEQUENCE / ACCEPTANCE

P0 — Consolidate PR dependencies, pin source, inventory feature ownership, repair CI and schema conflicts, no unauthorized merge.
P1 — Research Beta: Spot Analyst, Yield Scout (manual), Trader Joe, Emotion SHADOW, safety explanation, sourced market data and attribution.
P2 — Autonomous PAPER and real TESTNET: low-latency memecoin observation and realistic simulations, futures research lab, persisted order intent, exchange-confirmed fills and robust reconciliation.
P3 — Harden production: isolated signed permissions, transaction firewall, venue-specific protections, backup/restore, QHEF operational telemetry, Guardian incident response, independent audits.
P4 — Owner-approved, tightly capped LIVE pilot for one verified venue+strategy; other sleeves remain locked until separately certified.
P5 — Expand only proven markets; continuous calibration, drift detection, after-cost strategy reviews and rollback.

MANDATORY VERIFICATION:
- all six sleeve requirements have ownership and no duplicate runtime;
- SHADOW emotion cannot change orders, ENFORCED can only abstain, invalid/missing inputs never increase risk;
- source changes are linked to tests, exact commit and run results;
- tests for stale data, permission abuse, lost streams, duplicate fills, partial stop exposure, venue 5xx, restarts, invalid futures margin and unsafe Solana sellability;
- all LIVE endpoints remain locked unless all independent gates, signer, reviewer and owner authorization pass;
- full TypeScript, server unit/integration, browser Playwright, chaos, backup restore, secret/dependency scans;
- release note explicitly distinguishes code present on main vs UNMERGED branches vs unavailable external accounts and data;
- no statement about 100% win rate or guaranteed profit.

## OPEN SOURCE RESEARCH REFERENCES — STUDY, DO NOT DUPLICATE

NautilusTrader https://github.com/nautechsystems/nautilus_trader — order reconciliation.
Hummingbot https://github.com/hummingbot/hummingbot — in-flight order tracking.
CCXT https://github.com/ccxt/ccxt — exchange capability negotiation.
Freqtrade https://github.com/freqtrade/freqtrade — strategy protections.
QuantConnect LEAN https://github.com/QuantConnect/Lean — brokerage/contract semantics.
TradingAgents https://github.com/TauricResearch/TradingAgents — debate as research evidence.
vectorbt https://github.com/polakowo/vectorbt — forward/OOS strategy validation.
OWASP ASVS https://github.com/OWASP/ASVS — security verification.
Helius https://www.helius.dev/docs — Solana data.
Jupiter https://dev.jup.ag/ — swap/quote infrastructure, version-check.
DefiLlama https://defillama.com/ — yield/TVL research.

Check repository licenses and current provider specs, then selectively adapt. Do not copy an entire external engine or introduce a second risk or intelligence core.

## OUTPUT CONTRACT FOR CODEX / CLAUDE

Provide an audited feature matrix, exact code owners, duplicate/conflict decisions, minimal TypeScript diffs, separate test results, branch/PR dependency plan, risk and credential requirements, current progress without invented percentages, rollback plan and the next small implementation slice. Do not claim shipped/live until merged, deployed, independently certified and verified against real venue conditions.

CURRENT PR SCOPE: pure emotion evidence overlay inside existing THINK, tests, archived user source and this master prompt. NOT INCLUDED: real memecoin trades, futures execution, durable TESTNET OMS, independent LIVE signer, hosted production deployment, or guaranteed returns. LIVE remains locked.
