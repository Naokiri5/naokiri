# DITAS validation report

2026-11-17. Baseline 0dcfd79, feature branch feat/ditas-foundation. Node v24.22.1. Six supporting development/review agents; root integrated and ran combined checks.

| Check | Result |
|---|---|
| npm run typecheck | PASS: server + web |
| npm test | PASS: 208 tests; 2 opt-in live-provider tests skipped; 17 files passed, 1 skipped |
| PLAYWRIGHT_BROWSERS_PATH=/workspace/work/pw-browsers npm run test:e2e | PASS: 37 tests; production web build included |
| npm run scan:secrets | PASS on all staged files |
| git diff --cached --check | PASS |

## New and retained coverage

- quality.test.ts: provider vs receipt clocks, identity, invalid prices/books, raw/cached OHLCV order/duplicates/gaps, source count, failure/recovery/reset. Existing risk/OMS failures remain in full suite.
- ditas-frames.test.ts: primary good/secondary bad inputs, stale15m, independent BTC frames, frozen nulls after cache recovery.
- ditas-memory.test.ts: idempotency, immutable DB triggers, pre-QCI snapshot reuse through actual decide(), explicit field allowlists, BTC/worker context, correction history, invalid references, hash tampering, rollback, disk restart, manual no-signal lineage.
- ditas-market.test.ts: deterministic finite DNA, missingness/similarity coverage, strategy passport read-only projection, version-matched OOS and paper health.
- ditas-twin.test.ts: fees/spread/slippage, frozen stops/targets, gaps/stop-first, delayed/WAIT, partial/no fill, open/censored results, chronology/input bounds, numerical overflow and purity.
- ditas-calibration.test.ts: independent metric fixtures, log-loss clipping, reliability counts/ECE/Wilson intervals, sample thresholds, empty and invalid inputs.
- ditas-api.test.ts: auth/CSRF, empty overview, immutable-depth simulation/provenance hashes, no actual-ledger writes, historical window restrictions, strict assumptions, forecast dedupe/target/reference, clock rollback/60s expiry, lag cohorts, observed outcome uniqueness, no cohort pooling, authoritative paper account projection.
- e2e/ditas.spec.ts: real empty state, paper/hypothetical separation, memory/snapshot drilldown, mobile layout and exact cohort selection. Existing 33 browser checks also passed.

## Review fixes incorporated

Raw anomalies previously hidden by ingestion now flag interval integrity before indicators advance. Secondary/BTC frames fail independently. Scanner retries are not suppressed before durable success. Proposal attempts have unique frozen snapshots reused after asynchronous QCI. Actual projections use PAPER_ACCOUNT and current-version backtests exclude stale versions. Forecast duplicates cannot multiply identical targets; reference rules are frozen and registration time is constrained/cohorted. Simulations reject unsafe arithmetic and distinguish censored outcomes.

These are deterministic/offline checks with explicitly synthetic fixtures. No licensed-data validation, prospective paper campaign, OOS profitability evidence, model calibration certification, full load/recovery campaign or live execution certification was performed.
