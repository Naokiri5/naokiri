---
name: fullstack-delivery
description: Delivers a MIA feature or bug fix across backend, frontend, data contracts, tests, security and documentation. Use for new features, multi-file bugs or end-to-end changes.
---

# MIA full-stack delivery

Task: $ARGUMENTS

Act as the staff full-stack lead. Read CLAUDE.md and relevant rules. Start by checking branch, working tree and current state. Do not overwrite unrelated changes.

## Phase 1 — Understand
- Clarify observable acceptance criteria and identify what must not change.
- Trace UI → API → domain service → market/risk/OMS/database and back as relevant.
- Search for reusable API hooks, UI primitives, validators, feature engines, domain services and test fixtures.
- Ask the architecture analyst for a read-only map on broad tasks. Ask security and trading-risk reviewers to independently inspect relevant trust boundaries.
- Record affected files and contract changes before implementation.

## Phase 2 — Plan
Produce a small implementation plan with file/module ownership, existing code to reuse, proposed new code (only if necessary), behavior/compatibility risks, regression tests and docs. Do not parallel-edit the same files. Assign one implementation owner per file group.

## Phase 3 — Implement
- Make the smallest coherent vertical change.
- Keep route handlers thin and frontend pages compositional.
- Use existing typed contracts and shared helpers.
- Keep business logic out of UI and HTTP transport layers.
- Preserve deterministic, paper-only, fail-closed trading invariants.
- Add regression tests before or alongside the fix.

## Phase 4 — Verify
Run relevant focused tests, then:
- npm run typecheck
- npm run build
- npm test
- npm run test:e2e for relevant user flows
- npm run scan:secrets and npm audit --audit-level=high when security/dependency/release concerns apply.

If local checks cannot run, say why and use CI only when a completed run is available. Never report a pending check as passed.

## Phase 5 — Independent review
Ask the integration reviewer to inspect the actual diff. Ask the duplication specialist to verify no duplicate helper/component/service was introduced. Resolve critical/high findings or clearly mark blockers.

## Phase 6 — Delivery
Summarize changed behavior, files, API/database effects, tests actually run, CI status, known limitations and follow-up items. Do not merge or deploy. Leave unrelated code untouched.
