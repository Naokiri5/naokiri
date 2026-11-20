# TITAN HUNTER — Additive Token Intelligence Architecture

**Status:** Read-only research foundation. MIA paper-only restrictions remain unchanged.

## 1. Reuse rather than duplicate

Canonical code to preserve:

- `server/src/market/fabric.ts` and `store.ts` — CEX market ingestion and caches.
- `server/src/market/discover.ts` — discovery lists and ranking presentation.
- `server/src/providers/dexscreener.ts` — DEX Screener adapter.
- `server/src/providers/http.ts` — provider rate limits and health.
- `server/src/safety/safety.ts` — existing CEX/DEX safety classifications.
- `server/src/market/scanner.ts` — canonical strategy candidate scanner.
- `server/src/workers/` and `server/src/qci/` — verified evidence and consensus.
- `server/src/decision/`, `server/src/risk/`, `server/src/exec/oms.ts` — decision, independent risk and paper execution.

`server/src/hunt/ranker.ts` is **not a second trading scanner**. It ranks already-cached normalized observations to find research candidates. It contains no network calls, trading permission, bot schedule, order submission, wallet operation, or database modifications.

## 2. Two-speed architecture

```text
Allowed provider streams / REST / event sources (future phase)
               |
     Provenance + data validation
               |
    Normalized timestamped snapshots
               |
      +--------+----------------------------+
      |                                     |
  FAST LANE                              DEEP LANE
  Cached 1,000+ observations             Top candidates
  Deterministic read-only ranker         Contract and sellability checks
  Warning / freshness metadata           Liquidity & order simulation
  WATCH_ONLY watchlist                    Multiple independent sources
      |                                     |
      +----------------+--------------------+
                       |
           Existing canonical scanner
                       |
        Workers -> QCI -> decision -> risk gate
                       |
         Existing PAPER OMS (no change)
```

The fast lane is pure CPU work and can finish in milliseconds once data is cached. **Network collection, contract validation, blockchain confirmations, exchange orders and end-to-end decisions cannot be promised in milliseconds.**

## 3. Foundation contract

`screenCachedTokens(observations, now, limit)`:

- Validates positive price, nonnegative volume, source identity, timestamps, and record shape.
- Rejects future/stale observations, malformed numbers, and empty source identifiers.
- Deduplicates by caller-supplied canonical instrument/pool identity, keeping the freshest event.
- Ranks volume, liquidity, participation, relative hourly acceleration and short-horizon momentum with penalties for sharp moves and thin pools.
- Returns top-N with source provenance, warning labels, and counters.
- Outputs `WATCH_ONLY` and `tradeEligible: false` **unconditionally**.
- Is deterministic for the same input, clock and limit.
- Never claims this ranking is calibrated probability, security approval, or expected return.

A record with missing original provider timestamps **must not be assigned a fabricated provider timestamp**. Callers should omit such records until a data-provenance policy is defined, rather than inventing freshness.

## 4. Future data providers (proposals, not enabled)

- Reuse DEX Screener token profiles/pairs under existing quotas; add protocol-specific budgets.
- Optionally add CoinGecko/GeckoTerminal on-chain trending and pool data under licensing limits.
- Optional Helius/LaserStream Solana stream and EVM RPC log adapters with user-supplied credentials.
- Optional GoPlus and contract analysis for permission/freeze/honeypot evidence.
- Cross-venue enrichment must distinguish pool identity (`chain + pair address`) from token identity (`chain + contract address`), because a token can have multiple pools.
- Source marketing boosts, bots, wash trading, and duplicate/social hype do not constitute independent confirmations.
- Before adding providers, verify the official current rate limits, licenses, service availability and network approval.

## 5. Required hardening phases

1. **Complete here:** Pure cached ranker with deterministic tests and read-only results; no existing module edits.
2. Map existing authoritative CEX cache snapshots with provider timestamps. DEX data requires an explicit provenance policy because some DEX API objects lack per-pair event timestamps.
3. Add a read-only endpoint behind current Fastify auth, reusing `web/src/api.ts`; display a `Hunt Radar` tab in Asset Discovery. No extra stateful API client.
4. Add canonical token/pool identity, event-time snapshots, bounded cache size/TTL, sequence and gap checks.
5. Implement low-cost candidate enrichment and quota-aware provider discovery; avoid scanning all candidates deeply.
6. Enrich contract checks (sellability, mint/freeze/ownership authority, holder concentration, liquidity withdrawal, transaction taxes) using available verified chains and provider scopes. Unknown = UNVERIFIED, no automatic DEX orders.
7. Evaluate with historical event-time replay; avoid lookahead, survivorship bias, paid boost leakage, and unrealistically optimistic fills.
8. 24/7 operational verification: lag histograms, backpressure, rate limits, breaker health, SQLite backup/restore and failover.

## 6. Benchmark, testing and release criteria

- Synthetic local CPU fixture on Node.js 22.16.0: 1,000 cached observations over 100 warmed runs produced ~0.19 ms p50 and ~1.25 ms p95. This is NOT a live feed or trading benchmark; measurements depend on hardware and must be repeated in CI with multiple datasets.
- Acceptance target: p95 < 50 ms to screen 1,000 already-normalized cached observations on agreed test hardware; reliable top-N, stable tie order, no network, no execution.
- Tests in `server/test/hunt-ranker.test.ts`: deterministic 1,000 records, stale/future/NaN filtering, freshest duplicate selection, missing-liquidity warnings, output bounds and no-trade invariant.
- The full repository test suite and CI must pass before merging.
- This change does not modify risk, order managers, DITAS, database, UI, or execution mode.

## 7. Engineering master directive

Audit `main`, PR #18 and all overlapping open branches before integrating. Reuse the above canonical modules. Build one independent feature per reviewable PR. Always provide a file-level anti-duplication map, failure and provenance states, API schemas, regression tests and performance evidence. Never silently remove or replace existing code or relax risk policies. Never enable live trading, signing or withdrawals as a side effect of discovery.

## Source documentation for future phases

- DEX Screener API reference: https://docs.dexscreener.com/api/reference
- Binance Spot stream documentation: https://developers.binance.com/en/docs/binance-spot-api-docs/web-socket-streams
- CoinGecko on-chain API: https://docs.coingecko.com/reference/onchain-networks-trending-pools
- Helius LaserStream: https://www.helius.dev/laserstream
- GoPlus security API: https://docs.gopluslabs.io/reference/api-overview
- Hummingbot controllers: https://hummingbot.org/strategies/v2-strategies/controllers/
