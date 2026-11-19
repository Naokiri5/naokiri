# Omega PR-06: read-only Solana mint checks (Claude build)

## What it does
Every row on Discover → **Solana watchlist** gets a **Mint check** read from the Solana chain. It is read-only and cannot authorize anything.

- **When.** In the background after each DEX Screener refresh (`market/fabric.ts` `refreshBackground`). It never runs while a page loads, and it never delays the market-data lane.
- **What is read.** The watchlist's base mints, in one batched `getMultipleAccounts` call (jsonParsed, `confirmed` commitment, at most 100 accounts). Only Solana pools quoted in SOL, USDC or USDT count. Each result records the **slot** it was read at.
- **How it is judged.** The owner's starter parser, `solana/mint-audit.ts` `assessParsedMint`, unchanged:
  - mint authority;
  - freeze authority;
  - executable account;
  - Token-2022 extensions (risky ones block; unknown ones are flagged, never passed).

  A missing account, or a reply that cannot be parsed, is `UNKNOWN`, never a pass.
- **Stricter only.**
  - **BLOCK:** the row becomes `REJECT` and the reasons become blockers (for example `BLOCK_ACTIVE_MINT_AUTHORITY`).
  - **Pass:** a note "mint and freeze authority revoked at slot N" and a green "authorities revoked" badge. The row keeps the ranker's status and is never upgraded.
  - **Not checked / inconclusive:** the status is unchanged.
  - **Always:** every row stays `tradingEligible: false`, and the block stays `executionReady: false`.
- **Caching.**
  - A mint is re-read at most every 10 minutes (`MINT_CHECK_TTL_MS`).
  - A pass older than 30 minutes (`MINT_CHECK_MAX_AGE_MS`), or dated in the future after a clock jump, shows as "not checked". A block always stands, because blocking is the safe side.
  - Mints that leave the DEX sample are dropped.
  - Only one request runs at a time.

## Configuration (server only)
`MIA_SOLANA_RPC_URL` (https).
- **Unset:** no requests are made, the provider shows `PENDING_CREDENTIALS`, and every row shows "not checked".
- **Owner's choice (2026-11-19):** the public endpoint `https://api.mainnet.solana.com`, set in the server's environment. It is not in the code.
- **Public endpoint limits** ([Solana docs](https://solana.com/docs/references/clusters)):
  - about 100 requests per 10 s per IP, and 40 per 10 s per method;
  - no uptime guarantee; not meant for production.

  MIA sends about one request per DEX refresh (every 3 minutes), with a local cap of 30 per minute. A paid provider URL can replace it later without code changes.
- **Secrets.** A provider URL may embed an API key, so the URL is never logged, returned by the API or shown in the UI (tested). Errors surface only as short codes such as `HTTP_429`, `MALFORMED` or `TOO_LARGE`.
- **Network.** The server host must be able to reach the endpoint over HTTPS.

## Safety boundaries
- `providers/solanaRpc.ts` can send only `getMultipleAccounts`. There is no transaction builder, signer, `sendTransaction` or wallet.
- Redirects are refused, so a keyed URL is never replayed to another host.
- Responses are capped at 2 MB. `fetchProvider` gained an opt-in `maxBytes` that is checked against Content-Length and while streaming.
- The node's error text is never echoed; only the numeric JSON-RPC code is kept. Extension names from the reply are display-cleaned.
- `server/src/solana/` stays an evidence root (it cannot reach `exec/`, `wallet/` or `portfolio/`) and imports no npm packages.

## Files
- **New:**
  - `server/src/providers/solanaRpc.ts`: transport, provider registration, URL validation, reply decoding.
  - `server/src/solana/mintChecks.ts`: cache, background refresh, join, summary.
- **Changed:**
  - `providers/http.ts`: `maxBytes`.
  - `providers/pending.ts`: the `solana_rpc` entry moved to the new adapter.
  - `index.ts`: registration import.
  - `market/fabric.ts`: background call.
  - `market/discover.ts`: join and `mintChecks` summary.
  - `web/src/pages/SolanaWatchlist.tsx`: "Mint check" column and status line.
  - `.env.example`.
- **Tests:**
  - `server/test/solana-rpc.test.ts`: 14 tests with a stubbed RPC; four deliberately broken versions were each caught.
  - `e2e/solana.spec.ts`: one new test.
  - `server/test/live.providers.test.ts`: opt-in live check of wSOL (pass) and USDC (block).

## Not verified here
- **Live endpoint.** The live test has **not** been run: this build sandbox cannot reach Solana (its network policy refuses the host). Run it on the server with:
  `MIA_LIVE_TESTS=1 MIA_SOLANA_RPC_URL=https://api.mainnet.solana.com npx vitest run test/live.providers.test.ts`
- **Rest of the screening.** Holder distribution, pool custody, LP lock, an executable sell route and Token-2022 coverage on real accounts with every extension type are still unverified. A pass means "mint-level permissions revoked", not "safe".

**Rollback:** unset `MIA_SOLANA_RPC_URL` and restart MIA (checks stop; rows show "not checked"), or revert the PR. No migration.
