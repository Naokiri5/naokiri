# MIA live-readiness repair register

This register maps all 50 findings in the November 22, 2026 live-trading audit to their canonical owners and acceptance evidence. The code baseline is `main@dc6bc1b`. MIA's autonomy target is a supervised progression from reproducible research to automated PAPER operation, followed by independently certified, explicitly authorized bounded LIVE execution. The existing decision, risk, OMS, ledger, and release-gate services own that progression. [Existing DEMO/LIVE integration record](MIA_DEMO_LIVE_INTEGRATION.md)

**Foundation** identifies a narrowly scoped change in this work. **Existing** identifies behavior or evidence already on the baseline. **Unmerged** identifies related branch work. **Open** identifies engineering or evidence still required. A focused test supports the behavior it exercises. Venue, operating, and release claims require the corresponding external or prospective evidence.

## Execution lifecycle and account isolation

One order lifecycle should own intent, protection, fills, uncertain outcomes, and account attribution. The parity contract is exercised through mocked ports. The durable store and venue transport are separate prerequisites for production integration. [Paper OMS](../../server/src/exec/oms.ts) · [Parity contract](../../server/src/exec/demoLiveParity.ts) · [Ledger](../../server/src/portfolio/ledger.ts) · [Readiness and venue-state draft #97](https://github.com/Naokiri5/naokiri/pull/97)

| Audit | Canonical owner | Progress and acceptance evidence |
| --- | --- | --- |
| 1 | OMS and venue ports | **Open.** Certify one venue adapter against account permissions, venue order IDs, and integration tests. |
| 2 | Signing boundary and release gates | **Open.** Certify an isolated, trade-scoped signer with per-order policy, disabled withdrawals, and rotation procedures. |
| 3 | Mode and release gates | **Existing.** LIVE is locked. Activation requires build-specific G01–G14 evidence, independent approval, and explicit owner authorization. |
| 4 | Parity contract and OMS | **Foundation.** Harden final risk, control, and expiry checks in the unwired contract. Production wiring requires durable reservation and reconciliation. |
| 5 | OMS and database | **Open.** Persist an account-scoped order intent and stable client order ID before submission. Test crashes before and after submission. |
| 6 | Parity contract and venue reconciliation | **Foundation.** Ambiguous or malformed receipts enter `UNKNOWN` in the contract. Durable recovery still needs an authenticated venue lookup by original client order ID. |
| 7 | OMS and venue state | **Unmerged.** Reuse #97's account-scoped reducer. Prove persisted partial fills, cancellations, rejections, and unknown outcomes across restarts. |
| 8 | OMS protection and venue adapter | **Open.** Verify exchange-accepted stop quantity and status and quarantine entries when protection is unavailable. |
| 9 | Position monitor and venue protection | **Existing.** PAPER relies on the application monitor. LIVE requires native protection as the primary control and tested recovery monitoring. |
| 10 | OMS and ledger | **Open.** Scope orders, fills, positions, reservations, risk budgets, and reconciliation to the same account and environment identity. |

## Risk policy and capital protection

The deterministic risk gate owns entry approval. Extend its policy and ledger inputs as new market capabilities are verified. [Risk gate](../../server/src/risk/gate.ts) · [Risk policy](../../server/src/risk/policy.ts) · [Portfolio ledger](../../server/src/portfolio/ledger.ts)

| Audit | Canonical owner | Progress and acceptance evidence |
| --- | --- | --- |
| 11 | Risk policy | **Existing.** Current approved scope is crypto and `binance-paper`. Extend venue-specific constraints with the applicable market and adapter evidence. |
| 12 | Risk gate and OMS | **Open.** Certify short and derivative sizing, PnL, and protection before allowing those exposures. |
| 13 | Risk gate and execution evidence | **Open.** Calibrate limits against forward paper results, realistic costs, stress cases, and certified venue fills. |
| 14 | Risk gate and Strategy Lab | **Open.** Stress extreme gaps and enforce adverse-fill loss budgets using executable depth assumptions. |
| 15 | Paper OMS and protection incidents | **Open.** Exercise zero bids, halted markets, withdrawn liquidity, partial liquidation, and residual exposure. |
| 16 | Ledger and risk gate | **Open.** Size from reconciled balances, reserves, open orders, positions, and fees for the same venue account. |
| 17 | Risk costs and fill accounting | **Open.** Add verified venue fee schedules and settle against actual fill fees and applicable funding, borrowing, or network costs. |
| 18 | Ledger and portfolio risk | **Open.** Consolidate cross-venue exposure and reserved exposure from unsettled orders. |
| 19 | Portfolio risk and QA | **Open.** Certify correlated outages, concentration, depegs, and liquidity shocks using controlled scenarios. |
| 20 | Risk policy and derivative venue ports | **Open.** Certify margin, liquidation distance, collateral haircuts, maintenance requirements, and emergency reductions before leveraged exposure. |

## Market data, token safety, and whale evidence

Market Fabric owns ingestion and freshness. Token safety and whale research provide evidence to the existing decision and risk flow. [Market Fabric](../../server/src/market/fabric.ts) · [Market quality](../../server/src/market/quality.ts) · [Token safety](../../server/src/safety/safety.ts) · [Whale prints](../../server/src/whales/prints.ts)

| Audit | Canonical owner | Progress and acceptance evidence |
| --- | --- | --- |
| 21 | Market Fabric | **Unmerged.** Reconcile streaming work with the existing poller. Prove sequence-gap rejection, resynchronization, and stale-book behavior. [#18](https://github.com/Naokiri5/naokiri/pull/18) |
| 22 | Market quality and risk gate | **Open.** Define when fresh independent corroboration is mandatory and exercise fail-closed behavior when it is absent. |
| 23 | Provider adapters and instrument metadata | **Unmerged.** Reuse #95's read-only evidence where applicable. Executable stock, FX, and futures require authorized market data and session contracts. [#95](https://github.com/Naokiri5/naokiri/pull/95) |
| 24 | Market instruments | **Open.** Distinguish crypto, tokenized securities, equities, ETFs, and derivatives in canonical metadata. Retest affected symbols. |
| 25 | Token safety | **Open.** Verify EVM permissions, ownership, transfer restrictions, and executable sell behavior from source-linked evidence. |
| 26 | Token safety and Solana RPC | **Unmerged.** Review read-only mint checks and validate freeze authority, Token-2022 extensions, and token-account states before automation. [#50](https://github.com/Naokiri5/naokiri/pull/50) |
| 27 | Token safety and route simulation | **Open.** Exercise current-state sell simulation with quantified taxes, transfer restrictions, and failed routes. |
| 28 | Market Fabric and token safety | **Open.** Verify reserve changes, LP concentration and permissions, and realistic exit liquidity with independent data. |
| 29 | Whale research | **Unmerged.** Validate wallet attribution, cost basis, realized performance, and copy-delay economics before using wallet-derived evidence in decisions. [#109](https://github.com/Naokiri5/naokiri/pull/109) |
| 30 | Risk assessment and position monitor | **Unmerged.** Reconcile the FAST/DEEP evaluator with existing incidents and paper exits. Confirm paper replay, latency, and emergency behavior before wiring. [#111](https://github.com/Naokiri5/naokiri/pull/111) |

## Strategy research, calibration, and learning

Strategy Lab and Academy produce research evidence. QCI aggregates worker evidence, DITAS records observed outcomes, and the existing risk gate retains entry authority. [Backtester](../../server/src/lab/backtest.ts) · [Academy research](../../server/src/knowledge/research.ts) · [QCI coordinator](../../server/src/qci/coordinator.ts) · [DITAS passports](../../server/src/ditas/passports.ts)

| Audit | Canonical owner | Progress and acceptance evidence |
| --- | --- | --- |
| 31 | Strategy Lab and Academy | **Existing.** The archived holdout work identified weak evidence under modeled costs. Require independent walk-forward windows, multiple regimes, and forward paper outcomes. [#108](https://github.com/Naokiri5/naokiri/pull/108) |
| 32 | Strategy Lab and DITAS | **Open.** Collect independent samples by strategy version, market, regime, and execution style before promotion. |
| 33 | QCI and DITAS calibration | **Open.** Calibrate vote thresholds with settled outcomes, ablations, and prospective scoring. |
| 34 | QCI and worker registry | **Open.** Measure correlated and duplicated evidence. Validate any change to effective voting weight against held-out outcomes. |
| 35 | Worker registry and G03 | **Open.** Certify every required domain and provider dependency before counting full worker coverage. |
| 36 | Decision and parity contract | **Foundation.** Verify expiry at the final clock sample in mocked parity tests. Strategy-specific TTLs and real venue cancellation still require evidence. |
| 37 | Strategy Lab and DITAS replay | **Existing.** Replay includes modeled costs and guarded historical inputs. Extend it with tested latency, queue position, partial fills, dynamic spreads, and vanished liquidity. |
| 38 | Academy dataset provenance | **Existing.** Historical inputs are filtered to the frozen cutoff and reports track the fill-model version. Certify source snapshots, publication timestamps, applicable corporate actions, and leakage audits. |
| 39 | DITAS, OMS, and risk gate | **Unmerged.** Review account-scoped, fill-verified closed-trade learning and shadow vetoes through paper replay. [#112](https://github.com/Naokiri5/naokiri/pull/112) · [#113](https://github.com/Naokiri5/naokiri/pull/113) |
| 40 | Strategy health and DITAS | **Foundation.** Strategy Lab, DITAS, and the suspension monitor share a bounded cohort of recent, closed, current-version PAPER outcomes. Test prospective drift, net performance, and controlled promotion separately. |

## Recovery, supervision, and release evidence

The existing lease and backup modules own engine continuity and recovery. G01–G14 remain the release authority. Exact-head CI establishes code and test readiness. Independent sign-off, prospective operation, and credentialed venue tests establish separate release evidence. [Release gates](../../server/src/qa/gates.ts) · [Engine lease](../../server/src/ops/lease.ts) · [Backup implementation](../../server/src/ops/backup.ts)

| Audit | Canonical owner | Progress and acceptance evidence |
| --- | --- | --- |
| 41 | G10 and existing paper supervisor | **Foundation.** Retrospective PAPER activity is reported for context. G10 stays pending until a supervised prospective trial provides at least 30 days and 50 closed paper trades plus performance and drawdown evidence. |
| 42 | Release gates | **Foundation.** G10 now fails closed on absent prospective evidence. The remaining G01–G14 evidence and independent decisions are still required for a specific release. |
| 43 | Canonical modules and PR review | **Open.** Evaluate patches by ownership, dependency order, and exact-head checks. Use #110 for planning and reconcile overlapping changes before integration. [#45](https://github.com/Naokiri5/naokiri/pull/45) · [#110](https://github.com/Naokiri5/naokiri/pull/110) |
| 44 | DITAS CI on its feature branch | **Separate PR.** Corrected the test fixture's expected evidence cohort. CI passed on `39d88c9`. Independent risk review, overlap checks, and paper replay remain release criteria. [#113](https://github.com/Naokiri5/naokiri/pull/113) · [CI evidence](https://github.com/Naokiri5/naokiri/actions/runs/45005984572) |
| 45 | Server supervisor and operations | **Open.** Demonstrate durable storage, persistent compute, reconnects, alerting, supervision, and recovery on the chosen host. |
| 46 | Engine lease, parity contract, and OMS | **Foundation.** Mocked parity checks revalidate the fence before submission. Distributed LIVE still needs a durable reservation and venue reconciliation plus stale-leader proof across processes. |
| 47 | Backup and recovery | **Foundation.** Verify privately before making a snapshot eligible for retention. Off-site encrypted copies, scheduled restore rehearsals, and measured recovery objectives require operational evidence. [Related backup work #14](https://github.com/Naokiri5/naokiri/pull/14) |
| 48 | Evidence-key configuration | **Foundation.** Durable key load or publication failures stop startup. Recovery must establish that the same key verifies historical evidence after restoration. |
| 49 | Backup writer and deployment secrets | **Foundation.** New online/production backups require encryption. Verify key recovery, old-backup compatibility, and retention policy on the production host. |
| 50 | Independent security and release review | **Open.** Obtain independent review of Privy, signing isolation, authorization, provider egress, secret management, and recovery before LIVE release. |
