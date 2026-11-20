/**
 * MIA 5.0 B-MIND (M5-U03a): checks that a behavioral observation is honest before anything may read it.
 *
 * Pure: the caller passes the evaluation clock (`nowMs`), as workers do with `ctx.asOf`; nothing here reads the wall
 * clock. A rejected observation must be dropped, never repaired into a favorable state.
 */
import type { BehavioralEffect, BehavioralObservation, EvidenceStatus, InputCapabilities } from './contracts.js';
import { constructById, constructCoverage, effectiveCapabilities } from './atlas.js';

export type ObservationReason =
  | 'UNKNOWN_CONSTRUCT' | 'MISSING_IDENTITY' | 'NO_MODEL_VERSION' | 'INVALID_TIME' | 'EVENT_AFTER_RECEIPT' | 'RECEIVED_IN_FUTURE'
  | 'EXPIRES_BEFORE_EVENT' | 'STALE_INPUT' | 'NO_ORIGIN' | 'NO_DEPENDENCY_GROUP' | 'NON_FINITE_FEATURE' | 'UNKNOWN_WITH_VALUES'
  | 'STATE_ABOVE_COVERAGE' | 'INVALID_EFFECT' | 'EFFECT_ABOVE_CEILING' | 'EFFECT_NOT_VALIDATED' | 'INVALID_CALIBRATION';

export type ObservationCheck =
  | { ok: true; state: EvidenceStatus; independentEvidence: number }
  | { ok: false; reasons: ObservationReason[] };

const RANK: Record<BehavioralEffect, number> = { NONE: 0, EXPLAIN: 1, WAIT: 2 };
const isTime = (t: unknown): t is number => typeof t === 'number' && Number.isSafeInteger(t) && t > 0;

const distinct = (xs: readonly unknown[] | undefined) =>
  new Set((xs ?? []).filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim().toLowerCase())).size;
/**
 * How many independent pieces of evidence an observation has: distinct dependency groups (ten reposts of one source are
 * one source), never more than its distinct origins (JDR-001 K-02). Groups are compared trimmed and case-insensitively.
 */
export const independentEvidenceCount = (o: Partial<Pick<BehavioralObservation, 'dependencyGroups' | 'originIds'>>) =>
  Math.min(distinct(o.dependencyGroups), distinct(o.originIds));

/**
 * Validate one observation against the atlas, the inputs MIA can read and the clock. `caps` can only lower the reviewed
 * baseline (`effectiveCapabilities`). On success, `state` is the effective state: an OBSERVED or WEAK observation turns
 * STALE once `nowMs` reaches `expiresAtMs`; an UNKNOWN one stays UNKNOWN. STALE is set only by the clock, never by a producer.
 */
export function checkObservation(o: BehavioralObservation, nowMs: number, caps: InputCapabilities = {}): ObservationCheck {
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

  if (o.state === 'STALE') reasons.push('STALE_INPUT');
  const values = Object.values(o.features ?? {});
  if (values.some((v) => v !== null && !(typeof v === 'number' && Number.isFinite(v)))) reasons.push('NON_FINITE_FEATURE');
  const claimsEvidence = o.state === 'OBSERVED' || o.state === 'WEAK';
  if (claimsEvidence && distinct(o.originIds) === 0) reasons.push('NO_ORIGIN');
  if (claimsEvidence && distinct(o.dependencyGroups) === 0) reasons.push('NO_DEPENDENCY_GROUP');
  const cov = def ? constructCoverage(effectiveCapabilities(caps)).find((c) => c.id === def.id)! : null;
  // Unknown must not smuggle numbers a reader could treat as a measurement: neither an UNKNOWN observation nor any
  // observation of a construct MIA cannot observe with its inputs.
  if ((o.state === 'UNKNOWN' || cov?.state === 'UNKNOWN') && values.some((v) => v !== null)) reasons.push('UNKNOWN_WITH_VALUES');

  const effectKnown = Object.hasOwn(RANK, o.effect);
  if (!effectKnown) reasons.push('INVALID_EFFECT');
  if (def && cov) {
    if ((cov.state === 'UNKNOWN' && claimsEvidence) || (cov.state === 'WEAK' && o.state === 'OBSERVED')) reasons.push('STATE_ABOVE_COVERAGE');
    if (effectKnown && RANK[o.effect] > RANK[def.effectCeiling]) reasons.push('EFFECT_ABOVE_CEILING');
  }

  const cal = o.calibration;
  if (cal !== 'NOT_CALIBRATED') {
    const valid = typeof cal === 'object' && cal !== null && typeof cal.cohortId === 'string' && cal.cohortId.trim() !== ''
      && isTime(cal.horizonMs) && typeof cal.brier === 'number' && cal.brier >= 0 && cal.brier <= 1;
    if (!valid) reasons.push('INVALID_CALIBRATION');
  }
  // This foundation validates no signal: whatever the calibration says, nothing goes beyond EXPLAIN (signal promotion
  // rule, MIA 5.0 section 7). M5-U06 replaces this with an EVALUATED calibration report check.
  if (effectKnown && RANK[o.effect] > RANK.EXPLAIN) reasons.push('EFFECT_NOT_VALIDATED');

  if (reasons.length) return { ok: false, reasons };
  const state: EvidenceStatus = claimsEvidence && nowMs >= o.expiresAtMs ? 'STALE' : o.state;
  return { ok: true, state, independentEvidence: independentEvidenceCount(o) };
}
