# Vike Data research provider and Paper/Live contract

Status: **implemented, offline-tested.** Live calls to data.vike.io have **not** been verified, because they need the owner's rotated API key (see "Turning it on").

Skill: `.claude/skills/mia-vike-parity/SKILL.md`. Contract source: official OpenAPI 3.1 spec "vike.io Data API" 1.0.0 (`https://vike.io/data/openapi.json`, fetched 2026-11-18).

## What it is

Vike gives on-chain token and wallet activity, Hyperliquid candles, and the Polymarket and Predict.fun market catalogs. In MIA it is **research evidence only**:

- **Never a trade signal.** Nothing from Vike reaches the price cache, the scanner, workers, QCI, the decision engine, the risk gate or the OMS. A static test checks that `providers/vike.ts` and `research/vikeRoutes.ts` import no OMS, signing, wallet, transfer or ledger code.
- **Labelled on every response.** Each response carries `kind: 'RESEARCH_ONLY'`, `tradeEligible: false` and `freshness: 'UNVERIFIED'`.
- **Response shape is not checked.** The spec publishes `{}` for every success response, so beyond "is a JSON object" nothing is validated.
- **Errors are missing evidence.** A 401, 403, 429 or outage is an upstream error (HTTP 502/503). It is never turned into a zero or a vote.

## Where it lives (no second market service)

| Piece | File |
|---|---|
| Provider adapter (validation, allowlist, envelope) | `server/src/providers/vike.ts` |
| Transport, rate limit, Retry-After, health | existing `server/src/providers/http.ts` (`fetchProvider` gained `redirectMode`) |
| Owner-only HTTP routes | `server/src/research/vikeRoutes.ts`, registered in `server/src/api/routes.ts` |
| Paper/Live adapters | `server/src/exec/environment.ts`, plus `GET /api/trading/environments` |
| UI | Discover → **Vike research** tab (`web/src/pages/VikeResearch.tsx`) |
| Tests | `server/test/vike.test.ts` (adapter), `server/test/vike-routes.test.ts` (routes and adapters) |

Routes are all `GET`, require an owner session, and accept only the listed query keys (zod `.strict()`):

- `/api/research/vike/status`
- `search?q&limit`
- `tokens?chain&window&sort&minVolumeUsd&limit`
- `wallets?chain&window&sort&size`
- `hyperliquid/ohlcv?symbol&interval&market&limit`
- `predictfun?status&q&sort&limit`
- `polymarket?query&active&limit&offset`
- `polymarket/archive?date&stream&asset&tenor`

## Security rules enforced in code

1. **Where the key lives.** The key comes only from the server env `MIA_VIKE_API_KEY` and must match `vk_` followed by 12–256 safe characters. It is sent only as the `X-API-KEY` header, never in a URL, log, response or the browser bundle.
2. **No key, no request.** A missing or malformed key means no network request is made. The route answers 503, and the status shows `PENDING_CREDENTIALS`.
3. **Fixed destinations.** Requests go only to the fixed host `https://data.vike.io` and seven fixed `/v1/...` paths. User input cannot change the path or host.
4. **No redirects.** `redirect: 'error'` means the key can never follow a redirect to another host.
5. **Spec limits checked before sending.** Examples: search limit 1–20, screener limit ≤ 100, `smart_inflow` only on ethereum, Polymarket offset ≤ 10 000, asset and tenor given together.
6. **Rate limits.** The local budget is 100 requests per minute, half of Vike's 200. A 429 response's Retry-After blocks the provider (existing B-03 logic). A multi-process deployment would need a shared limiter.
7. **Archive links stay on the server.** The Polymarket archive route returns **metadata only**. Every URL-valued field (a presigned link, valid for 7 days, needing no key) is withheld before the response leaves the server.

## Overlap ledger (anti-duplication)

| Requested function | Canonical owner | Status | Minimum additive change | Regression test |
|---|---|---|---|---|
| HTTP client, timeouts, retry, rate limit | `providers/http.ts` | exists | `redirectMode` option only | `vike.test.ts` (redirectMode 'error') |
| Provider registry and health | `providers/http.ts` `registerProvider` | exists | one registration (`vike-data`) | `vike.test.ts` (registration) |
| On-chain token and wallet discovery | none (DexScreener covers DEX pairs, not flows) | missing | `providers/vike.ts` research functions | `vike.test.ts`, `vike-routes.test.ts` |
| Hyperliquid candles | none | missing | research-only candles, **not** fed to `FeatureEngine` | `vike.test.ts` |
| Prediction-market catalogs | none | missing | research-only catalog reads | `vike.test.ts` |
| Market price / order book for fills | `market/fabric.ts`, `market/store.ts` | exists | **none:** Vike must not feed it | static import check |
| Scanner / workers / QCI / decision | `market/scanner.ts`, `workers/`, `qci/`, `decision/engine.ts` | exists | **none** | unchanged suites |
| Paper order lifecycle | `exec/oms.ts` | exists | `PaperExecutionAdapter` wraps it (no copy) | `vike-routes.test.ts` (adapter delegates to the real OMS) |
| Live order lifecycle | none (locked) | missing by design | `LockedLiveExecutionAdapter` refuses everything | `vike-routes.test.ts` (LIVE_LOCKED) |
| Discover UI | `pages/Phase1.tsx` `Discover` | exists | one extra tab using `useApi` | typecheck, e2e Discover |

## Paper/Live

- **One way to get an adapter.** `executionAdapter('PAPER')` returns a thin wrapper around the existing paper OMS. Every result is labelled `PAPER`.
- **Live is always locked.** `executionAdapter('LIVE')` always returns the locked adapter. Every command throws `LiveLockedError` (`LIVE_LOCKED`, `NOT_CERTIFIED`). If `LIVE_EXECUTION_AVAILABLE` were ever true without a reviewed adapter, it throws.
- **Truthful overview.** `GET /api/trading/environments` shows both environments in the same layout, with Live reported `LOCKED` and its reasons.
- **APPROVAL means Paper.** `APPROVAL` mode still refers to Paper approvals.
- **A deposit unlocks nothing.** It never unlocks Live or raises limits.

Before any Live adapter may replace the locked one, all of the following are required:

- account isolation in every query and ledger row;
- durable reservations;
- venue client-order-id reconciliation;
- partial-fill states;
- verified protective stops;
- trade-only credentials;
- Live release tests;
- per-account strategy enrollment;
- explicit owner approval.

## Not implemented (next steps)

- **Archive downloader.** It would download the complete Parquet file with **no** key, from a verified and allow-listed host, to local disk, then read it locally.
- **Vike WebSocket.** It needs its own gap-aware, separately rate-limited connector, not REST polling.
- **Vike MCP endpoint** (`data.vike.io/mcp`). Not connected. If added, it must get research tools only.
- **Typed response parsing** per endpoint. This waits on Vike publishing response schemas.

## Turning it on

1. Revoke any key that was ever pasted in a chat, and create a new one in your Vike account.
2. Set `MIA_VIKE_API_KEY=vk_...` in the **server** environment: process manager, systemd `EnvironmentFile`, or shell. Never put it in `web/`, git or a public config.
3. Allow outbound HTTPS to `data.vike.io` and restart MIA.
4. Check Discover → **Vike research**. The status changes from `PENDING_CREDENTIALS` to data.
