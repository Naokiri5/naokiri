# MIA NEXUS: fabric event catalog (N1)

Source of truth: `server/src/fabric/catalog.ts`. This table is generated from it; edit the code, not this file. Read-only API: `GET /api/fabric/catalog` (owner session).

**Status meanings:**
- **ACTIVE_BEST_EFFORT:** the owner already publishes this as an in-process bus notification (`core/bus.ts`). It is not durable.
- **STATE_EXISTS_NO_EVENT:** the authoritative state already exists (OMS, ledger, DITAS tables, or the in-memory book), but no fabric event is emitted yet. N2 will record events *about* committed state; it never replaces that state.
- **RESERVED:** no producer exists. Validation rejects these topics, so nothing can fake activity. All `qmc.*` topics are reserved, because the 1,000-profile registry was not supplied.

**Envelope:** `fabric.event.v1` (`server/src/fabric/contracts.ts`, Zod, strict). Each event is checked for:
- a catalogued, non-reserved topic;
- a producer that is the topic's sole owner, with matching source and access class;
- a canonical-JSON SHA-256 payload hash and the topic's payload size limit;
- no secret-looking keys anywhere in the payload;
- UTC timestamps with `receivedAt ≤ recordedAt`, and no event time in the future;
- a `snapshotId` that, when present, is a DITAS content address (`snap_<sha256>`).

| Topic | Sole owner | Status | Priority | Durability | Retention | Access | Bus topic today | Authoritative record |
|---|---|---|---|---|---|---|---|---|
| `market.ticker.updated.v1` | `market/fabric.ts` | ACTIVE_BEST_EFFORT | P2 | BEST_EFFORT | HOT_ONLY | PUBLIC_MARKET | ticker | market/store.ts hot state |
| `market.book.synced.v1` | `market/depthStream.ts` | STATE_EXISTS_NO_EVENT | P1 | BEST_EFFORT | HOT_ONLY | PUBLIC_MARKET | — | sequence-checked local order book (in memory, REST fallback) |
| `market.candle.closed.v1` | `market/fabric.ts` | ACTIVE_BEST_EFFORT | P2 | DURABLE | 1Y | PUBLIC_MARKET | candle | stored candles |
| `market.source.degraded.v1` | `market/quality.ts` | ACTIVE_BEST_EFFORT | P1 | DURABLE | 1Y | SYSTEM_RESTRICTED | health | data-quality flags + provider health registry |
| `market.snapshot.frozen.v1` | `ditas/memory.ts` | STATE_EXISTS_NO_EVENT | P2 | DURABLE | PERMANENT | OWNER_PRIVATE | — | ditas_snapshots (content-addressed snap_<sha256>) + ditas_blobs |
| `hunt.candidate.researched.v1` | — | RESERVED | P3 | DURABLE | 30D | OWNER_PRIVATE | — | TITAN HUNTER ranker lives on PR #19 (not on this base) |
| `filter.candidate.evaluated.v1` | `market/scanner.ts` | ACTIVE_BEST_EFFORT | P2 | DURABLE | 1Y | OWNER_PRIVATE | scan | scan results + decision steps |
| `strategy.signal.proposed.v1` | `market/scanner.ts` | ACTIVE_BEST_EFFORT | P2 | DURABLE | 1Y | OWNER_PRIVATE | scan | strategy candidates from the scanner |
| `qmc.assignment.created.v1` | — | RESERVED | P3 | DURABLE | 1Y | SYSTEM_RESTRICTED | — | QMC registry (1,000 profiles) not supplied; no scheduler exists |
| `qmc.vote.sealed.v1` | — | RESERVED | P3 | NEVER_COALESCE | PERMANENT | OWNER_PRIVATE | — | no vote service exists |
| `qmc.challenge.published.v1` | — | RESERVED | P3 | DURABLE | 1Y | OWNER_PRIVATE | — | no debate coordinator exists |
| `qci.consensus.finalized.v1` | `qci/coordinator.ts` | ACTIVE_BEST_EFFORT | P2 | DURABLE | PERMANENT | OWNER_PRIVATE | consensus | consensus stored inside the decision record |
| `decision.certificate.issued.v1` | `decision/engine.ts` | ACTIVE_BEST_EFFORT | P1 | DURABLE | PERMANENT | OWNER_PRIVATE | decision | decisions table |
| `risk.evaluated.v1` | `risk/gate.ts` | STATE_EXISTS_NO_EVENT | P1 | DURABLE | PERMANENT | OWNER_PRIVATE | — | risk result stored in the decision record |
| `risk.halt.activated.v1` | `core/mode.ts` | ACTIVE_BEST_EFFORT | P0 | NEVER_COALESCE | PERMANENT | OWNER_PRIVATE | mode | control state + audit_log control.update |
| `order.intent.accepted.v1` | `exec/oms.ts` | STATE_EXISTS_NO_EVENT | P1 | NEVER_COALESCE | PERMANENT | OWNER_PRIVATE | order | orders table (paper) |
| `order.state.changed.v1` | `exec/oms.ts` | STATE_EXISTS_NO_EVENT | P1 | NEVER_COALESCE | PERMANENT | OWNER_PRIVATE | order | orders table (paper) |
| `fill.recorded.v1` | `exec/oms.ts` | STATE_EXISTS_NO_EVENT | P1 | NEVER_COALESCE | PERMANENT | OWNER_PRIVATE | order | fills table (paper) |
| `ledger.updated.v1` | `portfolio/ledger.ts` | STATE_EXISTS_NO_EVENT | P1 | NEVER_COALESCE | PERMANENT | OWNER_PRIVATE | position | ledger tables (paper) |
| `ditas.outcome.recorded.v1` | `ditas/memory.ts` | STATE_EXISTS_NO_EVENT | P2 | DURABLE | PERMANENT | OWNER_PRIVATE | — | ditas_events (hash chain, immutability triggers) |
| `qmc.agent.assessed.v1` | — | RESERVED | P3 | DURABLE | PERMANENT | OWNER_PRIVATE | — | no agent evaluator exists (ditas/passports.ts holds STRATEGY passports, not agent ones) |
| `research.challenger.proposed.v1` | — | RESERVED | P3 | DURABLE | PERMANENT | OWNER_PRIVATE | — | no loss-lab challenger producer exists; never auto-promotes |
| `ops.system.degraded.v1` | `ops/readiness.ts` | ACTIVE_BEST_EFFORT | P0 | DURABLE | 1Y | SYSTEM_RESTRICTED | health | readiness checks + exec/incidents protection incidents |
