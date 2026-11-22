# MIA — DITAS paper experience, no-trade evidence and protection interlock

**Scope:** 2026-11-22, single reviewable increment against `main@7ecda93c`. **PAPER only; live trading remains LOCKED.**

## Why this patch exists

1. `exec/oms.ts::autopsy` previously recorded a trade outcome only in the journal. The existing DITAS immutable decision event and its original market snapshot were not linked to the closed result.
2. `ditas/passports.ts` read all account positions by strategy, risking cross-account contamination when more execution environments arrive; its historical report had no distinction between position rows and entry+exit fill-backed evidence.
3. `risk/gate.ts` enforced open protection incidents on the *same instrument* only. An unprotected paper position could coexist with new entries on other instruments in the same account.
4. The decision engine's strategy performance step displayed negative out-of-sample results but did not explain separately whether there was any usable closed paper experience.

This increment extends the existing modules, rather than creating a duplicate risk engine, database, OMS, ledger, scanner or worker orchestration service.

## Canonical ownership and synchronization

| Existing owner | Minimal enhancement | Authority |
|---|---|---|
| `exec/oms.ts` | On successful, committed close, invoke `recordClosedPaperOutcome()` after financial transactions | Still the sole paper order/position/financial authority |
| `ditas/memory.ts` | Immutable, idempotent `TRADE_OUTCOME` event with original decision-time snapshot and parent decision link | Evidence only, no financial writes |
| `ditas/passports.ts` | Account-scoped, strategy-version-filtered outcome cohort with separate fill-backed subset | Read-only historical research |
| `risk/gate.ts` | Shadow-first statistical no-trade diagnostic; explicitly opted-in negative-evidence veto only | Canonical risk authority; cannot approve or size beyond original limits |
| `exec/incidents.ts` | Look up unresolved protection incidents for the current paper account | Existing incident table, recovery lifecycle unchanged |
| `decision/engine.ts` | Add the risk gate's no-trade evidence to the existing pipeline trace | No new voting, forecasts or order authority |
| `ditas/service.ts` | Truthful current coverage descriptions | Existing authenticated DITAS API exposes passport and risk evidence |

## Actual paper outcome memory

- Only `CLOSED` positions in `PAPER_ACCOUNT` with a linked historical `DECISION` event and valid original DITAS snapshot can create `TRADE_OUTCOME`.
- Both recorded positive-quantity FILLED `ENTRY` and `EXIT_%` order fills are required. A manually changed position status does not qualify.
- The emitted event includes actual paper net PnL, fees, outcome in R when planned risk is valid, entry/exit timestamps and prices, the existing decision ID, original snapshot ID and parent event ID.
- The existing DITAS event hash-chain protects integrity. `paper:closed:<positionId>` is the idempotency key, so autopsy retries do not duplicate results.
- Missing historical evidence is intentionally **not backfilled** using post-outcome market data. Legacy positions retain their existing visibility, but do not become synthetic confirmed event history.
- Failures in the evidence append cannot roll back a committed OMS fill or prevent the corresponding position event; they are journaled as system errors.

## No-trade evidence guard

`MIA_PAPER_EXPERIENCE_GUARD=SHADOW` is the default. The read-only risk evaluation reports:

- `paperExperienceMode`
- `paperExperienceStatus`
- `paperExperienceSamples`
- `paperExperienceExpectancyR`
- `paperExperienceUpper95R`

The `verified` cohort requires 30 *current-strategy-version*, *same-account*, closed PAPER positions, each with recorded filled entry and exit orders. A veto is eligible only when its existing 95% normal-approximation upper confidence bound is below **−0.3R**. Correlated trades and regime changes can invalidate that interval; it is a conservative heuristic, **not proof of future profitability**.

Only when the deployment operator explicitly selects `ENFORCED` does this add `PAPER_EXPERIENCE_NO_TRADE` to canonical risk denial reasons. The guard never turns DENY into ALLOW, promotes a strategy, changes quantities, modifies strategy weights, or enables real-money execution. Invalid/unrecognized configuration stays in SHADOW. Existing `lab/lab.ts::checkStrategyHealth` suspension remains separate and unchanged.

## Account-wide protection incident

If any OPEN position in the current account has an OPEN protection incident, a new order in another instrument is denied with `UNPROTECTED_ACCOUNT_EXPOSURE`; original `PROTECTION_INCIDENT_OPEN` still identifies same-instrument incidents. Recovery occurs using existing OMS monitoring and `markRecovered`; owner acknowledgement of a recovered incident is unchanged. No automatically fabricated exits are permitted.

## Tests and operational checks

New focused tests cover full paper OMS close → linked DITAS memory, chain integrity, retry idempotency, version/account separation, insufficient sample, SHADOW, opt-in ENFORCED veto and invalid mode. Existing incidents tests also assert the cross-instrument protection lock and recovery.

On this branch, check the exact final GitHub Actions SHA (no merge until complete):

```bash
npm ci
npm run scan:secrets
npm audit --audit-level=high
npm run typecheck
npm run build
npm test
npm run test:e2e
```

Also require independent trading-risk/security review, migration/PR conflict review (especially #89/#90, #108, #109, #111), a paper replay with non-synthetic outcomes, and a rollback rehearsal before accepting a release. No historical performance or calibrated probability is asserted by fixture-based tests.

## 100 senior development roles: truthful use

Reuse the existing 100-role senior engineering/review roster documented in PR #21 as a **review checklist and responsibility matrix**, not as a claim that 100 autonomous coding agents were executed. Key independent review lanes are architecture/ownership, DITAS evidence provenance, financial integrity, statistical inference, OMS idempotency, incident recovery, security, reliability, QA and release operations. Every lane must attach evidence before sign-off. This PR is authored and checked through available GitHub and CI tools only.

## Follow-on work, intentionally not attempted here

Prospective calibrated prediction training; regime-conditioned outcome cohorts; adversarial strategy arena; provider/source authenticity verification; whale wallet streaming/copy execution; memecoin token safety and real exit routing; live venue/signers; synchronized multi-market position lifecycle; learned worker reweighting; and autonomous strategy promotion. These remain separate independently reviewable increments, with the same canonical risk and release controls.
