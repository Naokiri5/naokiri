# MIA 5.1 — Multi-source AI trading research integration (additive)

**Repository baseline:** unified PR #45. **Input archives reviewed:** user-provided TradingAgents, Hummingbot, Freqtrade, skfolio, TA-Lib Python, Lightweight Charts, APScheduler, and the 1,538-line LiveOmsAdapter paste. **Machine catalog:** [MIA_EXTERNAL_SOURCE_RECONCILIATION.json](./MIA_EXTERNAL_SOURCE_RECONCILIATION.json), 34 mapped capabilities.

## Architecture and duplicate resolution

| Upstream | Actual code reviewed | MIA's canonical owner | Action |
| --- | --- | --- | --- |
| TradingAgents (Apache-2.0) | tradingagents/graph/trading_graph.py and debate/risk researchers | workers, qci/challenge.ts, ditas | reuse existing worker/QCI system; strengthen provenance, dissent tests |
| Hummingbot (Apache-2.0) | client_order_tracker.py, budget_checker.py, executor_orchestrator.py | exec/oms.ts, risk/gate.ts, PR #64 | develop unknown-ack and collateral tests, not second OMS |
| Freqtrade (GPL-3.0) | optimize/backtesting.py, optimize/analysis/lookahead.py, plugins/protections | lab/backtest.ts, lab/lab.ts, risk/gate.ts | independent lookahead/recursive test adaptation; do not copy GPL code casually |
| skfolio (BSD-3-Clause) | optimization/convex/_mean_risk.py, model_selection/_combinatorial.py | portfolio/stress.ts and lab | add original TS empirical 4h tail analysis; investigate purged walk-forward experiments |
| TA-Lib Python (BSD-2-Clause) | talib/_func.pxi, _abstract.pxi, _stream.pxi | features/indicators.ts | numerical-parity fixtures; no duplicated indicator engine |
| Lightweight Charts (Apache-2.0) | src/api/time-scale-api.ts, plugin examples | existing web/package.json lightweight-charts dependency | improve overlays with existing dependency |
| APScheduler (MIT) | _schedulers/async_.py, datastores | ops/lease.ts, bot/bot.ts, fabric/relay.ts | optional missed-run, overlap and retry observability; no Python scheduler import |
| Supplied LiveOmsAdapter | dual sockets, REST recovery, exchange order journal, dead-man RPC | exec/environment.ts, exec/oms.ts, PR #64 | live startup wiring incompatible; preserve live lock |

Presence is not proof of full production correctness. Archive snapshots may be stale; verify upstream versions and licenses before future integration. The user-supplied original trading script is preserved outside this PR; never copy it as a second OMS or start live trading from MIA_MODE=LIVE.

## Implemented: portfolio tail-risk analytics, research-only

New **server/src/portfolio/tailRisk.ts** estimates empirical 4h 95%/99% fixed-current-exposure Value at Risk and conditional tail average (expected shortfall) from **strictly aligned, closed and consecutive** 4h candles. Default minimum is 90 aligned return observations. Invalid, stale, future-dated, sparse or gapped history returns UNAVAILABLE with null risk estimates. A nominal effective-holdings concentration statistic (1/HHI), and worst *observed* loss are included. This is original TypeScript inspired by skfolio risk concepts, not copied Python source.

The existing **server/src/portfolio/stress.ts** now includes this result as additive **tailRisk** in its existing read-only response. No new routes, migrations, permissions, risk limits, order transmissions, venue credentials or model authority. Existing stress scenarios and paper ledger remain unchanged.

**Do not label this daily VaR:** native MIA candles support 15m, 1h and 4h; the output horizon is 4H. It is NOT a bound on actual loss. Observed CVaR may miss gaps, black swans, order-book impact, fees, latency, collateral failure, trading suspension and exchange insolvency.

### Source-to-implementation sequence for Claude

1. Read CLAUDE.md, approved decision records and .claude/skills/mia-research-reliability/SKILL.md; check actual current branch heads.
2. Finish critical outstanding fixes in PR #62 and preserve PR #64's read-only venue reconciliation (do not duplicate).
3. Check the new tail-risk module, its 8 Vitest scenarios, the integration with the existing PaperStress endpoint and all negative data paths. Add UI labeling for confidence, horizon, sample count and UNAVAILABLE only after CI.
4. Implement original point-in-time lookahead and recursive-indicator parity differential tests against canonical backtest/FeatureEngine; do not clone Freqtrade GPL source.
5. Extend unknown-ACK and event-tracking proofs, durable recoveries and reconciliation; preserve exit/ledger/idempotency semantics.
6. Research purged cross-validation and scenario stress; treat outputs as information, not execution authority.
7. Add scheduling misfire/overlap observability and chart overlays only where existing code is insufficient.

## Non-negotiable risk rules

- Winning rate 100% and zero loss risk cannot be guaranteed. Optimize for verified tail-risk reduction, fail-closed data handling and clear automation limits.
- Current PAPER OMS, risk gate, QCI, portfolio ledger, scanner, lease and NEXUS fabric remain authoritative. No alternate order manager, second agent vote, or second accounting engine.
- LIVE_EXECUTION_AVAILABLE remains **false** and all real-money paths remain disabled. No secret ingestion, order signing, withdrawal, leverage change or live unlock.
- Agents and analytics can research, explain, alert and (where already authorized) request risk-reducing pauses; never automatically override deterministic risk.
- Unknown outcomes, incomplete history or unavailable protection never become safe/neutral/zero risk.

## Verification, review and merger

Local offline strict TypeScript compilation and 8 isolated tests were performed on the pure diagnostic implementation. **Repository CI must be evaluated on exact PR head:** npm run typecheck; npm test; npm run build; npm run test:e2e; npm run scan:secrets; npm audit --audit-level=high. Any unavailable tests must say NOT VERIFIED, not PASS. Do not merge before approval. Review overlap with PR #45, recovery #62, Guardian #63 and reconciliation #64. The module does not enable real-money trading.
