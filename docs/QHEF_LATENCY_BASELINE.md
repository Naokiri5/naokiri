# QHEF Latency Baseline (Part 33.18 / 22.2)

Measured on the running engine against live providers (build container, REST polling, deep tier = 24 instruments).
Live values are on Connections Hub → Hot-path latency.

| Stage | Samples | p50 ms | p95 ms | p99 ms |
|---|---|---|---|---|
| qci.worker.compute (single worker evaluation) | 94 | 0.02 | 0.05 | 0.08 |
| qci.consensus (94 workers + validation + challenge) | 1 | 14.3 | — | — |
| decision.engine (incl. risk gate) | 1 | 13.6 | — | — |
| pipeline.candidate_to_decision | 1 | 37 | — | — |
| scan.cycle (24 instruments, no candidate) | 2 | 46.6 | — | — |
| features.incremental (per interval update) | 72 | 7.3 | 10.5 | 24.5 |
| oms.submit (paper fill + persistence) | 1 | 1.6 | — | — |
| provider.binance (REST round trip) | 164 | 229 | 1319 | 2338 |
| fabric.book (depth fetch) | 48 | 863 | 1096 | 1404 |
| fabric.tickers (all 24h tickers) | 4 | 1716 | 3163 | 3163 |

## Bottleneck report
1. **Provider round trips dominate** (hundreds of ms to seconds). Internal adjudication is ~40 ms end-to-end.
   Next step: WebSocket market streams (book/trade) once allow-listed. The benchmark shows no need for NATS/Aeron: in-process
   transport is not the constraint.
2. **Fixed:** worker statistics were written to SQLite per packet (~200 writes per candidate). They are now batched off the
   hot path (QCI went from 122 ms to 14 ms).
3. No synchronous LLM calls exist on the trading hot path; Trader Joe is out-of-band.
4. Candles are fetched incrementally only when a new bar can have closed; features update in O(window) per bar.
