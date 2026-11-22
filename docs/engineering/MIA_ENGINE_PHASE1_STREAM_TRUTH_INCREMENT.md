# MIA Engine Upgrade Phase 1 — Streaming Depth and Market Truth Increment

Baseline: `main@dc6bc1b7c2c91ec4ff6c2d66cb9abd528f38fd13` (November 22, 2026).
Implementation owner: existing draft PR #62 (`codex/mia-50-recovery`), stacked on the existing unified MIA branch.

## Scope and reuse

This increment **extends**, rather than duplicates, the reviewed Phase 1 specification:
- `market/depthStream.ts`: existing `BookSync`, bounded snapshot retry and generation fencing. Reject malformed REST snapshots before they can bootstrap an incremental book. Count invalid snapshots.
- `market/fabric.ts` + `market/store.ts`: existing `setBook`, `DeepState`, and `streamFresh`. Reject invalid books before canonical publication, preserve REST/STREAM provenance, clear stream-owned executable book state on gap/disconnect, protect newer REST replacement, prevent future freshness assertions, skip redundant REST depth fetches in `refreshDeep` while verified streaming is fresh, and clear previous-generation freshness after reconnect/re-subscription.
- Existing scanner, FeatureEngine, QCI, risk gate, paper OMS, ledger, database schema, incident manager, DITAS, bus and lease implementation remain authoritative and unchanged.
- Existing REST fallback remains active whenever the stream is disabled, invalid, disconnected, stale or outside the freshness window. No new exchange trading API, credentials or signing.

## Accepted protocol and limitations

The Binance Spot incremental depth procedure relies on exchange update IDs and a snapshot bridge. Neither WebSocket presence nor receiving a message grants trade authorization. The REST snapshot check requires safe integer `lastUpdateId`, finite strictly sorted positive levels on both sides, and best bid strictly below best ask. A rejected book never replaces the current one. This increment is **not** proof of independent exchange book accuracy, profitability, or production live readiness.

## Adversarial regression coverage

Extend:
- `server/test/depth-stream.test.ts`: NaN, out-of-range ID, negative ID, empty, duplicate, unordered, crossed, and nonfinite depth; transport bounded retry; no publication; preservation of synced state when invalid snapshot rejected.
- `server/test/depth-stream-fabric.test.ts`: malformed book fails canonical admission, REST remains eligible, future freshness clock rejected.

## Release gates and blockers

- Run `npm ci`, `npm run typecheck`, `npm run build`, `npm test`, `npm run test:e2e`, `npm run scan:secrets`, and `npm audit --audit-level=high`.
- Review current PR conflict state and dependent migration/version ancestry; PR #62 was DRAFT and not mergeable at audit time.
- Validate official stream host reachability and provider allow-list before enabling MIA_STREAMING in any deployment.
- Do not call Phase 1 complete: remaining implementation includes verified source clocks/provenance through risk and OMS, bounded priority scheduling, leader fencing integration tests, durable selected events, incident stress testing, and full latency/certification evidence.
- Preserve `BOUNDED_LIVE` locked; no real venue adapter or signer introduced. No production deployment or merge without verified gates and review.
