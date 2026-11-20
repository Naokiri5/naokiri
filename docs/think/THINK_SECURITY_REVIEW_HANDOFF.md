# THINK: independent security and trading-risk review handoff

- **For:** an independent reviewer (security plus trading risk). **No live execution is authorized** by any THINK work; Live stays LOCKED until separately certified and approved by the owner.
- **Scope:** THINK slices 1 to 4 (PR #33, PR #34, branch `claude/mia-think-03-risk`, and the slice-4 branch).

## What changed in production code

| Slice | Production change | Surface |
|---|---|---|
| 1 | `decision/certificate.ts`, `decision/profitLab.ts` (pure); route `GET /api/decisions/:id/certificate`; web Certificate tab | Read-only, owner session |
| 2 | none (tests) | — |
| 3 | none (tests) | — |
| 4 | `ditas/replay.ts`; route `GET /api/decisions/:id/replay`; `WorkerContext.asOf`; breadth worker reads `c.asOf ?? Date.now()` (v1.2.0); DITAS snapshot context adds `asOf` and `breadth`; coordinator exports `applicableDomains` (same rule, now shared) | Read-only, owner session; one worker's time source |

## Trust boundaries to check

1. **Authority.**
   - Certificates and replays are explanations only: `canAuthorizeTrade: false`; no import path to `exec/`, `wallet/` or `portfolio/` (enforced by `import-boundaries.test.ts`).
   - Mutating functions (orders, mode, policy, wallet) are importable only by an allow-list. Trader Joe may only `pauseNewOrders`.
2. **Inputs.**
   - The new routes take only a decision id (path parameter); no request body.
   - Data comes from the local database (stored report, consensus record, DITAS snapshot).
   - Replay **verifies the snapshot hash** and refuses on mismatch, independent of the DB immutability triggers (tested by dropping the trigger and tampering).
3. **Determinism and look-ahead.**
   - Replay uses only the frozen snapshot plus the recorded evaluation clock. Changing the live market, or the wall clock a day later, does not change the result (tested).
4. **Time-source change.**
   - The breadth worker now uses `ctx.asOf`, set by `buildContext` to `Date.now()`, so live behaviour is unchanged.
   - Reviewer: confirm no code path sets a stale or future `asOf` for live decisions.
5. **No side effects in replay.**
   - No signing, worker statistics, quarantine changes or DB writes (static test plus code reading).
   - It evaluates workers directly, not through `runtime.runOne`.
6. **Language and claims.**
   - No probability is shown without a calibrated cohort: win probability is `null` / `NO_VALID_FORECAST`.
   - A test bans guaranteed-profit and accuracy wording in certificates.

## Known open items

- **`npm audit`:** 12 high findings from Privy's wallet dependencies (`zod` < 4.6.6). This predates THINK; THINK adds no dependencies.
- **Partial replay scope:** replay covers worker evidence and consensus, not the decision engine or risk gate (their account and policy inputs are recorded in the report, not re-derived).
- **Old snapshots:** snapshots recorded before slice 4 lack `asOf` and `breadth`. Their replay falls back to snapshot time and reports this.
- **Not built** (each needs its own reviewed PR):
  - volatility-scaled risk budget and factor clustering (trading-risk review required);
  - horizon-conflict veto (037);
  - calibrated forecast cohort;
  - durable ingestion cursors and gap backfill (076/077);
  - OFFLINE_REPLAY / VENUE_UNKNOWN UI badges (080);
  - Guardian priority under load (014/019).

## How to verify

Run each from the repository root:

```bash
npm ci
```

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run test:e2e
```

```bash
npm run scan:secrets
```

```bash
MIA_OFFLINE=1 MIA_DATA_DIR=$(mktemp -d) node --import tsx scripts/benchmark-think.mjs
```

Key tests:

- `think-certificate.test.ts`
- `import-boundaries.test.ts`
- `worker-fault-injection.test.ts`
- `risk-correlation-sizing.test.ts`
- `think-replay.test.ts`
