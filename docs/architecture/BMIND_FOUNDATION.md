# B-MIND foundation (MIA 5.0, M5-U03a)

**Status:** foundation only. B-MIND is not connected to workers, QCI, decisions or the paper OMS, so it changes no trade. Owner-approved under [JDR-001](../mia5/MIA5_CLAUDE_CODEX_JOINT_DECISIONS.md) (2026-11-20).

## What B-MIND is
B-MIND reads market behavior: fear, panic, FOMO, herding and 28 more patterns from the B-MIND 3.0 master (EM-01…EM-32).
- These are **hypotheses about how traders as a group behave**, inferred from data. They are not feelings inside MIA, not diagnoses of any person, and not forecasts.
- **EM-30 to EM-32** watch MIA itself: one-sided evidence, re-proposing a rejected trade, and re-entering fast after losses. They measure patterns only; they give MIA no feelings and change no limit.

The source's 22 specialist functions (BE-01…BE-22) are not implemented here. Codex's traceability matrix (M5-U00) maps each one to its existing MIA owner, so none is built twice.

## What this slice contains (`server/src/bmind/`)
| File | Contents |
|---|---|
| `contracts.ts` | The types from MIA 5.0 Part I section 5 (`BehavioralObservation`, `BehavioralOverlay`, the five-dimension `BehaviorVector`), the observable inputs, the six existing QCI domains B-MIND may report into, and `BMIND_STANCES` (oppose or abstain only) |
| `atlas.ts` | The 32 constructs. Each lists the inputs it requires, optional inputs, its QCI domains, its role, its caveat, and the most a future validated overlay may do (`effectCeiling`). It also holds MIA's reviewed input baseline, `effectiveCapabilities()` and `constructCoverage()` |
| `observation.ts` | `checkObservation()`, which rejects dishonest observations, and `independentEvidenceCount()` |
| `index.ts` | The public surface |

## The rules it enforces
- **Entries only, never exits.** The effects are `NONE`, `EXPLAIN` and `WAIT`; there is no allow, buy or block.
  - `WAIT` can only ever defer a **new entry**. It never delays a stop, target, time exit, reduce-only order or protection incident.
  - Hard blocks stay with the existing safety and risk gates (JDR-001 K-03, K-10, D-11).
  - A test proves the order, exit, risk, portfolio and wallet code can never reach `bmind/`.
- **Never a supporting vote.** If B-MIND ever feeds QCI, it may only oppose or abstain, like the horizon-conflict challenger.
- **Nothing beyond EXPLAIN in this foundation**, whatever calibration an observation claims. A calibration object is only shape-checked. M5-U06 will require an evaluated report from `ditas/calibration.ts`, bound to the construct and strategy, before `WAIT` can apply.
- **Unknown stays unknown.**
  - A construct whose required data MIA cannot read is `UNKNOWN`, never neutral.
  - An input missing from the capability list counts as unavailable (fail closed).
  - Neither an `UNKNOWN` observation nor any observation of an unobservable construct may carry numbers.
  - An `UNKNOWN` observation stays `UNKNOWN` at expiry.
- **A caller can only lower what MIA observes.** Observations are checked against the weaker of the reviewed baseline and the caller's view, so a producer cannot claim a social feed MIA does not have.
- **Price alone never proves an emotion.** A construct that needs only price data (price/volume, cross-asset) is at most `WEAK`.
- **Independent evidence** counts distinct dependency groups, compared trimmed and case-insensitively, and never more than the distinct origins. Ten reposts of one source are one source.
- **Honest time.**
  - An observation is rejected if its event comes after its receipt, its receipt is in the future, it expires before its event, or its timestamps are not integers.
  - `STALE` is set only by the clock: OBSERVED and WEAK turn `STALE` at expiry, and a producer cannot hand in a `STALE` observation to skip the checks.
  - A multi-input observation carries the times of its oldest required input. The caller passes the clock; nothing reads the wall clock.
  - **For M5-U05:** a replay passes the recorded DITAS `asOf` and reads only the frozen snapshot. News must be selected by when MIA fetched it, not by publication time; otherwise a replay sees headlines MIA did not have yet.
- **Boundaries** (`import-boundaries.test.ts`):
  - `bmind/` reaches nothing outside itself (static, dynamic and side-effect imports);
  - nothing outside `bmind/` imports it yet;
  - orders, exits, risk, portfolio and wallet can never reach it.

  `bmind-foundation.test.ts` adds: no clock, randomness, environment, network or npm packages.

## What MIA could observe with today's inputs
Coverage with the current inputs (`constructCoverage()` on `MIA_INPUT_BASELINE`). **OBSERVABLE means the required inputs exist, not that a validated detector does.**

| State | Constructs | Why |
|---|---|---|
| OBSERVABLE (4) | Uncertainty, Confirmation Bias, Impatience, Revenge/Frustration | Built from source health and MIA's own records. No market emotion is fully observable today |
| WEAK (18) | Fear, Panic, Anxiety, Capitulation, Despair, Relief, Hope, Optimism, Greed, Overconfidence, Complacency, Skepticism, Distrust, Disbelief, Confusion, Surprise, Contagion, Anchoring | One or more inputs are only partial, or the construct is price-only. Partial inputs:<ul><li>the order book is one Binance snapshot per decision, with no history;</li><li>trade flow covers large prints for 12 instruments only;</li><li>news credibility is not verified.</li></ul> |
| UNKNOWN (10) | Dread, Regret, Euphoria, FOMO, Conviction, Curiosity, Anticipation, Herding, Scarcity/Urgency, Loss Aversion | They need data MIA does not have: licensed social media, options, wallet holders, search trends, a scheduled event calendar or cost basis |

A licensed X/social feed would make Regret, Euphoria, FOMO and Herding observable, and Scarcity/Urgency weak (tested). That needs an owner decision (JDR-001 section 6).

## Changing the baseline
When MIA gains a data source, update `MIA_INPUT_BASELINE` in `atlas.ts` in the same PR as the source, with its evidence, and update the coverage test. Never mark a source `AVAILABLE` because a provider is registered but pending.

## Found during review (not fixed here; for M5-U05)
`whales/prints.ts` `printContext()` returns zeros for instruments it never scans (all but the first 12 in the universe). Zero there means "not scanned", not "no selling". M5-U05 must treat it as unavailable; changing the worker input is a separate reviewed PR.

## Next (each needs a separate owner go-ahead)
- **M5-U05:** compute real observations from frozen DITAS snapshots; behavioral passports in shadow.
- **M5-U06:** a strategy-specific overlay (`CONTINUE` / `WAIT` on new entries only), validated against a baseline with an evaluated calibration report before it can affect an entry.

## Tests and rollback
- `server/test/bmind-foundation.test.ts` (20 tests) and a B-MIND block in `server/test/import-boundaries.test.ts` (3 tests).
- **Mutation evidence:**
  - 16 deliberately broken versions of the first version and 2 forbidden imports were caught;
  - after review, 16 more (one per fix) were caught.
- **Rollback:** revert the PR. Nothing else depends on `bmind/`. No migration and no setting.
