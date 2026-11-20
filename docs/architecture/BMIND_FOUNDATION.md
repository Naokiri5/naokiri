# B-MIND foundation (MIA 5.0, M5-U03a)

**Status:** foundation only. B-MIND is not connected to workers, QCI, decisions or the paper OMS, so it changes no trade. Owner-approved under [JDR-001](../mia5/MIA5_CLAUDE_CODEX_JOINT_DECISIONS.md) (2026-11-20).

## What B-MIND is
B-MIND reads market behavior: fear, panic, FOMO, herding and 28 more patterns from the B-MIND 3.0 master (EM-01…EM-32).
- These are **hypotheses about how traders as a group behave**, inferred from data. They are not feelings inside MIA, not diagnoses of any person, and not forecasts.
- **EM-30 to EM-32** watch MIA itself: one-sided evidence, re-proposing a rejected trade, and re-entering fast after losses. They measure patterns only; they give MIA no feelings and change no limit.

## What this slice contains (`server/src/bmind/`)
| File | Contents |
|---|---|
| `contracts.ts` | The types from MIA 5.0 Part I section 5 (`BehavioralObservation`, `BehavioralOverlay`, the five-dimension `BehaviorVector`), the list of observable inputs, and the six existing QCI domains B-MIND may report into |
| `atlas.ts` | The 32 constructs. Each lists the inputs it requires, optional inputs, its QCI domains, its role, its caveat, and the most it may ever do (`effectCeiling`). It also holds MIA's input baseline and `constructCoverage()` |
| `observation.ts` | `checkObservation()`, which rejects dishonest observations, and `independentSources()` |
| `index.ts` | The public surface |

## The rules it enforces
- **Unknown stays unknown.** A construct whose required data MIA cannot read is `UNKNOWN`, never neutral. An input missing from the capability list counts as unavailable (fail closed). An `UNKNOWN` observation may not carry numbers.
- **Price alone never proves an emotion.** A construct that needs only price data (price/volume, cross-asset) is at most `WEAK`.
- **Nothing can say "buy".** The effects are `NONE`, `EXPLAIN`, `WAIT` and `BLOCK`; there is no allow and no buy.
  - No construct may go above `WAIT`. A hard block stays with the existing safety and risk gates.
  - Without a calibrated out-of-sample cohort, an observation may only `EXPLAIN`.
- **Reposts are one source.** Independence is counted by dependency group, not by message count.
- **Honest time.** An observation is rejected if:
  - its event comes after its receipt;
  - its receipt is in the future;
  - it expires before its event;
  - its timestamps are not integers.

  It turns `STALE` at expiry. The caller passes the clock; nothing reads the wall clock.
- **Boundaries** (tests):
  - `bmind/` imports nothing outside itself at runtime;
  - it is listed as evidence code in `import-boundaries.test.ts`, so it can never reach `exec/`, `wallet/` or `portfolio/`;
  - nothing outside `bmind/` imports it yet;
  - it never reads the clock, randomness, the environment or the network.

## What MIA can observe today
Coverage with the current inputs (`constructCoverage()` on `MIA_INPUT_BASELINE`):

| State | Constructs | Why |
|---|---|---|
| OBSERVABLE (6) | Panic, Relief, Uncertainty, Confirmation Bias, Impatience, Revenge/Frustration | Built from the order book plus price, source health, or MIA's own records |
| WEAK (17) | Fear, Anxiety, Capitulation, Despair, Hope, Optimism, Greed, Overconfidence, Complacency, Skepticism, Distrust, Disbelief, Confusion, Surprise, Anticipation, Contagion, Anchoring | They need trade flow (only large prints), news (credibility not verified) or macro events (headline-based), or they are price-only |
| UNKNOWN (9) | Dread, Regret, Euphoria, FOMO, Conviction, Curiosity, Herding, Scarcity/Urgency, Loss Aversion | They need data MIA does not have: licensed social media, options, wallet holders, search trends or cost basis |

A licensed X/social feed would move Regret, Euphoria, FOMO and Herding out of UNKNOWN (tested). That needs an owner decision (JDR-001 section 6).

## Changing the baseline
When MIA gains a data source, update `MIA_INPUT_BASELINE` in `atlas.ts` in the same PR as the source, with its evidence, and update the coverage test. Never mark a source `AVAILABLE` because a provider is registered but pending.

## Next (each needs a separate owner go-ahead)
- **M5-U05:** compute real observations from frozen DITAS snapshots; behavioral passports in shadow.
- **M5-U06:** a strategy-specific overlay (`CONTINUE` / `WAIT` only), validated against a baseline before it can affect an entry.

## Tests and rollback
- `server/test/bmind-foundation.test.ts`: 19 tests. Each of 16 deliberately broken versions of the code, plus two forbidden imports, was caught by a failing test.
- `server/test/import-boundaries.test.ts`: `bmind/` is added to the evidence roots.
- **Rollback:** revert the PR. Nothing else depends on `bmind/`. No migration and no setting.
