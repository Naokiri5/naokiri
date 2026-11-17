# Global Chart Intelligence — repository audit

Audit date: 2026-11-17. Baseline: d7c6b0b725682d1fff6fc3bb96b925d23984d97e.
Source: owner-supplied MIA 4.1 feature brief. This audit distinguishes baseline capability from this increment. No AGENTS.md or CLAUDE.md was present at baseline.

## Architecture to preserve

TypeScript throughout; Node >=22.13, Fastify REST/SSE, React/Vite/lightweight-charts, node:sqlite/WAL. MarketStore is an in-memory cache; SQLite stores decisions, QCI evidence, lab results, journal and portfolio. Providers use the existing HTTP health/rate-control layer. Trader Joe uses Anthropic; deterministic workers are not LLM specialists.

| Component | Existing source | Baseline finding |
|---|---|---|
| Scanner/discovery | server/src/market/{scanner,discover,fabric,store}.ts | IMPLEMENTED for Binance spot; other markets PARTIAL/BLOCKED |
| Indicators | server/src/features/indicators.ts | PARTIAL: EMA, RSI, MACD, ATR, ADX, bands, stochastic, OBV, MFI, ROC, rolling VWAP; incomplete warm-up/reference coverage |
| Structure/candles | features/indicators.ts; workers/registry.ts | PARTIAL: rolling extrema/worker heuristics; missing dedicated detection schema and confirmed-pivot chart report |
| Multi-timeframe | market/types.ts; workers/indicators.ts | PARTIAL: 15m/1h/4h only; no full requested nine-timeframe report |
| Volume/order flow | market/quality.ts; providers/binance.ts; whales/prints.ts | PARTIAL: observed book/prints/taker volume; no historical depth/absorption validation |
| Fundamentals | providers/coingecko.ts; workers/registry.ts | PARTIAL crypto metadata; stock/FX/commodity fundamental histories MISSING/BLOCKED |
| News | news/news.ts; providers/googlenews.ts | PARTIAL RSS/source context; macro event feed MISSING |
| QCI/AI | qci/{coordinator,challenge,schemas}.ts; workers/{runtime,registry}.ts | IMPLEMENTED deterministic dependency-capped evidence/quorum; model specialist layer MISSING |
| Decision/risk | decision/engine.ts; risk/{gate,policy}.ts | IMPLEMENTED central decision and independent deterministic veto; full new specification remains PARTIAL |
| OMS/portfolio | exec/oms.ts; portfolio/{ledger,correlation,calendar}.ts | IMPLEMENTED paper path; live path BLOCKED by release gate |
| Strategy lab | lab/{lab,strategies,backtest,exits}.ts | PARTIAL: 3 strategies, chronological IS/OOS, costs, conservative fills; rolling walk-forward MISSING |
| Learning | journal/; lab/lab.ts; db/migrations.ts | PARTIAL outcome records/decay suspension; calibration and validated model promotion MISSING |
| Research knowledge | no dedicated module | MISSING source registry, provenance ingestion and hypothesis lifecycle |
| Replay | lab/backtest.ts | PARTIAL point-in-time backtest; interactive chart replay MISSING |
| Dashboard | web/src/pages/{Markets,Intel,Trading}.tsx | PARTIAL existing terminal/indicator/QCI/risk/lab views |
| Performance | core/latency.ts; qhef/qhef.ts | IMPLEMENTED histograms/bounded workers; chart benchmark MISSING at baseline |

MOCKED: synthetic data appears in explicit test fixtures, not production feeds. BROKEN: no confirmed runtime defect assigned from code reading alone. Dependency installation and tests are recorded separately rather than inferred from documentation.

## Missing integrations and evidence

Licensed stock/index/commodity feeds, tradeable FX, point-in-time financial statements, macro calendars, licensed research sources and historical order books are not connected. Existing pending provider registry: server/src/providers/pending.ts. Anthropic conversational use depends on configured credentials. No fabricated substitute data is permitted.

Known limitations include uncalibrated scores, small/negative historical OOS samples, polling latency and current-universe survivorship bias. Chart rule scores must not be marketed as win probabilities. This change does not certify trading performance.

## Reuse and increment boundary

Reuse MarketStore closed candles, instrument REST endpoint, terminal, interval definitions, authentication and CSRF. Add pure chart analysis and a bounded prefix-replay API. No new scanner, strategy engine, OMS, ledger or risk service. The report is explanatory only and always states NO TRADE; it does not vote in QCI or change decisions. Remaining phases are explicitly planned in IMPLEMENTATION_STATUS.md.
