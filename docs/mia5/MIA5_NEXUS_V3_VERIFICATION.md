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

## MIA 5.0 TypeScript package compatibility

The package manifest matched all 46 listed ZIP members. The enclosed PDF has 102 pages and SHA-256 `c59a196bff19b81c5830b75e063abbd94c090cb4989faae5cdd1677192a4d304`. The duplicate integration prompts matched the enclosed prompt byte for byte, and the standalone review matched the enclosed master. The archived files remain the source references. The table maps the 18 embedded proposals to their canonical owners and the existing traceability rows.

| PDF file and pages | Existing owner and integration decision |
| --- | --- |
| `IExecutionAdapter.ts` 3–4 | `exec/oms.ts` owns PAPER execution. `core/mode.ts` and the environment capability view retain the LIVE release gate (F27–F30, F52). |
| `RateLimitBudgetGovernor.ts` 4–7 | `core/ratelimit.ts` covers app request throttling. Venue request reservations require a venue adapter and verified endpoint quotas (F39–F40, F60). |
| `PaperOmsAdapter.ts` 7–18 | `exec/oms.ts` owns book-aware simulation and durable fills. Additional maker and partial-fill modeling needs deterministic liquidity and queue fixtures (F27–F33). |
| `LiveOmsAdapter.ts` 18–31 | [PR #72](https://github.com/Naokiri5/naokiri/pull/72) extends the read-only assessor from #64 with venue, account and instrument-scoped precision. Broker recovery and dead-man protection require venue capability evidence (F29–F30, F37–F40, F60). |
| `ExitSupervisor.ts` 32–40 | `lab/exits.ts` and `exec/oms.ts` own exits and protective stops. Order-book exhaustion remains a research candidate (F33–F39). |
| `CorrelationExposureGuard.ts` 40–43 | `portfolio/correlation.ts` and `risk/gate.ts` own current correlation and exposure checks. Cluster sizing needs validated history and stress evidence (F21, F45). |
| `TreasurySweepGuard.ts` 43–49 | `portfolio/ledger.ts` records cash activity. Treasury automation would require a defined policy, verified destinations and signer approval (F41, F46–F47, F57). |
| `UnifiedRiskGovernor.ts` 49–52 | `risk/gate.ts` and `risk/policy.ts` own limits and sizing. Existing safety and account decisions run through that boundary (F20–F26). |
| `MacroCalendarVetoSkill.ts` 52–53 | [PR #67](https://github.com/Naokiri5/naokiri/pull/67) owns the macro calendar work. Integration follows the outcome of that draft and source-freshness verification (F11, F23–F24). |
| `CapitalAllocatorSkill.ts` 54–55 | #67 owns shadow allocation research. The existing risk gate owns operational sizing (F18, F20–F21). |
| `TcaDatabase.ts` 55–59 | `ditas/execution.ts` reports paper OMS costs from the existing fill ledger. It adds recorded maker, taker and unknown fill counts, fee basis points and a fee-inclusive cost summary (F22, F31, F54). |
| `pinWorkerThread.ts` 59 | `workers/runtime.ts` runs the worker pool. CPU affinity requires platform benchmarks (F07, F58). |
| `fastReflexWorker.ts` 59–62 | `workers/registry.ts` owns specialist evidence. Order intents and permissions belong to the risk gate and OMS. Bundle dispatch remains outside the current release (F07, F25–F27, F57). |
| `deepConfluenceWorker.ts` 62–68 | The worker registry, chart analysis and DITAS snapshots own the available inputs. Derivatives-specific funding needs a validated source (F05, F07, F12, F16). |
| `marketIngressWorker.ts` 68–74 | `market/fabric.ts` labels the accepted REST or synchronized stream book. DITAS freezes its source and available update ID with the existing bounded book evidence. A continuous event tape and funding replay require provider and retention work (F04, F12, F16, F56). |
| `NexusFabricRouter.ts` 75–81 | `fabric/contracts.ts`, `outbox.ts` and `relay.ts` own event delivery and read models. Bot Account displays measured outbox health (F53, F59). |
| `index.ts` 81–96 | `server/src/index.ts`, the existing route owners and owner authentication retain app bootstrap and control authority (F52, F57, F62). |
| `FabricHealthStatusBar.tsx` 96–101 | Bot Account uses the existing owner-authenticated outbox and environment endpoints. The card reports pending age, delivery outcomes and registered consumers, with an unavailable state after a failed refresh (F52–F53, F59). |

The DITAS cost window is bounded by the existing orders endpoint. Fee basis points use executed notional. Fee-inclusive cost compares recorded fills and fees against the decision price for the filled quantity and averages comparable orders equally. A missing decision price leaves benchmark-relative costs unavailable. Fill delays measure local recording. Historical decision snapshots remain readable, and new captures mark unrecorded book provenance as unknown.

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
