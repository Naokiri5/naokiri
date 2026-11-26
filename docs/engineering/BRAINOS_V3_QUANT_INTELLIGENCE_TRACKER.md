# BrainOS V3 - Quantitative Intelligence and Strategy Evolution: evidence tracker

Tracks the owner's *MIA BrainOS V3 - Quantitative Intelligence and Strategy Evolution* (26 Nov 2026) on branch
`naokiri/jolly-wozniak-8q7ial` (PR #140, which contains #137 and #139). Paper only; LIVE stays locked. A phase is
done only when reproducible evidence in this repository shows it. Updated 2026-11-26.

## Architecture impact check (done before coding)

| Question | Answer |
|---|---|
| New engine, scheduler, worker pool or memory database? | No. Two pure modules inside Strategy Lab (`lab/overfitting.ts`, `lab/qualification.ts`); the genome funnel and cold lane are extended in place. |
| Duplicates existing logic? | No. Walk-forward with purge and embargo already exists in `knowledge/research.ts` and is not reimplemented. Out-of-sample cohort selection was extracted from `strategyStats` into `oosCohort` so the Lab and qualification share one definition. |
| Touches risk gate, OMS or ledger? | No. |
| Changes behaviour? | Yes, deliberately and fail-closed: owner promotion to PAPER now requires a QUALIFIED verdict instead of any stored backtest; genome funnel rejects edges that do not survive multiple testing. Strategies already in PAPER are not demoted. |
| Gives anything trading authority? | No. Verdicts carry `automaticPromotion: false` and `liveAuthority: false`; only the owner can promote. |

## Phase status (document section 9, P0-P7)

| Phase | Status | Evidence | Remaining |
|---|---|---|---|
| P0 Architecture and accuracy baseline | In progress | Risk hardening (`RISK_AUTHORIZATION_HARDENING.md`); component ownership (`BRAINOS_V2_COMPONENT_INVENTORY.md`). | Exact-head CI; recorded strategy and forecast performance baseline on real data (none supplied). |
| P1 Forecast and evidence intelligence | Existing, incomplete | `ditas/calibration.ts` (Brier, log loss, reliability bins), `ditas/forecastVerifier.ts`. | Connect verified outcomes per regime and horizon; `chart/scenarios.ts` weights stay labelled uncalibrated. |
| P2 Strategy evolution | **First slice done** | See below. | Wire the genome funnel to real Strategy Lab experiments (needs real datasets); champion-challenger; CSCV PBO over genome return matrices. |
| P3 Decision quality and metacognition | Not started | QCI dependency groups, Choice shadow arbitration exist. | Specialist reliability, knowledge-gap detection, counterfactuals. |
| P4 Trade lifecycle intelligence | Partial | Closed-trade linker (`ditas/tradeOutcomes.ts`), execution quality (`ditas/execution.ts`). | Entry quality and exit effectiveness from linked outcomes. |
| P5 Persistent adaptive learning | Partial | Immutable outcome-linked records with ledger-verified settlement. | Error memory, drift, research updates from verified outcomes. |
| P6 Portfolio intelligence | Existing, incomplete | `portfolio/correlation.ts`, risk gate concentration rules. | Stress tests, downside dependence, durable reservations (P0.3). |
| P7 Prospective PAPER validation | Not started | - | Frozen-baseline comparison on Railway (volume resize and backup key first). |

## P2 first slice: Strategy Qualification Engine (components 12, 14 partial; tests S03, S04)

- `server/src/lab/overfitting.ts`: Probabilistic Sharpe Ratio, expected maximum Sharpe of N no-skill trials, Deflated
  Sharpe Ratio (Bailey and Lopez de Prado 2014) and Probability of Backtest Overfitting by CSCV (Bailey et al. 2016).
  Per-observation Sharpe only; reproduces the paper's worked example (DSR about 0.90).
- `server/src/lab/qualification.ts`: verdict per strategy version from stored out-of-sample trades. Rules are fixed in
  code: at least 30 OOS trades, current fill model, positive mean R with a 95% lower bound above zero, and DSR of at
  least 0.95 where every stored backtest run of the version counts as a trial.
- `server/src/lab/lab.ts`: `strategyQualification(id)`; owner promotion to PAPER refuses with the verdict's reasons;
  `/api/lab` lists the verdict; `GET /api/lab/strategy/:id/qualification`.
- `server/src/knowledge/cognitive/genomes.ts`, `coldLane.ts`: a genome that passes every other gate is rejected with
  `SELECTION_BIAS_UNCONTROLLED` unless its deflated Sharpe is at least 0.95. N is the whole queued programme, so
  one-at-a-time batching in the cold lane can no longer hide how many hypotheses were tried. Evaluators must now report
  the walk-forward sample count and return moments.
- Tests: `overfitting.test.ts`, `qualification.test.ts`, additions to `brainos7-cognitive.test.ts` and `api.test.ts`.
  The shared backtest fixture is still labelled synthetic; it now carries a 60-trade cohort that qualifies, with
  explicit weak and legacy variants.

## Independent trading-risk review

No blockers. Fixed: cross-trial Sharpe variance is floored at the estimator variance (repeated near-identical runs can
no longer shrink the DSR benchmark); identical re-runs count as one trial; one shared 0.95 threshold; per-observation
Sharpe enforced in the genome contract; drawdown computed in exit-time order; verdicts carry their limitations.
Documented rather than fixed: pooled cross-instrument trades are not independent (sample size optimistic); costs are the
backtest model, not measured depth; a resumed genome programme must pass its full size; no strategy code hash yet, so a
logic change without a version bump keeps old evidence.

**Owner decision needed:** strategies already in PAPER before this rule keep their status. The Lab now shows their
verdict (for example `NOT_QUALIFIED: NO_BACKTEST`). Demoting them, or adding a risk-gate denial for unqualified PAPER
strategies, would stop current paper trading, so it is left to the owner.

## Not claimed

No strategy has been measured as qualified on real market data in this repository. Qualification is necessary for
PAPER, not evidence of future profit, and is never LIVE authorization.
