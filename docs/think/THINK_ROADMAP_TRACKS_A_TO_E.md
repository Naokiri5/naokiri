# THINK tracks A–E (master prompt step 5): status

Each track has one canonical owner and ships as small, reviewed draft PRs. Status as of 2026-11-18.

| Track | Owner module | Delivered | Remaining |
|---|---|---|---|
| **A: event provenance / snapshots** | `ditas/memory.ts`, `ditas/replay.ts` | Content-addressed snapshots and a hash-chained event log (existing). **Slice 4:** evidence replay from frozen snapshots with hash verification and a recorded evaluation clock; 200/200 benchmark decisions REPRODUCED. | Canonical cross-venue identity (001); source-lineage counts (006); durable ingestion cursors (076). |
| **B: bounded task scheduling and benchmarks** | `workers/runtime.ts`, `scripts/benchmark-think.mjs` | Bounded pool and applicability task graph (existing). **Slice 1/4:** compute-only benchmark, including replay. | Recorded real-market snapshot benchmark; Guardian priority under load (014/019); end-to-end latency (020). |
| **C: independent evidence / challenge** | `qci/coordinator.ts`, `qci/challenge.ts` | Dependency-group caps, mandatory checks and the challenge panel (existing). **Slice 2:** fault injection and import boundaries. | Horizon-conflict check (037); bounded challenge rounds proof (039). |
| **D: calibrated scenario / expected net return** | `decision/certificate.ts`, `decision/profitLab.ts`, `ditas/calibration.ts` | **Slice 1:** certificate, scenarios, stress, expectancy rules (`NO_VALID_FORECAST` without a cohort). **Slice 3:** risk-gate sizing and correlation invariants. | A calibrated forecast cohort, which needs ≥ 100 settled out-of-sample paper outcomes; volatility-scaled budget (052, review required). |
| **E: offline replay and transparent UI** | `web/src/pages/ThinkCertificate.tsx`, `StatusRibbon.tsx` | **Slices 1/4:** Certificate tab with NO_TRADE reasons, scenarios and evidence replay status; offline/reconnect runbook. | OFFLINE_REPLAY / VENUE_UNKNOWN badges (080); gap backfill gate (077). |
