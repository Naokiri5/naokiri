# MIA Ω four-layer traceability

The [CSV register](MIA_OMEGA_FOUR_LAYER_TRACEABILITY.csv) preserves the 100 ticket IDs, priorities, proposed implementations, and acceptance conditions from the owner’s 2026-11-18 four-layer specification. Its source SHA-256 is `86612133a263639aad250826417d68142e9da8ff829feb414ddc53bc59ebce26`. The reviewed code starts from PR #26 at `51895284b9db392c069e6cfcf20775e45d13aea7`.

The rows are grouped by layer and canonical owner. A path in `canonical_owner` identifies the existing component that owns the responsibility, including where new work would extend that component. Semicolon-separated references in `prior_requirements` connect overlapping work to the [existing repository register](REQUIREMENTS_TRACEABILITY.csv). A reference means shared scope, which may cover only part of the current acceptance condition. The source specification’s earlier 300-ticket register was not available for an exact crosswalk.

| Status | Meaning |
|---|---|
| `TESTED_SCOPE` | A new or existing check exercises the stated scope. New providers and account types need their own evidence. |
| `PARTIAL_TESTED` | Tests cover the stated subset. The remaining acceptance work is recorded in the row. |
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


## Security and dependency review

The checked baseline was `main` at `2627cd276d2108c15a47ba41d60cdb54fddf10ff`. The static review covered that baseline and the reviewed heads of PRs #18, #19, #25 and #26. Searches of tracked filenames, source markers, dependency resolutions and selected Git history found no matching excluded tutorial artifacts. That scope does not establish the provenance of unidentified artifacts. No tutorial links, contracts, external prototype files or funding instructions were used for this change. There are no package or lockfile changes.

The full npm audit flags the development dependency `picomatch` at 4.0.7. The advisory covers versions through 4.0.7 and lists no patched release. Keep the required audit failure visible. PR #18 separates the security audit from the other checks and owns the mode-transition and schema hardening. [GitHub advisory](https://github.com/advisories/GHSA-fc5q-39xc-vjpf) · [PR #18](https://github.com/Naokiri5/naokiri/pull/18)

PR #18 owns schema migrations v6–v7. PR #25 retains them and adds the reconciled Telegram migration as v8. This increment makes no schema or deployment changes. Review it as a draft on the PR #26 branch. Reverting its commits removes the new boundaries and read-only views without requiring a database rollback. If testing a branch with v6–v8, use a separate disposable database or a validated pre-upgrade backup when returning to v5.

## Runtime scope

- The Market Terminal reads normalized Binance spot volume, taker flow and order-book depth through the existing bounded caches. Five-minute flow and missing book data appear as unavailable. These estimates supply research evidence.
- The decision record presents market and strategy evidence, the independent risk result, and the linked Paper OMS entry outcome. The order outcome can show a rejection after a favorable decision.
- DEX safety reports unverified sellability, executable depth, fees, pool controls and concentration. It rejects automation while critical evidence is missing.
- Paper rejects foreign-account order mutations and unsupported risk accounts. Entry checks bind the enrolled strategy version and any approval to the exact decision and venue. Protective exits continue through the existing monitor.
- One Trader Joe retains the existing read, explain and pause tools. The authority test checks direct and transitive runtime imports from research modules.
