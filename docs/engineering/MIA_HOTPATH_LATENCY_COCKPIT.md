# MIA hot-path telemetry: owner-authenticated cockpit (draft)

## Source reconciliation

- Uploaded Phase 1 HP1-01/HP1-07 and web HP1-09/HP1-10 call for p50/p95/p99, ELD/ELU, venue weight, local order books and owner reset.
- Uploaded Phase 2 calls for AdaptiveBackpressureController, PriorityCandidateQueue, BoundedParallelCandidateEvaluator, CandidatePipelineCoordinator, and tests. These **are not installed by this draft** because the current runtime has no validated incremental diff-depth WebSocket stream and the existing worker/OMS/risk ownership must be reconciled first.
- Original PDF used `packages/server` and `packages/web` paths; this repository uses `server` and `web`. PDF Tailwind and Bearer-token/sessionStorage examples do not match MIA's CSS and authenticated same-origin cookie + CSRF design.
- Canonical `server/src/core/latency.ts`, `server/src/qhef/qhef.ts`, `server/src/market/store.ts`, `server/src/market/fabric.ts`, `server/src/market/quality.ts` and `server/src/exec/oms.ts` remain owners. No parallel monitor, Book, ExitSupervisor, ModeGuard, OMS, scheduler, or risk manager is introduced.

## End-to-end implemented path

Existing `record()` stage timings → existing `qhefReport()` + existing ELD sampler → additive ELU delta + truthful REST book observation → owner-authenticated `GET /api/telemetry/latency` → `web/src/components/LatencyReliabilityCockpit.tsx` displayed inside existing QHEF page.

Reset uses the existing owner session, CSRF policy and audit log: `POST /api/telemetry/latency/reset` → existing `resetLatency()` and `resetLoopDelay()`. It does not read credentials from sessionStorage.

No actual weight counters/cooldown/WS sync state are available. API emits `null` / `REST_SNAPSHOT_UNVERIFIED` and UI displays that limitation; never fake PASS or full available weight. Source budgets are engineering targets, not guaranteed observed speed or authorization for live trading.

## Verification and blockers

- Added Fastify contract tests for authentication, CSRF, measured stage, truthful transport evidence, reset and unchanged trading control.
- Requires exact-head CI run, TypeScript builds, unit/integration tests, browser smoke and security review before readiness can be assessed.
- External Binance rate-limit headers, 429/418 backoff, synchronized diff-depth local book, independent protective exit lane, Stage 4 proposed sub-50ms probes and Phase 2 scheduling/backpressure remain **NOT IMPLEMENTED**.
- PR #126 owns Choice Management FAST/DEEP shadow research and must stay separate. PR #114 owns ticker ingress validation; PR #62 has depth-continuity research on a stacked branch; PRs #91/#93 carry different telemetry architectures. Reconcile these before hot-path cutover.
- **DO NOT MERGE** until tests, architecture reconciliation, and owner approval; LIVE authority remains unchanged.
