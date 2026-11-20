# CCXT exchange research (read-only)

Status: **implemented, offline-tested, and live-checked on 2026-11-18.** The live check fetched ticker, order book and candles from Kraken and a ticker from Coinbase Exchange.

CCXT (`ccxt@4.5.93`, MIT) gives one interface to more than 100 exchanges. In MIA it is used **only for connectivity research**. It is not a venue adapter, a price source for paper fills, or a trading engine. Nothing from CCXT reaches the price cache, scanner, QCI, decision engine, risk gate or OMS.

## Safety by construction

| Guarantee | How |
|---|---|
| **No credentials** | Exchanges are created without keys. If an instance carries `apiKey`, `secret`, `password`, `uid`, `privateKey` or `walletAddress`, the adapter refuses to run. |
| **Cannot trade, withdraw or transfer** | CCXT's HTTP layer is replaced by MIA's `fetchProvider`. Only `GET` requests over HTTPS pass; any `POST`/`PUT`/`DELETE`, or a request with a body, is blocked before it leaves the process. |
| **Shares MIA's limits and health** | Requests use MIA's offline mode, per-exchange rate limit (half of CCXT's documented pace), Retry-After back-off, and health status (`ccxt-<exchange>` providers). |
| **Only known exchanges and methods** | Allowed exchanges: `binance`, `coinbaseexchange`, `kraken`, `okx`, `bybit`. Allowed methods: markets, ticker, order book, candles. |
| **CI guard** | A test fails if the adapter references order, withdrawal, balance or credential APIs, or imports `exec/`, `portfolio/` or `risk/`. |

## Sandbox mode

Setting `MIA_CCXT_SANDBOX=1` switches supported exchanges to their official test URLs, for example Binance or Bybit testnet. It stays keyless and GET-only. Exchanges without an official sandbox, such as Kraken, are refused in this mode.

Sandbox **order** testing would need testnet API keys and a separately reviewed adapter behind the Paper/Live interface (`exec/environment.ts`). That is out of scope, and Live stays locked.

## API (owner session required)

All routes are `GET`:

- `/api/research/ccxt` lists the exchanges, their health, and whether sandbox mode is on.
- `/api/research/ccxt/:exchange/markets?limit=`
- `/api/research/ccxt/:exchange/ticker?symbol=BTC/USDT`
- `/api/research/ccxt/:exchange/orderbook?symbol=BTC/USDT&limit=20`
- `/api/research/ccxt/:exchange/candles?symbol=BTC/USDT&timeframe=1h&limit=100`

Every response is labelled `kind: 'RESEARCH_ONLY'` and `tradeEligible: false`.

## Network

The server must reach each exchange's public API host. Kraken and Coinbase Exchange were reachable in the build environment. Binance's main API (`api.binance.com`) may be geo-blocked in some regions.

## Rollback

Revert this PR, or remove these:

- the `ccxtRoutes(app)` line in `api/routes.ts`;
- `server/src/research/ccxt*.ts`;
- the test file;
- the `ccxt` dependency.

No database or schema changes.
