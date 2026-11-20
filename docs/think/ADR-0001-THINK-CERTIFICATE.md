# ADR-0001: MIA Ω THINK builds on the existing pipeline; first slice is a Reason-to-Trade Certificate

- **Status:** Accepted for a draft PR (paper-only). Not merged.
- **Date:** 2026-11-18
- **Context documents:** the owner's THINK package (blueprint, 100 tickets, no-duplication master prompt). The ticket audit is in [`THINK_TICKET_AUDIT.json`](THINK_TICKET_AUDIT.json) / [`.csv`](THINK_TICKET_AUDIT.csv).

## Context

The blueprint asks MIA to "think" faster and more honestly, without adding 100 new agents, a second scanner, a second risk engine or a new OMS. The repository already has almost all of the structure the blueprint describes:

| Blueprint concept | Already in MIA (canonical owner) |
|---|---|
| 100 analyzers in 11 domains | `server/src/workers/registry.ts`, `workers/runtime.ts` (bounded pool; faults become ABSTAIN) |
| Skeptic council, domain caps, veto | `server/src/qci/coordinator.ts`, `qci/challenge.ts` (BULL / BEAR / CONTRARIAN / DATA_AUDITOR / EXECUTION) |
| One central decision | `server/src/decision/engine.ts` (`decide`) |
| Independent DEFEND | `server/src/risk/gate.ts` + `risk/policy.ts` (sizing, costR, stop-fill buffer) |
| One ACT | `server/src/exec/oms.ts` (paper), `exec/environment.ts` (Live LOCKED) |
| Decision memory, frozen snapshots | `server/src/ditas/memory.ts` (content-addressed snapshots, hash chain), `ditas/twin.ts` (HYPOTHETICAL counterfactuals) |
| Honest calibration | `server/src/ditas/calibration.ts` (Brier, log-loss, ECE, Wilson; UNCALIBRATED below minimum sample) |

What was missing for the blueprint's functional contract, in which every decision must state:

- its snapshot and timestamps;
- coverage, dissent and calibration status;
- the bull and bear cases;
- cost assumptions, scenario PnL and stress loss;
- uncertainty and NO_TRADE reason codes.

These facts existed, but scattered across `DecisionReport` and `ConsensusRecord`. There were no coded NO_TRADE reasons, no scenario or stress arithmetic, and no single verifiable artefact.

## Decision

1. **Reuse the existing pipeline and add no engine.** THINK is the name for how the existing workers → QCI → decision path explains itself.
2. **First slice: the Reason-to-Trade Certificate** (`server/src/decision/certificate.ts`). It is a deterministic, versioned (`think-certificate-v1`), read-only derivation of one *stored* decision report and its consensus record.
   - Provenance hashes are computed over the exact stored texts, so a certificate can be reproduced and checked against the database.
   - It is computed on read, so there is no schema change or migration.
   - It is never read by the risk gate or OMS (static test).
3. **Profit Laboratory** (`server/src/decision/profitLab.ts`) is pure arithmetic:
   - Scenarios: targets filled, flat exit, stop filled, a 2× gap, and a 3× liquidity pull with stressed slippage. Fees apply on both sides.
   - It also gives the break-even exit, the planned maximum loss and the worst stress loss.
   - It never sizes a trade; it reuses the risk gate's quantity and entry estimate.
   - Expectancy accepts only a probability with an interval, a named calibration source and a minimum sample. Otherwise it reports `NO_VALID_FORECAST`.
   - A lower bound ≤ 0 is reported as `UNCERTAIN_EDGE`.
4. **No probabilities are invented.** Until a calibrated out-of-sample cohort is wired:
   - `winProbability` is `null`;
   - the opportunity score is labelled `HEURISTIC_SCORE_NOT_A_PROBABILITY`;
   - consensus is labelled `NOT_CALIBRATED`.
5. **Authority is explicit.** `canAuthorizeTrade: false`, `finalApproval: INDEPENDENT_RISK_GATE`, `execution: PAPER_OMS_ONLY`, `liveTrading: LOCKED`.
6. **UI.** The Decision record page gets a **Certificate** tab (`web/src/pages/ThinkCertificate.tsx`), loaded only when opened.

## Consequences

- **Tickets fully addressed by this slice:** 038 (NO_TRADE reason codes), 041, 042, 043, 045, 050, plus the explanation parts of 010, 028, 032, 034, 099.
- **The flash-loan net check (088)** was already covered by `research/aave.ts` (`flashLoanEconomics`) in PR #31.
- **Not done here** (separate small PRs, by canonical owner; see the audit):
  - event provenance and as-known-at replay;
  - bounded task graphs and benchmarks;
  - a calibrated forecast cohort;
  - the offline replay engine and honest LIVE / DEGRADED / OFFLINE_REPLAY state;
  - account-scoped records.
- **Stored data is unchanged.** The certificate is derived on read; old decisions get certificates too.

## Ownership map

| Area | Owner module | THINK change in this slice |
|---|---|---|
| Certificate, NO_TRADE codes | `server/src/decision/certificate.ts` (decision domain) | new |
| Scenario / expectancy arithmetic | `server/src/decision/profitLab.ts` (decision domain) | new |
| HTTP | `server/src/api/routes.ts` → `GET /api/decisions/:id/certificate` | one read-only route |
| UI | `web/src/pages/ThinkCertificate.tsx`, a tab in `pages/Intel.tsx` | new view |
| Workers, QCI, risk gate, OMS, ledger, DITAS | unchanged | none |

## Rollback

Revert the PR. It changes no database, no stored data and no trading behaviour.
