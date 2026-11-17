# Execution quality increment

Adds GET /api/ditas/execution?limit=100 under existing owner-session authentication. The projection reads only actual paper-account orders and their fills, independently calculates volume-weighted fill price, fees, quantities and local fill delays, and compares entry fills to the stored decision reference where available. Missing legacy references stay null. Hypothetical Twin records are excluded.

This is a read-only portion of phase 8. Immutable execution lifecycle events, provider-backed historical settlement and additional portfolio budgets remain pending. No acknowledgement telemetry, actual market-impact model, live execution or completed portfolio phase is claimed. No migrations or execution-authority changes.

Validation: focused projection tests and server/web typecheck. Existing browser behavior is unchanged; the endpoint has no new dashboard controls.
