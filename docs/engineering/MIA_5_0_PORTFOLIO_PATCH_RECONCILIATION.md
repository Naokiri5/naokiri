# MIA 5.0 — 19-page portfolio patch PDF: compatibility and integration

**Status:** Gap-only, read-only TypeScript enhancement. This document supplements the 140-page five-sleeve source map in PR #85. The attached PDF remains the original source; this is a reviewed adaptation, **not** a byte-for-byte executable patch import.

## Identification before creation

| Attached patch item | Inspected canonical owner | Integration decision |
| --- | --- | --- |
| `docker-entrypoint.sh` + `gosu` + `/app/data` ownership | Current repository deployment workflows and `server/src/config.ts` | **Do not create unreferenced Docker entrypoint**. No matching Dockerfile runtime was established on this branch. |
| `scripts/validate-shadow-metrics.ts` for `mia_ledger.sqlite`, `mia_tca.sqlite`, `shadow_trades`, `tca_executions` | `server/src/db/db.ts`, `server/src/db/migrations.ts`, `server/src/portfolio/ledger.ts`, `server/src/ditas/execution.ts` | **Adapt** to actual canonical `mia.db` and `positions` table. New `server/src/portfolio/paperExpectancy.ts` is one read-only projection surfaced in existing authenticated `GET /api/portfolio`. No new database or change to execution authority. |
| `server/src/brokers/AlpacaBracketReconciler.ts` | Existing `exec/oms.ts` PAPER owner; provider research in draft PR #95 | **Deferred**: no actual broker-account linkage, durable broker order state or `equity_bracket_orders` table. The proposed callback can double count fills and has not been certified against real Alpaca order events. |
| Append chaos tests to `miaChaosSuite.test.ts` | Existing `server/test/*.test.ts` Vitest layout | **Adapt** to focused `server/test/paper-expectancy.test.ts`; preserve all existing tests. The named `miaChaosSuite.test.ts` is not on the reviewed branch. |
| Automatic paper-to-live promotion after 30 profitable trades | Canonical risk gate, owner policy, QA release gates, LIVE lock | **Rejected for execution**. 30 trades may inform research, never unlock LIVE, revoke an emergency pause, or override an owner gate. |
| JIT yield sweeps and futures concurrent drawdown chaos | No authorized vault or futures execution in this branch | **Not installed**; requires verified connectors, account-scoped reconciliation, threat model and tests. |

## Implemented read-only research projection (MIA-ID-11)

- `rollingPaperExpectancy()` queries **only** the canonical paper positions by account, market and strategy; SQL ranks latest 30 closed rows per cohort, with a stable `(closed_at,id)` tie-break.
- It reports observed sample size, win rate, average stored realized USD PnL, mean realized R (only with valid planned risk), and profit factor when losses exist.
- Source thresholds from the patch: 30 observations, positive expectancy and `profit_factor >= 1.25`. `THRESHOLDS_MET_RESEARCH_ONLY` is **not trading eligibility**; insufficient/invalid/unmeasurable evidence never unlocks an order.
- Only canonical `crypto:binance:` positions are labeled the existing `spot` sleeve; other markets remain unmapped, not falsely marked supported.
- Existing `GET /api/portfolio` adds a `paperExpectancy` field. The existing `lab/paperStats()` calculation is preserved for lifetime strategy-health diagnostics, but its query is now explicitly scoped to the canonical PAPER account to prevent cross-account contamination. There is no new API route, engine, risk governor, job, wallet signer, provider dependency, or database migration.
- Tests prove account isolation, 30-row bound, stable repeatability, zero-loss denominator handling, invalid planned risk, unknown markets, and no writes.
- This does **not** implement post-fill T+5s markouts, futures HMM/OFI/VPIN, vault recall, macro calendars, Alpaca brackets or live execution. Review separate draft PRs #84, #67, #95 and #82 rather than copying them.

## Required verification before merging upstream

```bash
npm ci
npm --workspace @mia/server run typecheck
npm --workspace @mia/server run test -- paper-expectancy.test.ts
npm test
npm run build
npm run scan:secrets
```

Manual review must compare this branch to PR #85 and check that `LIVE_EXECUTION_AVAILABLE` remains false. Never treat this standalone research metric as a promotion decision or proof of profitable live trading.
