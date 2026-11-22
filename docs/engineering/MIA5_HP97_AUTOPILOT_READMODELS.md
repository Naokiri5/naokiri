# MIA 5.x HP97 + Autopilot status (first integration slice)

**Source:** owner-provided `MIA5_Unified_Enhancement_PreImport_Package.zip` and nine PDFs.
**Baseline:** `main@a39ddaa597172619d8c897e49464910ebad6681f`.
**Scope:** additive read-only observability. No changes to existing OMS, canonical risk/mode authority, G01-G14 release gates, signing, portfolios, database schema, or trading permissions.

## Exactly what has been integrated

| Area | Existing owner | Extension |
| --- | --- | --- |
| HP97 97-slot schema | `market/store.ts` and `features/indicators.ts` | `market/feature97.ts` represents exact slots 0..96 and ten bucket boundaries. No new indicator computation system. |
| Verified feature values | `market/store.ts`, `market/quality.ts`, `features/indicators.ts` | `market/hp97.ts` projects ticker/book and existing closed 1h indicators, with source timestamps, explicit missing values and stale-book abstention. |
| Autopilot status | `bot/bot.ts`, `core/mode.ts`, `ops/readiness.ts`, `risk/policy.ts`, `portfolio/calendar.ts` | `ops/autopilotStatus.ts` derives a truthful read-only paper status. No new trading mode or owner controller. |
| API | Existing authenticated `api/routes.ts` | GET `/api/market/hp97/:symbol` and GET `/api/autopilot/status`, both session-protected and `Cache-Control: no-store`. |
| Regression tests | Current Vitest harness | `test/mia5-readmodels.test.ts`: 97-slot schema, source attribution, missing unsupported data, stale book, no live authority, authenticated GETs. |

## Guarantees

- A zero feature is never substituted for missing evidence; missing slots remain explicit.
- Perp funding, smart-money, Solana on-chain, memecoin sellability, cross-asset proxy and model-calibrated edge slots remain **absent** until verified canonical sources exist.
- The schema is not the PDF's proposed direct drop-in `NexusFabricRouter` or a 100-thread replacement. SharedArrayBuffer and a hard <4ms promise are postponed until production benchmarks justify them.
- HP97 cannot submit orders, set limits, activate live modes, or change trade outcomes.
- RUNNING in the Autopilot read model means paper operational eligibility, **not demonstrated profitability**.
- Both endpoints share the existing owner session and never expose a new login or auth token mechanism.
- The existing live gate remains locked. No signer, trading credential or real-money adapter is included.

## Existing overlap/PR dependencies: intentionally not merged

- PR #117: core live mode lock, security review still required.
- PRs #118/#119/#121: paper OMS order-state and executed-risk fixes (stacked).
- PRs #62/#116: lease and startup recovery work.
- PRs #112/#113: DITAS outcome memory.
- PRs #89/#111: FAST/DEEP research and exit supervision.
- PRs #92/#97/#98: venue and live-readiness proposals.

Do not bulk-copy the other PDF modules or unify PR #45 into main without a per-file merge review. Keep `qa/gates.ts` G01-G14 semantics intact.

## Verification and deployment

Run from repository root:

```sh
npm ci
npm run typecheck
npm run build
npm test
npm run test:e2e
npm run scan:secrets
npm audit --audit-level=high
```

The HTTP test uses the existing authenticated Fastify `buildApp()` and in-memory DB. Core E2E and CI must pass on this exact branch head. External provider quality tests, 100-worker performance benchmarking, production failover, and profitable-forward-paper certification are explicitly out of scope.

## Next safe integration slices

1. Complete independent risk review of #117 and reconcile #118 → #119 → #121 before changing OMS.
2. Extend versioned QCI snapshot evidence via the existing signed packet schema; add migration tests for v1 packets.
3. Connect verified observed DITAS outcomes without creating a second ledger or database table.
4. Evaluate cost-aware NO_TRADE and calibrated probability gates in SHADOW; prevent live authority changes.
5. Extend the existing Strategy Lab with point-in-time purged walk-forward holdout and realistic cost stress.
6. Build the owner cockpit UI as a consumer of this route, not a new scheduler.

All future migrations and additional capabilities require separate small PRs with exact-head test evidence, independent review, and rollback.
