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

Requirements: **Node.js ≥ 22.13** (uses the built-in `node:sqlite`; `.nvmrc` pins 22), npm, outbound HTTPS to the hosts in
`docs/02-integrations.md`. Works on macOS, Linux and Windows (cmd/PowerShell); all scripts are cross-platform.

```bash
npm install
npm start              # builds the UI on first run if needed, then serves API + UI on port 8787
```

Open **http://localhost:8787/**. The terminal prints the exact URLs:

```
  ➜ Local:     http://localhost:8787/
  ➜ Network:   http://<container-ip>:8787/      (only when bound to all interfaces)
```

Then create the **owner passphrase**, and:

1. **Risk Center**: review and accept the risk policy (step-up passphrase).
2. **Strategy Lab**: run backtests, then **promote** a strategy to PAPER only if you accept its out-of-sample record.
3. **Bot Account**: allocate paper capital and switch the mode to **Paper** (or **Approval** to confirm each order).

Development with hot reload: `npm run dev` starts the backend (8787) and Vite (http://localhost:5173/, proxies `/api`).

### Host binding and forwarded ports

| Where you run MIA | Default bind | Open |
|---|---|---|
| Your own computer | `127.0.0.1` (not exposed to your network) | http://localhost:8787/ |
| Docker, dev container, Codespaces, Gitpod, Claude Code cloud session | `0.0.0.0` (auto-detected) | the forwarded URL for port **8787** |
| WSL2, a VM, or another device on your LAN | set `MIA_HOST=0.0.0.0` | `http://<machine-ip>:8787/` |

`MIA_HOST` and `MIA_PORT` always override the defaults. Binding `0.0.0.0` exposes the login page to the network; MIA
requires the owner passphrase for every API call, but put it behind TLS before exposing it beyond a trusted network.

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `✖ Port 8787 is already in use` | another MIA instance or program | stop it, or `MIA_PORT=8788 npm start` (PowerShell: `$env:MIA_PORT=8788; npm start`) |
| Browser shows "connection refused" via a forwarded port | server bound to loopback only | `MIA_HOST=0.0.0.0 npm start` |
| Page says "MIA API is running … UI not built" | `web/dist` missing | `npm run build` |
| `✖ MIA requires Node.js 22.13 or newer` | old Node | install Node 22 LTS+ (`nvm use`) |
| `✖ Dependencies are not installed` | skipped `npm install` | run `npm install` in the repository root |
| Market data never loads behind a corporate proxy | proxy env | set `HTTPS_PROXY`; the launcher enables `NODE_USE_ENV_PROXY` for Node's fetch |

## Tests & QA evidence

```bash
npm test                         # 43 unit/integration tests (offline, deterministic)
npm run test:live -w server      # opt-in: real providers + real-order-book paper round trip (network)
npm run qa -w server             # records evidence used by the Release Gates page
```

## Documentation

- `docs/00-repository-audit.md`: Part 22.1 audit
- `docs/01-architecture.md`: topology, trust boundaries, roles vs runtime processes
- `docs/02-integrations.md`: provider/licensing matrix and pending integrations
- `docs/03-traceability.md`: spec part → implementation → tests → status
- `docs/04-runbook.md`: operations, incidents, backup/restore, rollback
- `docs/05-latency-baseline.md`: measured QHEF baseline and bottlenecks
