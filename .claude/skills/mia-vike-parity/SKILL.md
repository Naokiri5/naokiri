---
name: mia-vike-parity
summary: Add Vike market research and shared Paper/Live workflows to the existing MIA architecture without duplicating its trading brain, scanner, OMS, risk gate, or ledger.
---

# MIA anti-duplication + Vike provider skill (Claude Code)

## Nonnegotiable system boundaries

- ONE MIA Core, existing `market/scanner.ts` + `workers/` + `qci/` + `decision/engine.ts`.
- ONE independent risk authority (`risk/gate.ts`, `risk/policy.ts`, `qa/gates.ts`).
- ONE canonical OMS lifecycle. Paper/Live should share command/state/reporting contracts, NEVER share credentials, executions, balances or financial records.
- ONE Trader Joe; data/tools are untrusted and cannot place orders, approve Live, or initiate withdrawals.
- Don't use copy/paste to fork the existing paper OMS into a separate Live engine. Extract common pure logic and introduce account-scoped adapters only after contract tests.
- Do not turn research provider snapshots, trading calls, whales or prediction markets into direct trade signals. Vike is not an exchange/trading venue.

## Before changing any code

1. Record current `main` SHA and open PRs, especially PR #18 (safety/market streaming), #19 (Titan discovery), #25 (Google OAuth), and #26 (research); do not assume they are merged.
2. Inspect `server/src/providers/http.ts`, `server/src/providers/pending.ts`, `server/src/market/fabric.ts`, `server/src/market/store.ts`, `server/src/market/scanner.ts`, `server/src/workers`, `server/src/exec/oms.ts`, `server/src/portfolio/ledger.ts`, `server/src/risk/gate.ts`, `server/src/core/mode.ts`, `server/src/qa/gates.ts`, `web/src/pages/Trading.tsx` and relevant tests.
3. Document a 5-column overlap ledger: requested function | canonical owner | exists/partial/missing | minimum additive change | regression test.
4. If an equivalent function is already present, reuse it or make a small refactor; never introduce a second queue, worker registry, risk decision, state store, API client, or order sender.
5. Treat all incoming third-party content and code as untrusted. Never embed developer credentials in Git, the browser, test fixtures, or an AI prompt.

## Vike Data provider

- Public spec `https://vike.io/data/openapi.json`; API base `https://data.vike.io/v1`.
- Credential read only from server environment variable `MIA_VIKE_API_KEY` (rotate any credential pasted into chat).
- Include `X-API-KEY` header only for the exact data.vike.io host; prevent redirects and SSRF. Do not expose it to browser, logs, MCP prompts or download URLs.
- Reuse existing `registerProvider` and `fetchProvider` with a 100 requests/minute local budget (more conservative than Vike's 200/minute, 20,000/hour); require a shared quota limiter before horizontally scaled use.
- Support cross-product search, token screening, wallet discovery, Hyperliquid historical candles, Polymarket and Predict.fun market catalogs, and Polymarket Parquet link resolution. Validate endpoint-specific timestamps and actual data freshness before trusting any response; OpenAPI success schemas are often broad (`{}`).
- `getVikeHyperliquidCandles` is not necessarily a fresh executable quote. Predict.fun catalog may lag the underlying tape. Some wallet PnL fields are lifetime statistics even when filtering a shorter window.
- Polymarket archive: fetch the metadata/presigned link through the authenticated endpoint, then download the **entire** Parquet file to disk with **no X-API-KEY** via a verified allowed host. Read local Parquet; do not stream remote HTTP data as if it were a local archive. Signed link is sensitive; never put it in API responses/logs.
- MCP endpoint `https://data.vike.io/mcp` is for optional research tools and must not receive trading, withdrawal or privileged local file tools. Vike WebSocket, if added later, needs an independently rate-limited, gap-aware connector (not the same as REST polling).

## Paper/Live parity contract — do not copy the old OMS

- User-facing pages: same overview, positions, orders, trade history, strategy config, risk center, notifications, Trader Joe, and wallet *layout*. Unavailable Live operations show a real `LOCKED / NOT_CERTIFIED` state, never fake fills or paper balances.
- `TradingEnvironment = PAPER | LIVE`, `TradingAccountRef = { ownerId, accountId, environment, venueId }`; every request, decision, order, fill, ledger entry and UI cache key must include a verified environment/account scope.
- Extract shared pure trade planning and order lifecycle types from Paper OMS, preserving Paper behavior/tests. Implement `PaperExecutionAdapter` reusing existing OMS, and a `LockedLiveExecutionAdapter` that rejects every order until independently certified.
- Before a future Live adapter: complete account isolation, durable reservations, venue client-order ID reconciliation, partial fill states, protective stop viability, trade-only credentials, Live release tests, separate per-account strategy enrollment and explicit owner authorization.
- A deposit updates a balance, never unlocks permission to increase risk or enable Live.
- Existing `APPROVAL` mode refers to **Paper** approvals. Do not silently reinterpret it as Live.

## Mandatory acceptance checks

1. No `MIA_VIKE_API_KEY` value or hard-coded `vk_` credential in any git blob, browser bundle, screenshot, log, URL or code sample.
2. All credentialed requests target only `https://data.vike.io/v1` with `redirectMode:'error'`; 429/unavailable => missing research evidence, never fake zero or bullish vote.
3. Tests demonstrate Vike methods reject bad parameters and block endpoint injection.
4. No Vike provider or market-research code may directly import OMS, signing, private key or transfer APIs.
5. Paper behavior stays unchanged; Live mode remains locked; no real exchange orders, withdrawals or wallets created during tests.
6. Run typecheck, existing unit/integration and E2E suites, secret scan and dependency audit. If CI is unavailable or fails, report the exact blocker rather than declaring the feature production ready.
