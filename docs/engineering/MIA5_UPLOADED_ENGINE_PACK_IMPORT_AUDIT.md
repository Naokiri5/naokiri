# MIA 5.0 uploaded native / ingress / capital pack — integration audit

**Status:** PARTIAL, draft review; no LIVE authority; no claim of tested profitability.  
**Repository base:** `main` at `dc6bc1b7c2c91ec4ff6c2d66cb9abd528f38fd13` (2026-11-22).  
**Change intent:** integrate a safe, testable subset into canonical MIA 4.1 ownership; do not copy the attachment's replacement risk engine, OMS, DB, application router, or worker runtime.

## Source inventory and disposition

Seven user-supplied PDFs represent **six unique documents**: the two `CapitalMeshController` PDFs are byte-identical (SHA-256 `dbab772d9302050b44a88f53ba781614a314e4cc38572c2554bce50c0bfa69d5`).

| Attachment (summary) | Proposed modules | Canonical owner / overlapping PR | Decision |
|---|---|---|---|
| CapitalMeshController + IngressCircuitBreaker (24 p.; supplied twice) | Five-sleeve auto yield transfers; Bronze→Silver→Gold and P0/P1-protected shedding | Existing market `fabric.ts`/`quality.ts`, `risk/gate.ts`, `portfolio/ledger.ts`; #45/#71 | **Partially implement ingress validation** here. **Do not** activate capital movement, yield deposits, auto recall, or a second ingress runtime. |
| SolanaShredIngress + OmsOutboxSync (32 p.) | Yellowstone / Jito, whale and DEX detection; separate SQLite OMS outbox | #109 WIN evidence / #46/#50 Solana; existing `exec/oms.ts`, `db/`; NEXUS outbox #43 within #45 | **Blocked.** Needs verified decoded transactions, correct finality, licensed transport, signer/adapter and canonical DB reconciliation. Do not create `mia_ledger.sqlite` alongside `data/mia.db`. |
| Rust napi-rs native core + TypeScript bridge (55 p.) | 97-slot SharedArrayBuffer, VPIN and L5 seqlock native compute | Existing `features/indicators.ts`, `workers/runtime.ts`, `qci/coordinator.ts`; #91 telemetry | **Deferred.** First prove ABI/Atomics memory safety, feature parity, independent native CI builds, and an end-to-end hot-path benchmark. Do not replace deterministic workers. |
| NativeFeatureBridge/SwarmWorkerShmReader wiring (25 p.) | Replaces `UnifiedRiskGovernor`, swarm runtime, `NexusFabricRouter`, new bootstrap script | Existing `risk/gate.ts`, `exec/oms.ts`, `qci/coordinator.ts`; #45 and #91 | **Rejected as drop-in rewrite.** Would split order authorization and incident/ledger authority; use adapters to existing owners after certification instead. |
| QuestDB / DuckDB / SSE panel (PDF: QuestDB tick sink...) | ILP warm sink, Parquet cold analytics, extra SSE broadcaster and UI | Existing SQLite, `core/bus.ts`, `api/routes.ts`, `web/src/api.ts`; #45/#71 | **Deferred.** Separate infrastructure and backpressure/spool recovery required. Extra SSE and duplicate financial truth not justified by measured load; optional research storage only. |
| BanditWeightEngine + AutonomyLifecycleController (27 p.) | Thompson sampling over 100 workers; PAPER→MICRO_LIVE→FULL_LIVE automatic promotion | Existing `workers/effectiveness.ts`, DITAS, `lab/`, deterministic risk, #89/#112 | **Research-only candidate.** Automatic live promotion is explicitly incompatible with MIA's owner authorization and locked LIVE gate. Require out-of-sample, regime, survivorship and TCA tests; never translate learned weights into order authority. |

The PDFs are **engineering proposals, not evidence of running code**. Source PDF formatting includes wrapped code and zero-width characters; text extracted from a PDF must not be pasted as executable TypeScript without reconstruction, security review, and compilation.

## Implemented in this draft PR: canonical ticker ingress validation

1. **`server/src/market/quality.ts`:** `validateTicker24` checks provider identity, source event clock, freshness, finite positive prices, uncrossed spreads, day range consistency, nonnegative volumes and integer trade count. Source age is measured from Binance's `closeTime`, **not** merely local receipt time.
2. **`server/src/market/fabric.ts`:** `ingestTickerSnapshot` admits only validated rows, keeps older out-of-order snapshots from replacing a newer quote, and returns bounded counters. `refreshTickers` now emits one aggregate health event for invalid rows and **throws** when no tracked valid row exists; it does not advance `tickersFetchedAt` or emit a successful ticker event in that case. Existing risk/quality checks continue to age out stale quotes.
3. **`server/test/ticker-ingress.test.ts`:** cases for valid quotes, bad price fields, crossed spreads, malformed 24h range, nonfinite stats, future/stale source events, missing timestamps, replay, mixed batches, and all-invalid provider responses.

This is **one safe subset**, not the attachment's full Bronze/Silver/Gold tick-stream breaker, P2/P3 backpressure, Rust feature engine, full Solana feed, treasury or autonomy runtime. Crucially, safety-critical P0 risk and P1 order-book data are **never discarded** by this change; the new gate operates solely on Binance 24h ticker rows, not execution/OMS frames.

## Architecture, duplication and release guard

- **No added dependencies, migrations, signing keys, live venue connections, treasury transfers, new order types, new worker engine, alternate SQLite files, or route permissions.**
- Existing `risk/gate.ts` remains a fail-closed veto; `exec/oms.ts` alone creates paper orders; workers/QCI remain evidence only.
- **PR conflict:** `#45` and `#71` both change `market/fabric.ts`, and `#45` changes `market/quality.ts`. This PR targets current `main` independently because #45 is presently not mergeable and #71 is stacked on it. Before merge, compare final file hunks against those branches; port the validator into the reconciled canonical file rather than copy both implementations or fast-forward old files over newer work.
- Do not confuse a successful HTTP request with safe market data. A ticker refresh is unsuccessful unless at least one **tracked valid** row passes.
- Do not automatically promote a profitable paper strategy or buy whale-followed tokens. User-approved live enablement and independent venue/risk gates remain separate.

## Acceptance and next steps

Required on **exact PR head SHA**: `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `npm run scan:secrets`, `npm audit --audit-level=high`, and CI review; paper-only replay of provider degradation and independently review #45/#71 overlaps. Browser E2E if any UI is later changed. No commands are represented here as passed until a completed run is inspected.

**Release decision: DO NOT MERGE** until CI and architecture/reconciliation review are complete. **LIVE remains locked.** After this slice, separately evaluate a bounded optional telemetry queue (drop P3 before P2, never P0/P1) with measured backlog limits; then benchmark an optional Rust sidecar against the canonical TypeScript feature engine before discussing production substitution.
