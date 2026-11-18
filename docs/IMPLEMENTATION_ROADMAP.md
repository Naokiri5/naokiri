# Implementation Roadmap & Backlog

The app already exists and works (paper trading on live crypto data). The roadmap below **extends and hardens it**. It does
not rebuild it. Each phase ends with tests, a browser check, updated docs, a commit and a push, and needs your approval
before the next one starts.

Priority key: **P0** must do (safety/correctness) · **P1** core spec gap · **P2** important · **P3** nice to have.

## Phase 1 — Foundation hardening ✅ DONE (2026-11-16)
| ID | Pri | Task | Done when |
|---|---|---|---|
| F-1 | P0 | Fix SEC-01: upgrade `@fastify/static` to v10; clear `npm audit` high/moderate findings | `npm audit` shows 0 high, static UI still served |
| F-2 | P0 | GitHub Actions CI: typecheck, tests, `npm audit`, secret scan on every push/PR | green check on the PR |
| F-3 | P1 | Commit the Playwright browser suite (all routes, 0 console errors, mobile overflow) and run it in CI | suite passes in CI |
| F-4 | P1 | Add missing workspaces from your list: **Asset Discovery**, **QHEF Performance**, **Security Center**, **Copy Trading** (own page with honest dependency state), **Trading History** | pages render real data or a clear "needs connection" state |
| F-5 | P2 | Full command palette (keyboard navigation to every page/action); structured server logs with request IDs | — |

## Phase 2 — Market intelligence
| ID | Pri | Task | Notes |
|---|---|---|---|
| M-1 | P1 | WebSocket streaming for Binance trades/books with automatic REST fallback and provider failover | needs 2 extra network hosts (your approval) |
| M-2 | P1 | Binance USD-M futures public data (derivatives: funding, open interest, basis) | needs 1 extra host; read-only, no keys |
| M-3 | P1 | Stocks & commodities adapters (e.g. Alpaca market data) | **needs your free/paid API key** |
| M-4 | P2 | Liquidity heatmap from order-book snapshots | — |
| M-5 | P2 | Tokenized-equity tagging for Binance listings | — |

### MIA 4.2 research increment

| Skill | Available in this increment | Outstanding inputs or behavior |
|---|---|---|
| 01–04 | Asset Discovery → Market coverage shows supported asset classes, provider health, IANA market clocks and UTC crypto research sessions. Settings saves the display zone and the profit calendar groups closes by local day. | Verified classification per instrument, licensed exchange calendars, auctions, early closes, maintenance and halt feeds |
| 06 | Asset Discovery → SEC filings reads recent official filing metadata by CIK. Acceptance and financial reporting period are separate. | (Use a real contact User-Agent and permit egress to data.sec.gov.) Historical archives, filing contents and financial statement comparisons remain outside the current feed. |
| 11 | The Market Terminal compares confirmed structure on the available 15m, 1h and 4h closed caches at one timestamp. | Provider ingestion and validation for 1m, 5m, 30m, 1d and 1w |
| 12–14 | Structure breaks, changes of character, immediate breakout retests, and UTC or swing-anchored VWAP use the existing closed-candle report. | Additional pattern rules and verified earnings and event anchors |
| 15 | The canonical feature engine supplies WMA, HMA, Keltner Channels, Ichimoku, Parabolic SAR and OHLC-based volatility estimates in the terminal. | Historical trades for volume profile |
| 44 | The Risk Center models paper position and cash shocks from current marks and observable depth. It distinguishes partial or unavailable exposure. | Verified sector and token classification, and on-chain liquidity data for unsupported scenarios |

## Phase 3 — Worker network & QA roles
| ID | Pri | Task |
|---|---|---|
| W-1 | P1 | Implement the 3 workers that can work today (Market breadth, Regulatory screen, Exchange incident screen); replace the 3 constant workers with data-driven checks |
| W-2 | P1 | Worker outcome scoring (`correct`/`incorrect` per worker after each closed trade) feeding validated, regime-aware weights |
| W-3 | P1 | **15 QA roles (QA-01…QA-15)** as a registry mapping each test suite to its role, with an independent QA report page |
| W-4 | P2 | Validated early-quorum shortcut with deadline metrics |

## Phase 4 — Trading intelligence
| ID | Pri | Task |
|---|---|---|
| T-1 | P1 | **Historical replay engine**: replay stored candles through the *real* scanner → QCI → decision → risk → paper OMS at accelerated speed, point-in-time |
| T-2 | P1 | Strategy competition arena: same data for all strategies; Sharpe, Sortino, exposure, per-regime results |
| T-3 | P1 | More strategy families (momentum, volume expansion, market structure) as capsules shared by live and backtest |
| T-4 | P2 | Purged walk-forward validation; parameter change history |
| T-5 | P2 | Score and confidence calibration once enough paper outcomes exist |

## Phase 5 — Trading system
| ID | Pri | Task |
|---|---|---|
| X-1 | P1 | Limit and post-only paper orders with queue-position-aware fills; partial fills |
| X-2 | P1 | Backtest-vs-paper comparison (Part 20.3); richer performance metrics |
| X-3 | P2 | Portfolio stress test & allocation recommendations (Part 19) |
| X-4 | P2 | Strategy failure detector: add slippage, profit factor and regime-shift triggers |

## Phase 6 — QHEF performance
| ID | Pri | Task |
|---|---|---|
| Q-1 | P1 | Benchmark harness on replay workloads; record p50/p95/p99 per stage; fail CI on regressions |
| Q-2 | P2 | Bounded priority queues with backpressure metrics; pre-computed execution cost tables |
| Q-3 | P1 | Remove event-loop stalls (~220 ms seen): stream-parse the all-market ticker payload or move it off the main thread |

## Phase 7 — Security & QA certification
| ID | Pri | Task |
|---|---|---|
| S-1 | P0 | API rate limiting (SEC-02); persistent HMAC key (SEC-05); header tests (SEC-06) |
| S-2 | P1 | Recovery tests (restart mid-position, provider outage, DB restore) |
| S-3 | P1 | Pre-flight certification page: checklist + evidence per gate + defect tracker (P0–P3) |

## Phase 8 — Deployment
| ID | Pri | Task |
|---|---|---|
| D-1 | P1 | Dockerfile + compose, health checks, automated SQLite backups, log rotation |
| D-2 | P1 | Hosting option you choose (e.g. a small VPS or Fly.io/Render) with TLS; **needs your account** |
| D-3 | P1 | Start the 30-day paper evaluation on the hosted instance (release gate G10) |

## Never in scope without separate authorization
Live order execution, wallet signing, withdrawals, any real-money activity.
