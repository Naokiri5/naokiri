# MIA architecture audit — 2026-11-18

Squad A built an import graph with a regex parser, checked against `git grep`: 533 relative imports, 9 side-effect imports, 6 dynamic imports.

**Data and execution flow.** Paper only; verified by Squads A, D and E.
1. **Providers** (`providers/*`, `fetchProvider`: timeout, rate limit, Retry-After back-off).
2. **Market fabric** (`market/fabric.ts`): tickers, closed candles into the FeatureEngine, REST books (and optional stream books) into `market.deep`.
3. **Scanner** (`market/scanner.ts`): strategy signal, then `buildContext`.
4. **Workers** (`workers/runtime.ts`, 100 deterministic evaluators, measured deadline) produce signed packets.
5. **QCI** (`qci/coordinator.ts` v3): own-domain coverage, mandatory checks, one vote per group, adverse evidence counted.
6. **Decision engine** (`decision/engine.ts`).
7. **Risk gate** (`risk/gate.ts`: fail-closed, validated policy).
8. **Paper OMS** (`exec/oms.ts`): book-walk fills only, a write fence under the engine lease, compare-and-set monitor.
9. **Ledger and portfolio** (`portfolio/*`): reconcile with cash identity.
10. **DITAS** decision memory (`ditas/*`): immutable, hash-chained, store-once blobs.

**Ownership.** One canonical module each for:
- backups (`ops/backup.ts` plus the worker verify);
- the lease (`ops/lease.ts`);
- web data access (`web/src/api.ts`);
- the risk gate;
- the OMS;
- mode authority (`core/mode.ts`, which fails closed: SAFE-01).

**Findings:**
- No runtime circular imports.
- No orphan modules: each apparent orphan has a dynamic, side-effect or spawn consumer.
- 107 routes, all registered.
- Every web `/api` call resolves to a route.
- All 10 page modules are reachable.

**Documentation drift** (A-03, A-04, A-05), still OPEN:
- `docs/ARCHITECTURE.md` names a non-existent `LIVE_EXECUTION` identifier. The real lock is `LIVE_EXECUTION_AVAILABLE` in `core/mode.ts`.
- The same document lists 18 tables; there are 39.
- It omits `pdfjs-dist`.
- The README test counts are stale.

**Coupling notes:**
- `qci/challenge.ts`, `decision/scoring.ts` and `ops/integrity.ts` are tested only transitively (J coverage map).
- `any` at the DB boundary (`db/db.ts` `get`/`all` default to `any`) is the main typing risk in the accounting paths (J-08, OPEN).
