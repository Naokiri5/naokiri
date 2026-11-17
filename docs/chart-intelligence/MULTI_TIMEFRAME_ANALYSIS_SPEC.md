# Multi-timeframe analysis

Status: implementation design for subsequent increments; not a claim of completion.

Current source: market/types.ts and workers/indicators.ts. Only 15m/1h/4h are supported. Reuse cached FeatureEngine snapshots. Add an as-of report that includes only candles closed at the decision timestamp; report missing, stale and conflicting frames without requiring unanimity. Monthly/weekly boundaries need calendar-aware provider semantics. Acceptance: staggered-close, forming higher-timeframe, missing-frame and contradictory-frame tests.
