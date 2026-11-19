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
- **Reconnects:** with backoff and jitter. A socket silent for two minutes is treated as stalled: it is dropped and replaced at once, without waiting for a close event that a half-open connection may never send.
- **On the watchlist:**
  - A "Pump.fun live" panel on Discover → Solana watchlist: latest launches (mint, creator, age) and graduations (mint, PumpSwap pool), with no buttons and no links.
  - Watchlist rows whose mint launched or graduated get an informational note. It never changes their status.
- **Off by default:** `MIA_PUMPFUN_FEED=1` turns it on.
  - It uses the Solana endpoint in `MIA_SOLANA_RPC_URL` (same host over `wss`), or `MIA_SOLANA_WS_URL`.
  - Node's built-in WebSocket follows the HTTPS proxy only with `NODE_USE_ENV_PROXY=1`, which `server/scripts/run.mjs` sets.
- **Stops** with the bot, and stays stopped until the bot starts again (a background pass already in flight cannot reopen it).

## Bug found by the live run (also fixed in the existing Binance stream)
Stopping a socket that was still connecting caused an **error storm**: Node's WebSocket fires another `error` event when a connecting socket is closed, and an `onerror` handler that closed the socket again re-entered itself. One stopped socket produced **914** error events.

The same pattern existed in the existing Binance order-book stream (`market/depthStream.ts`), and the same measurement showed 914 events there too. Both now close each socket at most once (`core/util.ts` `closeSocketOnce`), and errors from a stream that is being stopped are ignored. Measured after the fix: 2 events, which is the platform's own count. Regression tests use a socket that re-enters `error` the way Node's does.

## Independent security review (before opening the PR)
A security reviewer read the diff. Every finding was fixed, each with a regression test, and each test was confirmed to fail when its fix is removed:

| Finding | Fix |
|---|---|
| Frame lines were matched with any word as the program id, so text such as `Program log: success` could open or close a frame | Program ids must be base58 (the runtime prefixes everything a program prints with `Program log:`). The invoke depth must follow on from the previous frame, and each `success`/`failed` must close the frame on top. Any inconsistency rejects the whole transaction. |
| A background refresh in flight could restart the feed after the bot stopped | `stopPumpFeed()` keeps it stopped until `resumePumpFeed()` (bot start). Turning the setting off only closes the socket. |
| A transaction signature from the provider was stored unchecked | Only a base58 string of 64–88 characters is accepted; anything else drops the message. |
| A stalled (half-open) socket was closed but not replaced until a close event that may never come | The watchdog drops it and schedules the reconnect itself. |
| Each message was parsed twice | It is parsed once; `handlePumpMessage` also accepts the parsed object. |
| The reconnect timer kept the process alive | It is `unref`'d, like the watchdog. |
| The traffic guard can be tripped on purpose | Documented: anyone can send cheap transactions mentioning these accounts. Tripping it pauses the feed for 10 minutes (availability only); it never costs unbounded bandwidth. |

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
  - `server/test/solana-pumpfun.test.ts` (21 tests; 14 deliberately broken versions caught: six for the first version, eight for the review fixes);
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
