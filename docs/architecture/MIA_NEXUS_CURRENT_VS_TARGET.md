# MIA NEXUS Ω V3: N0 read-only audit

Date: 2026-11-19. Scope: the owner's *MIA NEXUS Ω V3 All-Connected Master Prompt*, read in full: V3-00…V3-17 plus the V2 appendix sections 00, 01, 02, 07.15–07.17, 24 and the first-message contract. **No code or GitHub writes were made for this audit.**

## 1. Checked baseline

| Item | Evidence |
|---|---|
| `main` SHA | `2627cd276d2108c15a47ba41d60cdb54fddf10ff`, the same SHA the master prompt reviewed. Nothing has been merged since. |
| `main` tests (run locally in a clean worktree) | `npm ci` ✓, `npm run typecheck` ✓, `npm audit --audit-level=high` 0 vulnerabilities. Server tests: **493 passed, 1 failed, 3 skipped**. The failure is `api.test.ts:161`: a 300-character `/api/decisions/:id` returns **414** where the test expects 400/404. It passes on #18, whose CI is green, so this is a `main`-only defect fixed by merging #18. |
| Top of the integration stack (`#40`, `81b19ab`) | CI green on GitHub: typecheck/build, server (794 passed locally), web 21, e2e 85, secret scan, audit 0. |
| Top of the THINK stack (`#36`, `f45526a`) | CI green on GitHub. |
| 1,000-agent registry | **Not supplied.** The manifest lists `MIA_OMEGA_QMC_1000_AGENT_REGISTRY.json` (1,972,900 B) and `MIA_OMEGA_QMC_1000_AGENT_ROLES.csv` (746,405 B), but neither file was uploaded. N5 (QMC registry) is **blocked** until they are. No IDs will be invented. |

## 2. Open PR graph (26 open, 0 merged)

```text
main 2627cd2
├─ #18 claude/blissful-planck-lazglg  (safety + streaming + repairs; base of most work)
│   ├─ #29 → #30 → #31 → #32 → #38 → #39 → #40   integrations / Privy login / prediction / Guardian
│   ├─ #33 → #34 → (think-03) → #35 → #36        THINK certificate / boundaries / replay / horizons
│   └─ #22 codex/telegram-v8 (also opened against main as #23) → #24 → #25 (Google login)
├─ #37 claude/mia-think-03-risk (same branch as the THINK-3 layer, opened against main)
├─ #19 TITAN HUNTER: 1 file, hunt/ranker.ts (+140), read-only
├─ #26 chart intelligence + market coverage → #27 Ω four-layer / paper authority boundaries
├─ #28 CI independent checks + DITAS findings      ├─ #14 backup hardening     ├─ #15 notification center
├─ #20 Telegram hub      ├─ #21 docs: 100-agent roster
└─ (stale stack) #6 DITAS foundation → #8 execution quality   (based on feat/global-chart-intelligence)
```

**Consequences:**
- Any NEXUS work must stack on #18, because everything canonical (DITAS snapshots, the lease fence, the depth stream, QCI R-12) is only on #18.
- #26/#27 and #19 sit on separate stacks from `main` and touch the same owners (`routes.ts`, `oms.ts`, `market/*`).
- **Merge order matters more than new code:** merging #18 first unblocks every stack and fixes `main`'s failing test.

## 3. Source-of-truth matrix: actual owners on the #18 base

