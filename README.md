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

Requirements: **Node.js ≥ 22.13** (uses the built-in `node:sqlite`; `.nvmrc` pins 22), npm, outbound HTTPS to the hosts in
`docs/API_INTEGRATIONS.md`. Works on macOS, Linux and Windows (cmd/PowerShell); all scripts are cross-platform.

```bash
npm install
npm start              # builds the UI on first run if needed, then serves API + UI on port 8787
```

Open **http://localhost:8787/** for the public Obsidian Palazzo landing page, or **http://localhost:8787/app** for the **Privy wallet sign-in**. Production MIA no longer offers the old passphrase form. Before login, configure the [Privy wallet setup guide](docs/operations/PRIVY_SIGN_IN.md): set `MIA_PRIVY_APP_ID`, provision the correct `MIA_PRIVY_OWNER_ID` on the server, enable wallet-only login and register the exact HTTPS origin in Privy. The server prints its base URLs:

```
  ➜ Local:     http://localhost:8787/
  ➜ Network:   http://<container-ip>:8787/      (only when bound to all interfaces)
```

Then sign in with the pre-approved **Privy wallet**, enroll MIA two-factor authentication in Security Center using the server-console enrollment proof, and:

1. **Risk Center**: review and accept the risk policy (sensitive actions require a fresh 6-digit authenticator code).
2. **Strategy Lab**: run backtests, then **promote** a strategy to PAPER only if you accept its out-of-sample record.
3. **Bot Account**: allocate paper capital and switch the mode to **Paper** (or **Approval** to confirm each order).

Development with hot reload: `npm run dev` starts the backend (8787) and Vite (http://localhost:5173/, proxies `/api`).

### Host binding and forwarded ports

| Where you run MIA | Default bind | Open |
|---|---|---|
| Your own computer | `127.0.0.1` (not exposed to your network) | http://localhost:8787/ |
| Docker, dev container, Codespaces, Gitpod, Claude Code cloud session | `0.0.0.0` (auto-detected) | the forwarded URL for port **8787** |
| WSL2, a VM, or another device on your LAN | set `MIA_HOST=0.0.0.0` | `http://<machine-ip>:8787/` |

`MIA_HOST` and `MIA_PORT` always override the defaults. Binding `0.0.0.0` exposes the sign-in endpoint to the network: use HTTPS/TLS, the server-verified Privy owner identity and MIA's protected session/CSRF rules. Never expose the offline-only passphrase recovery mode publicly. A static Vercel frontend alone cannot authenticate MIA users: `/api/*` must reach a persistent MIA Fastify backend.

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
npm test                         # 54 unit/integration tests (offline, deterministic)
npm run test:e2e                 # 32 browser checks (Playwright, offline server, all 25 pages)
npm run test:live -w server      # opt-in: real providers + real-order-book paper round trip (network)
npm run qa -w server             # records evidence used by the Release Gates page
npm run scan:secrets             # fails if a key/token/private key is in a tracked file
```

CI (`.github/workflows/ci.yml`) runs the secret scan, `npm audit`, typecheck, unit tests and the browser suite on every push
and pull request.

## Documentation

Start with `docs/PROJECT_STATUS.md` (plain-language status) and `docs/SETUP_GUIDE_BEGINNER.md`. For AI-assisted development, read `docs/CLAUDE_CODE_WORKFLOW.md` and `docs/REFACTORING_BACKLOG.md`.

| File | Contents |
|---|---|
| `docs/PROJECT_STATUS.md` | where the project stands, what needs you |
| `docs/ARCHITECTURE.md` | design, trust boundaries, technology choices, dependencies |
| `docs/REQUIREMENTS_TRACEABILITY.md` | every spec part (1–33) → code → status |
| `docs/IMPLEMENTATION_ROADMAP.md` | phases and prioritized backlog |
| `docs/SETUP_GUIDE_BEGINNER.md` | step-by-step install and first use |
| `docs/API_INTEGRATIONS.md` | data providers, licences, credentials |
| `docs/SECURITY.md` | security audit and controls |
| `docs/TEST_REPORT.md` | test evidence |
| `docs/DEPLOYMENT_GUIDE.md` | running, backups, incidents, rollback |
| [Live-readiness repair register](docs/engineering/MIA_LIVE_READINESS_REPAIR_REGISTER.md) | 50 audit findings, canonical owners, and release evidence |
| `docs/KNOWN_LIMITATIONS.md` | what does not work yet and why |
| `docs/QHEF_LATENCY_BASELINE.md` | measured performance |
| `docs/CHANGELOG.md` | history |
| `docs/CLAUDE_CODE_WORKFLOW.md` | Claude Code setup, specialist agents, slash skills and optional GitHub @claude workflow |
| `docs/REFACTORING_BACKLOG.md` | evidence-based code-organization and duplication-removal plan |

## Global Chart Intelligence

The first phased increment adds closed-candle chart evidence to the Market Terminal and a bounded blind historical replay API. See [implementation status and Claude handoff](docs/chart-intelligence/IMPLEMENTATION_STATUS.md) and [repository audit](docs/chart-intelligence/GLOBAL_CHART_INTELLIGENCE_AUDIT.md). Advanced phases remain tracked there; this increment does not certify strategies for live trading.

## DITAS decision intelligence

Open **DITAS Decision Intelligence** in the sidebar for data health, immutable decision memory, Market DNA, strategy passports, separate paper/hypothetical records and exact-cohort calibration. Research APIs support frozen-decision Twin evaluation and explicit forecast/outcome records. See [DITAS implementation status](docs/ditas/IMPLEMENTATION_STATUS.md) for delivered scope, remaining phases and certification limits.
