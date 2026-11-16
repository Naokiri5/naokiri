# Requirements Traceability — MIA 4.1 Parts 1–33

Phase 0 audit · 2026-11-16 · audited commit `ce655bd` (main, after PR #1) · spec SHA-256 prefix `e2a0a376e37aa47f`

## Status definitions

| Status | Meaning |
|---|---|
| **IMPLEMENTED** | The workflow runs end to end in the app and has automated tests or recorded live verification. |
| **PARTIAL** | Real, working code exists, but part of the requirement is missing or simplified (stated in the row). |
| **MOCKED** | Present in the UI or code but returns fake or placeholder results. **None found** (see below). |
| **MISSING** | Not built, and nothing external blocks it. It can be built now. |
| **BLOCKED** | Needs something only you or a vendor can provide (API key, paid data licence, network access, a human sign-off). |

**Mocked-feature inventory.** A code scan found no fake prices, fake balances, random numbers or placeholder handlers. The
closest items are **12 of the 100 workers that always return ABSTAIN** (no opinion). They are honest about it, but they do
not yet analyse anything:

| Worker(s) | Why they abstain | Status |
|---|---|---|
| `Market breadth` (regime) | Not wired up, although the data already exists | **MISSING** (fixable now) |
| `Regulatory screen`, `Exchange incident screen` (news) | Not wired up; could use the existing news classifier | **MISSING** (fixable now) |
| `Social sentiment (X)` | Needs an X API key (paid) | **BLOCKED** |
| `Economic calendar`, `Earnings/fundamentals` | Needs a licensed calendar or fundamentals feed | **BLOCKED** |
| 6 on-chain workers (whale wallets, flows, holders, smart money, unlocks, permissions) | Needs an EVM/Solana data provider key | **BLOCKED** |

There are also three "constant" workers (`Stop executable`, `Liquidation/leverage`, `Fee tier`) that check a fixed rule
rather than live data. They are correct for spot paper trading, but they add little evidence. They should be reworked or
merged in Phase 3.

## Part-by-part matrix

| Part | Requirement | Where it lives | Status | Gap / dependency |
|---|---|---|---|---|
| 1.1–1.2 | Global market scanner (crypto, forex, stocks, commodities) | `market/fabric.ts`, `market/scanner.ts` | PARTIAL | Crypto spot: done, live. Forex: ECB daily reference only (display). **Stocks, commodities, derivatives: BLOCKED** (licensed feed / futures host not allow-listed). |
| 1.3–1.4 | Best-opportunity selection & transparent scoring | `decision/scoring.ts` | IMPLEMENTED | Weights are research defaults, **not calibrated** (needs 30+ days of paper data). |
| 2.1–2.3 | Asset safety, low-liquidity filter | `safety/safety.ts` | IMPLEMENTED (CEX) | — |
| 2.2 | Honeypot detection (contract, sell simulation, Solana authorities) | `assessDexPair` heuristics | BLOCKED | Needs EVM/Solana RPC + explorer key. |
| 2.4 | Manipulation detection | pump, wash-trade proxy, buy/sell imbalance | PARTIAL | Wallet-cluster evidence needs on-chain data (BLOCKED). |
| 2.5 | Five safety classes with reasons | `SafetyStatus` | IMPLEMENTED | — |
| 3 | 100 cooperative workers, decision-making, monitoring | `workers/registry.ts`, `runtime.ts`, Intelligence page | PARTIAL | 88 analyse live data; 12 abstain (table above). Per-worker accuracy tracking (`correct`/`incorrect`) exists in the schema but is **not yet scored**. |
| 4.1–4.3 | Whale discovery & ranking | `whales/prints.ts` (exchange large trades) | PARTIAL | Wallet-level whales BLOCKED (on-chain). |
| 4.4–4.6 | Copy trading | Tab explaining the dependency | BLOCKED | On-chain provider. |
| 5.1–5.4 | Trader Joe chat & commands | `joe/joe.ts`, Trader Joe page + drawer | PARTIAL | Command mode tested. Conversational mode needs `ANTHROPIC_API_KEY` (BLOCKED until you add it) and has never been run. |
| 5.5 | Daily briefing | `dailyBriefing()` | IMPLEMENTED | — |
| 6.1–6.3 | Live news & breaking-news detection | `news/news.ts` (Google News RSS) | PARTIAL | RSS licence is personal/non-commercial; replace for commercial use. |
| 6.2 | Economic calendar | — | BLOCKED | Licensed calendar feed. |
| 6.4–6.6 | Impact classification, heads-up, event-driven risk | lexicon classifier, notifications, macro worker | IMPLEMENTED | Classifier is keyword-based, not ML. |
| 7 | Portfolio tracker (multi-wallet, multi-asset) | Portfolio page, ledger | PARTIAL | Paper account only; external wallets/exchanges BLOCKED (read-only keys). |
| 8 | Central decision engine, 7 states, trade explanation | `decision/engine.ts` | IMPLEMENTED | — |
| 9 | Four autonomy levels + restrictions | `core/mode.ts`, risk gate | IMPLEMENTED | Level 4 is deliberately LOCKED. |
| 10 / 15 / 28.1 | Navigation, shell, mode badge, banners | `web/src/App.tsx` | PARTIAL | 19 workspaces + Release Gates exist. **Missing pages** from your list: *Asset Discovery*, *QHEF Performance dashboard* (data is on Connections Hub), *Security Center*, *Economic calendar* page, standalone *Copy Trading* page, *Trading history* page (it lives inside Journal). |
| 11.1 | Multi-timeframe analysis | 15m / 1h / 4h features | IMPLEMENTED | — |
| 11.2 | Smart money & order flow | taker ratio, OBV, book imbalance, large prints | PARTIAL | No live trade-tape streaming (REST polling). |
| 11.3 | Liquidity heatmap | — | MISSING | Book data exists; no heatmap view. |
| 11.4 | Regime detection | `regime/regime.ts` | IMPLEMENTED | — |
| 11.5 | Cross-market correlation | `portfolio/correlation.ts` | PARTIAL | Crypto-only; no cross-asset (stocks/FX) correlation. |
| 11.6 | Advanced execution management | paper book-walk fills | PARTIAL | No TWAP/limit/iceberg order types. |
| 11.7 / 18.3 | Strategy competition arena | Strategy Lab (per-strategy backtests) | PARTIAL | No side-by-side arena; no Sharpe/Sortino; only 3 strategy families. |
| 11.8 / 18.5 | Strategy failure detector | `checkStrategyHealth()` | PARTIAL | Uses expectancy only; no slippage, PF or regime-shift triggers. |
| 11.9 / 20 | Decision journal & trade autopsy | `journal/`, `oms.ts#autopsy` | IMPLEMENTED | — |
| 11.10 | Monte Carlo simulator | `lab/backtest.ts#monteCarlo` | IMPLEMENTED | — |
| 11.11 | Historical market replay engine | — | MISSING | Backtester exists; no "replay as if live" through the full QCI→risk→OMS pipeline. |
| 11.12 | AI disagreement & uncertainty detector | challenge panel, MIXED consensus | IMPLEMENTED | — |
| 12.1–12.2 | 15 QA roles, QA director | Tests exist; roles not mapped | MISSING | Need a QA registry assigning each test suite to QA-01…QA-15 with independent reporting. |
| 12.3–12.4 | Coverage per role, function-by-function registry | 43 tests | PARTIAL | No frontend tests or end-to-end browser tests in the repo; no CI. |
| 12.5–12.6 | Test environments, 30-day paper evaluation | paper mode | PARTIAL | 30-day run not started (needs the app running continuously; see Phase 8). |
| 12.7–12.9 | Release gates, defect severity, pre-flight certification | `qa/gates.ts`, Release Gates page | PARTIAL | 14 gates; no defect tracker or pre-flight checklist page. |
| 13.1 | 50 indicator specialists | `workers/indicators.ts` | IMPLEMENTED | — |
| 13.2 | Telegram launch intelligence | — | BLOCKED | Telegram API access + approved channels. |
| 13.3 | Telegram & push notifications | `notify/notify.ts` | PARTIAL | In-app done; Telegram code written but BLOCKED (bot token); native push MISSING. |
| 14 | Consolidated roadmap | `IMPLEMENTATION_ROADMAP.md` | IMPLEMENTED | — |
| 15.4–15.12 | Overview, terminal, scanner cards, risk UX, design system, accessibility, responsive, data-integrity rules | `web/src` | PARTIAL | Keyboard search exists; no full command palette; no accessibility audit; no automated responsive tests. |
| 16 | Opportunity intelligence, adversarial analyst, calibration, rejection intel, execution feasibility | `decision/`, `qci/challenge.ts` | PARTIAL | Calibration MISSING (needs outcome data). |
| 17 | Deterministic risk engine, sizing, stops, breakers, emergency semantics | `risk/`, `exec/oms.ts`, `lab/exits.ts` | IMPLEMENTED | — |
| 18 | Strategy lab lifecycle & governance | `lab/lab.ts` | PARTIAL | Lifecycle + promotion gate done; change history of parameters MISSING. |
| 19 | Portfolio optimisation & allocation | correlation limits | PARTIAL | No allocation optimiser or portfolio stress test. |
| 20 | Journal & performance analytics | Journal, Portfolio | PARTIAL | Backtest-vs-paper comparison view MISSING. |
| 21 | Acceptance testing | tests + manual Playwright runs | PARTIAL | Playwright suite not committed. |
| 22 | Claude implementation process | docs/ | IMPLEMENTED | — |
| 23 | X & Telegram account integrations | Connections Hub (status only) | BLOCKED | Accounts + keys. |
| 24.1–24.4 | Network registry, withdrawal workflow, safety controls, history | `wallet/` | PARTIAL | Validation, address book, cooling-off, freeze, preview: done. Submission is LOCKED by design. |
| 24.5–24.9 | Wallet roles, signing, transaction firewall, key management | — | BLOCKED | Requires an isolated signing service; deliberately not built before release gates. |
| 25.1–25.2 | Bubble map & gainer/loser detection | `market/bubbles.ts` | IMPLEMENTED (crypto + FX) | Stocks/commodities BLOCKED. |
| 25.3–25.4 | Holder bubble map | Holder Map page (status) | BLOCKED | On-chain provider. |
| 26 | Funded bot, modes, lifecycle | `bot/bot.ts`, `exec/oms.ts` | IMPLEMENTED (paper) | Bounded live LOCKED. |
| 27 | Profit calendar | `portfolio/calendar.ts` | IMPLEMENTED | — |
| 28.2–28.5 | QA coverage & build contract | — | PARTIAL | See Part 12. |
| 29 | QCI: bounded workers, evidence packets, challenge panel, consensus states, integrity | `qci/`, `workers/runtime.ts` | IMPLEMENTED | Early-quorum shortcut not implemented (all applicable workers always run; ~14 ms, so not needed yet). |
| 30 | Bot control, asset risk, forecasting, Google News | bot, safety, news | PARTIAL | No forecasting model (§5 of Part 30); no probability calibration. |
| 31 | QCI & wallet security supplement | as Parts 24/29 | PARTIAL | Same signer/firewall dependency. |
| 32.2 | Data-quality infrastructure | `market/quality.ts` | IMPLEMENTED | — |
| 32.3–32.4 | Volatility intelligence, calibrated ensemble forecasting | regime + volatility workers | PARTIAL | Forecast ensemble MISSING. |
| 32.5 | Backtest-illusion controls | IS/OOS split, costs, next-bar entry | PARTIAL | No purged/embargoed walk-forward; survivorship bias documented, not removed. |
| 32.6 | Execution intelligence & OMS hardening | idempotent client IDs, last-moment checks | PARTIAL | No durable order-intent queue (would matter only for live trading). |
| 32.8 | Independent safety supervisor | risk gate + strategy health | PARTIAL | No separate watchdog process. |
| 32.11 | Model ops, drift, controlled learning | — | MISSING | — |
| 32.12 | Reliability & security operations | audit chain, runbook | PARTIAL | No CI, no automated backups, no monitoring alerts outside the app. |
| 32.13 | Operator cockpit | Overview + Risk Center | IMPLEMENTED | — |
| 33.4–33.6 | Pre-warming, incremental features, tiered scanning | `features/`, `fabric.ts` | IMPLEMENTED | — |
| 33.7 | Selective parallel QCI | `runtime.ts#isApplicable` | IMPLEMENTED | — |
| 33.8 | Compiled strategy capsules | `lab/strategies.ts` (shared live/backtest) | IMPLEMENTED | — |
| 33.11–33.12 | Event-bus lanes, persistent venue sessions (WebSockets) | in-process bus; REST polling | BLOCKED | WebSocket hosts not allow-listed; can be enabled with your approval. |
| 33.13–33.15 | Smart execution router, DEX & stocks execution | — | BLOCKED | Live execution is locked. |
| 33.16 | Final safety barrier | last-moment risk revalidation | IMPLEMENTED | — |
| 33.17 | Priority scheduling & backpressure | lane timers + re-entrancy guards | PARTIAL | No bounded queue with backpressure metrics. |
| 33.18 | Latency budgets & observability | `core/latency.ts`, p50/p95/p99 | IMPLEMENTED | No dedicated QHEF page. |
| 33.19–33.22 | Adaptive latency controller, safe degradation, operator UX, benchmark plan | data-quality fail-closed | PARTIAL | No performance regression tests. |

## Summary counts (requirement rows above)

| Status | Rows |
|---|---|
| IMPLEMENTED | 27 |
| PARTIAL | 34 |
| MISSING | 4 |
| BLOCKED | 9 |
| MOCKED | 0 |
| **Total** | **74** |

These counts describe this audit's own rows, not the spec's line count. Some rows split one requirement into a working part
and a blocked part, so the categories overlap.