| State | Sole writer today (file) | NEXUS role | Status |
|---|---|---|---|
| Live notifications | `core/bus.ts`: a 12-line in-process `EventEmitter` with 16 topics, published by 13 modules (including `exec/oms.ts`) | Keep for best-effort UI fan-out | EXISTS. Not durable, by design. |
| Hot market state | `market/store.ts` (63 lines), `market/fabric.ts` (ingest/poll, 259) | F07 HotStateProjector = reuse | EXISTS |
| Sequence-checked order book | `market/depthStream.ts`: Binance WS with a sequence-checked local book and REST fallback | F03 normaliser (book) | EXISTS (#18) |
| Data quality / freshness | `market/quality.ts` | F12 governor | EXISTS (partly) |
| Immutable market snapshots | `ditas/memory.ts`: `ditas_snapshots` (content-addressed `snap_<sha256>`) + `ditas_blobs` (store-once candles/books) | **F06 snapshot service = DITAS. Do not add `fabric_snapshots`.** | EXISTS (#18) |
| Hash-chained research events | `ditas/memory.ts` `ditas_events` (prev-hash chain, immutability triggers) | F10 lineage source for research | EXISTS |
| Replay | `ditas/replay.ts` (THINK #35: hash-verified, no blob expansion, two-way domain diff) | F11 replay engine = extend | EXISTS on the THINK stack |
| Market capability | `market/coverage.ts` (#26): honest coverage per market with provider status | F16 CapabilityRegistry = extend #26 | EXISTS on another stack |
| Provider registry / health | `providers/http.ts` `registerProvider` / `fetchProvider` (timeouts, rate limits, offline) | F02 ProviderTrustGateway = extend | EXISTS |
| Workers | `workers/{registry,runtime,types}.ts`: 100 deterministic workers `W-XXX-##` | Keep unchanged | EXISTS |
| Consensus | `qci/{schemas,coordinator,challenge}.ts`: 11 domains, `SUPPORT/OPPOSE/ABSTAIN`, regex `^W-[A-Z]{3}-\d{2}$`, R-12 one vote per dependency group | QMC adapter later (N7), shadow first | EXISTS |
| Decision | `decision/engine.ts`; reason-to-trade certificate on THINK #33 | Decision Passport = certificate | EXISTS |
| Risk | `risk/gate.ts`: deterministic, fail-closed | Unchanged authority | EXISTS |
| Paper orders/fills | `exec/oms.ts` (425) under the engine-lease write fence | Unchanged authority | EXISTS |
| Ledger | `portfolio/ledger.ts` | Unchanged authority | EXISTS |
| Scheduler / leader | `bot/bot.ts` hot/scan/background lanes; `ops/lease.ts` engine lease plus `withWriteFence` | F15 priorities = extend | EXISTS |
| Audit | `core/audit.ts`: append-only SHA-256 chain | Guardian #40 reads it | EXISTS |
| Strategy passports | `ditas/passports.ts`: **strategy** rules and stats, not agent passports | Agent passports are new (N5+) | Name collision; keep separate |
| TITAN HUNTER | `hunt/ranker.ts` (#19, read-only, 140 lines) | N8 | EXISTS on its own branch |
| Durable outbox/inbox | none on any branch | F05 | **MISSING** |
| Versioned event envelope + topic catalog | none | F04 | **MISSING** |
| Instrument identity (venue / chain / contract / pool) | `market/types.ts` + `store.ts` IDs (CEX-only in practice) | F01 | **PARTIAL** |
| QMC registry / votes / agent memory | none (registry files not supplied) | N5–N7 | **MISSING + BLOCKED** |
| Fabric read models / UI (`/data-fabric`, `/intelligence/council`) | none | N4 | **MISSING** |

## 4. Event catalog: today's reality per canonical topic

| Topic (V3-04.4) | Current producer | Durable today? |
|---|---|---|
| `market.ticker.updated.v1` | `fabric.ts` → bus `ticker` | No (best-effort, correct) |
| `market.book.synced.v1` | `depthStream.ts` (state only) | No event; state is in memory |
| `market.candle.closed.v1` | `fabric.ts` → bus `candle` | Candles are stored; no event |
| `market.source.degraded.v1` | `providers/http.ts` / `quality.ts` → bus `health` | No |
| `market.snapshot.frozen.v1` | DITAS `ditas_snapshots` | **Yes** (row is immutable; no event) |
| `hunt.candidate.researched.v1` | #19 ranker | No |
| `filter.candidate.evaluated.v1` / `strategy.signal.proposed.v1` | `scanner.ts` → bus `scan`; decision steps | Partly (decision row) |
| `qmc.*` (assignment, vote.sealed, challenge, agent.assessed) | — | **Missing** |
| `qci.consensus.finalized.v1` | coordinator → bus `consensus` + decision record | Partly |
| `decision.certificate.issued.v1` | `decision/engine.ts` → bus `decision`; certificate (#33) | Yes (decisions table) |
| `risk.evaluated.v1` | `risk/gate.ts`, stored in the decision | Yes (inside the decision) |
| `risk.halt.activated.v1` | `core/mode.ts` `control.update` audit + bus `mode` | Yes (audit) |
| `order.*` / `fill.recorded.v1` | `exec/oms.ts` tables + bus `order` | **Yes: OMS tables are the truth** |
| `ledger.updated.v1` | ledger tables + bus `position` | Yes |
| `ditas.outcome.recorded.v1` | `ditas_events` | **Yes** (hash chain) |
| `research.challenger.proposed.v1` | — | Missing |
| `ops.system.degraded.v1` | `ops/readiness.ts`, `exec/incidents.ts` | Yes (incidents) |

**Finding:** every financial and research state already has a durable, authoritative owner. What is missing is a **uniform, versioned, replayable record of transitions** (an envelope plus a catalog plus an outbox), not a second store of truth. The outbox must carry *events about* committed rows. It never replaces the OMS, ledger or DITAS.

## 5. Data contracts proposed (N1)

- `FabricEventV1` (V3-04.3, Zod). Fields:
  - `schemaVersion`, `eventId`, `eventType` (catalog-controlled), `source`, `sourceClass`;
  - `assetId?`, `instrumentId?`;
  - `traceId`, `correlationId?`, `causationId?`;
  - `occurredAt` (nullable), `receivedAt`, `recordedAt`;
  - `snapshotId?` (**= a DITAS `snap_…` id**), `sourceSequence?`, `producerVersion`;
  - `dataStatus`, `accessClass`;
  - `payloadHash` (sha256 of the canonical JSON), `payload`.

  Unknown fields, versions and types are rejected.
- `TopicSpec`: topic, version, owner (the file that is its sole writer), consumers, priority P0–P4, durability (`BEST_EFFORT` / `DURABLE` / `NEVER_COALESCE`), retention, accessClass, maxPayloadBytes, redaction keys.
- Per-topic payload schemas for the topics that have real producers today. `qmc.*` is catalogued as **RESERVED (no producer)**, so nothing fakes activity.

## 6. Implementation order (crosswalk to V2 M0–M10)

| Phase | Builds on (existing) | Blocked by |
|---|---|---|
| **N1 contracts + catalog** (read-only) | bus topics, DITAS ids, provider registry | — |
| N2 outbox/inbox: one research event (`ditas.outcome.recorded.v1`) | DITAS transaction, engine lease | N1 approval; new append-only migration |
| N3 lineage: decision → DITAS snapshot → events | DITAS snapshots, THINK #35 replay | THINK stack merge order |
| N4 read models + `/data-fabric` | api routes, SSE (`useStream`) | N2 |
| N5 QMC registry (1,000 IDs) | — | **registry JSON + CSV not supplied** |
| N6–N7 pilot cohort, then QCI shadow adapter | workers, QCI R-12 groups | N5 |
| N8 TITAN HUNTER | #19 ranker | #19 rebase onto #18 |
| N9 multi-market capability | #26 `coverage.ts` | #26/#27 rebase |
| N10–N14 | — | earlier phases; N14 stays a proposal (no Live) |

## 7. Tests the phases must add (from V3-13, mapped)

- **N1:** envelope rejects unknown fields, versions and topics; the payload hash is deterministic; the catalog has exactly one owner per topic, and that owner file exists; `NEVER_COALESCE` is set on `order.*`, `fill.*` and `ledger.*`; `qmc.*` is RESERVED with no producer; the catalog route needs an owner session.
- **N2:**
  - a rolled-back business transaction emits no event;
  - a committed event before a relay crash is delivered after restart;
  - duplicate delivery has one effect (inbox);
  - a failing consumer goes to the dead letter with an alert;
  - out-of-order events never overwrite newer ones;
  - paper fills are byte-identical with and without the fabric.
- Later phases: everything else in the V3-13 matrix and the 30 V2 fault tests.

## 8. Smallest safe next PR (proposed: N1, no behaviour change)

- **Branch:** `claude/mia-nexus-01-contracts`, stacked on **#18** (not on the integration stack, so it does not wait on Privy, prediction or Guardian).
- **Files:**
  - `server/src/fabric/contracts.ts`: Zod `FabricEventV1`, canonical-JSON hash, validator;
  - `server/src/fabric/catalog.ts`: the 23 V3 topics with owner file, consumers, priority, durability, retention, access and status (`ACTIVE_BEST_EFFORT`, `STATE_EXISTS_NO_EVENT`, `RESERVED`);
  - `GET /api/fabric/catalog`: owner session, read-only;
  - `server/test/fabric-contracts.test.ts`;
  - `docs/architecture/MIA_NEXUS_EVENT_CATALOG.md` and this audit as `docs/architecture/MIA_NEXUS_CURRENT_VS_TARGET.md`.
- **Does not:** add tables or migrations, change any producer, touch QCI/risk/OMS/ledger/DITAS behaviour, add UI, or add dependencies.
- **Proof:** QMC/fabric off ⇒ identical decisions, because nothing consumes the catalog yet. Full CI green.
- **Rollback:** revert the PR.

**Not doing without approval:** any GitHub push or PR, migrations, outbox wiring, QMC IDs (files missing), Live, signing or withdrawals.
