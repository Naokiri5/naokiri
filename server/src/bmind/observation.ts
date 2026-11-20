/**
 * MIA 5.0 B-MIND (M5-U03a): checks that a behavioral observation is honest before anything may read it.
 *
 * Pure: the caller passes the evaluation clock (`nowMs`), as workers do with `ctx.asOf`; nothing here reads the wall
 * clock. A rejected observation must be dropped, never repaired into a favorable state.
 */
import type { BehavioralEffect, BehavioralObservation, EvidenceStatus, InputCapabilities } from './contracts.js';
import { constructById, constructCoverage, baselineCapabilities } from './atlas.js';

export type ObservationReason =
  | 'UNKNOWN_CONSTRUCT' | 'MISSING_IDENTITY' | 'NO_MODEL_VERSION' | 'INVALID_TIME' | 'EVENT_AFTER_RECEIPT' | 'RECEIVED_IN_FUTURE'
  | 'EXPIRES_BEFORE_EVENT' | 'NO_ORIGIN' | 'NO_DEPENDENCY_GROUP' | 'NON_FINITE_FEATURE' | 'UNKNOWN_WITH_VALUES'
  | 'STATE_ABOVE_COVERAGE' | 'EFFECT_ABOVE_CEILING' | 'EFFECT_NOT_VALIDATED' | 'INVALID_CALIBRATION';

export type ObservationCheck =
  | { ok: true; state: EvidenceStatus; independentSources: number }
  | { ok: false; reasons: ObservationReason[] };

const RANK: Record<BehavioralEffect, number> = { NONE: 0, EXPLAIN: 1, WAIT: 2, BLOCK: 3 };
const isTime = (t: unknown): t is number => typeof t === 'number' && Number.isSafeInteger(t) && t > 0;

/** Distinct dependency groups: ten reposts of one source are one source (JDR-001 K-02, MIA 5.0 invariant). */
export const independentSources = (o: Pick<BehavioralObservation, 'dependencyGroups'>) =>
  new Set(o.dependencyGroups.filter((g) => typeof g === 'string' && g.trim())).size;

/**
 * Validate one observation against the atlas, the inputs MIA can read (`caps`) and the clock. On success, `state` is
 * the effective state: STALE once `nowMs` reaches `expiresAtMs`.
 */
export function checkObservation(o: BehavioralObservation, nowMs: number, caps: InputCapabilities = baselineCapabilities()): ObservationCheck {
  const reasons: ObservationReason[] = [];
  const def = constructById(o.constructId);
  if (!def) reasons.push('UNKNOWN_CONSTRUCT');
  if (!o.instrumentId?.trim() || !o.strategyId?.trim()) reasons.push('MISSING_IDENTITY');
  if (!o.modelVersion?.trim()) reasons.push('NO_MODEL_VERSION');

  if (![o.eventTimeMs, o.receivedTimeMs, o.expiresAtMs, nowMs].every(isTime)) reasons.push('INVALID_TIME');
  else {
    if (o.eventTimeMs > o.receivedTimeMs) reasons.push('EVENT_AFTER_RECEIPT');
    if (o.receivedTimeMs > nowMs) reasons.push('RECEIVED_IN_FUTURE');
    if (o.expiresAtMs <= o.eventTimeMs) reasons.push('EXPIRES_BEFORE_EVENT');
  }

  const values = Object.values(o.features ?? {});
  if (values.some((v) => v !== null && !(typeof v === 'number' && Number.isFinite(v)))) reasons.push('NON_FINITE_FEATURE');
  const claimsEvidence = o.state === 'OBSERVED' || o.state === 'WEAK';
  if (claimsEvidence && !o.originIds.some((x) => typeof x === 'string' && x.trim())) reasons.push('NO_ORIGIN');
  if (claimsEvidence && independentSources(o) === 0) reasons.push('NO_DEPENDENCY_GROUP');
  // UNKNOWN must not smuggle numbers that a reader could treat as a measurement.
  if (o.state === 'UNKNOWN' && values.some((v) => v !== null)) reasons.push('UNKNOWN_WITH_VALUES');

  if (def) {
    const cov = constructCoverage(caps).find((c) => c.id === def.id)!;
    if ((cov.state === 'UNKNOWN' && claimsEvidence) || (cov.state === 'WEAK' && o.state === 'OBSERVED')) reasons.push('STATE_ABOVE_COVERAGE');
    if (RANK[o.effect] > RANK[def.effectCeiling]) reasons.push('EFFECT_ABOVE_CEILING');
  }

  const cal = o.calibration;
  if (cal !== 'NOT_CALIBRATED') {
    const valid = typeof cal === 'object' && cal !== null && typeof cal.cohortId === 'string' && cal.cohortId.trim() !== ''
      && isTime(cal.horizonMs) && typeof cal.brier === 'number' && cal.brier >= 0 && cal.brier <= 1;
    if (!valid) reasons.push('INVALID_CALIBRATION');
  }
  // Until a calibrated cohort exists, an observation may only explain (signal promotion rule, MIA 5.0 section 7).
  if (cal === 'NOT_CALIBRATED' && RANK[o.effect] > RANK.EXPLAIN) reasons.push('EFFECT_NOT_VALIDATED');

  if (reasons.length) return { ok: false, reasons };
  const state: EvidenceStatus = nowMs >= o.expiresAtMs ? 'STALE' : o.state;
  return { ok: true, state, independentSources: independentSources(o) };
}
