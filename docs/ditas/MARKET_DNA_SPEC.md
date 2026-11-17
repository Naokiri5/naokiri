# Market DNA

fingerprint(ctx,asOf) is pure and versioned (market-dna-v1). Uses only captured features closed by asOf, normalized to [0,1]: EMA trend, ADX, ATR%, relative volume, liquidity coverage, spread, impact, RSI, range location and BTC correlation. Missing/future features are null, never zero. Macro/fundamentals remain explicitly missing; spot funding is N/A.

Fingerprints persist inside immutable proposal snapshots. compareFingerprints uses equal-weight shared-dimension absolute distance; version/timeframe must match, data cannot have failed, >=3 common dimensions and >=50% coverage required. Similarity is research evidence, never probability/permission. GET /api/ditas/events/:id/similar searches at most 500 prior events, excludes the same snapshot, never later events, returns up to20 matches. No future outcomes enter fingerprint construction. Finding historical profitable strategy matches with validated sufficient outcomes is a later extension.
