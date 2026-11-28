# BrainOS shutdown and offline release evidence

This runbook extends the existing scheduler and release gate. No new order authority, background worker pool, deployment provider or runtime mode was introduced.

## Runtime drain contract

1. SIGTERM/SIGINT irreversibly latch process shutdown. The existing `/api/ready` immediately reports HTTP 503 without depending on SQLite; `/api/health` is liveness while HTTP is still listening.
2. Reject new non-health requests; Fastify closes ingress and existing SSE streams. Stop scheduling new lanes (including settlement wakes and late scanner results). The canonical OMS rejects entries/approvals while protective exits remain available to existing work.
3. Drain in-flight scheduler lanes and existing HTTP/knowledge ingestion work under a shared monotonic 20-second deadline. Retain the captured fence until completion. Duplicate drain calls share the same in-flight promise. Fence epochs are not reset.
4. Release only the captured generation; checkpoint SQLite WAL with PASSIVE and close the local connection. A busy/incomplete checkpoint retains committed WAL frames, never truncates them forcibly.
5. Exit zero only after successful completion. If the deadline expires or a phase errors, exit nonzero without clean-close claims; the lease expires if not released, and SQLite recovery plus the existing takeover verification fence subsequent execution. The composition-root 30-second hard watchdog is a backstop, not a promise about any hosting platform's grace window.

Never delete the WAL or lease row to force promotion. In-memory calculations are not durable orders. This build uses cooperative asynchronous lanes and synchronous fenced SQLite transactions, not the speculative worker_threads/OMS architecture in the supplied diagrams. No extra worker thread adapter is necessary.

## P0 regression verification

Run from a clean committed revision with the lockfile installed, Linux/Node >=22.13:

```bash
npm ci
bash scripts/verify-brainos-phases.sh --p0-only
```

The existing CI runs that same command against GitHub's exact tested commit. It now exercises the existing OMS guard, SIGTERM and SIGINT, WAL crash recovery, suspended leader fencing, scanner drain and ingress deadline over three fixed shuffled seeds (13701–13703), with no unexecuted or skipped P0 assertions allowed. The canonical QA evaluator checks exact named assertions and report counters; the P0 wrapper also validates expected file membership, distinct ordered report starts and digests, matching revision and seed manifest. Successful as well as failed runs retain logs in the printed private temp directory; CI uploads them with seven-day retention. Credentials and deployment variables are excluded from the test environment. These are offline test results, not a cryptographic production attestation.

To independently re-check the saved reports:

```bash
MIA_OFFLINE=1 MIA_AUTH_MODE=passphrase node --import tsx server/src/qa/verify-p0-evidence.ts verify /path/to/logs "$(git rev-parse HEAD)"
```

The full existing G09 emergency test predicate requires the additional exact P0 assertions in the full QA report. The separate three-pass bundle is the CI reliability gate, not an alternative to G01–G14. Missing reports, invalid counters, skipped tests, wrong revision, duplicate pass or digest mismatch block the CI check. Use the existing `npm run qa -w server` for G01–G14 evidence.

## Bounded LIVE promotion — explicitly unavailable

`scripts/promote-live-bounded.sh REPORT_DIR EXPECTED_SHA` is a **non-mutating preflight**. It verifies matching offline P0 evidence then exits nonzero even on success. The existing `core/mode.ts` hard-denies BOUNDED_LIVE: this revision lacks the certified external venue, isolated signer and settlement/reconciliation integration. There is no SHADOW execution-mode enum; shadow research is advisory, while PAPER remains the supported autonomous execution environment under the owner-approved mandate, risk policy, qualification and position/slot limits.

No shell environment owner flag, arbitrary ARM/ROLLBACK_CMD, manifest digest, or successful CI run can grant execution or mutate Railway settings. Do not substitute 72 hours of offline results for the existing G10 paper soak (at least 30 days and 50 trades) or bypass the other release requirements. A future real LIVE implementation needs a separate reviewed change and authentic deployment/owner authorization, reconciliation, external risk/security certification, and a tested rollback to a supported runtime mode. No real funds or sessions are modified by this preflight.

Refer to [Deployment guide](../DEPLOYMENT_GUIDE.md) for Railway, [Security](../SECURITY.md) for auth and [existing integration architecture](../engineering/MIA6_BRAINOS_INTEGRATION.md) for canonical execution. The preview/web UI does not acquire trading authorization.
