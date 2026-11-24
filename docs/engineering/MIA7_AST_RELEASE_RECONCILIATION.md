# BrainOS 7 — AST isolation and release-package reconciliation

Scope: upgrade the existing BrainOS test in PR #137. No new financial controller, no new production dependency, and no additional CI workflow. TypeScript 7 remains the typechecker; Rolldown 1.2.19 (already in npm lock) is an explicit dev-only AST dependency. Existing npm CI already runs typecheck, QA, build and browser tests.

The proposed cognitive directory is actually server/src/knowledge/cognitive. The previous source audit was regex-only and missed the transitive book retrieval dependency via search -> concepts -> risk/policy. Extract existing retrieval functions without changing algorithms or public search exports; the cognitive reader now imports the retrieval-only module.

The audit recursively walks production roots and follows first-party runtime imports/re-exports, rejects unresolved edges, disallows dynamic/CommonJS loading, detects restricted identifier references and explicit authority escalation, and uses narrow named-import exceptions for canonical DB and config infrastructure. It is not an AST symbol resolver, data-flow/taint analyzer, SQL security sandbox or hostile-code containment. DB/config are trusted terminal owners; dependency packages are not recursively audited. Further hardening: enforce read-only query capabilities, isolated runtime permission and callback validation.

## Uploaded release proposal decisions
- Reuse canonical SQLite WAL database, QA gate, owner control, lease fencing, readiness and OMS. Do not create a second database or an alternative mode authority.
- Reject proposed hash-only LIVE promotion: a digest is not a signature or independent evidence; generatedAtIso is excluded from the supplied digest and may be edited without detection. A 50-cycle smoke fixture is not multi-day operational evidence.
- Do not install the proposed live adapter factory: the repo lacks a certified signer and venue adapters. Constructor-only checks do not authorize future dispatch; each action needs current lease, permission, risk and reconciliation checks.
- Do not replace the actual npm/Railway deployment with the supplied pnpm/Docker assumptions, or expose a parallel health endpoint that claims certified LIVE.
- Do not emit a release certificate, invent Brier scores, enable LIVE, or merge this stacked draft based on unit tests. Canonical G07/G08/G10/G12 blockers remain, including the 30-day paper evaluation.
