# MIA BrainOS Ω — OMNI VISION: Phase 0 audit (2026-11-26)

Read with [`docs/BRAINOS_V2_COMPONENT_INVENTORY.md`](../BRAINOS_V2_COMPONENT_INVENTORY.md), which classifies the 64
core BrainOS responsibilities against call sites. This audit covers only what OMNI VISION adds: multi-asset trading
(OMNI) and the read-only observation layer (VISION). Classes: **V** verified in code and tests, **P** partial,
**X** missing, **B** blocked on credentials, data licensing, regulation or owner decision.

## 1. OMNI — multi-asset capabilities

| Group | Existing owner | Class | Evidence and gap |
|---|---|---|---|
| Universal instrument registry (1) | `market/types.ts` `Instrument`, `market/store.ts` | P | Id `crypto:binance:BTCUSDT`, `market` ∈ crypto, crypto-dex, forex, stocks, commodities. No instrument type (spot, future, perpetual), contract multiplier, expiry, settlement currency or calendar. Futures research uses a separate provider id (`binance-usdm-research`), not registry instruments. Extending `Instrument` is the next OMNI step; it touches every market consumer, so it needs its own reviewed change. |
| Multi-venue gateway, normalizer, scanner (2–4) | `providers/*`, `providers/http.ts`, `market/fabric.ts`, `market/scanner.ts` | P | Binance spot (executable for paper), Coinbase and Kraken references, CoinGecko, DEX Screener, Frankfurter FX references, Binance USD-M research klines. No broker, Hyperliquid, Databento, Alpaca, OANDA, CCXT, Helius or Jupiter adapter. |
| Cross-asset features, correlation, regime (5, 12, 13) | `features/indicators.ts`, `portfolio/correlation.ts`, `regime/regime.ts` | P | Crypto spot only. |
| Calendar, corporate actions, futures contracts and rollover, funding (6–10) | — | X | No market calendar, corporate action, contract or funding model. Funding is research-only (W8 in the inventory). |
| Currency conversion (11) | `providers/frankfurter.ts` | P | Daily reference rates only; the ledger is single-currency USD. |
| Economic calendar, macro, lead-lag (14–16) | — | X | Needs a licensed data source. |
| Opportunity arbitration, capital allocation (17–18) | `choice/arbitration.ts` (shadow), `risk/gate.ts`, `ops/tradingMandate.ts` | P | Single market; shadow-only arbitration. |
| Global ledger, collateral, margin, liquidation (19–22) | `portfolio/ledger.ts` (one paper account) | P / X | No per-venue accounts, collateral or margin (W8). |
| Smart routing, venue registry, cost model, multi-venue reconciliation (23–26) | `exec/oms.ts` (`binance-paper`), `exec/demoLiveParity.ts` (test-only port) | P / X | One paper venue. The parity port is the intended adapter boundary once a real adapter exists. |
| Global circuit breaker, market-specific exits (27–28) | `risk/gate.ts`, emergency stop, `lab/exits.ts` | P | Account-wide for one venue; exits are spot-generic (W7). |
| Regulatory eligibility (29) | `qa/gates.ts` (LIVE lock), mandate scope | B | No jurisdiction or product-eligibility policy. The Philippine SEC advisories cited in the brief must be reviewed before any LIVE venue. |
| Cross-asset learning memory (30) | `ditas/*` | P | Crypto spot outcomes only. |

**Blockers outside the code:** broker and exchange accounts and API permissions, market-data licences (equities and
futures), Solana RPC credentials, a regulatory review per venue and product, and owner authorization. None can be
satisfied from this repository.

## 2. VISION — observation layer

| Area | Existing owner | Class | Evidence and gap |
|---|---|---|---|
| Live telemetry stream | `GET /api/stream` (`api/routes.ts`), `core/bus.ts`, `web/src/api.ts` | P → **improved** | Authenticated (session revalidated every 20 s) and read-only. It broadcast every topic to every client, without ids, sequence numbers or schema version, so a reconnect silently lost events and views stayed stale until their next poll. Fixed in this increment (§3). |
| Chart engine (charts 1, 3, 12–13, 15) | `web/src/pages/Markets.tsx` (lightweight-charts), `chart/analysis.ts` | P | Candles, volume, EMAs, recorded entry, stop and target lines. Chart analysis emits swing, BOS and FVG *hypotheses* as explanatory evidence. No tick, footprint, CVD, depth, OI, funding or liquidation charts. |
| Strategy, execution and guardian evidence | `decisions`, `ditas_events`, `exec/fillEvents.ts`, risk reason codes | P | The evidence exists and is linked by trace and decision ids; the UI shows activity summaries, not reconstructions. |
| Predictive Vision | `ditas/calibration.ts`, `chart/scenarios.ts` | P | Scenario weights are explicitly uncalibrated; there are no calibrated directional forecasts to display honestly. |
| Hunter Vision | `market/flinQueue.ts`, `market/volumeSpike.ts` | B | No live Solana feed. |
| Replay Studio | `lab/eventReplay.ts`, `lab/sessionSimulation.ts`, `chart/replay.ts` | P | Deterministic, isolated replay exists server-side with no execution credentials; there is no UI. |
| Memory Vision | `ditas/memory.ts`, `knowledge/*` | P | Data exists; no dedicated view. |

Every VISION workspace must draw only recorded backend evidence. Where the backend has no calibrated output (for
example, forecasts), the honest display is "not available", not an illustrative chart.

## 3. Increment delivered: sequenced, recoverable, filtered telemetry

Extends the existing stream instead of adding a second gateway (`server/src/core/telemetry.ts`).

- Every bus event is journaled with id `<bootId>:<sequence>` in a bounded ring (512 events). SSE frames carry `id:`.
- On reconnect the browser resends `Last-Event-ID`; the server replays exactly the missed events, in order, without
  duplicates. If it cannot (another process booted, the gap is older than the ring, malformed or future id) it sends
  `event: resync`, and every live view whose `useApi` hook declares the resync topic refetches authoritative state
  from the REST API. Views whose hooks declare no topics do not refetch on resync — for example
  `useApi('/api/settings')` in `web/src/pages/Account.tsx` waits for a manual reload — so "every live view
  refetches" does not hold for them.
- `?topics=order,position` subscribes to listed topics only; unknown topics are refused (400).
- A `hello` frame announces the schema version and current id, and carries that id as its SSE `id:` so a
  reconnecting browser resends it as `Last-Event-ID`.
- Telemetry stays notification-only and read-only: it says *what changed*; state is always reread from its owner, so
  a lost or reordered event can never alter orders, positions or balances. A failing subscriber cannot affect others.

Tests: `server/test/telemetry.test.ts` (journal ordering, exact replay, resync reasons, ring bound, subscriber
isolation, bus wiring; and an end-to-end stream on a real port covering authentication, topic filtering, gap-free
replay after reconnect and resync).

## 4. Recommended order (dependency-first)

1. Instrument identity: add instrument type, multiplier, expiry and settlement currency to `Instrument`, with every
   consumer updated together. Prerequisite for any futures, perpetual, stock or FX venue.
2. One PAPER venue adapter behind the `demoLiveParity` port (Hyperliquid PAPER is the brief's first candidate), with
   per-venue balances and reconciliation in the ledger. Requires margin and liquidation modelling (W8) before leverage.
3. VISION Execution and Guardian views from existing decision, risk and fill evidence over the new telemetry.
4. Replay Studio UI over `lab/sessionSimulation.ts` (isolated, no credentials).
5. Predictive Vision only after calibrated, independently evaluated forecasts exist.
6. Brokers, licensed data and LIVE only after credentials, regulatory review and the release gates.
