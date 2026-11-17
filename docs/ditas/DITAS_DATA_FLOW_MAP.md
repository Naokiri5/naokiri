# Data flow and trust boundaries

1. Existing providers -> quality validation (source/receipt time, OHLCV, continuity, book and cross-venue sanity).
2. Evaluated scan -> frozen snapshot + append-only event, even for rejection/no-signal. QCI packets retain their own signed provenance.
3. Central decision -> event linked to existing decision ID. Later corrections append a new event; do not rewrite the snapshot.
4. Frozen features -> versioned fingerprint; history comparisons only use records at or before query timestamp.
5. Stored proposal + explicit cost/liquidity assumptions + historical candles after decision -> hypothetical Twin result; actual paper positions are queried separately.
6. Explicit probability forecast committed before target outcome -> observed label -> calibration metrics. Simulated or arbitrary evidence percentages do not become actual probabilities.
7. Read-only overview/drilldowns expose stored evidence, limitations and source labels. Authentication/CSRF remain the existing API boundary.

No credentials in snapshots; snapshots use an explicit field allowlist. Database mutation errors fail the analysis path before execution callback. Live trading remains release-gated and disabled.
