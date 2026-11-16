# Requirements Traceability (Parts 21.1 / 28.5)

Status legend: **DONE** = workflow works and is tested · **PARTIAL** = works with stated limits · **PENDING** = needs
credentials/licences (adapter registered, no fake data) · **LOCKED** = intentionally disabled by release gates.

| Part | Requirement | Implementation | Tests | Status |
|---|---|---|---|---|
| 1 | Universal scanner, opportunity selection & scoring | `market/fabric.ts`, `market/scanner.ts`, `decision/scoring.ts` | qci, api | DONE (crypto), PENDING (stocks, commodities) |
| 2 | Honeypot / low-liquidity / manipulation, 5 safety classes | `safety/safety.ts` | qci (veto) | PARTIAL: CEX checks done; DEX heuristics only, contract/sell simulation PENDING (RPC) |
| 3 | 100 cooperative workers, monitoring | `workers/registry.ts`, `workers/runtime.ts` | qci (all 100) | DONE: deterministic evaluators, not LLM agents |
| 4 | Whale tracking & copy trading | `whales/prints.ts` | — | PARTIAL: CEX large prints; wallet tracking/copy trading PENDING |
| 5 | Trader Joe | `joe/joe.ts` | api (authority) | PARTIAL: command mode done; LLM mode needs API key |
| 6 | News, heads-up, event risk | `news/news.ts`, macro worker | quality (RSS) | PARTIAL: lexicon classifier; economic calendar PENDING |
| 7 | Portfolio tracker | `portfolio/*`, Portfolio page | oms | PARTIAL: paper account; external wallets/exchanges PENDING |
| 8 | Central decision engine, 7 states, explanation | `decision/engine.ts` | qci, oms | DONE |
| 9 | Autonomy levels & permissions | `core/mode.ts`, risk gate | risk, api | DONE (Level 4 LOCKED) |
| 10/15/28.1 | Navigation, shell, mode badge, stale banners, 19 workspaces | `web/src` | Playwright run (20 routes, 0 console errors) | DONE |
| 11/18 | Regime, multi-TF, strategy lab, Monte Carlo, decay detection | `regime/`, `lab/` | lab | DONE (Historical replay = backtester) |
| 12/21 | QA registry, release gates | `qa/gates.ts`, tests | api | DONE (manual gates NOT_CERTIFIED) |
| 13.1 | 50 indicator specialists | `workers/indicators.ts` | api | DONE |
| 13.2/13.3 | Telegram launch intel, notifications | `notify/notify.ts` | — | PARTIAL: in-app done; Telegram needs token |
| 16 | Opportunity scoring, adversarial analyst, rejection intel | `decision/scoring.ts`, `qci/challenge.ts`, scanner rejections | qci | DONE (weights NOT calibrated) |
| 17 | Deterministic risk engine, sizing, stops, breakers, emergency semantics | `risk/`, `exec/oms.ts`, `lab/exits.ts` | risk, oms, lab | DONE |
| 19 | Portfolio correlation / allocation | `portfolio/correlation.ts`, risk gate | risk | PARTIAL: correlation limits; optimizer not built |
| 20 | Journal, autopsy, metrics | `journal/`, `exec/oms.ts#autopsy` | oms | DONE |
| 23 | X & Telegram account integration | Connections Hub | — | PENDING |
| 24 | Wallet center, address book, withdrawal flow, freeze | `wallet/` | wallet | PARTIAL: validation/preview/freeze; submission LOCKED |
| 25 | Bubble maps, breadth; holder map | `market/bubbles.ts` | api | PARTIAL: market map done; holder map PENDING |
| 26 | Funded bot, modes, lifecycle | `bot/bot.ts`, `exec/oms.ts` | oms, live | DONE (paper) |
| 27 | Profit calendar & reconciliation | `portfolio/calendar.ts` | oms | DONE |
| 29/31/32.9 | QCI evidence packets, challenge panel, quorum states, integrity | `qci/` | qci | DONE (HMAC, schema, replay, scope) |
| 32 | Data quality, execution costs, safety supervisor, model ops | `market/quality.ts`, risk gate, strategy health | quality, risk | PARTIAL |
| 33 | QHEF: incremental features, tiered scan, selective QCI, latency tracing | `features/`, `fabric.ts`, `runtime.ts#isApplicable`, `core/latency.ts` | features | DONE (baseline in 05) |
