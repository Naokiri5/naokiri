# MIA Central Command

MIA runs as a Node.js and Fastify modular monolith on one SQLite database. The existing bot schedules protection, market refresh, scanning, maintenance and research. QCI supplies evidence, the decision engine issues reports, the risk gate evaluates current paper exposure, and the OMS commits fills, positions and ledger changes together.

## Paper execution and recovery

- The OMS rechecks permissions, cash, aggregate risk and executed-price limits under its SQLite write lock. A pending approval is bound to the owner action and its decision. It claims capital only when a fill commits.
- Each scheduler pass captures an engine lease generation. The OMS checks that generation again inside each write transaction. A takeover verifies the ledger and the existing audit, decision and protection records before scheduling work.
- The protective monitor has its own cadence. It consumes cached executable market data while ticker and position-book requests are pending. Fresh price and depth remain required to book a paper exit. A data outage creates an incident for the affected position.
- An unresolved paper order blocks new paper exposure until reconciliation. Operators can inspect the readiness probe and the Risk Center. See the [deployment guide](../DEPLOYMENT_GUIDE.md).

## Research and feedback

| Capability | Source and authority |
| --- | --- |
| FAST discovery | Existing DEX discovery observations and token eligibility checks. FAST returns `NO_TRADE` until there is verified on-chain safety and an executable sell route. |
| DEEP futures | Closed USD-M perpetual candles for three allowlisted symbols, with independently timestamped mark price, funding and open interest observations. The research plan checks one-ATR volatility scenarios against structural invalidation. Margin, liquidation and executable depth require separate evidence before eligibility. |
| Adaptive routing | The advisory routing rules from PR #89 annotate canonical decision reports with a route and reasons. |
| Choice Management | An adaptation of PR #126 freezes each observed decision's snapshot reference, strategy and policy versions, score, costs and expiry. It stores bounded comparisons in the DITAS chain with explicit `NO_TRADE` results when evidence is missing or the captured set is incomplete. |
| Outcomes | The choice API links compared decisions to actual paper position outcomes, fees and entry slippage where the canonical records exist. The rank comparison reflects the sequential scan. Prospective evidence is required to estimate the effect of selecting a different trade. |
| Event replay | The NEXUS envelope from PR #41 records committed paper fills in the existing hash-chained audit log. Replay via `GET /api/fabric/events` uses a cursor and stable fill IDs. Persist the cursor after processing, and deduplicate retry deliveries by event ID. |

The current paper account settles orders immediately within the OMS transaction. Durable pre-submission reservations and external venue reconciliation become necessary for an asynchronous execution path. Allocation from shadow research requires a prospective paper review and an explicit cutover decision.

## Operator cockpit

Open **Autopilot → Bot Account** after signing in. MIA Central Command shows engine authority, paper reconciliation, open-position protection, provider health, scheduling, shadow decisions, recent risk denials and measured latency. The existing controls handle funding and permissions. The Strategy Lab remains the registry for strategy versions, performance evidence and enrollment. The cockpit links to the Risk Center, release gates and QHEF diagnostics.

## Release and rollback

Review each draft on the exact head in GitHub Actions. Confirm the stack's base and the SQLite schema before review. For rollback, pause entries, verify open-position protection and review unresolved orders. Revert phases in reverse order. All four phases use the existing schema versions and preserve the paper rows already committed.

The controlled fault tests measure scheduling with synthetic market data and deliberately pending provider calls. Performance measurements on those inputs describe the local test environment. Provider health, long-running latency and any live venue release require separate evidence.

## Local performance

Three Windows runs on Node 26.13.1 used 280 timed iterations each after 40 warm-up iterations. The fixture used two synthetic instruments, one open paper position, an in-memory database and a frozen QCI result. The decision measurement included persistence. The protection measurement included the lease fence in the complete stack. Values are medians of the run percentiles in milliseconds.

| Operation | Phase 1 p95 / p99 | Complete stack p95 / p99 |
| --- | ---: | ---: |
| Canonical decision and persistence | 1.69 / 4.92 | 1.38 / 5.03 |
| Paper protection pass | 0.35 / 0.41 | 0.31 / 0.50 |

A public Binance BTCUSDT smoke check returned 79 closed candles for each of 15m, 1h and 4h plus current funding and open interest. The funding and open interest timestamps are checked against a bounded sample of the exchange clock.
