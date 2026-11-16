# MIA 4.1 — Multi-market Intelligence & Paper-Trading Terminal

MIA scans live crypto markets, evaluates opportunities with **100 deterministic market workers**
and **50 indicator specialists** coordinated by **Quantum Consensus Intelligence (QCI)**, routes every
candidate through a central **decision engine** and a **fail-closed deterministic risk engine**, and
executes **paper trades against live order books**. Built from the MIA 4.1 Unified Master Prompt
(Parts 1–33).

> "Quantum" is a product metaphor for bounded parallel analysis. No quantum hardware or algorithms are used.
> MIA never promises profit; scores and consensus are evidence summaries, not win probabilities.

## Status at a glance

| Area | State |
|---|---|
| Live market data (Binance public mirror, Coinbase, Kraken, CoinGecko, DEX Screener, ECB FX, Google News) | **Working, verified live** |
| Scanner → 100-worker QCI → decision engine → risk gate | **Working on live data** |
| Paper OMS (live book-walk fills, fees, OMS-monitored stops, partial TP, trailing, time stops) | **Working**, verified with a real BTC round trip |
| Strategy Lab (walk-forward backtests on real history, Monte Carlo) | **Working** |
| Risk Center, emergency controls, Bot Account, Portfolio, Journal, Profit Calendar | **Working** |
| Trader Joe | **Command mode working**; Claude conversational mode needs `ANTHROPIC_API_KEY` (not exercised in this build environment) |
| Wallet & Withdrawals | Address book, EIP-55/format validation, guided preview, freeze. **Submission blocked by release gate** (no signer, by design) |
| Equities, commodities, on-chain wallets/holders, copy trading, X, Telegram sources | **Pending credentials/licenses**: adapters registered and shown honestly; no simulated data |
| Real-money trading | **LOCKED.** No live venue adapter or signer exists. Mode `BOUNDED_LIVE` is refused by the release gates |

## Quick start

Requirements: Node.js ≥ 22.13 (uses built-in `node:sqlite`), outbound HTTPS to the hosts in `docs/02-integrations.md`.

```bash
npm install
npm run build          # builds the web UI into web/dist
npm start              # serves API + UI on http://127.0.0.1:8787
```

Open the UI, create the **owner passphrase**, then:

1. **Risk Center**: review and accept the risk policy (step-up passphrase).
2. **Strategy Lab**: run backtests, then **promote** a strategy to PAPER only if you accept its out-of-sample record.
3. **Bot Account**: allocate paper capital and switch the mode to **Paper** (or **Approval** to confirm each order).

Development: run `npm run dev -w server` and `npm run dev -w web`; Vite proxies `/api` to port 8787.

## Tests & QA evidence

```bash
npm test                         # 43 unit/integration tests (offline, deterministic)
npm run test:live -w server      # opt-in: real providers + real-order-book paper round trip
npm run qa -w server             # records evidence used by the Release Gates page
```

## Documentation

- `docs/00-repository-audit.md`: Part 22.1 audit
- `docs/01-architecture.md`: topology, trust boundaries, roles vs runtime processes
- `docs/02-integrations.md`: provider/licensing matrix and pending integrations
- `docs/03-traceability.md`: spec part → implementation → tests → status
- `docs/04-runbook.md`: operations, incidents, backup/restore, rollback
- `docs/05-latency-baseline.md`: measured QHEF baseline and bottlenecks
