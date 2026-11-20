# THINK slice 2: authority boundaries and worker fault injection

- **Status:** tests only. No production code changed: the existing code already behaved correctly. These tests now **prove** it and keep it that way in the required CI test job.
- **Tickets:** MIA-THINK-015, 016, 022, 028, 029, 091, 092.

## 1. Import boundaries (`server/test/import-boundaries.test.ts`)

The test builds MIA's **runtime** import graph from every `server/src/**/*.ts` file. It ignores type-only imports, which disappear at runtime.

- **Evidence cannot reach trading.** No module under these roots can reach `exec/`, `wallet/` or `portfolio/`, directly or through other modules:
  - `workers/`, `qci/`, `providers/`, `research/`;
  - `knowledge/`, `chart/`, `features/`, `regime/`;
  - `safety/`, `news/`, `whales/`, `lab/`, `journal/`, `notify/`;
  - `decision/certificate.ts`, `decision/profitLab.ts`.
- **Only an explicit allow-list may change things.** These functions are mutators:
  - orders and positions: `submitEntry`, `closePosition`, `closeAllPositions`, `emergencyStop`, `pauseNewOrders`, `protectPositions` and other order-system functions;
  - mode: `updateControl`;
  - risk policy: `acceptPolicy`;
  - wallet: addresses, freeze, withdrawal preview.

  Only the following may import them:

| Module | Allowed | Why |
|---|---|---|
| `api/routes.ts` | all | the owner-authenticated HTTP surface (session, CSRF, step-up) |
| `bot/bot.ts` | `submitEntry`, `queueForApproval`, `monitorPositions`, `expireApprovals` | the paper bot |
| `joe/joe.ts` | `pauseNewOrders` | Trader Joe may read, explain, alert and **pause** only |
| `ops/integrity.ts` | `protectPositions` | risk-reducing |
| `exec/environment.ts` | `submitEntry`, `closePosition` | Paper adapter wraps the canonical OMS |
| `exec/oms.ts` | `updateControl` | `pauseNewOrders` / `emergencyStop` set the pause and emergency flags (risk-reducing) |

Any new import that crosses these lines fails CI. Changing the allow-list requires a reviewed edit to the test. A seeded-violation check proves the guard isn't vacuous.

## 2. Worker fault injection (`server/test/worker-fault-injection.test.ts`)

These tests run through the real `runConsensus` → `decide` → certificate path:

- **A crashing non-mandatory worker** is counted as `failed`, and the coordinator survives.
- **A crashing mandatory check** (round-trip cost) gives `NO_QUORUM` with the check named, and the decision never enters.
- **After 5 faults** the worker is **quarantined**: it isn't run, the result is still `NO_QUORUM`, and the certificate shows the quarantined count and a `QCI_NO_QUORUM` reason.
- **Only the owner** can release a quarantined worker. After release, a fixed worker runs again.
- **A malformed worker result** is rejected before aggregation (`rejected_packets`).
- **A third of the pool crashing at once** never crashes consensus and never yields a trade state.

## Not covered (next slices)

- CPU-overload and priority shedding (014/019).
- A Guardian-priority test under load.
- Correlation limits (053).
- Horizon conflict (037).
- Snapshot replay (010/075).
