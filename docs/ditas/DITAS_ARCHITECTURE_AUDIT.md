# DITAS architecture audit

2026-11-17. Baseline 0dcfd79 (PR #5, still unmerged); main d7c6b0b. Branch feat/ditas-foundation builds on the prior chart increment. Three parallel audit reviewers inspected data/memory, strategy/risk and UI/operations before implementation. Repository guidance: CLAUDE.md. This is an audit of code, not certification of trading returns.

| Foundation | Baseline | Sources, storage and API | Gaps / required changes |
|---|---|---|---|
| Data truth | PARTIAL | market/quality.ts, fabric.ts, chart/analysis.ts; in-memory MarketStore; /api/instrument; quality.test.ts | Receipt freshness can hide bad provider timestamps; invalid quotes/books and candle gaps can pass. Reuse strict candle validator in quality gate. |
| Decision memory | PARTIAL | decision/engine.ts, market/scanner.ts; decisions, consensus_records, orders/fills/positions, journal; /api/decisions; api/oms tests | Exact raw snapshot lineage, immutability, corrections absent; no-signal/rejected scans only in memory. Append snapshot/events atomically; existing decisions remain authoritative. |
| Market DNA | MISSING | FeatureSnapshot, regime/regime.ts and quality context reusable | Normalized versioned point-in-time fingerprints, comparisons and limitations needed. |
| Strategy passport | PARTIAL | lab/strategies.ts, lab/lab.ts; strategies/backtests; /api/lab; lab.test.ts | Rules/version and owner promotion exist; no assembled passport. OOS stats may mix versions. Health uses >=15 cumulative outcomes; confidence intervals/rolling windows missing. |
| Decision Twin | MISSING | lab/exits.ts, lab/backtest.ts, chart/replay.ts | Shared conservative exits reusable; add stored-decision simulation with explicit costs/fill constraints, delayed-entry and WAIT alternatives; no actual ledger writes. |
| Calibration | MISSING | Scores marked NOT_CALIBRATED in QCI; no probability outcome records | Separate probability forecasts from evidence strength; sample-qualified Brier/log loss/reliability/ECE/intervals. |
| Portfolio allocation | PARTIAL | portfolio/ledger.ts, correlation.ts; risk/gate.ts, policy.ts; /api/risk and /api/portfolio | Exposure/correlation/capital limits exist. Sector/event and full asset-class budgets require sources and policy review. No AI sizing authority. |
| Execution intelligence | PARTIAL | exec/oms.ts, fills/orders/positions; /api/orders,/api/history | Paper fills/fees and latency exist; fuller expected-vs-actual reports, partial fills/acknowledgement telemetry absent. |
| AI reliability | PARTIAL | workers/runtime.ts, registry.ts, qci/schemas.ts; worker_stats/consensus_records; /api/intelligence | Signed packets/dependency caps/timeouts/quarantine exist; versioned LLM prompt evaluation and cost traces incomplete. Most workers deterministic, not 100 LLMs. |
| Safety/recovery | PARTIAL | core/mode.ts, qa/gates.ts, exec/oms.ts, bot/bot.ts; settings/audit_log; /api/control,/api/emergency,/api/qa | Existing kill switch/pause and owner resume reusable; broad autonomous fault governor and durable incident/recovery workflow absent. |
| Arena/stress | MISSING | lab/backtest.ts, exits.ts and risk/oms tests reusable | No common-window arena or full operational stress certification. |
| Dashboard | PARTIAL | web/src/pages, App.tsx; existing Risk/Intelligence/QHEF/QA | Add DITAS read views and drilldowns; empty/uncalibrated states must remain explicit. |

No production data is MOCKED; synthetic candles are test fixtures. BROKEN: specific permissive data checks confirmed by inspection and to be reproduced in adversarial tests. BLOCKED: licensed multi-asset data, macro/financial histories, real venue execution and live evaluation. SQLite/WAL, Fastify, React/Vite remain sufficient. No PostgreSQL/Redis migration justified.

## Integration decision

Implement the foundation increment: stricter existing truth gate, immutable snapshots/decision events, DNA, read-only strategy passports, bounded research Decision Twin, independent calibration metrics, and a dashboard backed by those records. Preserve existing scanner/QCI/decision/risk/OMS/ledger authorities and live locks. Later operational expansion remains explicitly PARTIAL or MISSING.

Independent pure analysis helpers may be authored and tested concurrently after this audit. Integrate phase 1 truth before phase 2 memory, then DNA/passports, Twin/calibration, and read-only UI. This audit-justified parallel preparation does not grant any new execution authority and avoids races between shared services. API/root integration is owned by one agent. No migration of existing histories into fabricated snapshots.
