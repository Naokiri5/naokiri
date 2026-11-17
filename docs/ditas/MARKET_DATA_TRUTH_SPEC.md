# Market data truth

Extends market/quality.ts, fabric.ts and store.ts. Existing scanner, risk and OMS use the same quality assessment. Event time (providerTs) and receipt time remain distinct. Source identity must match the known instrument/venue. Prices/volumes/timestamps must be finite; source/receipt freshness and future timestamps are checked with 5s clock skew. Malformed/crossed/unsorted books fail structural validation before impact estimation. Independent source counts include only valid fresh venues.

Raw candle batches are validated before FeatureEngine sorts/deduplicates: duplicates/order/gaps/OHLCV/close times/future opens, one final forming candle, and continuity to existing history. Expected overlap between separate polls is accepted. Invalid input leaves feature state untouched and sets interval integrityIssues; valid retry clears that interval. Existing health bus reports failure/recovery. Cached closed histories are also checked on every assessment.

This is crypto polling validation, not REST/WebSocket consistency or market-session certification. Source anomaly health events are in-process; snapshots persist quality at evaluated decisions. No missing candle is synthesized. Regression fixtures include failure, recovery and reset, plus unchanged risk/OMS tests.

Secondary instrument and BTC reference frames are assessed independently in buildContext. A failed/stale frame becomes null, so workers abstain rather than voting from invalid cached features. Snapshot context preserves each frame quality report and explicit null; later cache recovery cannot refill historical evidence.
