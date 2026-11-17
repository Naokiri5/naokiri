# Acceptance criteria

- Truth: bad/future/stale provider and receipt timestamps, malformed prices/books and candle gaps fail or explicitly warn; critical faults block the existing risk path.
- Memory: frozen snapshots/events survive SQLite restart, are immutable at DB level and hash-verifiable; corrections append, duplicate scan records are idempotent; no secrets captured.
- DNA/passports: normalized deterministic fingerprint, missingness explicit, no future comparison records; version-matched strategy evidence and no automatic promotion.
- Twin: only frozen pre-outcome plan; strictly future consecutive candles, costs/depth and fill assumptions recorded; stop-first gap handling shared with existing exits; no-fill/open status; WAIT baseline; isolated from actual ledger.
- Calibration: independent known-reference metrics, probabilities distinct from evidence scores, chronologically recorded labels, cohort/version separation, sample counts/intervals and UNCALIBRATED default.
- Dashboard/API: auth/CSRF, bounds, honest empty states, actual-paper versus hypothetical labels, evidence drilldowns; no invented aggregate performance.
- Regression: typecheck, server tests, browser tests, secret scan. Live locks and owner-only controls intact.

Full certification additionally requires prospective paper sample, cost/fill validation, rolling OOS, operational stress/recovery and model evaluation datasets. Passing offline tests alone does not certify profitability or live readiness.
