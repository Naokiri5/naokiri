# MIA 4.1 — Architecture & Trust Boundaries (Part 22.2)

## Runtime topology

```
                ┌───────────────────────────── Browser (web/) ─────────────────────────────┐
                │ React SPA · Part 15 shell · 19 workspaces · mode banner · SSE live stream │
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
