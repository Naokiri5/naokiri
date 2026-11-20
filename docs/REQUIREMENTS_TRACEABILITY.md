# Requirements Traceability — MIA 4.1 Parts 1–33

Phase 0 audit · 2026-11-16 · audited commit `ce655bd` (main, after PR #1) · **updated after Phase 1** · spec SHA-256 prefix `e2a0a376e37aa47f`

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
| 10 / 15 / 28.1 | Navigation, shell, mode badge, banners, command palette | `web/src/App.tsx`, `palette.tsx`, `pages/Phase1.tsx` | IMPLEMENTED | 25 workspaces incl. Asset Discovery, QHEF Performance, Security Center, Copy Trading (honest blocked state), Trading History (Phase 1). Economic calendar page waits on a licensed feed (BLOCKED, Part 6.2). |
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
| 12.3–12.4 | Coverage per role, function-by-function registry | 54 unit/integration + 32 browser checks, CI | PARTIAL | Browser suite + CI added (Phase 1); per-role QA registry still MISSING (Phase 3). |
| 12.5–12.6 | Test environments, 30-day paper evaluation | paper mode | PARTIAL | 30-day run not started (needs the app running continuously; see Phase 8). |
| 12.7–12.9 | Release gates, defect severity, pre-flight certification | `qa/gates.ts`, Release Gates page | PARTIAL | 14 gates; no defect tracker or pre-flight checklist page. |
| 13.1 | 50 indicator specialists | `workers/indicators.ts` | IMPLEMENTED | — |
| 13.2 | Telegram launch intelligence | — | BLOCKED | Telegram API access + approved channels. |
| 13.3 | Telegram & push notifications | `notify/notify.ts` | PARTIAL | In-app done; Telegram code written but BLOCKED (bot token); native push MISSING. |
| 14 | Consolidated roadmap | `IMPLEMENTATION_ROADMAP.md` | IMPLEMENTED | — |
| 15.4–15.12 | Overview, terminal, scanner cards, risk UX, design system, accessibility, responsive, data-integrity rules | `web/src` | PARTIAL | The command palette and keyboard navigation are implemented; accessibility audit and automated responsive tests remain outstanding. |
| 16 | Opportunity intelligence, adversarial analyst, calibration, rejection intel, execution feasibility | `decision/`, `qci/challenge.ts` | PARTIAL | Calibration MISSING (needs outcome data). |
| 17 | Deterministic risk engine, sizing, stops, breakers, emergency semantics | `risk/`, `exec/oms.ts`, `lab/exits.ts` | IMPLEMENTED | — |
| 18 | Strategy lab lifecycle & governance | `lab/lab.ts` | PARTIAL | Lifecycle + promotion gate done; change history of parameters MISSING. |
| 19 | Portfolio optimisation & allocation | correlation limits | PARTIAL | No allocation optimiser or portfolio stress test. |
| 20 | Journal & performance analytics | Journal, Portfolio | PARTIAL | Backtest-vs-paper comparison view MISSING. |
| 21 | Acceptance testing | tests + manual Playwright runs | PARTIAL | Playwright suite is committed in `e2e/app.spec.ts`; expand coverage as new workflows are added. |
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
| 32.12 | Reliability & security operations | audit chain, runbook, CI, request IDs, Security Center | PARTIAL | CI + request tracing added (Phase 1); automated backups and external monitoring still missing. |
| 32.13 | Operator cockpit | Overview + Risk Center | IMPLEMENTED | — |
| 33.4–33.6 | Pre-warming, incremental features, tiered scanning | `features/`, `fabric.ts` | IMPLEMENTED | — |
| 33.7 | Selective parallel QCI | `runtime.ts#isApplicable` | IMPLEMENTED | — |
| 33.8 | Compiled strategy capsules | `lab/strategies.ts` (shared live/backtest) | IMPLEMENTED | — |
| 33.11–33.12 | Event-bus lanes, persistent venue sessions (WebSockets) | in-process bus; REST polling | BLOCKED | WebSocket hosts not allow-listed; can be enabled with your approval. |
| 33.13–33.15 | Smart execution router, DEX & stocks execution | — | BLOCKED | Live execution is locked. |
| 33.16 | Final safety barrier | last-moment risk revalidation | IMPLEMENTED | — |
| 33.17 | Priority scheduling & backpressure | lane timers + re-entrancy guards | PARTIAL | No bounded queue with backpressure metrics. |
| 33.18 | Latency budgets & observability | `core/latency.ts`, `qhef/qhef.ts`, QHEF page | IMPLEMENTED | Budgets per hot-path stage + true event-loop delay (Phase 1). |
| 33.19–33.22 | Adaptive latency controller, safe degradation, operator UX, benchmark plan | data-quality fail-closed | PARTIAL | No performance regression tests. |

## Summary counts (requirement rows above)

| Status | Rows |
|---|---|
| IMPLEMENTED | 28 |
| PARTIAL | 33 |
| MISSING | 4 |
| BLOCKED | 9 |
| MOCKED | 0 |
| **Total** | **74** |

These counts describe this audit's own rows, not the spec's line count. Some rows split one requirement into a working part
and a blocked part, so the categories overlap.

---

## Unified quantitative intelligence overlay (2026-11-20)

**Canonical home:** This existing traceability document merges the owner's uploaded `MIA_AI_UNIFIED_QUANT_MASTER(1).md` and 100-feature JSON, rather than introducing another trading engine. The DOCX is a formatted presentation of that same specification. The appended feature catalog is a **requirements overlay**; it does not replace Parts 1–33 or retroactively upgrade their test status.

**Machine-readable index:** [Quant Feature Catalog](engineering/QUANT_FEATURE_CATALOG.json) retains all original 100 feature IDs and adds repository ownership hints and code-grounded exceptions. Names, descriptions and original status labels are preserved; repository ownership maps are for implementation planning, not proof of feature completion.

### Verified architectural integration decisions

| Owner in existing code | Reused responsibilities | Augmentation boundary |
|---|---|---|
| `server/src/features/indicators.ts` | Closed-candle incremental features; existing 50 reader adapters consume it | Add validated moments, distribution diagnostics and reference vectors here; never create another indicator engine |
| `server/src/chart/analysis.ts` / `chart/replay.ts` | Rule-based chart evidence and prefix replay | New pattern evidence is explanatory until prospectively validated and formally routed through QCI |
| `server/src/knowledge/research.ts` + `lab/backtest.ts` | **Already has walk-forward** with multiple OOS windows, crossing-trade purge and embargo; reuses backtest | Improve dynamic certification, point-in-time universe, execution realism and dependence-aware uncertainty; do not duplicate research engines |
| `server/src/qci/coordinator.ts` | Signed worker packets, quorum, dependency caps and vetoes | Add measured quantitative evidence behind current authenticated schema; avoid uncalibrated probability claims |
| `server/src/decision/engine.ts` + `risk/gate.ts` | One decision and risk authority | Certification may only restrict entry, not bypass owner limits; require adversarial regression tests |
| `server/src/ditas/*` | Forecast calibration, memory, fingerprint and decision twins | Link independently observed outcomes and model versions; no secondary trading authority |
| `server/src/market/fabric.ts` + `safety/safety.ts` | Existing CEX+DEX discovery and safety gates | Future Solana RPC/event provider adapters must fail closed until verified; no new global scanner |
| `server/src/exec/oms.ts` + `portfolio/ledger.ts` | Paper execution and authoritative accounting | Shared pretrade policies can support future live mode; actual live execution/signing remains absent and locked |

**Corrections versus the earlier standalone brief:** the `knowledge/research.ts` research walk-forward already exists; the previous package's `src/catalog.ts`, `src/adapters.ts` and `docs/REPO_FILE_MAP.md` are **not present** in this GitHub repository and must not be copied in as competing services. Existing experimental status should never be read as complete certification. The default `main` release lock remains intact.

### Mode-parity acceptance contract

- PAPER and future LIVE must call the same feature functions, strategy versions, QCI, decision engine, owner policy and risk veto on identical frozen evidence. Do **not** maintain two separately evolving decision engines.
- The mode-specific adapter enters only **after** shared risk approval. PAPER uses simulated fills; LIVE would additionally require separate owner approval, release gates, isolated signing, provider authorization and reconciliation. No real transaction path is introduced by this documentation.
- Any incomplete or stale Solana token authority, liquidity or sell-route check must prevent automation in both modes. DEX sniping features in the catalog are planned, not enabled.
- No automatic risk-limit relaxation, speculative strategy promotion, or unreviewed model self-update. Every increment must include reproducible unit/regression tests and explicit proof of acceptance gates.

### First bounded implementation increment on this branch

`MIA-Q001`: extend **existing** `FeatureEngine` with 20-return mean, population skewness and excess kurtosis; abstain (NaN) for incomplete history or zero-variance standardized moments. New test cases check 20-return warm-up, deterministic incremental calculation and constant-price abstention. These are descriptive features only, not QCI votes, order signals or win probabilities. CI confirmation is required before considering the implementation verified.

### Appended original 100-feature specification (reconciled)

**Version:** 1.0.0  
**Prepared:** November 20, 2026  
**Repo:** https://github.com/Naokiri5/naokiri  
**Status:** IMPLEMENTATION BLUEPRINT + TYPECHECKED REFERENCE CONTRACTS, NOT A PRODUCTION LIVE BOT

## Purpose and non-removal rule

Unify all 100 previously proposed statistical, mathematical, technical-chart, on-chain, AI, strategy, risk, research, and operations upgrades in **one canonical master document**. Keep all already implemented MIA features and stored data. Reuse the existing sources; add extensions with migration and tests. Existing paper trading and future authorized live trading must share *the same* mathematical features, market truth, model versions, rule engine, QCI evidence, decision engine, mandatory risk policy and observability. No research agent, model, or explanatory assistant may bypass these controls.

This document supersedes no owner files: it is an additive implementation reference. All code must be reviewed against the newest repository commit before implementation. Feature status refers to inspected source and docs; no full test-suite run or live profitability audit was executed to build this package.

## Executive decisions

- Preserve TypeScript/Fastify/SQLite and existing market fabric, `FeatureEngine`, `chart/analysis.ts`, Lab, QCI, DITAS, risk gate, decision engine, paper OMS and Trader Joe.
- Measure statistical edge through **out-of-sample net returns** and calibration, not the number of agents, chart indicators or QCI votes.
- Treat model confidence as uncertainty-qualified and outcome-specific. The existing MIA opportunity score explicitly is **not** a probability of profit.
- Keep a certified strategy registry and versioned dataset provenance. No strategy may be promoted solely because it has any saved backtest.
- Keep Solana DEX contracts fail-closed until real RPC verification, token extension analysis, route/sell simulations and liquidity checks exist.
- LIVE routes require **additional** owner authorization, release certification, separate signer, venue access and telemetry; those are **never substitutes for shared policy checks**.
- Deploy in bounded, test-first phases. Each phase includes clear acceptance tests and a rollback plan.

## Grounded code inventory (reviewed `main`)

| Existing implementation | Present today | Deficiency / direction |
|---|---|---|
| `server/src/features/indicators.ts` | EMA, RSI, ATR, MACD, ADX, bands, stochastic, OBV, volume Z, realized vol, VWAP20 etc. | Improve per-metric warm-up, full reference fixtures, division by zero, numerical behavior |
| `server/src/workers/registry.ts` | 100 deterministic market workers in 11 domains | Not 100 separately trained AI models; validate coverage and correlated sources |
| `server/src/workers/indicators.ts` | 50 normalized indicator readers across 15m/1h/4h | Not 50 independent predictive models; extend only useful evidence |
| `server/src/chart/analysis.ts` | Confirmed swings, basic patterns, breakout/sweeps, FVG hypotheses | Confidence marked NOT_CALIBRATED; explanatory `NO TRADE` by design |
| `server/src/lab/backtest.ts` | IS/OOS split, next-bar entry, fees, spread, slippage, R results, Monte Carlo | Research walk-forward with purge/embargo already exists in `knowledge/research.ts`; lacks full independent certification, robust fill queues and dependence-aware stress |
| `server/src/ditas/calibration.ts` | Brier, log loss, ECE, Wilson intervals on settled binary cohorts | Needs verified observed outcomes, prospective forecasts, trained model registry |
| `server/src/qci/coordinator.ts` | Signed packets, quorum, capped dependency votes, vetoes | Fixed thresholds, uncalibrated; preserve rather than duplicate |
| `server/src/decision/scoring.ts` | Transparent fixed weighted scores, missing-value penalty | Research weights only; do not convert score to probability |
| `server/src/decision/engine.ts` | Central authority, signed QCI, independent risk and paper path | Make failed mandatory statistical gates deterministically block entry |
| `server/src/lab/lab.ts` | Owner-controlled strategy lifecycle | Paper promotion currently only requires saved backtest; require durable certification |
| `server/src/safety/safety.ts` | CEX risk + DEX heuristic flags | DEX cannot be auto-eligible; no validated SPL/Token-2022 security provider |
| `server/src/risk/gate.ts` | Loss limits, sizing, correlation, cost, freshness, pause and incidents | Extend stress/tail risk without relaxing hard limits |
| `server/src/market/fabric.ts` | Binance spot REST polling, cross venue, data fabric | Add authorized event streams and venue-specific integrity checks |
| `server/src/core/mode.ts` | OBSERVE/PAPER/APPROVAL/BOUNDED_LIVE controls | Preserve live lock until release certification |

Historic repository docs report 3 strategies losing money OOS on very small samples. These results are *not* proof of edge. Source review does not certify runtime performance. See `docs/engineering/IMPLEMENTATION_INVENTORY.md` for exact file/feature references.

## Target architecture

```text
RAW MARKET SOURCES (CEX / Solana / Licensed FX or equities / News)
  -> existing Market Data Fabric + provenance / source timing / quality gates
  -> single versioned Feature Store (price, volatility, structure, order flow, on-chain, portfolio)
  -> Statistical + Chart + On-chain + Quant + Calibration specialists (research evidence only)
  -> existing QCI coordinator and adversarial challengers (dependency caps)
  -> existing single Decision Engine (expected value + uncertainty + certification)
  -> existing independent deterministic Risk Engine (owner policy / sizing / fail closed)
  -> shared validated Order Intent / OMS interface
     -> PAPER adapter: realistic simulation and explicit synthetic fills
     -> LIVE adapter: real venue and separately authorized isolated signer, LOCKED until certified
  -> identical journal/metrics/result envelopes -> prospective evaluation -> reviewed model promotion
```

## Foundational contract for demo and live

Core analytics must never branch on `mode`. Reusing the same functions and policy versions is stronger than duplicating near-identical paper and live components. Formula, feature inputs, model versions, data-quality policy, certification, risk limits, strategy eligibility, traceability and kill switch must be shared. Routing, key custody and real fill mechanics can differ as necessary; live may add restrictions but never reduce security. Test frozen decision fixtures for equality of core outputs across modes. A live outcome is **not** required to match a paper simulated fill: observe and report the difference.

## Mathematical requirements

**Trade expectancy in R:** `E_net[R] = p_win*mean_win_R - (1-p_win)*mean_loss_R - expected_cost_R`; only use if win/loss cohorts are aligned and empirically justified. Example p=.54, mean win=1.40R, mean loss=1.0R, cost=.15R -> +.146R, illustrative only.

**Statistical uncertainty:** record effective sample sizes, Wilson intervals for binary outcomes, bootstrap confidence intervals for R, and block/bootstrap or regime resampling where serial dependence matters. The probability must refer to a named event and horizon, with proper calibration, rather than treating relative votes as P(win).

**Cost mechanics:** estimate fee+spread+slippage+priority fee+failed transaction/partial fill+exit costs, and preserve provider source/time; simulation fills must not claim more liquidity than observed. Compare expected versus realized shortfall.

**Time integrity:** features use only data with `availableAt <= decisionAt`; candles must be closed, snapshots ordered, no look-ahead, no historical survivorship, and price events must never be backdated after late arrival.

**Model governance:** compare prospective OOS baselines and stress costs; accept only reviewed evidence. Model drift triggers abstention/suspension, not unbounded live self-training.

## Feature priority

P0 = mandatory correctness, data, risk, certification and mode parity; P1 = high-value feature expansion; P2 = research ideas contingent on demonstrated incremental value. `BASE_EXISTS` means some related implementation was observed, not that it is production-complete. `NEEDS_EXTERNAL_FEED` explicitly means a provider/credential/certification is required. **All 100 requirements are preserved in `docs/engineering/QUANT_FEATURE_CATALOG.json` and below.**

## Complete 100-feature catalog

| ID | Category | Feature | Baseline | Priority | Short requirement |
|---|---|---|---|---|---|
| MIA-Q001 | Statistics | Statistical distribution analyzer | PARTIAL | P0 | Measure returns, variance, skewness and kurtosis. |
| MIA-Q002 | Statistics | Robust outlier detection | PARTIAL | P1 | Flag anomalous prices and volumes without contaminating baselines. |
| MIA-Q003 | Statistics | Confidence interval engine | PARTIAL | P0 | Quantify uncertainty of expectancy, win rates, and measured outcomes. |
| MIA-Q004 | Statistics | Bayesian probability estimation | PROPOSED | P2 | Update event probabilities with independent new evidence. |
| MIA-Q005 | Statistics | Statistical hypothesis tester | PROPOSED | P0 | Test an apparent strategy edge against explicit baselines. |
| MIA-Q006 | Statistics | Cost-adjusted expectancy | BASE_EXISTS | P0 | Compute expected net R after fees, slippage and market impact. |
| MIA-Q007 | Statistics | Conditional volatility model | PROPOSED | P2 | Estimate changing volatility with EWMA or GARCH-style approaches. |
| MIA-Q008 | Statistics | Tail-risk analysis | PARTIAL | P0 | Quantify extreme losses and expected shortfall. |
| MIA-Q009 | Statistics | Advanced Monte Carlo | BASE_EXISTS | P0 | Simulate clustered losses, regime changes and adverse fills. |
| MIA-Q010 | Statistics | Statistical drift detection | PARTIAL | P1 | Detect changes in feature distributions and predictive performance. |
| MIA-Q011 | Statistics | Correlation and covariance modeling | BASE_EXISTS | P0 | Quantify portfolio-wide common risk exposure. |
| MIA-Q012 | Statistics | Statistical significance controller | PROPOSED | P0 | Guard against multiple comparisons and strategy-selection bias. |
| MIA-Q013 | Charts | Advanced market structure | BASE_EXISTS | P1 | Detect confirmed BOS, CHoCH, higher highs and lower lows. |
| MIA-Q014 | Charts | Support/resistance zones | BASE_EXISTS | P1 | Estimate zone age, strength and confirmed retests. |
| MIA-Q015 | Charts | Fair value gap analysis | BASE_EXISTS | P1 | Identify OHLCV gaps and test forward predictive value. |
| MIA-Q016 | Charts | Supply/demand analysis | PROPOSED | P2 | Hypothesize zones based on observable price and volume only. |
| MIA-Q017 | Charts | Volume profile | PARTIAL | P2 | Estimate traded volume by price level from suitable data. |
| MIA-Q018 | Charts | Anchored VWAP | PARTIAL | P1 | Calculate VWAP from identified historical anchor events. |
| MIA-Q019 | Charts | Multi-timeframe alignment | BASE_EXISTS | P0 | Join confirmed frames strictly as-of decision time. |
| MIA-Q020 | Charts | Pattern performance database | PARTIAL | P2 | Track subsequent real outcomes for every detection. |
| MIA-Q021 | Charts | Chart explanation engine | BASE_EXISTS | P1 | Present entry, invalidation, levels, time and evidence visually. |
| MIA-Q022 | Charts | Adaptive indicator parameters | PARTIAL | P2 | Promote parameters only after robust OOS testing. |
| MIA-Q023 | Solana | Real-time launch detector | NEEDS_EXTERNAL_FEED | P0 | Track mints, pools, launchpad events and migrations. |
| MIA-Q024 | Solana | Sub-minute analytics | NEEDS_EXTERNAL_FEED | P0 | Compute event-time 5s, 15s, 1m and 5m measures. |
| MIA-Q025 | Solana | Token authority verifier | NEEDS_EXTERNAL_FEED | P0 | Inspect SPL mint/freeze authority and Token-2022 behavior. |
| MIA-Q026 | Solana | Holder concentration analysis | NEEDS_EXTERNAL_FEED | P0 | Estimate ownership distribution and linked clusters. |
| MIA-Q027 | Solana | Deployer reputation tracking | NEEDS_EXTERNAL_FEED | P2 | Connect creators to prior launches and suspicious behavior. |
| MIA-Q028 | Solana | Liquidity survival analysis | NEEDS_EXTERNAL_FEED | P0 | Measure whether pool liquidity survives launch and early trading. |
| MIA-Q029 | Solana | Buy/sell participation analysis | PARTIAL | P1 | Compare observed buyer, seller and transaction participation. |
| MIA-Q030 | Solana | Wash-trading detection | PARTIAL | P2 | Find repetitive, cyclic and coordinated wallet trades. |
| MIA-Q031 | Solana | Swap-route simulation | NEEDS_EXTERNAL_FEED | P0 | Evaluate quote, sell-route feasibility and total trading cost. |
| MIA-Q032 | Solana | Transaction landing analysis | NEEDS_EXTERNAL_FEED | P0 | Track submission, confirmation, expiry and failure. |
| MIA-Q033 | Solana | MEV and execution-risk analysis | NEEDS_EXTERNAL_FEED | P1 | Estimate routing and adversarial transaction-execution risks. |
| MIA-Q034 | Solana | Wallet behavior intelligence | PARTIAL | P2 | Assess whale behavior without blind copy trading. |
| MIA-Q035 | AI | Central feature store | BASE_EXISTS | P0 | Share versioned, point-in-time evidence across specialists. |
| MIA-Q036 | AI | Predictive probability models | PARTIAL | P0 | Train models on precisely defined and settled outcomes. |
| MIA-Q037 | AI | Model ensemble | PARTIAL | P1 | Combine models with independently measured contribution. |
| MIA-Q038 | AI | Adaptive evidence weights | PARTIAL | P2 | Reweight evidence only after validated OOS comparisons. |
| MIA-Q039 | AI | Uncertainty-aware decisions | BASE_EXISTS | P0 | Abstain on weak, stale, anomalous or OOD data. |
| MIA-Q040 | AI | Bull/bear/challenger debate | BASE_EXISTS | P1 | Use opposing analyses and independent failure tests. |
| MIA-Q041 | AI | Market DNA memory | BASE_EXISTS | P1 | Find comparable historical conditions and their outcomes. |
| MIA-Q042 | AI | Counterfactual decision twin | BASE_EXISTS | P2 | Compare enter, wait, skip and delayed alternatives. |
| MIA-Q043 | AI | AI hallucination validator | PARTIAL | P0 | Reject unsupported numbers, times and causal conclusions. |
| MIA-Q044 | AI | Trader Joe explanation layer | BASE_EXISTS | P1 | Explain signals, costs, vetoes and filled orders with evidence. |
| MIA-Q045 | Research | Rolling walk-forward testing | PARTIAL | P0 | Evaluate successive unseen out-of-sample windows. |
| MIA-Q046 | Research | Purged time-series validation | PARTIAL | P0 | Prevent overlapping-label leakage and look-ahead. |
| MIA-Q047 | Research | Realistic historical replay | BASE_EXISTS | P0 | Replay only information observable at each decision. |
| MIA-Q048 | Research | Slippage and market-impact simulation | BASE_EXISTS | P0 | Model partial, adverse, delayed and failed fills. |
| MIA-Q049 | Research | Strategy competition arena | PARTIAL | P1 | Compare candidate strategies under identical windows and costs. |
| MIA-Q050 | Research | Performance decomposition | PARTIAL | P1 | Separate signal edge, market beta and execution outcomes. |
| MIA-Q051 | Research | Shadow strategy testing | PARTIAL | P0 | Test candidate models with zero order authority. |
| MIA-Q052 | Research | Model and strategy version registry | BASE_EXISTS | P0 | Track datasets, hashes, versions, owners and approvals. |
| MIA-Q053 | Risk | Conditional position sizing | BASE_EXISTS | P0 | Adjust permitted exposure to liquidity and estimated risk. |
| MIA-Q054 | Risk | Expected shortfall controls | PARTIAL | P0 | Cap exposure to severe modeled downside. |
| MIA-Q055 | Risk | Correlation stress testing | PARTIAL | P0 | Stress simultaneous losses across correlated assets. |
| MIA-Q056 | Risk | Market-data failover | BASE_EXISTS | P0 | Stop safely and recover after source outages. |
| MIA-Q057 | Risk | Execution anomaly detection | PARTIAL | P0 | Find unexplained fills, slippage, latency and reconciliation gaps. |
| MIA-Q058 | Risk | Unified paper/live rules | BASE_EXISTS | P0 | Run the exact same decision and risk policies in both modes. |
| MIA-Q059 | Risk | Model decay supervisor | BASE_EXISTS | P0 | Suspend decayed strategies after valid prospective evidence. |
| MIA-Q060 | Risk | Immutable decision journal | BASE_EXISTS | P0 | Preserve inputs, models, approvals, execution and outcomes. |
| MIA-Q061 | Data | Event-time synchronization | PARTIAL | P0 | Align exchange timestamps, Solana slots and receipt clocks. |
| MIA-Q062 | Data | Deterministic event replay | PARTIAL | P0 | Reproduce decisions without information from the future. |
| MIA-Q063 | Data | Historical gap and duplicate detection | BASE_EXISTS | P0 | Reject incomplete or non-monotonic market records. |
| MIA-Q064 | Data | Point-in-time market universes | PROPOSED | P0 | Remove survivorship bias from historical testing. |
| MIA-Q065 | Data | Immutable raw-data provenance | PARTIAL | P0 | Trace predictions to original unmodified observations. |
| MIA-Q066 | Data | Return autocorrelation analysis | PARTIAL | P2 | Test serial dependence and return predictability hypotheses. |
| MIA-Q067 | Data | Market entropy diagnostics | PROPOSED | P2 | Evaluate complexity under explicitly specified estimators. |
| MIA-Q068 | Data | Jump and discontinuity detection | PARTIAL | P1 | Identify moves poorly captured by smooth volatility. |
| MIA-Q069 | Data | Covariance shrinkage | PROPOSED | P2 | Stabilize estimates from limited return samples. |
| MIA-Q070 | Data | Sequential statistical testing | PROPOSED | P2 | Control repeated peeking at results over time. |
| MIA-Q071 | Microstructure | Aggressor-volume imbalance | PROPOSED | P1 | Track buyer- and seller-initiated volume where available. |
| MIA-Q072 | Microstructure | Cumulative volume delta | PROPOSED | P1 | Aggregate signed trade flow over event time. |
| MIA-Q073 | Microstructure | Order-book resilience | PROPOSED | P2 | Measure depth recovery after market impact. |
| MIA-Q074 | Microstructure | Spread regime analysis | PARTIAL | P1 | Detect unstable spreads and execution friction. |
| MIA-Q075 | Microstructure | False-breakout outcome classifier | PARTIAL | P2 | Measure confirmed false-breakout frequencies. |
| MIA-Q076 | Microstructure | Triple-barrier outcome labeling | PARTIAL | P0 | Label target, stop and time barrier outcomes. |
| MIA-Q077 | Microstructure | Meta-labeling | PROPOSED | P2 | Learn when to accept or skip primary strategy signals. |
| MIA-Q078 | Microstructure | Class-imbalance evaluation | PROPOSED | P0 | Evaluate rare events without misleading accuracy. |
| MIA-Q079 | Microstructure | Regime-specific calibration | PARTIAL | P0 | Estimate reliability separately across market conditions. |
| MIA-Q080 | Microstructure | Out-of-distribution detection | PARTIAL | P0 | Abstain on inputs unlike the training distribution. |
| MIA-Q081 | Solana | Token-program-aware parser | NEEDS_EXTERNAL_FEED | P0 | Separate SPL Token and Token-2022 programs. |
| MIA-Q082 | Solana | Token extension policy engine | NEEDS_EXTERNAL_FEED | P0 | Validate fees, delegates, hooks and freeze powers. |
| MIA-Q083 | Solana | Pool creation graph | NEEDS_EXTERNAL_FEED | P2 | Relate tokens, deployers, pools and prior launches. |
| MIA-Q084 | Solana | Holder concentration timeline | NEEDS_EXTERNAL_FEED | P1 | Track concentration changes since launch. |
| MIA-Q085 | Solana | Organic participation estimator | NEEDS_EXTERNAL_FEED | P2 | Identify signs of non-independent participants. |
| MIA-Q086 | Solana | Funding-wallet relationship analysis | NEEDS_EXTERNAL_FEED | P2 | Investigate common funding sources and links. |
| MIA-Q087 | Solana | Solana transaction latency breakdown | NEEDS_EXTERNAL_FEED | P0 | Measure detect, simulate, sign, submit, land and confirm. |
| MIA-Q088 | Solana | Quote expiration and revalidation | NEEDS_EXTERNAL_FEED | P0 | Fail closed when swap quotes expire or state changes. |
| MIA-Q089 | Solana | Execution-provider benchmarking | NEEDS_EXTERNAL_FEED | P0 | Compare providers using controlled comparable samples. |
| MIA-Q090 | Solana | Liquidity emergency detector | NEEDS_EXTERNAL_FEED | P0 | Identify withdrawals and evaluate safe exit options. |
| MIA-Q091 | Portfolio | Factor exposure decomposition | BASE_EXISTS | P0 | Quantify shared market, asset and event risk. |
| MIA-Q092 | Portfolio | Liquidity-adjusted position limits | PARTIAL | P0 | Constrain positions by realistic exit capacity. |
| MIA-Q093 | Portfolio | Realized versus predicted P&L attribution | BASE_EXISTS | P0 | Explain discrepancies between forecasts and execution. |
| MIA-Q094 | Portfolio | Portfolio scenario policy | PARTIAL | P0 | Stress simultaneous drawdowns and exits. |
| MIA-Q095 | Operations | Autonomous incident response | BASE_EXISTS | P0 | Pause safely and alert owner on critical failures. |
| MIA-Q096 | Operations | Metamorphic mathematical testing | PARTIAL | P0 | Verify logical invariants of numerical code. |
| MIA-Q097 | Operations | Property-based leakage testing | PARTIAL | P0 | Verify hidden future input cannot change past decisions. |
| MIA-Q098 | Operations | Shadow-model comparisons | PARTIAL | P0 | A/B candidate models without execution authority. |
| MIA-Q099 | Operations | Per-stage latency budgets | BASE_EXISTS | P0 | Measure queue, model, risk and execution delays. |
| MIA-Q100 | Operations | Reproducible evidence packages | PARTIAL | P0 | Archive inputs, versions, assumptions and independent checks. |


## Mandatory statistical and safety acceptance tests

1. **Indicator reference vectors:** independent RSI/MACD/ADX/ATR/Bollinger/volume tests, warm-up and non-finite guards; deterministic repeatability.
2. **Temporal purity:** after freezing history at timestamp T, any changes after T leave feature, chart, QCI and strategy output at T exactly unchanged.
3. **Data-truth gate:** missing venue, stale quote, invalid candle/book, off-chain provenance and expired token check always reject or abstain.
4. **Certification lifecycle:** no approved trading after one arbitrary backtest, underpowered OOS, negative expectancy, missing owner approval, expired model version, failed walk-forward or cost stress.
5. **Backtesting realism:** next-observable-bar entry, queue limitations, unfilled orders, end-of-history positions, split-boundary handling, fees/priority fees and worst-case stop-before-target where ambiguous.
6. **Calibration:** clearly defined forecast target/horizon; Brier/log loss/ECE; independent source-linked settled outcomes; proper regime cohorts; no scores reused as probabilities.
7. **Shared mode parity:** identical frozen inputs and policy yield identical core decision for PAPER and LIVE; authorization differences arise only after core checks.
8. **Live release gate:** no live transaction before independent approval, signer setup, venue allowlist, idempotency, ledger reconciliation, incident drills and audited kill-switch behavior.
9. **Solana safety:** Token-2022 extension inspection, mint/freeze controls, held liquidity/holders, route freshness, sell-route simulation and permission checks; unavailable critical data means reject.
10. **End-to-end rollback:** any rollout has backups/migration tests, a rollback plan, measured latency and source of truth for event sequences.

### Suggested non-universal promotion policy

Start with a configurable *research* threshold, for example >=100 independent OOS trades, >=3 genuinely separate test windows, net expected R >0 and bootstrap lower-bound R >0, with verified provenance and manual review. These numbers are **illustrative starting settings, not guarantees of statistical significance or optimal risk policy**. Sparse Solana token opportunities may not satisfy these thresholds and should remain research-only rather than weakening the test.

## Delivery phases and outputs

| Phase | Goal | Acceptance artifact | Scope |
|---|---|---|---|
| P1 | Correct existing math, formalize certificates, data/fill safety | reference fixtures, audited hard veto, baseline report | Q001-Q012, Q053-Q060, Q061-Q065 |
| P2 | Rolling WFO, calibration, simulated trading cost truth | replay ledger, OOS and uncertainty pack | Q045-Q052, Q076-Q080 |
| P3 | Charts, order flow, specialist evidence contracts | no-look-ahead chart tests and QCI schema test | Q013-Q022, Q066-Q080 |
| P4 | Solana event, token and execution data | independently sourced safety and route simulations | Q023-Q034, Q081-Q090 |
| P5 | Shared specialist evaluations + portfolio decisions | measured model/research improvement and paper/live parity | Q035-Q044, Q091-Q094 |
| P6 | Operational resilience, certification and measured release | staged paper proof, failure drills, incident review | Q095-Q100 |

Catalog entries define a primary phase, not a claim that all features have to be built simultaneously. Implement one work card and ship it with tests at a time.

## Architectural change policy (preserve user data)

- Never replace, delete, rename or silently alter existing data or repository files. New modules and schema migrations must be add-only by default; if consolidation is proposed, get review approval and prove contract equivalence.
- Code in this package is a **standalone reference and non-trading starter**. It is not yet wired to the user's MIA database or live exchange. Use it for type definitions and test fixtures, not as a drop-in production patch.
- No private keys, API tokens, wallet mnemonics or browser cookies in code/prompts/LLM tools. Use isolated secret storage and a signer with strict limits.
- Do not use a changing risk policy in one mode only. Policy version and strategy model version must appear in every decision report.
- No automated alterations to approved risk limits; keep owner-only configuration and emergency shutdown.

## Token-cost-efficient agent workflow

The entire master is *not* a daily agent prompt. See `agent_instructions/QUICK_CONTEXT.md`, `docs/TASK_CARDS.md` and `docs/LOW_TOKEN_WORKFLOW.md`. Tell Codex/Claude one task ID and two or three exact source paths; let them inspect only relevant code. Reuse the repo's existing `CLAUDE.md` without overwriting. Keep a minimal feature manifest and provenance logs, not giant conversation dumps. Every task produces a diff summary, test evidence, parity result and next task ID.

## Repository research references (research, not copy-paste dependency mandate)

- TA-Lib: https://github.com/TA-Lib/ta-lib-python
- vectorbt: https://github.com/polakowo/vectorbt
- statsmodels: https://github.com/statsmodels/statsmodels
- scikit-learn: https://github.com/scikit-learn/scikit-learn
- River: https://github.com/online-ml/river
- NautilusTrader: https://github.com/nautechsystems/nautilus_trader
- MLflow: https://github.com/mlflow/mlflow
- Solana documentation: https://solana.com/docs
- Helius docs: https://www.helius.dev/docs
- Jupiter docs: https://developers.jup.ag/docs
- Jito docs: https://docs.jito.wtf

Review current licenses, APIs, security and terms before adopting external packages. Do not bulk import vendor code or grant an external MCP unrestricted signing permissions.

## Historical standalone reference-kit index (not an installed repo module)

- `docs/MIA_UNIFIED_MASTER.md` — this canonical architecture and all 100 feature IDs.
- `catalog/FEATURE_CATALOG.json` — structured searchable 100-feature machine catalog.
- `src/catalog.ts` — typed TypeScript index for feature lookup.
- `src/types.ts` — versioned event/evidence/strategy/decision/parity contracts.
- `src/math.ts` — deterministic, non-trading statistical reference helpers.
- `src/strategy-certification.ts` — research-only hard certificate checks.
- `src/shared-decision.ts` — a mode-agnostic shared pretrade validation function; live-specific permission gate follows it.
- `src/adapters.ts` — non-trading PAPER preview and locked LIVE placeholder, no order signing.
- `src/index.ts` — public exports.
- `tests/parity.test.mjs` — smoke tests for 100 IDs, math, shared-parity, certificate blocks, DEX safety and locked execution.
- `docs/PARITY_MATRIX.md` — invariant matrix.
- `docs/engineering/IMPLEMENTATION_INVENTORY.md` — exact integration targets in user repo.
- `docs/TASK_CARDS.md` — bounded implementation sequence for Claude and Codex.
- `docs/LOW_TOKEN_WORKFLOW.md` — prompt/context cost control.
- `agent_instructions/QUICK_CONTEXT.md` — context summary for both agents.
- `agent_instructions/CODEX_PROMPT.md` / `CLAUDE_PROMPT.md` — short prompts.

**Status statement:** The original standalone package did not modify Naokiri5/naokiri. This feature branch integrates the specification and a limited indicator enhancement but does not claim to implement all 100 requirements. It does not unlock live trading. Source-code references are based on a read-only inspection of the repository as available for this task.
