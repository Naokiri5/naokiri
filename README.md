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
| Asset Discovery, QHEF Performance, Security Center, Trading History, command palette (Ctrl/⌘+K) | **Working** (Phase 1) |
| Trader Joe | **Command mode working**; Claude conversational mode needs `ANTHROPIC_API_KEY` (not exercised in this build environment) |
| Wallet & Withdrawals | Address book, EIP-55/format validation, guided preview, freeze. **Submission blocked by release gate** (no signer, by design) |
| Equities, commodities, on-chain wallets/holders, copy trading, X, Telegram sources | **Pending credentials/licenses**: adapters registered and shown honestly; no simulated data |
| Real-money trading | **LOCKED.** No live venue adapter or signer exists. Mode `BOUNDED_LIVE` is refused by the release gates |

## Quick start

Requirements: **Node.js 22.16+ in the 22 LTS line or Node.js 24+** (uses built-in SQLite FTS5; `.nvmrc` selects 22), npm, outbound HTTPS to the hosts in
`docs/API_INTEGRATIONS.md`. Works on macOS, Linux and Windows (cmd/PowerShell); all scripts are cross-platform.

```bash
npm install
npm start              # builds the UI on first run if needed, then serves API + UI on port 8787
```

Open **http://localhost:8787/**. The terminal prints the exact URLs:

```
  ➜ Local:     http://localhost:8787/
  ➜ Network:   http://<container-ip>:8787/      (only when bound to all interfaces)
```

Enter the one-time setup code from the MIA terminal or service log and create your **owner passphrase**. Then:

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

**First-time setup.** Every new MIA instance asks for a **setup code** before you can create the owner account.
It appears in the MIA terminal or service log as `First-time setup code: XXXXX-XXXXX-XXXXX-XXXXX`.
The code is consumed when the account is created. Existing owners can sign in as usual.

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `✖ Port 8787 is already in use` | another MIA instance or program | stop it, or `MIA_PORT=8788 npm start` (PowerShell: `$env:MIA_PORT=8788; npm start`) |
| Browser shows "connection refused" via a forwarded port | server bound to loopback only | `MIA_HOST=0.0.0.0 npm start` |
| Page says "MIA API is running … UI not built" | `web/dist` missing | `npm run build` |
| Setup screen asks for a setup code | the owner account has not been created yet | copy the code from the MIA terminal or service log (`journalctl -u mia`) |
| `✖ MIA requires Node.js 22.16+` | unsupported Node version | install the latest Node 22 LTS or Node 24 LTS (`nvm use`) |
| `✖ Dependencies are not installed` | skipped `npm install` | run `npm install` in the repository root |
| Market data never loads behind a corporate proxy | proxy env | set `HTTPS_PROXY`; the launcher enables `NODE_USE_ENV_PROXY` for Node's fetch |

## Tests & QA evidence

```bash
npm test                         # 54 unit/integration tests (offline, deterministic)
npm run test:e2e                 # 32 browser checks (Playwright, offline server, all 25 pages)
npm run test:live -w server      # opt-in: real providers + real-order-book paper round trip (network)
npm run qa -w server             # records evidence used by the Release Gates page
npm run scan:secrets             # fails if a key/token/private key is in a tracked file
```

Release QA requires Git, npm and tar. It installs the committed lockfile in an isolated snapshot of `HEAD`,
runs the full offline server suite there, and records the commit, exit status and report hash. Commit code
before collecting release evidence. Use `npm test -w server -- <filter>` for focused work on your checkout.

CI (`.github/workflows/ci.yml`) runs the secret scan, `npm audit`, typecheck, unit tests and the browser suite on every push
and pull request.

## Documentation

**Start at [`docs/README.md`](docs/README.md)**: it maps every document by purpose (start here, run and operate, security, features, engineering, planning, history) and shows where each part of the code lives.

| Most-used documents | Contents |
|---|---|
| `docs/operations/SETUP_GUIDE_BEGINNER.md` | step-by-step install and first use |
| `docs/operations/DEPLOYMENT_GUIDE.md` | always-on PAPER operation, readiness, backups, incidents |
| `docs/engineering/DEBUG_AUDIT_2026-11-17.md` | current bug register, test results, performance baseline |
| `docs/SECURITY.md` | security register and controls |
| `docs/ARCHITECTURE.md` | design and trust boundaries |
| `docs/CHANGELOG.md` | history, newest first |

Dated reports from earlier phases (project status, known limitations, test report) are kept under `docs/history/`.

## Global Chart Intelligence

The first phased increment adds closed-candle chart evidence to the Market Terminal and a bounded blind historical replay API. See [implementation status and Claude handoff](docs/chart-intelligence/IMPLEMENTATION_STATUS.md) and [repository audit](docs/chart-intelligence/GLOBAL_CHART_INTELLIGENCE_AUDIT.md). Advanced phases remain tracked there; this increment does not certify strategies for live trading.

## DITAS decision intelligence

Open **DITAS Decision Intelligence** in the sidebar for data health, immutable decision memory, Market DNA, strategy passports, separate paper/hypothetical records and exact-cohort calibration. Research APIs support frozen-decision Twin evaluation and explicit forecast/outcome records. See [DITAS implementation status](docs/ditas/IMPLEMENTATION_STATUS.md) for delivered scope, remaining phases and certification limits.

## Autopilot presentation and monitor

See [the preserved Autopilot requirements and Claude handoff](docs/autopilot/README.md) before continuing the 100-function blueprint. The compact paper cockpit, presentation presets and read-only monitor reuse existing services. [Implementation and verification](docs/autopilot/IMPLEMENTATION_REPORT.md) distinguishes delivered behavior from remaining requirements.
