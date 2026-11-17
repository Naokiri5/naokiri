# Service dependency map

Provider adapters -> MarketStore/FeatureEngine -> existing quality gate -> existing scanner -> QCI -> central decide() -> deterministic risk -> paper OMS -> actual ledger.

DITAS snapshot/memory observes those inputs/results. DNA reads snapshot features. Passports read versioned strategy definitions and existing validated results. Twin reads frozen decision plans and a future historical path, then uses shared exits in isolated simulation storage. Calibration reads explicitly timestamped probability forecasts/outcomes, never agent vote counts. Dashboard reads these services. No DITAS analyzer calls OMS or changes policy.

SQLite migration 2 adds immutable snapshot/event and research-result tables alongside existing tables. No separate event bus/cache/database or duplicate execution service.
