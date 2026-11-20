# MIA file inventory — 2026-11-18

Machine-readable companion: [`MIA_FILE_INVENTORY.csv`](MIA_FILE_INVENTORY.csv), one row per tracked file (`git ls-files`) at the time of writing.

Columns: `file_id`, `path`, `type`, `purpose`, `consumers`, `tests`, `status`, `test_evidence`, `findings`, `decision`, `notes`.

**How it was built:**
- Squad A's import-graph scripts compute consumers: static, dynamic and side-effect imports, spawn and Worker paths, npm scripts, and test discovery.
- The audit maps findings to files.
- A file is marked **HAS DIRECT TESTS** only when a test file imports it directly. That means it has test coverage, not that it is verified correct in every path.

| Measure | Count |
|---|---:|
| Tracked files | 331 |
| Source in use (USED) | 130 |
| Tests | 85 |
| Docs | 100 |
| Config | 16 |
| Source with direct tests | 83 |
| Source without direct tests (transitive or none) | 47 |
| Files with audit findings | 37 |
| Files with OPEN findings | 27 |
| Confirmed orphan files | 0 (every candidate has a dynamic, side-effect or spawn consumer, per Squad A) |
| Runtime circular imports | 0 |

**Files with OPEN findings** (details in `MIA_ERROR_REGISTER.md`):

- `README.md`: A-04 (OPEN)
- `docs/ARCHITECTURE.md`: A-03 (OPEN)
- `server/src/api/routes.ts`: I-01 H-08 (FIXED); I-06 H-09 H-10 H-11 (OPEN); MA-04 (OWNER)
- `server/src/db/db.ts`: G-01 (FIXED); J-08 (OPEN)
- `server/src/ditas/calibration.ts`: G-06 (OPEN)
- `server/src/ditas/memory.ts`: G-02(part) G-03 (FIXED); G-08 (OPEN)
- `server/src/ditas/service.ts`: G-05 (OPEN)
- `server/src/exec/oms.ts`: E-02 E-03 J-04 MA-20 (FIXED); E-04 E-06 (OPEN)
- `server/src/features/indicators.ts`: C-05 C-12 (OPEN)
- `server/src/knowledge/research.ts`: F-04 F-07 (OPEN)
- `server/src/lab/backtest.ts`: F-03 F-05 F-08 F-10 (OPEN)
- `server/src/lab/exits.ts`: F-03 (OPEN)
- `server/src/lab/lab.ts`: F-01 (FIXED); F-02 F-04 (OPEN)
- `server/src/market/fabric.ts`: B-01 B-02 B-03 (FIXED); B-08 B-10 (OPEN)
- `server/src/ops/backup.ts`: I-03 MA-14 (FIXED); I-02 I-04 I-05 (OPEN)
- `server/src/portfolio/calendar.ts`: E-01 (FIXED); E-07 J-06 (OPEN)
- `server/src/portfolio/ledger.ts`: E-05 E-06 (OPEN)
- `server/src/providers/googlenews.ts`: B-07 (OPEN)
- `server/src/providers/http.ts`: B-03 (FIXED); B-06 (OPEN)
- `server/src/qa/gates.ts`: J-02 MA-16 (FIXED); J-03 (OPEN)
- `server/src/qci/challenge.ts`: D-05 (OPEN)
- `server/src/qci/coordinator.ts`: D-01 D-03 D-06 C-01 J-04 (FIXED); D-02 D-04 D-07 (OPEN)
- `server/src/workers/registry.ts`: C-04 C-06 C-07 (FIXED); C-02 C-05 C-08 C-09 C-10 C-11 (OPEN)
- `web/src/pages/Intel.tsx`: H-05 H-12 (OPEN)
- `web/src/pages/Markets.tsx`: H-01 H-02 (OPEN)
- `web/src/pages/Trading.tsx`: H-03 H-05 H-13 F-06 (OPEN)
- `web/src/ui.tsx`: H-06 (OPEN)

**High-risk source tested only transitively** (Squad J): `qci/challenge.ts`, `ops/integrity.ts`, `decision/scoring.ts`, `workers/indicators.ts`, `portfolio/correlation.ts`, `ditas/service.ts`, `security/security.ts`.

**Not reviewed line by line:**
- the `docs/ditas`, `docs/autopilot` and `docs/chart-intelligence` claims, which were checked for links only;
- the `.claude/` agent and skill content;
- `knowledge/*` internals;
- the `joe.ts` LLM path.
