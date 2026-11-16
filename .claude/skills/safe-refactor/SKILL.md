---
name: safe-refactor
description: Executes small, behavior-preserving refactors to remove confirmed duplication, split oversized modules and improve separation of concerns with regression protection.
---

# Safe refactoring protocol

Refactor target: $ARGUMENTS

Read CLAUDE.md and invoke the duplication audit first. For risky domains, obtain architecture and trading-risk review.

## Rules
- Refactor only confirmed A/B/E candidates; preserve C and D.
- State current behavior/contracts before moving code.
- Add characterization tests for existing behavior, including failure paths.
- Refactor one boundary at a time. Do not combine structural moves with new behavior.
- Keep names, public routes, request/response payloads, schema and observable UI unchanged unless explicitly authorized.
- Move code behind stable, domain-named modules. Avoid circular dependencies, barrels that obscure ownership, generic catch-all helpers and broad renames.
- Keep shared mechanisms separate from domain-specific policies.
- Preserve transactions, timestamps, ordering, error mapping, permissions and idempotency.
- Update imports and documentation. Remove old code only after all call sites use the canonical module.

## For large modules
1. Identify cohesive responsibilities and callers.
2. Extract one group with its own tests.
3. Keep a small composition/registration entry point.
4. Run tests and typecheck after each extraction.
5. Check dependency direction and circular imports.
6. Review the final diff for behavior changes and accidental reformatting.

## Done means
Relevant tests pass; typecheck/build pass; API/UI contracts are unchanged; duplicate paths are removed; docs/imports are updated; final reviewer findings are resolved or listed as blockers.
