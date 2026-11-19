# Omega 06a: Solana watchlist alerts on Telegram (opt-in, read-only)

## Why
The owner asked for BONKbot and Axiom "Telegram integration". Both are real-money trading tools with no official API. Connecting them would mean live trading and handing over account access, which the paper-only rules forbid, so MIA does not talk to them.

What the owner gets instead: MIA tells them, on Telegram, when a token passes the watchlist checks. They decide on their own, outside MIA.

## What it does
- **Where:** MIA's existing notifications (`notify/notify.ts`): the in-app notification center, plus Telegram when `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are configured.
- **When:** after each background refresh, when a Solana watchlist row is **WATCH** and its **on-chain mint check passed** (mint and freeze authority revoked, Omega PR-06).
  - Rows that are rejected, inconclusive or not checked never alert.
  - Without `MIA_SOLANA_RPC_URL`, nothing is checked on chain, so nothing alerts.
- **Off by default.** Turn it on under Settings → Notifications → "Send Solana watchlist alerts to Telegram". It is stored as `notifyPrefs.solanaWatchlistTelegram`.
  - Because the owner opted in explicitly, these INFO messages reach Telegram even when the minimum Telegram severity is WARNING.
  - Quiet hours still apply.
- **Limits:** once per token per 24 hours, and at most 5 alerts per hour. Both are counted from the stored notifications, so a restart does not reset them.

## What a message contains (plain text, no links)
- The ticker (display-cleaned; a non-ASCII ticker gets a "compare the mint address" warning) and the full mint address.
- Liquidity, 1-hour volume and age.
- "Mint and freeze authority revoked (slot N)".
- What is **not** checked: holder distribution, pool custody, an executable sell route.
- "Watchlist only. Not a trade signal; MIA cannot buy this token."

There are no buy buttons, no links to trading bots or trading sites, and no prices to "act on". MIA never sends anything to BONKbot, Axiom or any other trading service.

## Files
- **New:** `server/src/solana/watchAlerts.ts`.
- **Changed:**
  - `notify/notify.ts`: optional `telegramOptIn` flag; existing callers are unchanged.
  - `api/routes.ts`: the setting.
  - `market/fabric.ts`: runs after the mint checks; it is never awaited by the market-data lane.
  - `web/src/pages/Account.tsx`: the checkbox.
- **Tests:**
  - `server/test/solana-watch-alerts.test.ts`: 9 tests. Six deliberately broken versions of the code were each caught.
  - `e2e/solana.spec.ts`: one new test.

**Rollback:** untick the setting (immediate), or revert. No migration: alerts use the existing `notifications` table.
