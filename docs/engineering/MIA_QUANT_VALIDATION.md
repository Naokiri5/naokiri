# MIA quantitative intelligence — Unified integration and verification

**Canonical enhancement document for the MIA-Q001…MIA-Q100 catalog.** Updated 2026-11-20. Baseline for proposed changes: `claude/mia-unified-01` (open PR #45), **not** the older `main` branch. This updates the existing quantitative document and preserves the original validation evidence and uploaded master source rather than creating another trading engine.

## How to interpret completion

- `EXISTING_SUBSET` means source code for a related function exists; it does **not** mean the complete feature is certified or profitable.
- `IN_OPEN_PR_NOT_IN_BASE` means a dedicated PR already implements part of the idea. Do not copy it into this branch; coordinate the PR integration order.
- `DESIGN_PARITY_ONLY` means paper/live must share analysis and risk rules in the future; **live execution is still locked**.
- All uploaded 100-feature descriptions, IDs, original baseline labels and priorities are preserved in [the machine catalog](MIA_QUANT_FEATURE_CATALOG_100.json). The `repoReconciliation` object is additional versioned evidence, never a retroactive rewrite of the uploaded source.
- The original Word document duplicates the Markdown blueprint; Markdown is the source of truth for agent development because it is diffable, and the DOCX is retained by the owner as a reading copy.

## Existing MIA modules that must be reused

| Owner | Source files | What must not be duplicated |
|---|---|---|
| Market truth | `server/src/market/{fabric,quality,store,depthStream}.ts` | No second event scanner, price store or data-quality gate |
| Math and charts | `server/src/features/indicators.ts`, `server/src/chart/{analysis,replay}.ts` | No competing FeatureEngine or chart-to-trade engine |
| Strategy research | `server/src/lab/{backtest,lab,strategies,exits}.ts`, `server/src/knowledge/research.ts` | Extend existing lab; Academy already has embargoed walk-forward research |
| QCI and models | `server/src/workers/**`, `server/src/qci/**`, `server/src/ditas/{calibration,memory,twin}.ts` | No second coordinator, ledger or probability-as-score conversion |
| Authority | `server/src/decision/engine.ts`, `server/src/risk/gate.ts`, `server/src/core/mode.ts` | One decision/risk policy, no model-controlled live permission |
| Execution | `server/src/exec/oms.ts`, `server/src/portfolio/ledger.ts` | Existing paper accounting/exit semantics remain authoritative |
| Solana stacked work | PR #46 → #50 → #51 → #52 | Cherry-pick or merge in reviewed order; no duplicate RPC/token/pool implementation |
| B-MIND stacked work | PR #55 → #56 | B-MIND 32-construct research foundation exists in later PR, not in integration base; read-only and not a trading vote |

## Specific corrections to the uploaded main-branch-only baseline

1. PAPER promotion: `server/src/lab/lab.ts` in the unified branch already requires ≥30 out-of-sample trades and positive expectancy, **or an audited owner override**. This is better than the old main-branch behavior; do not implement a duplicate promotion registry. A future improvement is reducing exceptional overrides through a formal certification review, not silently removing the owner override.
2. Advanced indicator research: `FeatureEngine.research` already supports WMA, HMA, Keltner, Ichimoku, Parabolic SAR and OHLC volatility. Validate indicator warm-up and formulas instead of adding competing indicator libraries directly to the decision path.
3. Walk-forward research with embargo already exists in Academy; generic backtester still lacks a fully certified rolling/OOS model-promotion pathway. Reuse shared strategy definitions and record separate research-vs-production coverage.
4. DITAS calibration exists but no validated production win-probability model is established. Scores and worker-vote ratios remain **NOT PROBABILITIES**.
5. Solana read-only token checks and Pump.fun events are staged in Omega PRs, not yet integrated in the baseline. Live Solana route simulation/execution and permission hardening remain separate blocked work.
6. The existing rules and `CLAUDE.md` prohibit adding a live execution route today. Paper/live **feature parity is a future contract**, not an excuse to unlock live transactions in this change.

## Shared paper/live intelligence design

```text
Normalized, timestamped real observations (CEX / DEX / licensed sources)
  -> Existing data-quality and FeatureEngine + chart/DITAS evidence
  -> Existing workers + QCI challenger (no double counting)
  -> Existing Decision Engine (versioned evidence, abstention, uncertainty)
  -> Independent deterministic Risk Gate (same checks and policy version)
  -> Validated OrderIntent and approved-venue permission
       PAPER -> existing OMS, simulated fills explicitly labeled
       LIVE  -> unavailable until separately reviewed certification and isolated signer
  -> One journal/evaluation contract with mode-specific execution facts
```

**Parity invariants:** same frozen observation, features, strategy, model, policy, calibration and QCI evidence must give the same core verdict in PAPER and LIVE; venue authorization can further deny LIVE. Paper simulated fills need not equal exchange fills. Every new catalog feature gets at least one mode-invariance test, no-look-ahead test, missing-input test and deterministic risk-veto test. There must not be a demo-only version of an analytical feature.

## Token-efficient Claude/Codex workflow

Read in order: `AGENTS.md` (when merged), `CLAUDE.md`, `docs/mia5/MIA5_CLAUDE_CODEX_JOINT_DECISIONS.md` (on PR #55+), **this single master**, and only the selected `MIA-Qxxx` entry from `MIA_QUANT_FEATURE_CATALOG_100.json`. For each task, read just the catalog's mapped owner files and their tests. Do not paste the 100-feature catalog into every prompt. Use one accountable owner per PR; leave other agents as read-only reviewers.

Suggested small slices: indicator warm-up/regressions; deterministic strategy-certification analysis; outcome-source provenance; proper walk-forward integration; shared frozen-input parity fixtures; read-only Solana event integrity. Each requires a specific failing regression, typecheck and test evidence. **Do not claim tests passed unless run and reported.**

## Previous quantitative validation, preserved

# MIA quantitative validation — 2026-11-18

All checks ran offline against synthetic or seeded data. No profitability claim is made: the strategies remain research and paper candidates.

## Indicators (Squad C)
Independent reference implementations compared with the incremental FeatureEngine:
- 20 random-walk series, checked at prefixes and at every bar from 260 on;
- chunked versus batch ingest;
- reversed and duplicate input.

**Result:** maximum absolute error **0**, across 48 snapshot fields, for:
- EMA 9/20/50/200, MACD 12/26/9, RSI14, ATR14, +DI/−DI/ADX14;
- Bollinger 20/2, Stoch %K, Williams %R, CCI20, MFI14;
- OBV, VWAP20, realized vol 20, Donchian 20, ROC10.

Open: C-05, no warm-up guard on windowed features (values from 2–3 bars).

## Paper accounting (Squad E)
Scenario: deposit 10,000; book walk 2/3/0.7536 at about 233; T1 50%; trail to breakeven; trailing-stop exit.

**Result:** every quantity matched a hand calculation to within **2e-12 USD**:
- gate quantity 5.7536 and entry fill 233.10607491;
- fees 2.71368829;
- realized PnL 28.57637467;
- final cash = equity = 10,028.57637467;
- reconcile Δ 4.3e-14.

**Fee drift:** 4,426 partial exits → realized −4.63293819 against hand −4.63293819 (Δ 2.4e-13).

**Edge proposals:** each was denied by the gate (stop above price, zero stop, negative or NaN entry, cost-R above maximum).

## Backtester (Squad F)
- **No look-ahead:** 125 trades over full versus prefix runs, 0 mismatches. Entries fill at the next open × (1 + slip).
- **Same-bar stop and target:** the stop is assumed first (conservative). A gap through the stop fills at the open × (1 − slip).
- **Metrics:** hand versus code agree for win rate, expectancy, profit factor, max drawdown (additive and compounded), CAGR, Sharpe and Sortino (annualised).
- **Walk-forward** (research): non-overlapping windows with a 24-bar embargo; a supported verdict needs ≥ 30 trades and a CI lower bound > 0.
- **Monte Carlo:** seeded and reproducible.

**Promotion:**
- Never automatic, and LIVE_CANDIDATE is hard-blocked.
- PAPER now needs ≥ 30 out-of-sample trades with positive expectancy, or an audited owner OVERRIDE (F-01, fixed).

**Open:**
- F-02: the trial count is not tracked.
- F-03: TIME exits are not slipped.
- F-04: the closed-candle cutoff time.
- F-05: no contiguity check.
- F-06: no uncertainty shown in the Lab.
- F-07: Sharpe uses the population SD.

## Calibration (Squad G)
Brier score, log loss (eps 1e-15) and ECE matched hand calculations in 5 cases, including the clipping case. NaN probabilities are rejected.

Open:
- G-05: outcomes are owner-reported and not verified against candles.
- G-06: bin boundary error at 100 bins.

## Strategy edge
Not demonstrated. No walk-forward run on real data was performed in this offline session. Strategies stay research or paper candidates; see `docs/engineering/BLUEPRINT_STATUS.md` and the Academy walk-forward experiment.


---

## Owner-supplied Quantitative Intelligence Master Specification — fully preserved implementation reference

> **Historical baseline warning:** The text below is the uploaded November 20 blueprint based predominantly on older main. The branch-aware reconciliation above and current source/tests override its implementation-status assumptions, not its feature requirements. All 100 features and policy requirements remain intended enhancement goals.

# MIA AI — Unified Quantitative Intelligence & Trading Parity Master Specification

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
| `server/src/lab/backtest.ts` | IS/OOS split, next-bar entry, fees, spread, slippage, R results, Monte Carlo | No rolling walk-forward, robust fill queues, block dependence or comprehensive OOS evidence |
| `server/src/ditas/calibration.ts` | Brier, log loss, ECE, Wilson intervals on settled binary cohorts | Needs verified observed outcomes, prospective forecasts, trained model registry |
| `server/src/qci/coordinator.ts` | Signed packets, quorum, capped dependency votes, vetoes | Fixed thresholds, uncalibrated; preserve rather than duplicate |
| `server/src/decision/scoring.ts` | Transparent fixed weighted scores, missing-value penalty | Research weights only; do not convert score to probability |
| `server/src/decision/engine.ts` | Central authority, signed QCI, independent risk and paper path | Make failed mandatory statistical gates deterministically block entry |
| `server/src/lab/lab.ts` | Owner-controlled strategy lifecycle | Paper promotion currently only requires saved backtest; require durable certification |
| `server/src/safety/safety.ts` | CEX risk + DEX heuristic flags | DEX cannot be auto-eligible; no validated SPL/Token-2022 security provider |
| `server/src/risk/gate.ts` | Loss limits, sizing, correlation, cost, freshness, pause and incidents | Extend stress/tail risk without relaxing hard limits |
| `server/src/market/fabric.ts` | Binance spot REST polling, cross venue, data fabric | Add authorized event streams and venue-specific integrity checks |
| `server/src/core/mode.ts` | OBSERVE/PAPER/APPROVAL/BOUNDED_LIVE controls | Preserve live lock until release certification |

Historic repository docs report 3 strategies losing money OOS on very small samples. These results are *not* proof of edge. Source review does not certify runtime performance. See `docs/REPO_FILE_MAP.md` for exact file/feature references.

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

P0 = mandatory correctness, data, risk, certification and mode parity; P1 = high-value feature expansion; P2 = research ideas contingent on demonstrated incremental value. `BASE_EXISTS` means some related implementation was observed, not that it is production-complete. `NEEDS_EXTERNAL_FEED` explicitly means a provider/credential/certification is required. **All 100 requirements are preserved in catalog/FEATURE_CATALOG.json, in src/catalog.ts and below.**

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

## Full code-package index

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

**Status statement:** The delivered package does not claim to have merged or changed Naokiri5/naokiri. It does not unlock live trading. Source-code references are based on a read-only inspection of the repository as available for this task.
