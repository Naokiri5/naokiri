# MIA NEXUS V3 traceability evidence

[MIA5_TRACEABILITY.csv](MIA5_TRACEABILITY.csv) maps all 64 feature families in SOURCE-C §3.2 and six additional PAPER-side surfaces observed in the repository. The evidence baseline is [PR #45 at `2ceb6dc88ae87a7f324ad3d7f56ecae151288e74`](https://github.com/Naokiri5/naokiri/tree/2ceb6dc88ae87a7f324ad3d7f56ecae151288e74). Its code and test files are branch evidence. Delivery and provider availability require separate verification.

The register uses the existing 12-column format specified by [JDR-001 D-07 in PR #55](https://github.com/Naokiri5/naokiri/blob/afbf6a0b1b68850de33864530388b4902632ac6e/docs/mia5/MIA5_CLAUDE_CODEX_JOINT_DECISIONS.md#1-decisions-that-apply-to-every-mia-50-pr). `NEXUS-V3-F01` through `NEXUS-V3-F64` correspond to the source table's row order. `NEXUS-V3-X01` through `NEXUS-V3-X06` identify the additional surfaces. The prior [engineering traceability](../engineering/REQUIREMENTS_TRACEABILITY.csv), [THINK ticket audit](../think/THINK_TICKET_AUDIT.csv), [Omega traceability](../engineering/MIA_OMEGA_FOUR_LAYER_TRACEABILITY.csv) and [duplication audit](../engineering/MIA_DUPLICATION_AUDIT.md) retain their own scopes. JDR-001 tracks the broader MIA 5.0 work.

- `status` describes the PAPER-side feature on the evidence baseline. `DONE` means the inspected code contains the indicated scoped behavior. `PARTIAL`, `BLOCKED` and `MISSING` name the observed gap.
- `proposed_action` starts with `LIVE_STATUS=<state>.` Release-gated financial and privileged features show `LOCKED`. Missing provider or venue conditions have explicit blockers. `RESEARCH_ONLY` describes the permissible scope of a counterpart. `NOT_IMPLEMENTED` and `NOT_VERIFIED` record missing or unproven counterparts.
- `tests` identifies existing evidence locations. Runtime coverage, test outcomes and external provider access need independent evidence. LIVE certification remains unverified.

## Source integrity

The separate owner-provided manifest is 1,595 bytes. The master Markdown is 184,486 bytes and 1,590 lines. Its SHA-256 matched the manifest value `129cce31f4fc4e7716d9c06f7cebcea0de0257c07719d3b6beb7a31349f60a18`. Raw extraction between each archive's byte markers verified the following entries.

| Archive | Bytes | Lines | SHA-256 |
| --- | ---: | ---: | --- |
| SOURCE-A | 22,882 | 237 | `8139cb21fd8ce4e96c31e1894894ecbc5e7b2d2da24803ae1f2782c8eeeaa86b` |
| SOURCE-B | 22,882 | 237 | `8139cb21fd8ce4e96c31e1894894ecbc5e7b2d2da24803ae1f2782c8eeeaa86b` |
| SOURCE-C | 91,351 | 672 | `aba4df62071e4a5cb7c4ce622445f50e2293bb375c3fe342f32c053cf2f30fc1` |

SOURCE-A and SOURCE-B are byte-identical. They describe the same implementation scope. Embedded code sketches and historical status claims were used as requirements context. The two supplied files remain outside this register.

## Acceptance evidence to reconcile

This increment adds feed-use labels to the existing Market Coverage view and shows the server's environment status in Bot Account (F02, F03 and F52). The new PAPER fixtures exercise stop handling during an emergency pause, stop priority over the maximum hold time, and stop persistence across a database reopen (F31 and F33–F37). These changes supply diagnostics and regression evidence for the existing execution boundary.

| Requirement source | Relevant code, rows or evidence |
| --- | --- |
| SOURCE-A/B §§4–11 | Shared intelligence, distinct financial facts, event scope and release gates map to F01–F63. Their frozen-input and venue fault cases remain independent acceptance work. |
| SOURCE-C §9, CORE-01–CORE-35 | Authority and fail-closed rules belong to the existing module owners in F05–F40 and F50–F62. The [authority-boundary suite](../../server/test/authority-boundaries.test.ts) and [event catalog](../architecture/MIA_NEXUS_EVENT_CATALOG.md) are starting evidence. Full rule-by-rule certification is unverified. |
| SOURCE-C §9, PARITY-01–PARITY-20 | F01–F64 declare both environments, with release and venue blockers. Shared-implementation fixtures, account isolation, full dual-mode UI and release coverage require separate verification. |
| V3 §11, NX-001–NX-020 | F64 maps traceability, F01–F23 map shared data and decision ownership, F25–F47 map account and execution boundaries, and F57–F63 map security, operations and fabric. Source integrity is verified above. Independent exact-head release and other uncovered checks remain unverified. |
| V3 §14, T-001–T-030 | Mode refusal, replay/worker faults, paper exit protection, lease fencing and transactional event delivery have candidate suites linked in the underlying rows. Venue ACK/cancel/fill behavior, LIVE accounting and actual venue protection require separate acceptance evidence. T-030 archive integrity was checked against the supplied manifest. |

The [existing durable log](../architecture/MIA_NEXUS_DURABLE_LOG.md) covers one DITAS research topic. Financial durability requires evidence from the existing owners and transaction boundary. [PR #62](https://github.com/Naokiri5/naokiri/pull/62), [PR #63](https://github.com/Naokiri5/naokiri/pull/63), [PR #64](https://github.com/Naokiri5/naokiri/pull/64) and [PR #67](https://github.com/Naokiri5/naokiri/pull/67) are related recovery, Guardian, reconciliation and research work. Verify their ancestry, scope and status for any follow-up. Future execution requires independent release authorization, venue certification, confirmed and isolated financial state, and no weakening of PAPER safeguards.
