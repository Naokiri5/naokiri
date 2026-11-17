# MIA 4.1 — Architecture & Trust Boundaries (Part 22.2)

## Runtime topology

```
                ┌───────────────────────────── Browser (web/) ─────────────────────────────┐
                │ React SPA · Part 15 shell · 25 workspaces · mode banner · SSE live stream │
                └───────────────▲──────────────────────────────────────┬──────────────────┘
                     SSE /api/stream                         REST /api/* (owner session)
                ┌───────────────┴──────────────────────────────────────▼──────────────────┐
                │                         server/ (Node 22, Fastify)                       │
                │                                                                          │
  public APIs ─▶│ L0 Provider adapters ─▶ Market Event Fabric ─▶ MarketStore (in-memory)   │
  (allow-list)  │     (rate-limited,        (provenance, trace,      + incremental features │
                │      health-tracked)       dedupe, freshness)                            │
                │                                   │                                      │
                │      Tiered scanner (T1 broad / T2 deep) ─▶ Strategy candidate generator │
                │                                   │                                      │
                │ L1 Worker pool (100 market workers, 50 indicator specialists — bounded,  │
                │    deterministic evaluators, HMAC-signed evidence packets, deadlines)    │
                │ L2 Challenge panel (bull / bear / contrarian / data-auditor / execution) │
                │ L3 QCI coordinator (domain coverage, dependency caps, quorum, expiry)    │
                │                                   │ consensus record (evidence only)     │
                │ Part 8/16 Decision engine ─▶ Part 17 Risk gate (deterministic, fail-closed)
                │                                   │ ALLOW / DENY / NEEDS_REVIEW          │
                │ Part 9 permission mode ─▶ Last-moment validation ─▶ OMS                  │
                │                                   │                                      │
                │   Paper venue (live book walk, fees, slippage)   │  Live venues: LOCKED  │
                │                                   │                                      │
                │ Ledger ▸ Portfolio ▸ Journal ▸ Profit calendar ▸ Notifications ▸ Audit    │
                │ Trader Joe (Claude API, read-only tools + risk-reducing commands only)   │
                └───────────────────────────────┬──────────────────────────────────────────┘
                                                 │ node:sqlite (WAL) — data/mia.db
```

## Trust boundaries

| Boundary | Rule enforced in code |
|---|---|
| External data → system | All provider payloads parsed by typed adapters; news/token text is never interpreted as instructions (`news/`, `joe/` wrap it as quoted data). |
| Workers → coordinator | Evidence packets validated with Zod schema + HMAC signature + replay cache (`qci/schemas.ts`, `workers/runtime.ts`). |
| QCI → decision | Consensus is evidence only; the decision engine re-checks (`decision/engine.ts`). |
| Decision → risk | Risk gate recomputes from trusted state; any exception ⇒ DENY (`risk/gate.ts`). |
| Risk → execution | Execution requires mode ≥ PAPER, ALLOW, and last-moment validation (`exec/oms.ts`). |
| Real-money execution | No live venue adapter can be enabled: `qa/gates.ts` keeps `LIVE_EXECUTION` locked until gates pass **and** owner authorizes. No signer exists in this build. |
| Withdrawals | Bot has no withdrawal path. Withdrawal workflow stops at preview/`BLOCKED_BY_RELEASE_GATE`. |
| Trader Joe | Tools are read-only except `pause_bot`, `pause_new_orders` (risk-reducing). Cannot change limits, mode, or allocation. |
| Owner config | Risk policy / mode changes require an authenticated session and are written to the append-only audit log with policy versioning. |

## Specialist roles vs runtime processes (Part 22 / 29.2)

The specification's 110 specialists, 50 indicator specialists, 100 market workers and 15 QA roles are
**role definitions**. In this build:

* **100 market workers** and **50 indicator specialists** are real runtime evaluators: deterministic,
  versioned functions over shared features, each with an id, domain, dependency group and
  performance record. They run in a bounded async pool with per-worker deadlines. They are not LLM agents.
* **Challenge panel** reviewers are deterministic analyzers.
* **Trader Joe** is the only LLM component and has no trading authority.
* **QA roles** map to automated test suites and release gates (`server/test`, `qa/gates.ts`).

