# Chart analysis performance benchmark

Measured 2026-11-17 on the task's shared Linux workspace, Node v24.22.1.
Command: `node --import tsx scripts/benchmark-chart.mjs`.

400 synthetic closed candles, 200 warm-up calls, 2000 measured calls:

| Quantile | Analysis time (ms) |
|---|---:|
| p50 | 0.0135 |
| p95 | 0.0672 |
| p99 | 0.1310 |

Pure single-process calculation only. Excludes HTTP, providers, database, model calls, QCI, execution and browser rendering. This is a reproducible microbenchmark, not a production SLO, load/recovery test or trading-performance result. Shared-host scheduling and JIT/GC affect repeat measurements.

Work is linear in the supplied candle window; live analysis reuses the existing bounded 400-bar cache. Replay is capped at 2000 bars per request. No new workers, timers, API subscriptions or model calls were added. Incremental chart-state caching is deferred until load measurements justify it. Existing core/latency.ts provides broader application histograms; full certification remains pending.
