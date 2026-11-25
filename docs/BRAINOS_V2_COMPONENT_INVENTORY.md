# BrainOS V2 — Component Inventory, Verification Matrix and Backlog

Companion to [`BRAINOS_MASTER_ARCHITECTURE.md`](BRAINOS_MASTER_ARCHITECTURE.md) (the single master). This file answers
the owner's 64-responsibility audit. The responsibilities are logical capabilities, not 64 services: each row names
the module that already owns it, or says it is missing. Audited on 2026-11-25 at branch `naokiri/fervent-dijkstra-46ctbr`
(PR #139, stacked on #137).

**Evidence method.** Reachability comes from import call sites in `server/src`, not file names. A module with zero
runtime importers is **disconnected**, even when it is tested. "Verified" means tested **and** reached at runtime.

Classes: **V** verified · **U** implemented but untested · **P** partial · **S** scaffolded · **D** disconnected
(test-only) · **X** missing · **B** blocked by another component · **Dup** duplicated · **Dep** deprecated.

## 1. Verification matrix (64 responsibilities)

### A. Central intelligence and orchestration
| # | Responsibility | Owner (existing) | Class | Evidence / gap |
|---|---|---|---|---|
| 1 | BrainOS Kernel | `bot/bot.ts` (lease-fenced lanes) + `knowledge/brain.ts` | P | The scheduler runs hot, protection, books and research lanes. No single cycle object spans research → OMS. |
| 2 | Durable Session Orchestrator | `ops/durableSession.ts`, `ops/tradingMandate.ts` | V | Mandate, drain, takeover and expiry tests. Executes only the spot paper lane. |
| 3 | Cognitive Mode Router | `decision/think-router.ts` (1 importer: `decision/engine.ts`), mandate `LANE_SCOPE` | P | FAST and DEEP sessions cannot run (`execution-lane: BLOCKED`). |
| 4 | Central Event Bus | `core/bus.ts` (13 importers) + `fabric/contracts.ts` (validated envelope) | P | The bus is an untyped in-process `EventEmitter` with no schema, dedupe or version. The fabric envelope validates but is not on the bus path. |
| 5 | Component Registry | `knowledge/capabilityGraph.ts`, `knowledge/cognitive/registry.ts` | P | Covers capability evidence, not runtime liveness of modules. |
| 6 | Health Supervisor | `ops/readiness.ts`, `/api/ready`, `ops/integrity.ts` | P | Lane and lease freshness only. Does not detect disconnected modules (this table does, by hand). |
| 7 | Resource Scheduler | `bot/bot.ts` lanes (protection is independent of entries) | P | Protection is scheduled separately. There is no priority queue under load. |
| 8 | State Machine Controller | session: `durableSession.persist` (version CAS); orders: SQL CAS in `exec/oms.ts` | P | The session machine is explicit. Order and position transitions are guarded inline, with no shared transition table. |

### B. Market perception and chart intelligence
| # | Responsibility | Owner | Class | Evidence / gap |
|---|---|---|---|---|
| 9 | Market Data Gateway | `providers/*` via `providers/http.ts`, `market/fabric.ts` | V | Binance, Coinbase, Kraken, CoinGecko, DEX Screener and Frankfurter. Solana RPC and EVM RPC are pending (`providers/pending.ts`). |
| 10 | Normalization Engine | `market/fabric.ts`, `market/store.ts`; trades: `market/tradeBars.ts` | P | Spot normalization is live. The trade event contract exists (V2) but no live trade feed is connected. |
| 11 | Data Quality Engine | `market/quality.ts` (11 importers), `chart/analysis.validateCandles` | V | Freshness, book age and executable depth. The trade path also quarantines late, duplicate, future and malformed trades. |
| 12 | Real-Time Candle Builder | `market/tradeBars.ts` | U→V | Tested and benchmarked, but **not wired to a live feed** (blocked on #9 Solana). |
| 13 | Feature Vector Engine | `features/indicators.ts` (canonical `FeatureEngine`) | V | Trade bars feed it through `tradeBarCandle`. |
| 14 | Market Structure Engine | `chart/analysis.ts` (8 importers) | V | Chart evidence is explanatory only and has no vote. |
| 15 | Order Flow Intelligence | `features` taker-buy ratio; `tradeBars` buy/sell flow; `whales/prints.ts` | P | Spot only. No order-book imbalance series. |
| 16 | Market Regime Engine | `regime/regime.ts` (10 importers) | V | — |

### C. FAST memecoin intelligence
| # | Responsibility | Owner | Class | Evidence / gap |
|---|---|---|---|---|
| 17 | New Token Discovery | `market/flinQueue.ts` (DEX Screener profiles) | P | Snapshot polling, not an on-chain launch subscription. Candidates are only `QUARANTINED` or `REJECTED`. |
| 18 | Candidate Screening Pipeline | `flinQueue` (bounded batch 250), `choice/dualResearch.ts` | P | Bounded and deduplicated. No ranking to eligibility. |
| 19 | Volume Velocity Engine | `market/volumeSpike.ts` | U→V | Tested, but no live trades (blocked). |
| 20 | Volume Authenticity Engine | `market/volumeSpike.ts` (concentration, two-sided churn) | U→V | Wallet-cluster graph analysis is missing (needs holder and transfer data). |
| 21 | Liquidity Intelligence | `market/quality.walkBook` (spot); `safety/safety.ts` DEX heuristics | P | No Jupiter route or sell simulation for Solana. |
| 22 | Token Security Engine | `safety/safety.ts` (heuristics only) | B | Mint and freeze authority and Token-2022 checks need `solana_rpc` credentials. |
| 23 | Whale Intelligence | `whales/prints.ts` (exchange large prints) | P | Exchange prints only. Wallet identities are not available. |
| 24 | FAST Opportunity Ranker | — | X | Blocked by #19–#22 and #35. |

### D. DEEP futures intelligence
| # | Responsibility | Owner | Class | Evidence / gap |
|---|---|---|---|---|
| 25 | Multi-Timeframe Analysis | `market/scanner.ts` (15m, 1h, 4h features), `chart/analysis.ts` | V | Spot instruments only. |
| 26 | Statistical Analysis | `features/indicators.ts`, `portfolio/correlation.ts` | P | No distribution or uncertainty model. |
| 27 | Probabilistic Forecast | `ditas/calibration.ts`, `ditas/forecastVerifier.ts` | P | Calibration exists. There are no calibrated directional forecasts for futures. |
| 28 | Strategy Registry | `lab/strategies.ts` (versioned) + `ditas/passports.ts` | V | Spot strategies only. |
| 29 | Strategy Selection | `decision/engine.ts`, `choice/arbitration.ts` (2 importers) | P | Shadow arbitration; spot only. |
| 30 | Derivatives Intelligence | `providers/binanceFuturesResearch.ts`, `choice/dualResearch.ts` | P | Klines research only. No funding, OI or basis series in decisions. |
| 31 | Margin and Liquidation Engine | — | X | No futures margin ledger. Spot sizing must not be reused. |
| 32 | Scenario Simulation | `chart/scenarios.ts` (1 importer); `knowledge/cognitive/deepCycle.ts` | D | `deepCycle.ts` has **zero runtime importers** and is test-only. |

### E. Decision intelligence and capital protection
| # | Responsibility | Owner | Class | Evidence / gap |
|---|---|---|---|---|
| 33 | QCI Consensus | `qci/coordinator.ts` | V | Evidence only; no order authority. |
| 34 | Decision Certificate | `decision/engine.ts` `DecisionReport` (persisted in `decisions`) | V | Report carries evidence, strategy version and consensus expiry. Its name is not "certificate". |
| 35 | Expected Value Engine | `decision/scoring.ts` (opportunity score) | P | A score is not a net-EV after costs. Missing. |
| 36 | UnifiedRiskGovernor | `risk/gate.ts` (sole `evaluateRisk`) | V | Called by `decision/engine.ts` and again inside the OMS transaction. |
| 37 | Capital Allocation | `risk/gate.ts` sizing, reserves, allocation multiplier; `ops/tradingMandate.ts` ceiling | V | — |
| 38 | Portfolio Exposure | `risk/gate.ts` (open risk, correlation limit), `portfolio/correlation.ts` | V | — |
| 39 | Circuit Breaker | `risk/gate.ts` (`DAILY_LOSS_BREAKER`, `DRAWDOWN_CAPITAL_PRESERVATION`), data-quality gate, emergency stop | V | — |
| 40 | Security and Permission Gateway | `api/routes.ts` auth hook, `security/stepUp.ts`, `security/privy.ts` | V | Session mandate binds scope. |

### F. Execution and position management
| # | Responsibility | Owner | Class | Evidence / gap |
|---|---|---|---|---|
| 41 | CanonicalOMS | `exec/oms.ts` (`VENUE = 'binance-paper'`) | V | Paper only. |
| 42 | Durable Reservation Engine | — (paper fills are atomic in one transaction) | B | Needed only with an external adapter. Drafts were rejected (BigInt→Number, release-on-missing). |
| 43 | Execution Adapter Registry | — ; `exec/demoLiveParity.ts` port interfaces | D | `demoLiveParity.ts` has **zero runtime importers** and is test-only. |
| 44 | Execution Quality Engine | `ditas/execution.ts`, OMS slippage, impact and book checks | V | — |
| 45 | Bundle Coordinator | — | X | No Solana executor. |
| 46 | Authenticated Reconciliation | `exec/recovery.ts` (unresolved-order quarantine), `portfolio/calendar.reconcile` | P | Paper ledger only. External venue reconciliation is missing. |
| 47 | Autonomous Position Supervisor | `exec/oms.monitorPositions` (protection lane), `exec/incidents.ts` | V | Runs independently of entries and the session state. |
| 48 | Dynamic Exit Engine | `lab/exits.ts` exit capsule (stop, targets, trailing, time) | P | No liquidity-collapse or momentum-exhaustion exit. The roadmap's priority order is not implemented. |

### G. Memory and continuous learning
| # | Responsibility | Owner | Class | Evidence / gap |
|---|---|---|---|---|
| 49 | Working Memory | `knowledge/cognitive/internalProcesses.ts`, `market/store.ts` | P | — |
| 50 | Episodic Memory | `ditas/memory.ts` (10 importers), `journal/journal.ts` | V | — |
| 51 | Semantic Memory | `knowledge/*` (Quant Academy), `knowledge/memory.ts` | P | Research evidence, not validated strategy knowledge. |
| 52 | Procedural Memory | `risk/policy.ts` (versioned), `lab/strategies.ts` | P | — |
| 53 | Internal REFLEX | `internalProcesses.assessAutonomicProtection` (from `bot.ts`) | P | Observes; protection itself is the OMS monitor. |
| 54 | Internal REFLECT | `internalProcesses.summarizeLearningEvidence`, `choice/dpbm.ts` | P / D | `dpbm.ts` (post-close review) has **zero runtime importers**. |
| 55 | DITAS Learning Linker | `ditas/execution.ts`, `exec/fillEvents.ts` | V | Decisions link to fills. |
| 56 | Strategy Challenger and Promotion | `lab/lab.ts` validation, `qa/gates.ts`; `knowledge/cognitive/coldLane.ts`, `genomes.ts` | P / D | `coldLane.ts` is test-only. No shadow → PAPER promotion pipeline. |

### H. Reliability and operational infrastructure
| # | Responsibility | Owner | Class | Evidence / gap |
|---|---|---|---|---|
| 57 | Historical Streaming | `lab/tape-reader.ts` | V | Bounded AsyncGenerator with no array materialization. |
| 58 | Deterministic Replay | `lab/eventReplay.ts` (book probes and trade evidence) | V | Determinism hashes; trade replay matches the live path. |
| 59 | Backtesting and Evaluation | `lab/backtest.ts`, `lab/lab.ts` | P | Candle backtest plus out-of-sample checks. Not a portfolio backtester with funding or failed exits. |
| 60 | Latency Telemetry | `core/latency.ts` (12 importers), `qhef/qhef.ts`, `/qhef` | V | Per-stage percentiles; V2 benchmark script. |
| 61 | Fault Recovery | `ops/lease.ts`, `ops/shutdown.ts`, `exec/recovery.ts`, crashpoint tests | V | SIGKILL takeover and SIGTERM drain tests. |
| 62 | Persistent Audit Ledger | `core/audit.ts` (hash chain, 22 importers) | V | `ops/leaseWitness.ts` is test-only (D). |
| 63 | Independent Runtime Manager | `bot/bot.ts` + Railway (`Dockerfile`, `railway.json` in PR #138) | B | Not deployed or verified. |
| 64 | Release Certification | `qa/gates.ts` (G01–G14), `exec/demoLiveParity.ts` (D) | V | LIVE is locked; gates fail closed. |

**Totals.** V 30 · P 23 · disconnected modules 6 (`deepCycle`, `demoLiveParity`, `dpbm`, `coldLane`, `leaseWitness`,
`featureIdentification`) · missing 4 (#24, #31, #35, #45) · blocked 4 (#22, #42, #63, plus live wiring of #12 and #19).
No responsibility has two competing runtime owners. The only near-duplicate is #4: an untyped `bus` beside the
validated `fabric` envelope.

## 2. Broken integration and weakness register (top priorities)

| ID | File / module | Current responsibility | Missing or broken | Proposed solution | Depends on | Risk | Required tests | Acceptance | Priority |
|---|---|---|---|---|---|---|---|---|---|
| W1 | `providers/` | Spot and DEX snapshot feeds | No authenticated Solana trade, swap or authority feed | Add one provider adapter (Helius, Vike or GMGN after an entitlement check) that emits `TradeEvent` into `TradeBarBuilder` | Owner credentials | High | Opt-in provider test; fixture parser tests | Live FAST bars with quality counters | P0 for FAST |
| W2 | `safety/safety.ts` | DEX heuristics | No mint, freeze or Token-2022 checks | Extend the existing safety module with an on-chain `TokenSafetySnapshot` and a TTL | W1 | High | Malicious-token fixtures | Unknown evidence ⇒ reject | P1 |
| W3 | `decision/scoring.ts` | Opportunity score | No net EV after fees, spread, impact and failure | Add an EV term in the existing scoring module; abstain when EV ≤ 0 | Cost model | Medium | Golden EV cases | Abstains when costs exceed edge | P1 |
| W4 | `knowledge/cognitive/deepCycle.ts`, `choice/dpbm.ts`, `coldLane.ts` | Cognitive research | Disconnected (test-only) | Wire into a research lane in `bot.ts` with no financial write path, **or** retire after owner review | — | Low | Call-site test | A runtime importer exists, or the module is removed | P2 |
| W5 | `exec/demoLiveParity.ts` | Adapter port contract | Disconnected | Becomes the Execution Adapter Registry port when a real adapter exists; keep it test-only until then | Venue adapter | Medium | Parity tests (existing) | — | P2 |
| W6 | `core/bus.ts` | In-process pub/sub | Untyped; no schema, dedupe or version | Validate trading-relevant topics with `fabric/contracts.ts` at publish (no second bus) | — | Medium | Contract tests | Invalid events rejected | P2 |
| W7 | `lab/exits.ts` | Exit capsule | No liquidity-collapse or momentum-exhaustion exits; no priority order | Extend the capsule with the roadmap's exit priority; protection lane only | W1 for FAST | High | Exit priority and partial-fill persistence | No duplicate close; exits allowed while entries are halted | P1 |
| W8 | futures | — | No margin, liquidation or reduce-only model | New `portfolio/futuresMargin.ts` owned by the portfolio domain; never reuse spot sizing | Contract specs | High | Margin invariants | Entry denied when the liquidation buffer is breached | P1 for DEEP |
| W9 | runtime | — | Railway not verified | Merge PR #138's Railway foundation; staging soak | Owner | High | Restart and volume tests | 7–14 day unattended PAPER run | P0 for autonomy |
| W10 | `portfolio/calendar.reconcile` | Ledger reconciliation, called inside the OMS entry transaction (`ops/paperSpotEntry.ts`), by approvals and by every readiness poll | **Fixed (migration 8).** The per-position join rescanned every ledger entry (no index on `ledger_entries.ref` or `orders.position_id`): 8 ms at 100 closed trades, 30 ms at 200, 117 ms at 400 (quadratic; ~70 s extrapolated at 10,000), all while holding the write lock that protective exits need | Two indexes, index-only migration 8: 400 trades 3.2 ms, 1,000 8 ms, 10,000 89 ms, 50,000 470 ms (linear). Follow-up: reconcile incrementally per closed position so the entry path does no full-ledger work | — | High | `reconcile-scaling.test.ts` (fails at ratio 15.5 without the indexes) | Entry-path reconciliation O(1) per trade | P0 done; follow-up P1 |
| W11 | `risk/gate.ts` sizing + `exec/oms.ts` cap | Position notional cap | When the 25% cap sizes a position (tight stops), the gate sizes it at the top ask but the OMS enforces the cap at the executed price, so any fill worse than the top ask is refused (`POSITION_NOTIONAL_LIMIT`). The historical simulator refused 9 of 15 synthetic `trend_pullback` signals for this reason | Size the cap against the worst permitted entry in the gate | Trading-risk review | Medium | Simulator + gate parity tests | Capped setups fill when slippage is within policy | P1 |
| W12 | `ops/tradingMandate.ts` | Capital ceiling = open cost + realized loss | No limit on unrealized session loss, no pre-trade loss headroom, no latched breach / REFLEX suspension, no stale-quote fail-closed. An earlier separate `brainos_session_boundaries` design (PR branch `naokiri/jolly-wozniak-8q7ial`, commits `60f9f7a`, `4f5a70f`) did these but duplicated the mandate and collided on migration 7; it was withdrawn | Add an optional `max_session_loss` to the mandate (new migration) and reuse its liquidation-value, headroom and latch rules | — | High | Port the withdrawn tests to the mandate | One capital authority; loss limit enforced in the OMS and by the protection lane | P1 |

## 3. Canonical data flow (spec §5) mapped to owners

Market discovery (`flinQueue`, `market/discover`) → ingestion (`providers/*`, `market/fabric`) → normalization
(`market/store`; trades: `tradeBars.TradeEvent`) → quality (`market/quality`; trade quarantine) → charts (`tradeBars`,
klines) → features (`features/indicators`) → memory retrieval (`ditas/memory`, `knowledge/*`) → regime
(`regime/regime`) → FAST/DEEP research (`choice/dualRuntime`, `dualResearch`) → strategy selection
(`decision/engine`, `choice/arbitration`) → QCI (`qci/coordinator`) → EV (**missing**, W3) → decision certificate
(`DecisionReport`) → risk (`risk/gate`) → reservation (**atomic paper transaction**; external: blocked) → CanonicalOMS
(`exec/oms`) → adapter (**paper simulator only**) → fill (`fills`, `exec/fillEvents`) → portfolio (`portfolio/ledger`)
→ monitoring (`monitorPositions`) → exit (`lab/exits`) → risk-authorized close (OMS exit path) → reconciliation
(`portfolio/calendar.reconcile`, `exec/recovery`) → DITAS outcome (`ditas/execution`) → REFLECT
(`internalProcesses`; `dpbm` disconnected) → learning (`ditas/*`; no self-promotion).

Single sources of truth: session (`durableSession`), market (`market/store`), strategy (`lab/strategies`), risk
(`risk/gate` + `risk/policy`), orders (`exec/oms`), money (`portfolio/ledger`), positions (`positions` table written only
by OMS fills), learning (`ditas/*`), permissions (`api/auth`, `security/*`). No competing balance or order state was found.

## 4. Dashboard consolidation (spec §12–13)

Already implemented in `web/src/nav.ts` (`NAV_GROUPS`): four destinations (Autopilot, Portfolio, Trader Joe and
Settings). Internal engines (Intelligence/QCI, DITAS, QHEF, scanners) are secondary routes under Autopilot or
Settings, kept for owner diagnostics. REFLEX and REFLECT have no user controls. Remaining work: show session
realized/unrealized P&L and exposure on the Autopilot hero (data already exists in `accountState`), and move the
QHEF and DITAS links behind an owner-only "Operations" section. Low risk, frontend only.

## 5. Prioritized backlog

1. **P0** — Merge #139 into #137 once its CI passes. Reconcile #137 with #138, keeping the #138 landing page and Railway files.
2. **P0** — W9 Railway staging plus a 7–14 day unattended PAPER run on the spot lane, the only executable lane.
3. **P0 (FAST)** — W1 Solana trade feed → `TradeBarBuilder` → `volumeSpike` evidence into FLIN (needs owner credentials).
4. **P1** — W2 token safety, W3 net EV, W7 exit priority, W8 futures margin.
5. **P2** — W4/W5/W6 disconnected-module decisions and validated bus topics; Autopilot P&L and exposure tiles.
6. **P3** — Bounded LIVE canary only after every gate passes and the owner approves explicitly.

## 6. PR readiness assessment

| PR | State | Evidence | Merge? |
|---|---|---|---|
| #139 (this work → #137 branch) | Draft | Local: 851 server + 44 web tests, typecheck, build, 65 Playwright, secret scan, audit. GitHub Actions "Typecheck, unit tests, audit, secret scan": **success** on `41963b6`; Playwright job: pending at time of writing. Vercel and Cloudflare Workers failures are shared with #137. | Only into #137 after Actions is fully green |
| #137 → `main` | Draft | Prospective soak, deployment and #138 reconciliation incomplete | **No** |

## 7. Release checklist and recovery

PAPER and LIVE release items and the rollback procedure are in the master document (sections 11–12) and `qa/gates.ts`.
Recovery playbook, in order: emergency stop (owner controls) → entries revoked (session drain) → protection lane
continues → reconcile (`/api/ready`, `exec/recovery`) → restore from a verified encrypted backup (`ops/backup.ts`) →
restart; takeover always lands in a suspended session and needs a fresh owner authorization. Never roll back a ledger
by discarding authoritative fills.
