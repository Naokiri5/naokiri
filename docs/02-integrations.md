# Integrations & Licensing Matrix (Part 22.4)

| Provider | Host(s) | Data | Freshness | Credentials | License / restriction | Status |
|---|---|---|---|---|---|---|
| Binance public market-data mirror | data-api.binance.vision | 24h tickers, klines, depth, aggTrades, exchangeInfo | Near-real-time (REST polling) | none | Binance ToS; no redistribution | LIVE |
| Coinbase Exchange | api.exchange.coinbase.com | ticker (cross-venue check) | Near-real-time | none | Coinbase market-data terms | LIVE |
| Kraken | api.kraken.com | ticker (cross-venue check) | Near-real-time | none | Kraken ToS | LIVE |
| CoinGecko | api.coingecko.com | market cap, rank, volume | Delayed | none (public tier) | Attribution; commercial use needs paid plan | LIVE |
| DEX Screener | api.dexscreener.com | token profiles, pairs, liquidity, txns | Near-real-time | none | DEX Screener API terms, 60 req/min | LIVE |
| Frankfurter (ECB) | api.frankfurter.dev | FX reference fixing | **Daily**, not tradeable | none | ECB reuse with attribution | LIVE (display only) |
| Google News RSS | news.google.com | headlines | Near-real-time | none | **Personal, non-commercial only**. Replace before commercial use | LIVE |
| Anthropic Claude API | api.anthropic.com | Trader Joe | — | `ANTHROPIC_API_KEY` | Anthropic Commercial Terms | PENDING_CREDENTIALS |
| Telegram Bot API | api.telegram.org | notifications | — | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Telegram Bot ToS | PENDING_CREDENTIALS |
| Equities (Alpaca/Polygon/IEX) | — | stocks | — | API key + exchange data license | vendor | PENDING_CREDENTIALS |
| Commodities (CME via vendor) | — | futures | — | vendor license | vendor | PENDING_CREDENTIALS |
| EVM RPC + explorer | — | contract analysis, sell simulation, holders, whale wallets | — | API key | vendor | PENDING_CREDENTIALS |
| Solana RPC | — | mint/freeze authority, holders | — | API key | vendor | PENDING_CREDENTIALS |
| X API | — | social | — | OAuth 2.0 PKCE app (paid read tier) | X Developer Agreement | PENDING_CREDENTIALS |
| Live exchange execution | — | orders | — | trading keys + isolated signer | exchange ToS | **LOCKED by release gate** |

Notes
- Streaming WebSockets are not used: the WebSocket hosts are not allow-listed in the build environment, so REST polling is the
  documented fallback (Part 29 L0). Event provenance (provider, receive time, candle close time) is still recorded.
- Binance lists some tokenized-equity tokens as spot pairs (e.g. tickers ending in `B`). MIA treats them as crypto spot
  instruments with the same safety checks. It does not present them as stock-exchange data.
- Node's built-in `fetch` ignores `HTTPS_PROXY`. The start scripts set `NODE_USE_ENV_PROXY=1` so proxied environments work.
