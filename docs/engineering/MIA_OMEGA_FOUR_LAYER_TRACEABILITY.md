# MIA Ω four-layer traceability

The [CSV register](MIA_OMEGA_FOUR_LAYER_TRACEABILITY.csv) preserves the 100 ticket IDs, priorities, proposed implementations, and acceptance conditions from the owner’s 2026-11-18 four-layer specification. Its source SHA-256 is `86612133a263639aad250826417d68142e9da8ff829feb414ddc53bc59ebce26`. The reviewed code starts from PR #26 at `51895284b9db392c069e6cfcf20775e45d13aea7`.

The rows are grouped by layer and canonical owner. A path in `canonical_owner` identifies the existing component that owns the responsibility, including where new work would extend that component. Semicolon-separated references in `prior_requirements` connect overlapping work to the [existing repository register](REQUIREMENTS_TRACEABILITY.csv). A reference means shared scope, which may cover only part of the current acceptance condition. The source specification’s earlier 300-ticket register was not available for an exact crosswalk.

| Status | Meaning |
|---|---|
| `EXISTING_UNVERIFIED` | An existing implementation or open PR addresses the core behavior. Acceptance needs evidence on the reconciled revision. |
| `PARTIAL_UNVERIFIED` | An existing component covers part of the requirement. The remaining acceptance work is recorded in the row. |
| `PENDING_IMPLEMENTATION` | The required behavior needs implementation in its canonical component. |
| `BLOCKED_EXTERNAL` | A provider, data entitlement, source attribution, or other external prerequisite remains unresolved. |
| `DEFERRED_LIVE` | The behavior depends on a separately authorized execution, mandate, or account scope. |
| `BLOCKED_CI` | A required CI result is currently failing. |

An evidence pointer identifies the related path, existing test, or advisory. The `@PR18` and `@PR19` suffixes identify code on the reviewed PR heads at `74fa093517c3288493e62c676473f73ac1fc640c` and `f7477a5321d0d4ad98e3519acdada1fb1149ceba`, respectively. Those pointers establish ownership and overlap. Passing an individual test supplies only the acceptance evidence it exercises.

- **SENSE** uses the market fabric and provider registry. The order-book stream already has an owner in PR #18. Cached Titan ranking stays in PR #19. SEC filing metadata and provider coverage stay in PR #26. [PR #18](https://github.com/Naokiri5/naokiri/pull/18) · [PR #19](https://github.com/Naokiri5/naokiri/pull/19) · [PR #26](https://github.com/Naokiri5/naokiri/pull/26)
- **THINK** uses the scanner, deterministic workers, QCI, decision engine, and DITAS. The PR #26 chart comparisons are research evidence. [PR #26](https://github.com/Naokiri5/naokiri/pull/26)
- **DEFEND** uses the canonical risk gate, policy, mode, and token safety. PR #18 owns the fail-closed mode transition and Live lock. [PR #18](https://github.com/Naokiri5/naokiri/pull/18)
- **ACT** uses the Paper OMS, ledger, and supervised backend. PR #18 owns its migration guards and PR #25 carries the append-only Telegram v8 migration. [PR #18](https://github.com/Naokiri5/naokiri/pull/18) · [PR #25](https://github.com/Naokiri5/naokiri/pull/25)
