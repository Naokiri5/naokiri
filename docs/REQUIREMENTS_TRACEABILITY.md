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

## MIA AI — Single Unified Quantitative Intelligence & Trading Parity Master

**Consolidated edition:** 1.2.0 • **Date:** November 20, 2026  
**Project:** [Naokiri5/naokiri](https://github.com/Naokiri5/naokiri)  
**Review baseline:** `main` tree `2627cd276d2108c15a47ba41d60cdb54fddf10ff`  
**Review changes:** [Draft PR #58](https://github.com/Naokiri5/naokiri/pull/58), branch `feat/quant-unified-existing-core`  
**CI evidence:** [GitHub Actions run 44655902028](https://github.com/Naokiri5/naokiri/actions/runs/44655902028) — completed successfully at inspected PR head `e2e692d7814dced5bf3c79bce1a66361e5639bae`  
**Release status:** paper-trading source base; live execution not operational/certified; no real-money execution enabled in PR #58.

> **Single-document rule:** This is one authoritative *portable* combination of the previously uploaded master and the GitHub audit. In the repository, the canonical requirements home remains **`docs/REQUIREMENTS_TRACEABILITY.md`** and the machine-readable catalog remains **`docs/engineering/QUANT_FEATURE_CATALOG.json`**. Do not install the old standalone TypeScript reference kit as a second application.

## 1. Consolidation decisions and source traceability

The uploaded `MIA_AI_UNIFIED_QUANT_MASTER(2).md` and `(3).md` are byte-identical. The uploaded 100-feature catalog contains all IDs `MIA-Q001`–`MIA-Q100`, each once. The DOCX upload is an alternate formatted version of the master, not an independent design authority. This edition preserves the original 100 feature names, priorities, phases, baseline labels, requirements and acceptance constraints. It combines the user-provided GitHub audit and PR results with verified code evidence and explicitly corrects older assumptions.

**Preservation priority:** Preserve existing GitHub code and its documentation, contracts, database records, security and execution controls. No new scanner, QCI coordinator, feature engine, strategy lab, risk engine, OMS or second live trading core. `BASE_EXISTS` only means related code was inspected, not that the complete item is deployed. `PARTIAL`, `PROPOSED` and `NEEDS_EXTERNAL_FEED` remain planning statuses until independent proof exists.

### Source provenance and intentional corrections

| Topic | Earlier source framing | Verified integrated interpretation |
|---|---|---|
| Walk-forward evaluation | Backtester alone lacks rolling walk-forward | `server/src/knowledge/research.ts` **already implements** `strategyWalkforward`, with OOS windows, boundary-trade purging, embargo, and metrics; harden/reuse instead of duplicating |
| 100 workers | Sometimes treated as 100 AI brains | `workers/registry.ts` contains deterministic workers; not 100 independent trained models |
| 50 indicators | Sometimes treated as 50 predictor models | `workers/indicators.ts` maps canonical features to indicator readings; do not build another indicator calculation engine |
| Forecast confidence | Score implies win probability | QCI consensus and weighted score are **not** calibrated profit probabilities |
| Solana safety | Heuristic checks might authorize DEX sniping | `safety/safety.ts` provides incomplete DEX heuristics and fails closed; real permission/authority/liquidity and sell-route verification needed |
| Live mode | PAPER and LIVE should share features | This is a **parity requirement**, not operational live readiness; mode-specific signing and venue execution remain prohibited by the current release lock |
| Old standalone paths | `src/catalog.ts`, `src/adapters.ts`, `docs/REPO_FILE_MAP.md` suggested as existing repo components | These belonged to the original separate starter kit; current repo owns features through existing `server/src/` modules and `CLAUDE.md` |
| PR #58 test state | Browser tests were running during earlier progress report | Both CI jobs subsequently completed successfully; CI does not establish actual trading profitability or certify the 100 new features |

## 2. GitHub source audit — what MIA already has

The verified repository baseline contains substantial implementations in **statistics, chart evidence, 100 deterministic workers, 50 indicator readers, QCI, DITAS, backtesting, walk-forward research, risk controls and paper OMS**. The next upgrades should extend these owners and their tests, not introduce competing services.

| Capability | Existing owner | What is present / what to enhance |
|---|---|---|
| Technical indicators and statistics | `server/src/features/indicators.ts` | Incremental EMA/RSI/MACD/ADX/ATR, VWAP and volatility; add reference validations and distribution metrics |
| Worker coordination | `server/src/workers/registry.ts`, `runtime.ts` | 100 deterministic workers; improve independent evidence and outcome measurement |
| Indicator readers | `server/src/workers/indicators.ts` | 50 readers over shared features; preserve adapter, avoid duplicating computation |
| Chart intelligence | `server/src/chart/analysis.ts`, `chart/replay.ts` | Swings, patterns, FVG hypotheses, prefix replay; extend and validate causality |
| Backtester/Monte Carlo | `server/src/lab/backtest.ts` | IS/OOS backtest and independent bootstrap; improve cost and dependent-loss simulation |
| Existing walk-forward research | `server/src/knowledge/research.ts` | Multiple OOS windows, crossing-trade purge and embargo; improve certification and point-in-time robustness |
| Strategy lifecycle | `server/src/lab/lab.ts` | Owner-led promotion; require positive independent OOS certification instead of mere stored backtest |
| Decision/QCI | `server/src/decision/engine.ts`, `qci/coordinator.ts` | Single authoritative decision engine; prevent bypass of failed mandatory evidence gates |
| Probability calibration | `server/src/ditas/calibration.ts` | Brier/log loss/ECE-style cohort evaluation; link validated prospective labels and governed models |
| Portfolio and risk | `server/src/risk/gate.ts`, `portfolio/ledger.ts` | Deterministic fail-closed controls, correlation/size/loss safeguards; add tail stress without loosening caps |
| Paper execution | `server/src/exec/oms.ts` | Simulated execution, accounting and protection; preserve exactly one OMS/ledger authority |
| Solana DEX safety | `server/src/safety/safety.ts`, `market/fabric.ts` | Heuristic DEX intelligence only; add verified provider adapters and Token-2022 checks |
| Trader Joe | `server/src/joe/joe.ts` | Existing assistant; explanation/alerts only, no autonomous sign/withdraw permission |
| Modes and live release | `server/src/core/mode.ts`, `qa/gates.ts` | OBSERVE/PAPER/APPROVAL/locked BOUNDED_LIVE; leave actual live execution disabled pending certification |

### Most important confirmed gaps

**P0-A: Strategy certification.** The existing paper-promotion lifecycle can accept a stored backtest without a robust independent OOS positive-edge certificate. Make the hard gate require valid reviewed evidence and sample/uncertainty checks; reuse `strategyWalkforward` rather than implementing another backtester.

**P0-B: Decision certification enforcement.** Any mandatory statistical or strategy-performance failure must create an explicit `DENY` before OMS, regardless of QCI agreement or Trader Joe interpretation.

**P0-C: Calibrated prediction.** Do not rename consensus scores as trading success probabilities. Train/evaluate outcome-specific models on settled, point-in-time cohorts; abstain when calibration sample size is insufficient.

**P0-D: Solana provider truth.** Mint/freeze/Token-2022 authority, liquidity resilience, exit-route simulation, holder concentration and quote expiry require real provenance-backed Solana RPC and quote integrations; unavailable critical evidence must deny automation.

## 3. PR #58: integration already completed, and what is not completed

**Pull request:** https://github.com/Naokiri5/naokiri/pull/58  
**Branch:** `feat/quant-unified-existing-core`  
**Status at verification:** OPEN, DRAFT, UNMERGED. Seven commits ahead of baseline `main`; no base drift at inspection.  
**CI:** https://github.com/Naokiri5/naokiri/actions/runs/44655902028 — completed **successfully**, including typecheck/unit-and-integration/audit/secret-scan job and Playwright browser job.

The PR updates exactly six existing/new paths:

| Changed path | Purpose |
|---|---|
| `server/src/features/indicators.ts` | Adds descriptive 20-return mean, population skewness and excess kurtosis to **existing** FeatureEngine |
| `server/test/features.test.ts` | Adds warm-up, skewness, flat-history and deterministic ingestion tests |
| `docs/REQUIREMENTS_TRACEABILITY.md` | Appends full 100-requirement master to existing Parts 1–33 requirements; records module ownership corrections |
| `docs/engineering/QUANT_FEATURE_CATALOG.json` | Machine-readable 100-ID catalog with existing owner-module maps and evidence exceptions |
| `CLAUDE.md` | Sends Claude/Codex to the canonical requirements and existing source owners |
| `docs/CLAUDE_CODE_WORKFLOW.md` | Documents low-token one-feature-at-a-time task workflow |

**Verification boundaries:** Successful CI is evidence the PR passed its configured build/test workflow. It is **not** a complete runtime or profitability certification. PR #58 does **not** implement all 100 enhancements, build a new live venue adapter or activate real-money trading. Do not merge the draft without owner review.

## 4. Shared DEMO/PAPER and future LIVE design requirements

One shared **market data truth → canonical FeatureEngine → specialist evidence → QCI → single decision engine → deterministic risk gate → unified order intent** must serve both modes. PAPER and LIVE may differ **only downstream of shared evaluation** in order routing, actual fills, secure key custody and additional live permissions. Any new risk rule must apply equally to paper and live, and live is permitted to be *more restrictive*, never less restrictive.

| Layer | PAPER / DEMO | Future authorized LIVE | Parity rule |
|---|---|---|---|
| Trusted data, timestamps and features | Real observed feeds; simulated actions | Same validated observed feeds | Same input snapshot and algorithm/version |
| Strategy, QCI and calibrated models | Shared evaluation | Shared evaluation | Identical pretrade evidence and scoring |
| Independent policy and sizing | Shared fail-closed risk gate | Same gate plus additional release authorizations | A failure must reject in both modes |
| OMS contract and audit | Paper book-walk simulation and synthetic fill journal | Real venue path and independent signer after separate authorization | Comparable intents, distinguish real vs simulated fills |
| Provider errors, liquidity changes, unsafe tokens | `DENY`/`ABSTAIN` | Same `DENY`/`ABSTAIN` | No unsafe fallback in either mode |
| Release gate | Approved paper operation | Remains locked until certified and owner explicitly authorizes | Cannot bypass shared rules |

**Non-negotiable:** Existing code is currently paper-only. This document defines eventual live architecture, **not a command to unlock or secretly add real-money execution**.

## 5. Implementation roadmap and agent handoffs

| Order | Work packet | Existing owners | Acceptance criterion |
|---|---|---|---|
| T01 | Verify numeric indicators and descriptive distribution moments | `features/indicators.ts`, `test/features.test.ts` | Closed candle, warm-up, reference vectors, no-future-data tests |
| T02 | Strategy promotion certification | `lab/lab.ts`, `knowledge/research.ts`, `lab/backtest.ts` | Stored backtest alone never grants paper authority; fail-closed on weak OOS |
| T03 | Enforce mandatory certification in decisions | `decision/engine.ts`, `risk/gate.ts` | All invalid/expired/weak evidence is vetoed before OMS |
| T04 | Calibration, estimates and model registry | `ditas/calibration.ts`, `ditas/service.ts` | Defined target/horizon, testable cohorts, independent settlement |
| T05 | Research robustness | `knowledge/research.ts`, `lab/backtest.ts` | Reuse existing purge/embargo; correct serial dependence/cost assumptions |
| T06 | Chart and QCI quantitative evidence | `chart/analysis.ts`, `qci/coordinator.ts` | Versioned, signed packets; no second vote for the same dependency |
| T07 | Solana provider-backed safety and route feasibility | `market/fabric.ts`, `safety/safety.ts`, providers | Verified sources; no unsafe DEX entry if checks are unavailable |
| T08 | Paper/live invariant certification and incident drills | `risk/gate.ts`, `exec/oms.ts`, `qa/gates.ts` | Frozen evidence same core verdict; live remains locked without owner sign-off |

### Low-token Claude/Codex execution contract

1. Read only `CLAUDE.md`, one `MIA-Q###` catalog record, relevant owner files and their direct tests.
2. Before coding, report `REUSE`, `EXTEND`, `BLOCKED`, or `UNVERIFIED` with exact evidence. Do **not** copy old standalone `src/*.ts` files into this repository.
3. Implement one vertical slice per PR increment; add no duplicate worker, feature engine, risk gate or trade router.
4. Require tests for mathematical references, historical causality, paper/live core parity, failed trade attempts and no-change invariants.
5. Document SHA, exact tests run, CI result, residual risk and rollback path. Do not declare a model profitable without independently reproduced OOS/live evidence.

### Minimal reusable agent task prompt

```text
MIA enhancement task: MIA-Q### — <feature name>.
Use repo Naokiri5/naokiri, current draft branch only.
Read CLAUDE.md, docs/engineering/QUANT_FEATURE_CATALOG.json
for this ID, and the existing owner paths/tests only.
Map call sites; REUSE or EXTEND current code; never create a
parallel FeatureEngine, research lab, QCI, risk engine or OMS.
Shared PAPER/LIVE pretrade math and risk are mandatory; real LIVE
execution is locked and must stay locked.
Add deterministic negative tests and document exact results.
Output: small diff, traceability update, verification, remaining gaps.
Do not merge main or alter owner-approved risk limits.
```

---

## 6. Preserved original feature specification (100 IDs, corrected integration context)

The following is the supplied master specification **with only the code-evidence corrections documented above**. Original feature names, descriptions, priorities, baseline labels and category groupings remain intact. Section numbering below follows the uploaded source.

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

## Original baseline inventory (integrated above)

The complete baseline inventory has been reconciled into Section 2; previously understated walk-forward work is described there. Original module ownership, component responsibilities and improvement targets are all retained in the integrated audit table.

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

P0 = mandatory correctness, data, risk, certification and mode parity; P1 = high-value feature expansion; P2 = research ideas contingent on demonstrated incremental value. `BASE_EXISTS` means some related implementation was observed, not that it is production-complete. `NEEDS_EXTERNAL_FEED` explicitly means a provider/credential/certification is required. **All 100 requirements are preserved below and in repository `docs/engineering/QUANT_FEATURE_CATALOG.json`.** The earlier `catalog/FEATURE_CATALOG.json` and `src/catalog.ts` are standalone-kit files, not canonical repository modules.

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

The entire master is *not* a daily agent prompt. In the repository, see `CLAUDE.md` and `docs/CLAUDE_CODE_WORKFLOW.md`. The standalone kit also includes `agent_instructions/QUICK_CONTEXT.md`, `docs/TASK_CARDS.md` and `docs/LOW_TOKEN_WORKFLOW.md`; those are not assumed to be installed in GitHub. Tell Codex/Claude one task ID and two or three exact source paths; let them inspect only relevant code. Reuse the repo's existing `CLAUDE.md` without overwriting. Keep a minimal feature manifest and provenance logs, not giant conversation dumps. Every task produces a diff summary, test evidence, parity result and next task ID.

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

## Historical standalone reference-kit index (not installed as parallel MIA modules)

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
- `docs/REPO_FILE_MAP.md` — exact integration targets in user repo.
- `docs/TASK_CARDS.md` — bounded implementation sequence for Claude and Codex.
- `docs/LOW_TOKEN_WORKFLOW.md` — prompt/context cost control.
- `agent_instructions/QUICK_CONTEXT.md` — context summary for both agents.
- `agent_instructions/CODEX_PROMPT.md` / `CLAUDE_PROMPT.md` — short prompts.

**Source-history clarification:** The original standalone package did not modify the repository. The later, separately reviewed **draft PR #58** does change the existing indicator engine, relevant tests and repository documentation. PR #58 is not merged and does not unlock live trading. This section preserves original package filenames for traceability only.

---

## 7. Final status and approval boundary

**Delivery status:** Unified specification published as a portable Markdown and Word document; the GitHub baseline is the open draft PR #58. The document is not an instruction to remove existing files, merge the PR, unlock live trading or treat all 100 requirements as implemented. New changes must be tested in existing owners, reconciled with `docs/REQUIREMENTS_TRACEABILITY.md`, and reviewed before release.

**Verified evidence:** owner-uploaded 100-feature JSON and master Markdown; inspected GitHub source tree on `main`; inspected PR #58 and its successful GitHub Actions workflow. No claim of current trading accuracy, live order fill performance or audited profitability is made.
