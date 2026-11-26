# EVIDENCE Omega: evidence tracker

Tracks the owner's *MIA BrainOS - EVIDENCE Omega Evidence Intelligence Architecture* (26 Nov 2026) on branch
`naokiri/jolly-wozniak-8q7ial` (PR #140). As the document asks, EVIDENCE Omega is a milestone inside DITAS, not a second
evidence engine: no new database, ledger or event system was added. Updated 2026-11-26.

## This increment

- `server/src/ditas/evidenceCoverage.ts`, `GET /api/ditas/evidence-coverage`, and an "Evidence coverage" panel on the
  DITAS "Intelligence evaluation" tab. It classifies the evidence behind every recent decision (frozen market snapshot,
  worker findings, risk decision, decision record) and reconstructs every recent closed trade's chain, using the
  document's quality vocabulary: OBSERVED, VALIDATED, RECONCILED, REJECTED, UNAVAILABLE, STALE. Missing evidence is
  counted by name; classification happens on read, never from a stored PASS.
- Tests: `server/test/ditas-evidence-coverage.test.ts` (empty, fully evidenced, missing and compacted evidence, unlinked
  and altered trades, malformed decisions, limits; mutation-checked) and an e2e check of the panel.

## The 30 upgrades (section 13)

| # | Upgrade | Status | Where |
|---|---|---|---|
| 1 | Universal evidence schema | Partial | QCI packet schema (`qci/schemas.ts`), DITAS events, outcome records; classification on read in `evidenceCoverage.ts`. No single shared type yet. |
| 2 | Source identity verification | Partial | Provider registry (`providers/http.ts`); host not enforced (see SECURE Omega matrix, SSRF). |
| 3 | Market data provenance | Implemented | DITAS snapshots record source, receipt and provider times. |
| 4 | Source and receipt timestamps | Implemented | Quote and book age checks in risk gate and OMS. |
| 5 | Freshness policies | Implemented | `market/quality.ts` limits; fail closed. |
| 6 | Missing evidence recognition | Implemented | QCI required domains, risk gate denials, evidence chain gaps, coverage UNAVAILABLE counts. |
| 7 | Contradictory evidence detection | Partial | QCI opposition and challenge; cross-venue disagreement. |
| 8 | Evidence independence | Implemented | QCI dependency-group caps; worker reliability per group. |
| 9 | Immutable decision-time snapshots | Implemented | DITAS snapshots and events (immutable triggers). |
| 10 | Feature-vector linkage | Partial | Snapshot carries features; no separate feature-vector id. |
| 11 | QCI contribution provenance | Implemented | Packets with worker id, version, sources, freshness, dependency group. |
| 12 | Reason-to-trade certificate | Missing here | Draft PR #33; not merged into this branch. |
| 13 | Risk authorization evidence | Partial | Gate decision stored on the decision; entry authorization is checked in the OMS transaction but not persisted. |
| 14 | Token security evidence | Blocked | FAST requires Solana providers. |
| 15 | Executable liquidity evidence | Implemented | Depth-walk fill checks; protection depth checks. |
| 16 | Execution-event linkage | Implemented | `ditas/evidenceChain.ts`. |
| 17 | Fee and fill reconciliation | Implemented | Outcome settlement verified against the ledger. |
| 18 | Position-closing evidence | Implemented | Outcome records with exit reason and fills. |
| 19 | Automated forecast settlement | Implemented | `ditas/forecastVerifier.ts` (owner-registered forecasts). |
| 20 | Probability calibration | Partial | `ditas/calibration.ts`; no production forecasting model. |
| 21 | Strategy performance provenance | Implemented | Strategy qualification from stored OOS trades. |
| 22 | Walk-forward evaluation | Implemented | `knowledge/research.ts` (purge and embargo). |
| 23 | Evidence-backed worker effectiveness | Implemented | `workers/reliability.ts`. |
| 24 | Model drift evidence | Partial | Strategy health suspension; no model drift detector. |
| 25 | Counterfactual verification | Partial | DITAS Twin (labelled hypothetical). |
| 26 | Evidence-based learning promotion | Implemented | Qualification required for PAPER; owner approves. |
| 27 | Tamper-evident records | Implemented (local) | Hash-chained audit log, DITAS hashes, outcome hashes. External checkpoints not built. |
| 28 | Runtime and recovery certification | Partial | Crash-injection suite; not yet run on Railway. |
| 29 | PAPER/LIVE evidence parity | Not applicable yet | No LIVE adapter. |
| 30 | Evidence inspector | Partial | Chain API, coverage panel; no per-trade inspector screen yet. |

## Certification levels (section 17) mapped to existing gates

The eight levels are already covered by the release gates (`qa/gates.ts`); no second gate system was created.

| Level | Existing evidence |
|---|---|
| 1 Source verification | Data quality gate; G02. |
| 2 Calculation verification | Indicator and chart tests; G01. |
| 3 Decision verification | Evidence chain and coverage (this increment); G05. |
| 4 Historical evaluation | Strategy qualification, walk-forward. |
| 5 Prospective PAPER | G10 (30-day paper evaluation; pending). |
| 6 Operational | G09, crash-injection suite. |
| 7 Venue | G12 (not implemented by design). |
| 8 Controlled LIVE | G13 and G14 (independent auditor and owner authorization). |
