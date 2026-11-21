# MIA — Coding-agent instructions (Codex / Claude)

**First read [CLAUDE.md](CLAUDE.md)**. It is the maintained engineering guide for this TypeScript/npm-workspace repository. Follow the existing Fastify, Node `node:sqlite`, Vitest and `.js` ESM import conventions. Do not replace `CLAUDE.md` with a pasted external architecture specification.

## Goal

Evolve MIA toward **autonomous, minimum-intervention market research, safe decision evaluation and, only after independent certification, bounded trading**. Routine monitoring, deterministic risk checks and paper execution should not require manual operation on each tick. Human authorization remains necessary for account enrollment, LIVE release, risk-limit increases, identity changes and exceptional financial-state recovery.

## Authoritative implementation ownership

- Market data: `server/src/market/fabric.ts`, `market/quality.ts` and `features/indicators.ts`.
- Intelligence: existing `server/src/workers/registry.ts`, `workers/runtime.ts`, `qci/coordinator.ts`, `decision/*`, `ditas/*`. The 100 W-* workers and dependency-group vote deduplication are canonical.
- Risk: `server/src/risk/gate.ts` and `risk/policy.ts`. Never permit any signal, skill, swarm or LLM to authorize an order independently.
- PAPER positions/financial state: `server/src/exec/oms.ts`, `portfolio/ledger.ts`, `db/db.ts`, `db/migrations.ts`. The existing WAL `mia.db` is authoritative; never introduce a second financial ledger, ORM or database just because a PDF proposed one.
- Existing 30-trade PAPER evidence: `server/src/portfolio/paperExpectancy.ts` and `server/test/paper-expectancy.test.ts`. Strategy-version-specific diagnostic health: `server/src/ditas/passports.ts`. They are **research**, not a LIVE promotion gate.
- Trade environments: `server/src/core/mode.ts` and `exec/environment.ts`. `LIVE_EXECUTION_AVAILABLE=false` stays enforced; an indicator, backtest, 30 profitable simulated trades or UI status may never unlock it.
- Auth/security/operations: existing `server/src/api/auth.ts`, `security/privy.ts`, `ops/lease.ts`, `ops/readiness.ts` and `qa/gates.ts`.

## When importing a specification

1. Compare every proposed symbol, module, table and API against actual branch head and open related PRs; classify REUSE, EXTEND, MISSING, BLOCKED, or CONFLICT before coding.
2. Keep uploaded source as a **non-executable** archive. Do not run embedded scripts, especially destructive `--reset` database seeding, production-signing code or Alpaca submit/cancel "dry runs" that can produce real fills.
3. Make a minimal diff in the **existing domain owner**. Do not copy another `server/src/index.ts`, `UnifiedRiskGovernor`, `LiveOmsRouter`, `SwarmThreadPool`, 100-agent registry, duplicate feature-vector math or fabricated `mia_ledger.sqlite`/`mia_tca.sqlite` accounts.
4. Separate a paper simulator from a genuinely certified venue. Use exact account/environment scope, durable idempotency, source freshness, verified protection, and fail-closed UNKNOWN/reconcile-required states. No automatic order replay after uncertain network outcomes.
5. Preserve independent owner release gates, emergency halts and risk-reducing exits. No code-only override or auto-arm of LIVE. P95 performance targets are unverified until benchmarked under actual loads.
6. Add deterministic regression tests and verify **the exact PR head SHA** via `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `npm run scan:secrets` and relevant security/dependency/E2E checks. Never claim success from an older green CI run.
7. Reuse the related open PR and dependency stack when the work belongs there. Keep non-mergeable, untested or uncertified work **DRAFT**. Do not merge, deploy, force-push or relax checks to make it pass.

## Attached reference and reconciliation

The uploaded 63-page MIA 5.0 Unified Architecture/TypeScript Catalog is archived at
`docs/engineering/sources/MIA_5_0_63_PAGE_UNIFIED_ARCHITECTURE_PDF_PARSED.txt`.
It is the complete *parsed* PDF transcript with 63 page markers, **not** byte-identical original TypeScript. Its proposed five-sleeve matrix, 30-trade promotion, four scripts, 4-ms claims and 19-module map are documented in the corresponding engineering reconciliation appendix. The actual repository and existing security contracts take precedence over mismatched speculative code.
