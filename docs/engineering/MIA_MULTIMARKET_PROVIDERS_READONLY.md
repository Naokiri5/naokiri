# MIA Multi-Market Provider Integration — Safe Read-Only Slice

**Source:** User request to integrate Alpaca, OANDA, CCXT/Kraken, Helius/Jupiter and GoPlus into existing MIA.
**Branch:** feat/mia-multimarket-providers-readonly-20261121; stacked on PR #92; unmerged.
**Status:** Read-only provider integrations; NOT a production trading release.

## Existing code preserved

- server/src/market/fabric.ts is the canonical market-data owner. It already imports public Kraken REST, Coinbase, CoinGecko, DEX Screener, and Frankfurter daily forex reference rates.
- server/src/providers/http.ts already implements rate limits, provider health and latency; the only transport change adds optional JSON-RPC POST for Helius.
- server/src/safety/safety.ts already implements conservative asset checks. Provider results are evidence, not trading approval.
- server/src/exec/oms.ts remains the only paper OMS. QCI, decision engine, risk gate and all live release gates remain authoritative.
- The existing Connections Hub (web/src/pages/Account.tsx) is extended rather than duplicated.

## New read-only integrations

| Provider | Implemented functionality | Explicit restrictions |
|---|---|---|
| Alpaca PAPER | Asset metadata via paper-api.alpaca.markets/v2/assets/{symbol} | PAPER keys only; broker tradable does NOT mean MIA execution approved |
| OANDA PRACTICE | Account-specific bid/ask pricing via api-fxpractice.oanda.com | PRACTICE token only; five allowed FX pairs; stale/crossed quotes rejected |
| Kraken | Existing direct REST public ticker reused | No duplicated polling or trading OMS |
| CCXT | Catalog entry states NOT_INSTALLED | Dependency intentionally deferred; do not falsely claim CCXT runtime works |
| Helius | Only Solana JSON-RPC getAsset from mainnet.helius-rpc.com | No sendTransaction, wallet signing, or account mutation; safety UNASSESSED |
| Jupiter Swap V2 | GET api.jup.ag/swap/v2/order without taker | Quote-only; no transaction, signer, execute, build or submit; fail closed if unexpected transaction |
| GoPlus Solana | Beta token security GET endpoint | RISK_FLAGS / NO_KNOWN_FLAGS / UNKNOWN; no trade approval or assertion of safety |

## API and connections UI

- GET /api/integrations returns statuses, markets, purposes and explicit read-only restrictions.
- GET /api/integrations/alpaca/asset/AAPL — paper asset eligibility metadata.
- GET /api/integrations/oanda/price/EUR_USD — practice bid and ask with timestamp.
- GET /api/integrations/helius/asset/{mint} — Solana metadata, Helius key required.
- GET /api/integrations/jupiter/quote?inputMint=...&outputMint=...&amount=... — read-only routing quote.
- GET /api/integrations/goplus/solana/{mint} — read-only beta risk evidence.
- All use existing authenticated Fastify session, input validation and per-session analysis quotas. No new POST trade routes.

## Credentials

Optional server-only environment variables (described in .env.example): ALPACA_PAPER_KEY_ID, ALPACA_PAPER_SECRET_KEY, OANDA_PRACTICE_ACCOUNT_ID, OANDA_PRACTICE_TOKEN, HELIUS_API_KEY, JUPITER_API_KEY, GOPLUS_ACCESS_TOKEN.
Never commit actual values, pass them to the frontend, send production brokerage keys to paper endpoints, or mistake API availability for jurisdictional eligibility.

## Testing and promotion

- The new server/test/multimarket-integrations.test.ts tests mocked Alpaca/OANDA signed requests, allowed API domains, stale/invalid data, Helius getAsset-only RPC, Jupiter quote-only/no-taker, GoPlus flags/unknown, and no trade authority.
- Typechecking, server regression, web unit, Playwright E2E, secret scanning and dependency audit must pass before review.
- Real provider credentialed networking and quality/latency benchmarks are NOT certified by mocked CI.
- This patch intentionally does NOT insert new venues into the Binance-centric order execution, price quality quorum, or LIVE risk policy. Symbol normalization, market hours, venue order filters, cross-market position accounting and deterministic safety gates require separately tested work.
- The next real trading milestone is still an exchange-confirmed TESTNET OMS with durable intent, idempotent order IDs, partial fills, reconciliation and exchange protection; only then expand to Alpaca PAPER and OANDA PRACTICE order adapters and a separate Solana sandbox.
- LIVE requires independent signer, withdrawal-disabled trade-only credentials, transaction firewall, broker eligibility, all G01-G14 release gates, security review and explicit owner authorization.

## External security/observability recommendations

Cloudflare WAF rules, CodeQL and OpenTelemetry exporters are separate infrastructure actions. MIA already uses GitHub secret/dependency checks and QHEF; this PR does not pretend to deploy Cloudflare rules or install another tracing backend.

## Provider documentation

- https://docs.alpaca.markets/us/reference/get-v2-assets-symbol_or_asset_id
- https://developer.oanda.com/rest-live-v20/development-guide/
- https://github.com/ccxt/ccxt
- https://docs.kraken.com/api-reference/market-data/get-ticker-information
- https://www.helius.dev/docs/das-api
- https://github.com/jup-ag/docs/blob/main/swap/index.mdx
- https://docs.gopluslabs.io/reference/solanatokensecurityusingget

**No live orders, signer, wallet custody, brokerage write action, funding transfer, simulated confidence score, or duplicate trading subsystem is introduced by this integration.**