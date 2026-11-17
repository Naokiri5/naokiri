---
name: release-review
description: Performs a final MIA release and pull-request readiness review across implementation, tests, security, trading safety, duplication and documentation.
---

# MIA release-readiness review

Review scope: $ARGUMENTS

Read CLAUDE.md and inspect the actual git diff. Do not edit code or merge.

Review correctness and edge cases; backend/frontend contracts; authentication, authorization, CSRF, secrets, untrusted content and dependencies; market-data freshness/provenance, risk gates, paper OMS, fill depth, fees, position/ledger reconciliation; duplicate logic and reuse; regression coverage/determinism; typecheck/build/CI evidence; append-only migrations; documentation accuracy; and diff hygiene.

Return a go/no-go table. Findings require severity, path/symbol, evidence, consequence and recommended action. State checks actually executed and whether Actions results are pending. A pending CI run is not a pass. Do not imply this paper-only product is safe for live trading.
