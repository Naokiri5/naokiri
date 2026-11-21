# MIA 5.0 Original Bootstrap — Lossless Import, Deduplication and Safe Integration

**Repository:** `Naokiri5/naokiri`  
**Source:** user upload `Pasted text(20261121-055928).txt` (3,135 lines, 108,480 bytes, CRLF).  
**Original SHA-256:** `87760d51b4c40a592d545f6ccfbde15e85f726a8bc06ab2838771cf9d44f8561`.  
**Archived verbatim:** `docs/source-archive/MIA5_20261121_ORIGINAL_BOOTSTRAP_DO_NOT_RUN.sh.txt`.  
**Integration branch:** `feat/mia5-reflex-telemetry-recovery-safe-20261121` (stacked after Adaptive Thinking PR #89).

## Non-destructive import contract

The entire original shell script is present byte-for-byte in the GitHub source archive, including **every line of the 12 TypeScript/TSX/YAML payloads, literal single-quoted heredoc delimiters, original SHA-256 algorithm, conditional backups, CPU-isolation flags, and `--skip-tests` option**. The archive is a **reference, not a runnable installer**. Running the original script from the repo root would overwrite `server/src/index.ts` and introduce incompatible dependencies; do not execute it as-is.

Use the new safe staging command to materialize **all 12 complete original payloads without overwriting existing code**:

```bash
node scripts/mia5-safe-stage.mjs --skip-tests  # stage original files only
node scripts/mia5-safe-stage.mjs               # stage and run adapted isolated chaos tests
```

The safe staging output is `data/mia5-source-staging/MIA5-ID-XX/<original-path>`. It uses SHA-256 to print `CREATED`, `UPDATED`, or `UNCHANGED` and creates timestamped `.bak.<timestamp>` **only when changed**. Writes use same-directory temp files and atomic renames; identical files remain untouched. Stage extraction parses, but **does not execute or interpolate**, the literal heredoc data; TypeScript template literals and GitHub Actions expressions stay intact. Every source ID must match one of exactly 12 expected, ordered blocks and the full source hash must match.

The isolated verification runs `server/test/miaChaosSuite.test.ts` with Vitest's `--no-file-parallelism` and `--bail=1`. It does **not** assert that a placeholder callback achieved sub-10ms market-to-trade execution.

## 12-source-ID integration map

| Source ID | Exact original target | Non-destructive integration | Decision |
|---|---|---|---|
| MIA5-ID-01 | `server/src/telemetry/FastReflexTelemetryLayout.ts` | `server/src/telemetry/reflexTelemetry.ts` | Adapted BigInt64Array 128-byte contract; bigint states expressed as const object, not invalid bigint enums |
| MIA5-ID-02 | `server/src/workers/fastReflexProfiler.ts` | `server/src/telemetry/reflexTelemetry.ts` | Observational recorder, monotonic clocks, CAS maxima, warmup and heartbeat; does not claim network wire measurements without ingress clock |
| MIA5-ID-03 | `server/src/workers/fastReflexWorker.ts` | Full source retained in archive/staging | NOT activated: original `evaluateReflexTick()` body is empty, not a trading engine; owner must provide validated data-frame schema |
| MIA5-ID-04 | `server/src/nexus/readReflexTelemetry.ts` | `server/src/telemetry/reflexTelemetry.ts` | Read-only JSON-safe status; missing heartbeats do not count healthy; supports incident simulation |
| MIA5-ID-05 | `server/src/risk/UnifiedRiskGovernor.ts` | `server/src/ops/dualEngineHealth.ts` | Reuses canonical `risk/gate.ts`, `exec/incidents.ts` and `core/mode.ts`, no second risk governor |
| MIA5-ID-06 | `server/src/nexus/NexusFabricRouter.ts` | `server/src/ops/deepRecovery.ts` | Bounded recovery policy with generation fencing and READY checks; not another leader, worker pool or trade scheduler |
| MIA5-ID-07 | `server/src/alerts/OpsWebhookNotifier.ts` | Existing `server/src/notify/notify.ts` | Kept canonical notification system; separate Telegram/Discord sender not installed |
| MIA5-ID-08 | `server/src/telemetry/telemetrySseRoute.ts` | Existing Fastify `/api/qhef` and in-process SSE | No Express routes. Added QHEF dual-engine health projection |
| MIA5-ID-09 | `server/src/index.ts` | Existing Fastify bootstrap **untouched** | Original proposed Express rewrite rejected. Existing auth, content security policy and route registration preserved |
| MIA5-ID-10 | `web/src/components/ExecutionTelemetryPanel.tsx` | Existing `web/src/pages/Phase1.tsx` QHEF | Added health cards within canonical screen; no duplicate React app or Tailwind requirement |
| MIA5-ID-11 | `server/tests/miaChaosSuite.test.ts` | `server/test/miaChaosSuite.test.ts` | Deterministic clock/heartbeat/abstention/recovery/source-integrity tests, no `better-sqlite3` |
| MIA5-ID-12 | `.github/workflows/mia-ci.yml` | Existing `.github/workflows/ci.yml` | New isolated verification job in canonical required CI without a second Docker/GHCR publish workflow |

## Critical discrepancies in the uploaded original

1. **Framework mismatch:** Source ID-08 imports Express and ID-09 replaces `server/src/index.ts` with Express. MIA uses Fastify with owner auth, CSRF/error/privacy controls. Replacing it would break the site.
2. **Database mismatch:** Source ID-11 and ID-12 use `better-sqlite3` for the trading ledger, but MIA uses Node `node:sqlite` with WAL. Introducing a second ledger driver is unnecessary and dangerous.
3. **No genuine fast-reflex evaluator:** ID-03 `evaluateReflexTick()` is empty; a 10ms test would measure essentially an empty callback. Do not market it as certified real trading speed.
4. **Heartbeat stall mismatch:** A 50ms tripwire against a 250ms heartbeat will repeatedly false-trip a healthy worker. The adapted contract uses a 25ms heartbeat and a 200ms default tripwire, still requiring empirical load testing before any operational alert.
5. **Unfinished dependency:** ID-09 starts `deepConfluenceWorker.js` without defining that module among the 12 payloads. Activating it causes an error. The deep-recovery **policy** is available but no new worker is spawned.
6. **Unsafe authority:** The source's second `UnifiedRiskGovernor` and automatically re-enabled entries after worker recovery conflict with MIA's existing fail-closed execution locks. New policy never grants trade authority.
7. **Duplicate API and notifier:** Source adds Express routes and a second external webhook sender. Existing Fastify/notification systems remain canonical; future Discord integration would require separate credential/network review.
8. **CI workflow duplication:** Source workflow assumes Docker image and registry details that are not established and could publish an unverified image. Existing required checks remain, with one additional isolated contract test.
9. **Environment split:** The source's `MIA_EXECUTION_MODE=LIVE` environment label is **not** a license to unlock real trading. MIA's live gate remains locked.
10. **Latency semantics:** QHEF's `decision.engine` p95 is not an exchange-wire-to-decision measurement. The UI explicitly distinguishes this.

## New active integration points

```text
Canonical scanner, QCI, decision engine, risk gate, OMS  (UNCHANGED)
                       |
              Existing core/latency.ts
                       |
              Existing qhef/qhef.ts
                       |
     NEW ops/dualEngineHealth.ts (READ-ONLY)
                       |
          Existing Fastify /api/qhef
                       |
           Existing QHEF web dashboard

NEW telemetry/reflexTelemetry.ts   -> future real worker adapter, NOT started
NEW ops/deepRecovery.ts            -> future worker recovery adapter, NOT started
NEW server/test/miaChaosSuite...   -> deterministic contract regression
NEW scripts/mia5-safe-stage.mjs    -> exact 12-source idempotent archival staging
```

No new market scanner, decision authority, account, order-manager, signer, approval path, database schema, dependency, Docker image, or external worker framework is installed.

## Verification and promotion checklist

Run the canonical gates on this branch:

```bash
npm ci
npm run typecheck
npm run build
npm run qa -w server
npm test -w web
node scripts/mia5-safe-stage.mjs
npm run test:e2e
node scripts/secret-scan.mjs
npm audit --audit-level=high
```

The PR is intentionally stacked on the existing Adaptive Thinking development branch; do not fast-forward or merge unrelated PRs on `main` implicitly. A future separate, gated implementation can wire a **real** shared-memory ingress/worker and bounded restart controller after exchange snapshot integrity, crash recovery, owner-safe reset, and real p95/p99 latency have been validated under load. All new trade entries must still pass existing QCI, risk and OMS protections for both demo/paper and any future *separately released* live mode.
