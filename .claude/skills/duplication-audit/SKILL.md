---
name: duplication-audit
description: Audits MIA for true duplicated logic, repeated UI/API patterns, validation and data pipelines. Use before adding helpers, when code feels repetitive, or when planning cleanup.
---

# MIA duplication and reuse audit

Audit scope: $ARGUMENTS

Read CLAUDE.md first. This is an evidence-based audit, not a mandate to extract every similar-looking snippet.

## Search order
1. Find all existing definitions and call sites for the behavior.
2. Inspect shared modules: web/src/api.ts, web/src/ui.tsx, server/src/features/indicators.ts, server/src/workers/indicators.ts, server/test/helpers.ts, DB helpers, validators and provider adapters.
3. Search repeated calculations, formatting, validation, API error handling, state transitions, SQL, UI widgets and test fixtures.
4. Trace whether copies differ in semantics, lifecycle, ownership, freshness requirements, permission rules or side effects.

## Classification
- A — Exact duplicate: same behavior and contract; a common owner is likely safe.
- B — Near duplicate: shared structure but some differences; extract only stable common mechanism and keep domain-specific policy explicit.
- C — Intentional adapter: one canonical engine feeds a second layer that formats/interprets it. Do not merge.
- D — Similar syntax only: different semantics; do not extract.
- E — Repeated orchestration: consider a cohesive helper/service if call sites share error, transaction and lifecycle behavior.

## Output
Create an evidence table with candidate, paths/symbols, class, evidence and semantic differences, risk and recommendation. Also list canonical modules, confirmed accidental copies, oversized/coupled modules, false positives that should remain separate, and staged remediation with characterization tests.

Never claim exact duplication without comparing full relevant implementations. Never create a generic utils.ts dumping ground. Do not change code during an audit unless the user explicitly asks for fixes.
