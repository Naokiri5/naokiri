# THINK baseline: 2026-11-18

These are measured results, not targets.

- **Command:** `MIA_OFFLINE=1 MIA_DATA_DIR=$(mktemp -d) node --import tsx scripts/benchmark-think.mjs`
- **Machine:** Intel Xeon @ 2.30 GHz, 4 cores, Node v22.23.4, Linux (cloud dev container, shared CPU).
- **Data:** 8 synthetic seeded instruments (`server/test/helpers.ts` `seedInstrument`), in-memory and warmed.
- **Runs:** 200 measured after 20 warm-up runs.

## Compute-only latency of the existing pipeline (ms)

| Stage | p50 | p95 | p99 |
|---|---|---|---|
| `buildContext` | 0.47 | 0.65 | 1.56 |
| `runConsensus` (100 workers + QCI, includes SQLite write) | 4.93 | 7.21 | 10.00 |
| `decide` (includes SQLite write + DITAS memory) | 3.91 | 6.22 | 7.56 |
| `buildCertificate` (THINK, read + derive) | 0.57 | 0.81 | 1.28 |
| **Total per candidate** | **10.22** | **13.65** | **17.08** |

- **Worker failure rate:** 0%.
- **Worker abstention rate:** 18.6%. 94 of 100 workers are eligible on CEX spot; the 6 on-chain workers don't apply.
- **Consensus states:** 200 × STRONG_CONSENSUS.

## What this does NOT show

- **Not real-market behaviour.** Every synthetic fixture reached STRONG_CONSENSUS, so the fixtures are too uniform to represent real markets, where MIXED, NO_QUORUM and VETOED are common. A recorded-snapshot replay benchmark (MIA-THINK-075) is still missing.
- **Excludes everything outside this process:** network, provider latency, ingestion lag, HTTP, Trader Joe/LLM and OMS. End-to-end latency is not measured here (MIA-THINK-020 stays PARTIAL).
- **No trading-quality metrics.** Strategy expectancy, drawdown and calibration need settled out-of-sample paper outcomes. None qualify yet: DITAS calibration reports `UNCALIBRATED` below 100 settled forecasts. **No win rate or profitability is claimed.**
- **No load-isolation test.** Single process, one candidate at a time: no cross-core contention, no 10k-candidate load and no Guardian-priority test (MIA-THINK-014/019).

## Update (slice 4): offline evidence replay

The benchmark now also replays every recorded decision from its DITAS snapshot. Replay is timed separately and is not part of "Total".

| Stage | p50 | p95 | p99 |
|---|---|---|---|
| `replayDecision` (verify snapshot hash, rebuild context, 94 workers, aggregate, compare) | 1.89 | 2.38 | 3.68 |

**Reproducibility: 200 / 200 decisions REPRODUCED** (identical domain counts, scores, weighted support/opposition and vetoes). This run's pipeline totals: p50 10.18, p95 14.23, p99 19.11 ms.

Same caveats as above: these are synthetic fixtures, and every one reached STRONG_CONSENSUS.
