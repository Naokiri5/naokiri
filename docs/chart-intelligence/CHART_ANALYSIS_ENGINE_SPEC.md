# Chart analysis contract

Implemented: prior-20-bar support/resistance, strict two-left/two-right confirmed pivots, higher-high/higher-low and lower-high/lower-low trend classification, doji, bullish/bearish body engulfing, pin bars, inside bars, range-close breakouts, wick-sweep hypotheses and three-bar fair-value-gap hypotheses.

Require >=22 consecutive, strictly ordered, valid closed candles. OHLC must be finite and positive, volume finite/nonnegative. Reject duplicates, gaps, future/forming and stale history. Current cached history is bounded by the existing FeatureEngine (400 bars). Recompute over that bounded window; this is not claimed to be incremental.

Signal-bar close must cross the preceding 20-bar extreme for a breakout. Pivot comparisons are strict; equal highs/lows do not fabricate a trend. Two right-side closes are required before a pivot becomes evidence. Sweep/FVG names denote price hypotheses, never proof of hidden orders.

Every detection includes instrument, timeframe, detectedAt, price boundaries, calculation method, evidence, uncalibrated confidence, expiration and invalidation text. Confidence defaults to 0.6 rule strength and is not a fitted probability. Expiration is one interval after analysis time; consumers must revalidate. ChartReport status is VALID, INVALID or INSUFFICIENT_DATA. All reports are evidence-only and say NO TRADE. No entry/stop/target or position size is invented.

Pending Phase 1: supply/demand, BOS/CHoCH, breakout/retest, consolidation/channels, named multi-swing patterns, Fibonacci, pivots and volatility expansion. Acceptance: positive/negative reference fixtures, no-look-ahead prefix invariance, clear invalidation and sufficient-data gates for each rule.
