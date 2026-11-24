# BrainOS 8.0 audit and watchdog reconciliation

Scope: incremental Q42/Q48 foundations against the canonical BrainOS spot-paper stack. No new release authority, signer, order adapter, scheduler, migration, or deployment service.

## Evidence policy

The supplied Q1–Q60 rubric (300 points) has non-compensatory gates Q36, Q37, Q38, Q40, Q41, Q42, Q43, Q45, Q46, Q48, Q53, Q54. A test defined wholly inside a test file, a filename match, a self-reported boolean, or a checksum of a manifest cannot establish production behavior. Existing QA release gates remain authoritative. No maturity points or operational certification are awarded here.

- Q42: the separate read-only lease witness observes the canonical engine lease and durable session checkpoint in one SQLite snapshot. It reports expiry, malformed timestamps, or a mismatched running session. It cannot fence, signal processes, cancel orders or flatten exposure. Existing real-process lease tests exercise takeover, not exchange emergency flattening.
- Q48: the existing audit verifier now checks the stored predecessor as well as the recomputed hash. Existing hash format is unchanged. This is tamper evidence, not immutability against a privileged database writer or proof of a complete history; external trusted checkpoints are still needed. The new tests use a real file-backed database and demonstrate restart and link tampering.
- Run the new test with the existing server Vitest suite. After the existing server build, an external operator can invoke `node server/dist/ops/leaseWitness.js /path/to/mia.db`. Exit 0 indicates an observed current lease, no unbound running checkpoint and structurally valid audit chain; exit 1 indicates degraded evidence, exit 2 an unavailable probe. Neither exit code authorizes financial actions. Do not run this full-chain probe on the trading hot path.

## Deferred import blockers

1. Reuse `db/db.ts`, `db/migrations.ts`, `audit_log`, `runtime_leases`, `brainos_sessions`, `orders`, `fills`, DITAS memory and QHEF. The proposed separate text-version migration table and mirror OMS/lease tables would conflict with canonical state.
2. Map each rubric question to exact production assertions and require exact-head CI evidence, including failing/skipped/absent assertions; do not promote synthetic test fixtures. Use the existing QA report evaluator instead of trusting self-asserted NDJSON.
3. Burn-in requires per-session, exact-build, continuous telemetry, actual sample coverage and independent artifact provenance. A 72-hour elapsed interval, zero missing-event counts or an unsigned SHA-256 digest alone cannot promote a question. Do not add a duplicate live telemetry database.
4. A future external watchdog needs atomic compare-and-set of the observed holder, generation and heartbeat; durable pending/retry/reconciliation state across crashes; process identity verification; and a deployment topology with the same authoritative database. A status-only transition cannot prove exposure was closed. Do not signal PIDs from another container or host.
5. Emergency venue actions require certified account/venue/position-mode scope, fresh venue position queries, stable idempotency, confirmed cancellation and fills, durable settlement, restricted isolated credentials and independent testnet/security review. Existing order rows are not authoritative exchange exposure. No signer or VPS service is provisioned here. Current Railway topology must be reconciled first.

Release status: LIVE remains locked. This patch is not a 60-question certification, a 72-hour soak, a complete external watchdog, or a production rollout.
