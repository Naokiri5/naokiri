# Omega PR-06: read-only Solana mint checks (Claude build)

## What it does
Every row on Discover → **Solana watchlist** gets a **Mint check** read from the Solana chain. It is read-only and cannot authorize anything.

- **When.** In the background after each DEX Screener refresh (`market/fabric.ts` `refreshBackground`). It never runs while a page loads, and it never delays the market-data lane.
- **What is read.** The watchlist's base mints, in one batched `getMultipleAccounts` call (jsonParsed, `confirmed` commitment, at most 100 accounts).
  - Only Solana pools quoted in SOL, USDC or USDT count.
  - Every address must decode to exactly 32 bytes; one bad address would make the node reject the whole batch.
  - Each result records the **slot** it was read at.
- **How it is judged.** The owner's starter parser, `solana/mint-audit.ts` `assessParsedMint`:
  - mint authority;
  - freeze authority;
  - executable account;
  - Token-2022 extensions: risky ones block; unknown ones and mutable metadata authorities are flagged, never passed.

  Two guards wrap the parser: more than 32 extensions, or a parser exception, makes the result `UNKNOWN`.
- **Stricter only.**
  - **BLOCK:** the row becomes `REJECT` and the BLOCK reasons become blockers.
  - **UNKNOWN** (missing account, unparseable mint, flagged extension): fail closed. A `WATCH` row becomes `INSUFFICIENT_DATA` with blocker `MINT_CHECK_INCONCLUSIVE`.
  - **Pass:** a note "mint and freeze authority revoked at slot N" and a green "authorities revoked" badge. The row is never upgraded.
  - **Not checked** (no RPC setting, a failed or stale check): the ranker's status is unchanged.
  - **Always:** every row stays `tradingEligible: false`, and the block stays `executionReady: false`.
- **Caching and retries.**
  - A mint is re-read at most every 10 minutes.
  - A pass older than 30 minutes, or dated in the future, shows as "not checked". A block always stands.
  - After a failure MIA waits 1 minute, or 5 minutes for a 403, an RPC error, a malformed or oversized reply, or a bad setting. That avoids a retry storm against the public endpoint.
  - Only one request runs at a time.
  - Up to 10 reasons are shown per row, deduplicated.

