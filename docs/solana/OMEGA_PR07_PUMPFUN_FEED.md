# Omega PR-07: read-only Pump.fun launch and graduation feed

## Why this design
The owner asked to "install pumpfun". The community Pump.fun skills found mostly trade, and Pump.fun's official SDKs build trades. Pump.fun publishes no official read-only data API: its web endpoints are undocumented, and the "advanced" one needs a login token. So MIA reads Pump.fun **from the Solana chain itself**, using the program's official interface definition (IDL). It is read-only, signs nothing, and has no trade path.

## Verified facts (2026-11-19, mainnet)
| Item | Value | How it was checked |
|---|---|---|
| Pump.fun program | `6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P` | On chain: an executable program. Matches `idl/pump.json` in [pump-fun/pump-public-docs](https://github.com/pump-fun/pump-public-docs) (commit 639b87f) |
| PumpSwap AMM program | `pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA` | On chain: an executable program |
| Mint authority | `TSLvdd1pWpHVjahSpsvCXUbgwsL3JAcvokwaKt1eokM` | The `mint_authority` account of a real `create_v2` transaction, decoded with the IDL |
| Withdraw authority | `39azUYFWPz3VHgKCf3VChUwbpURdCHRxjWVowf5jUJjg` | Read from the program's Global account `4wTV1YmiEkRvAtNtsSGPtUrqRYQMe5SKy2uB4Jjaxnjf` (IDL layout, discriminator checked) |
| Event layouts | `CreateEvent`, `CompletePumpAmmMigrationEvent` | Discriminators and field order from the IDL; decoded on real transactions and cross-checked against the instruction's own accounts |

## Measured traffic (why the subscription is narrow)
| Subscription | Messages | Data | Useful events |
|---|---|---|---|
| Logs mentioning the whole program | ~330 per second (82% failed bot transactions) | ~475 kB/s, about 40 GB a day | 8 launches in 20 s |
| Logs mentioning the **mint authority** | ~0.3 per second | ~3 kB/s | launches only |
| Logs mentioning the **withdraw authority** | a few per minute | small | `migrate_v2` calls (graduations; a duplicate attempt carries no event) |

MIA's feed (`server/src/solana/pumpFeed.ts`) opens one WebSocket with exactly the two narrow subscriptions and sends nothing else. If traffic ever exceeds 600 messages a minute (far above the narrow rate), it disconnects and waits 10 minutes, so a provider change cannot turn it into a bandwidth sink.

## What it does
- **Decoding** (`server/src/solana/pumpfun.ts`, pure). An event is accepted only while the Pump.fun program itself is executing, because any program can print bytes that look like a Pump.fun event.
  - A Pump.fun call made by another program (a CPI) still counts.
  - Truncated data and oversized names are rejected.
  - Names and symbols are display-cleaned. Metadata URIs are dropped and never fetched.
- **Storage:** in memory, the latest 50 launches and 50 graduations, de-duplicated across reconnects. A restart starts empty.
- **Reconnects:** with backoff and jitter; a silent socket (two minutes) is treated as stalled.
- **On the watchlist:**
  - A "Pump.fun live" panel on Discover → Solana watchlist: latest launches (mint, creator, age) and graduations (mint, PumpSwap pool), with no buttons and no links.
  - Watchlist rows whose mint launched or graduated get an informational note. It never changes their status.
- **Off by default:** `MIA_PUMPFUN_FEED=1` turns it on.
  - It uses the Solana endpoint in `MIA_SOLANA_RPC_URL` (same host over `wss`), or `MIA_SOLANA_WS_URL`.
  - Node's built-in WebSocket follows the HTTPS proxy only with `NODE_USE_ENV_PROXY=1`, which `server/scripts/run.mjs` sets.
- **Stops** with the bot.

## Bug found by the live run (also fixed in the existing Binance stream)
Stopping a socket that was still connecting caused an **error storm**: Node's WebSocket fires another `error` event when a connecting socket is closed, and an `onerror` handler that closed the socket again re-entered itself. One stopped socket produced **914** error events.

The same pattern existed in the existing Binance order-book stream (`market/depthStream.ts`), and the same measurement showed 914 events there too. Both now close each socket at most once (`core/util.ts` `closeSocketOnce`), and errors from a stream that is being stopped are ignored. Measured after the fix: 2 events, which is the platform's own count. Regression tests use a socket that re-enters `error` the way Node's does.

## Verified live
- MIA's own feed code ran against `api.mainnet.solana.com` for 60 s: connected, decoded 21 launches (all Token-2022), no errors.
- No graduation happened during that minute. The graduation decoder is tested on a real `migrate_v2` transaction fetched from mainnet.
- The public endpoint (or this sandbox's proxy) dropped the long-lived connection after about 28 s once; the feed reconnected as designed.

## Not covered
- **Bonding-curve progress** (how close a launch is to graduating) needs reading each curve account; not built.
- **History:** launches from before the server started are not shown.
- **Not a signal:** a launch on Pump.fun says nothing about safety. New tokens are extremely risky; most fail or are scams.

## Files
- **New:**
  - `server/src/solana/pumpfun.ts` (decoder);
  - `server/src/solana/pumpFeed.ts` (feed);
  - `server/test/solana-pumpfun.test.ts` (14 tests; six deliberately broken versions caught);
  - `server/test/fixtures/pumpfun-mainnet-logs.json` (real, public mainnet logs).
- **Changed:**
  - `core/util.ts`: `closeSocketOnce`.
  - `market/depthStream.ts`: the same storm fix, plus 2 regression tests.
  - `market/fabric.ts`, `bot/bot.ts`: start and stop.
  - `market/discover.ts`: the view and notes.
  - `web/src/pages/SolanaWatchlist.tsx`: the panel.
  - `.env.example`.
  - `e2e/solana.spec.ts`: one test.

**Rollback:** unset `MIA_PUMPFUN_FEED` and restart (the feed stops; the panel shows how to turn it on), or revert. No migration.
