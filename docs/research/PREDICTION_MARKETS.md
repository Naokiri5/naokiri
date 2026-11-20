# Prediction markets (Polymarket, Kalshi): research only

Status: **implemented and offline-tested; not yet live-verified.**
- Polymarket and Kalshi were unreachable from the build sandbox: its network policy refused both hosts.
- Response parsing follows the field names used by the reviewed projects' working parsers, and accepts the alternate formats seen there.
- The first real run against the live APIs should be watched.

Where: **AI Intelligence → Prediction Markets** (`/prediction`).

## What it does

| Tab | What you get |
|---|---|
| Markets | Most active Polymarket or Kalshi markets with bid/ask, 24 h volume, liquidity and reward program. Click one for a full analysis: the public order book; mid and microprice; book imbalance; a complete-set arbitrage check after fees; a liquidity-reward share estimate for a hypothetical quote; and fill risk for that quote. |
| Arbitrage scan | Reads the YES and NO books of up to 8 active Polymarket binary markets. Reports any market where buying both sides (or splitting and selling both) clears 0.5¢ per set after fees. |
| Backtest | A conservative book replay (see below) for a passive quoting strategy or a fair-value taker strategy, on order-book snapshots you supply. |
| Calculators | Fractional Kelly stake (from *your* probability estimate) and a model value for short crypto up/down rounds. |

API (owner session + CSRF, like every research route):
- `GET /api/research/prediction/markets?venue&query&limit`
- `GET /api/research/prediction/analyze?venue&id&feeBps`
- `GET /api/research/prediction/scan?limit&minEdge&feeBps`
- `POST /api/research/prediction/cross-venue`: requires `confirmSameQuestion: true`.
- `POST /api/research/prediction/backtest`
- `POST /api/research/prediction/calc`

Every reply is labelled `RESEARCH_ONLY`, `tradeEligible: false`.

## Safety boundaries (unchanged MIA invariants)

- **No order path.** There is no prediction-market order, signing, wallet, allowance, deposit or withdrawal code. A CI test fails if any appears in `server/src/prediction/`, or if a venue read ever uses anything but GET.
- **Evidence, not authority.** Results never reach the scanner, the QCI vote, the decision engine, the risk gate or the paper OMS. Live trading stays locked.
- **Untrusted data.**
  - Every venue field is validated and bounded.
  - Market text is displayed as data.
  - Token ids and tickers are checked against strict patterns before they enter a URL.
- **No invented fills.**
  - Taker walks use visible depth only, so a thin book gives a partial result.
  - In the replay, a resting quote fills only when a later snapshot trades *through* its price.
  - Short selling is never assumed.
- **No calibrated-probability claims.** Kelly uses the owner's belief. The up/down value is labelled a model.
- **Cross-venue pairs need explicit confirmation** that both markets resolve the same question. Matching titles is how a "hedge" becomes two losses.

## Formulas (MIA's own implementation; sources are public documentation)

- **Polymarket taker fee:** `shares × (feeBps / 10 000) × p × (1 − p)`. Maker fills pay nothing. If a market's fee rate is unknown, MIA computes it fee-free and says so. You can pass `feeBps`.
- **Kalshi taker fee:** `ceil-to-cent(0.07 × contracts × P × (1 − P))` per order.
- **Polymarket liquidity reward:**
  - Each order scores `S = ((v − s) / v)² × size`, where `v` is the max reward spread in ¢ and `s` is its distance from the mid. Orders under the minimum size score 0.
  - Inside 0.10–0.90, `Q_min = max(min(Q₁, Q₂), max(Q₁/3, Q₂/3))`, so a one-sided quote earns a third.
  - Outside that band both sides are required.
  - The share estimate compares your quote's `Q_min` with the visible book only.
- **Complete sets:**
  - BUY_BOTH: YES ask + NO ask + fees < 1.
  - MINT_AND_SELL: YES bid + NO bid − fees > 1. This needs an on-chain split; its gas is not counted.
  - Multi-outcome: Σ YES asks + fees < 1, and only valid if the outcomes are exhaustive.