## QHEF (Part 33) mapping

* Hot lane: incremental indicators on candle close, cached features, candidate-specific worker graphs,
  early quorum only if every mandatory domain present, deadlines → ABSTAIN.
* Background lane: universe refresh, news, CoinGecko metadata, backtests, Monte Carlo.
* Tiered scanning: T1 = all Binance spot tickers (breadth / bubble map); T2 = top-N liquid pairs with
  1h/15m candles and order books.
* Tracing: every stage records latency into histograms exposed at `/api/latency` (p50/p95/p99).
* Transport: in-process event bus. No NATS/Aeron introduced — not justified by measured workload.

## Data model (SQLite, migrations in `server/src/db/migrations.ts`)

`settings`, `audit_log`, `risk_policy_versions`, `decisions`, `consensus_records`, `orders`,
`fills`, `positions`, `ledger_entries`, `journal`, `news`, `notifications`, `address_book`,
`withdrawal_requests`, `strategies`, `backtests`, `worker_stats`, `sessions`.

## Account modes (Part 9 / 15.3 / 26.2)

`OBSERVE` (read-only) → `PAPER` → `APPROVAL` → `BOUNDED_LIVE`, plus `PAUSED` and `EMERGENCY`.
`APPROVAL` in this build prepares **paper** orders for confirmation. `BOUNDED_LIVE` is refused by the
release gate.

## Technology choices, in plain language (Phase 0 assessment)

| Piece | What we use | Why it fits MIA | Verdict |
|---|---|---|---|
| Language | **TypeScript** everywhere | One language for screen and server; types catch mistakes before they run. | Keep |
| Server | **Node.js 22 + Fastify** | Fast, small, good at many simultaneous network requests (market feeds). | Keep |
| Database | **SQLite** (built into Node) | A single file, nothing to install or run separately, easy to back up. Enough for one owner. | Keep. Revisit (PostgreSQL) only for multi-user hosting. |
| Screen | **React + Vite** | Industry standard; fast reloads while developing. | Keep |
| Charts | **lightweight-charts** (TradingView, open source) | Built for financial candlesticks; very light. | Keep |
| Workers | Plain deterministic functions in a bounded pool | 100 checks finish in ~14 ms with no AI cost; results are repeatable and testable. LLMs would be slow, costly and non-deterministic for this job. | Keep |
| Assistant | **Claude API** (Trader Joe) | Only place an LLM adds value; isolated from trading authority. | Keep |
| Message transport | In-process event bus | Measured: internal work is ~40 ms; data-provider round trips dominate. NATS or Aeron would add complexity for no gain. | Keep |

## Dependencies (direct)

| Package | Version | Purpose | Notes |
|---|---|---|---|
| fastify | 5.12.8 | HTTP server | |
| @fastify/static | 10.1.11 | serves the built UI | upgraded in Phase 1 (SEC-01 resolved) |
| zod | 4.6.7 | schema validation (evidence packets, API input) | |
| @anthropic-ai/sdk | 1.8.0 | Trader Joe | |
| fast-xml-parser | 5.12.1 | news RSS parsing | |
| tsx · typescript · vitest · cross-env | 4.23.15 · 7.0.2 · 5.1.0 · 10.1.0 | run TS, typecheck, tests, cross-platform env | dev only |
| react · react-dom · react-router-dom | 19.3.1 · 19.3.1 · 7.18.5 | UI | |
| lightweight-charts · d3-hierarchy | 5.3.0 · 3.1.3 | charts, bubble packing | |
| vite · @vitejs/plugin-react · concurrently | 8.3.8 · 6.3.0 · 10.0.7 | build & dev tooling | dev only |
| @playwright/test | 1.63.0 | browser end-to-end suite | dev only (Phase 1) |

Runtime requirement: Node.js ≥ 22.13 (enforced at startup).

## Code size (Phase 0)
~4,800 lines of TypeScript across 23 server modules, 12 UI files and 10 test files. The largest modules are the market
fabric (411 lines), providers (312), workers (297) and the strategy lab (271).

Measured latency baseline: `QHEF_LATENCY_BASELINE.md`.