## Configuration (server only)
`MIA_SOLANA_RPC_URL` (https).
- **Unset:** no requests are made, the provider shows `PENDING_CREDENTIALS`, and every row shows "not checked".
- **Invalid value:** the provider shows `DOWN`, and the value itself is never displayed.
- **Owner's choice (2026-11-19):** the public endpoint `https://api.mainnet.solana.com`, set in the server's environment. It is not in the code.
- **Public endpoint limits** ([Solana docs](https://solana.com/docs/references/clusters)):
  - about 100 requests per 10 s per IP, and 40 per 10 s per method;
  - no uptime guarantee; not meant for production.

  MIA sends about one request per DEX refresh, with a local cap of 30 per minute.
- **Secrets.** A provider URL may embed an API key, so the URL is never logged, returned or shown.
  - Error messages are scrubbed of the configured URL, including its path and query.
  - A reply that is not valid JSON is never quoted into provider status.
  - Errors surface only as short codes such as `HTTP_429` or `MALFORMED`.
- **Network.** The server host must reach the endpoint over HTTPS. Node's built-in `fetch` needs `NODE_USE_ENV_PROXY=1` behind a proxy; `server/scripts/run.mjs` already sets it.
- **Offline tests.** The test config clears `MIA_SOLANA_RPC_URL`, so an owner's real setting never changes offline results. Only opt-in live tests keep it.

## Safety boundaries
- `providers/solanaRpc.ts` can send only `getMultipleAccounts`. There is no transaction builder, signer, `sendTransaction` or wallet.
- Redirects are refused, so a keyed URL is never replayed to another host.
- Responses are capped at 2 MB. `fetchProvider` gained an opt-in `maxBytes` that is checked against Content-Length and while streaming.
- The node's error text is never echoed, and extension names from the reply are display-cleaned.
- `server/src/solana/` stays an evidence root (it cannot reach `exec/`, `wallet/` or `portfolio/`) and imports no npm packages.
- Copy Trading never shows Solana wallet activity as LIVE, because only mint checks are built.

## Bug found by the live test (fixed)
The starter's `TOKEN_2022_PROGRAM` was `TokenzQdBNbLqP5VEhdkAS6EPF4g7q5gghRXAgn4G5`, which is not a valid 32-byte key (the node answers `WrongSize`). Every Token-2022 mint, which covers most new launch-platform tokens, was therefore blocked as `BLOCK_NOT_TOKEN_PROGRAM`, and its extensions were never checked. That failed safe, but the reason was wrong.

The correct id, `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb` ([spl.solana.com/token-2022](https://spl.solana.com/token-2022)), was confirmed on chain as an executable program. The starter's own tests could not catch this, because they import the same constant. Two tests now guard it:
- an offline test that both program ids are valid 32-byte keys;
- a live test case with PayPal USD, a Token-2022 mint with risky extensions.

## Verified live (2026-11-19)
The owner approved allowing `api.mainnet.solana.com` from the build sandbox. All calls were read-only.
- **Live test:** `MIA_LIVE_TESTS=1 MIA_SOLANA_RPC_URL=https://api.mainnet.solana.com npm run test:live -w server -- -t Solana` passes.
  - Wrapped SOL: pass (no mint or freeze authority).
  - USDC: block (active mint authority).
  - PayPal USD: Token-2022, block (permanent delegate, transfer hook and other risky extensions).
- **End-to-end on real data** (live DEX Screener sample, one batched request at slot 471406626):
  - 24 Solana pools in the sample.
  - 12 skipped for an untrusted quote token.
  - 12 mints checked:
    - 1 pass (SPL Token, authorities revoked; row stays WATCH);
    - 11 inconclusive. All are Token-2022 with `metadataPointer`/`tokenMetadata`, which the starter flags because the metadata authority may still be mutable. Those rows were already REJECT from the ranker's market checks, such as low liquidity or extreme price change.
  - No row became tradable, and `executionReady` stayed `false`.

## Files
- **New:**
  - `server/src/providers/solanaRpc.ts`: transport, address check, provider registration, URL validation, reply decoding.
  - `server/src/solana/mintChecks.ts`: cache, background refresh, guards, join, summary.
- **Changed:**
  - `providers/http.ts`: `maxBytes`, safe JSON decoding, URL scrubbing.
  - `providers/pending.ts`: the `solana_rpc` entry moved to the new adapter.
  - `index.ts`: registration import.
  - `market/fabric.ts`: background call.
  - `market/discover.ts`: join, `mintChecks` summary, honest note.
  - `api/routes.ts`: Copy Trading requirement wording.
  - `solana/hunting.ts`: the shared row comparator `compareSolanaRows` (no behavior change).
  - `solana/mint-audit.ts`: the Token-2022 id fix.
  - `server/vitest.config.ts`.
  - `web/src/pages/SolanaWatchlist.tsx`: "Mint check" column and status line.
  - `.env.example`.
- **Tests:**
  - `server/test/solana-rpc.test.ts`: 26 tests with a stubbed RPC. Ten deliberately broken versions of the code were each caught.
  - `e2e/solana.spec.ts`: one new test.
  - `server/test/live.providers.test.ts`: the opt-in live test, which passed.

## Still not verified
Holder distribution, pool custody, LP lock and an executable sell route are not checked. A pass means "mint-level permissions revoked", not "safe to buy".

The owner may want to review the starter's extension lists (`dangerExts`/`reviewedExts`), for example whether `mintCloseAuthority` should block rather than flag.

**Rollback:** unset `MIA_SOLANA_RPC_URL` and restart MIA (checks stop; rows show "not checked"), or revert the PR. No migration.