- **Up/down model:** driftless lognormal, `N(ln(S/K)/σ√t − σ√t/2)`, with time-aware EWMA volatility.
- **Kelly:** `f* = (b − p)/(1 − p)`, then a fraction of that, capped (defaults ¼ and 5 %). It is zero when fees remove the edge.

## Where each idea came from (and what was NOT installed)

Four uploaded archives were reviewed. No code was copied:
- `polymarket_lp_tool` has **no licence**, which means all rights reserved.
- `prediction-market-backtesting` is partly **LGPL-3.0**.
- The other two are MIT.

MIA re-implemented the publicly documented formulas and general ideas in TypeScript.

| Upload | Reused as ideas | Not installed (why) |
|---|---|---|
| `polymarket_lp_tool` (Python + Rust, no licence) | Reward-band scoring and keeping quotes off the touch; fill risk from queue position and taker pressure | Private-key order signing, CLOB order posting and cancelling, Telegram control, web panel (live trading; key custody) |
| `Prediction-Markets-Trading-Bot-Toolkits` (Rust, MIT) | Cross-venue YES+NO arbitrage maths and its "pair by explicit link, never by title" rule; driftless digital pricing with EWMA volatility; book imbalance | Market-making, copy-trading, sniping and arbitrage bots that place orders with a wallet key; on-chain deposit monitoring |
| `prediction-market-backtesting` (Python/NautilusTrader, MIT + LGPL) | Current curved Polymarket fee formula; conservative, depth-limited fills; separating maker and taker liquidity | The NautilusTrader replay engine, live adapters and notebooks (large Python dependency; LGPL; MIA already has an isolated Nautilus lab under `research/python/`) |
| `AutoPilotPM` (TypeScript, MIT) | Complete-set ("rebalance") and multi-outcome arbitrage; fractional Kelly; the Kalshi public endpoint | The agent platform (≈ 630 files): wallets, swaps, lending, perps, messaging channels, daemons, skills (far outside paper-only scope). Its "sell both when YES+NO > 1" idea was corrected: you can only sell what you hold, so MIA models it as split-then-sell. |

Overlap with existing MIA code:
- Vike already lists Polymarket markets (it needs a key). This module adds the free public books and the analytics instead of duplicating that catalog.
- MIA's crypto Strategy Lab backtests candles. This replay works on binary order books with settlement at 0 or 1. The domains differ, so they stay separate.

## Security review of the uploads (static, nothing was installed or run)

| Upload | Examined | Findings |
|---|---|---|
| polymarket_lp_tool | All 77 files scanned automatically; key handling read by hand | Needs `PRIVATE_KEY` for live order signing (by design). The hardcoded addresses are Polymarket exchange contracts and the USDC tokens. No exfiltration, obfuscation or install hooks found. |
| Trading-Bot-Toolkits | All 61 files scanned; key handling and addresses read | The key is used only for local signing. The `0xf39f…` and `0x7099…` addresses are public test accounts used in tests. `pnlpro.fit` is the author's marketing redirect. Nothing malicious found. |
| prediction-market-backtesting | All 254 files scanned | Notebook outputs hold large base64 images (benign). `pickle.load` reads only files the tool wrote itself. Nothing malicious found. |
| AutoPilotPM | 831 files scanned; flagged files, install hooks and skill files read; **not every line read** | Has a `postinstall` hook (local binding fixes plus a HuggingFace model download). It also ships a daemon that installs LaunchAgents and systemd units, clipboard tooling, and many wallet and transfer features. These are documented features, not hidden behaviour. No exfiltration found. **Do not `npm install` it on a machine with wallets or keys.** |

A static scan reduces risk but cannot prove code is safe. MIA reused none of it.

## Turning on live data

The routes work when the MIA server can reach these hosts over HTTPS:
- `gamma-api.polymarket.com`
- `clob.polymarket.com`
- `api.elections.kalshi.com`

No keys are needed. `MIA_OFFLINE=1` keeps them silent: nothing is sent.
