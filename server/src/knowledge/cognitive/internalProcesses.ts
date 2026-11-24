/** BrainOS 7.1 internal cognitive processes. No order, risk or permission authority.
 * FAST/DEEP are the only trading minds; protection and learning are lifecycle responsibilities.
 */
export interface AutonomicObservation {
  now: number;
  monitorAt: number;
  monitorMaxAgeMs: number;
  monitorFailing: boolean;
  eventLoopUtilization: number;
}
export function assessAutonomicProtection(o: AutonomicObservation) {
  const validTime = Number.isSafeInteger(o.now) && o.now > 0 &&
    Number.isSafeInteger(o.monitorAt) && o.monitorAt > 0 && o.monitorAt <= o.now &&
    Number.isFinite(o.monitorMaxAgeMs) && o.monitorMaxAgeMs > 0;
  const protectionOverdue = !validTime || o.monitorFailing ||
    o.now - o.monitorAt > o.monitorMaxAgeMs;
  const overloaded = !Number.isFinite(o.eventLoopUtilization) ||
    o.eventLoopUtilization < 0 || o.eventLoopUtilization > 0.8;
  const reason = protectionOverdue ? 'Protection needs attention' :
    overloaded ? 'Event loop is busy' : null;
  return Object.freeze({
    status: reason ? 'DEFERRED' as const : 'OBSERVED' as const,
    researchAllowed: reason === null, reason, observedAt: o.now,
    tradingAuthority: false as const,
  });
}

export interface LearningEvidence {
  observedAt: number;
  recentPaperClosedCount: number;
  latestPaperClosedAt: number | null;
  recentOwnerReportedOutcomes: number;
}
export function summarizeLearningEvidence(e: LearningEvidence) {
  const valid = Number.isSafeInteger(e.observedAt) && e.observedAt > 0 &&
    Number.isSafeInteger(e.recentPaperClosedCount) && e.recentPaperClosedCount >= 0 &&
    e.recentPaperClosedCount <= 100 &&
    Number.isSafeInteger(e.recentOwnerReportedOutcomes) && e.recentOwnerReportedOutcomes >= 0 &&
    e.recentOwnerReportedOutcomes <= 100 &&
    (e.recentPaperClosedCount === 0 ? e.latestPaperClosedAt === null :
      e.latestPaperClosedAt !== null && Number.isSafeInteger(e.latestPaperClosedAt) &&
      e.latestPaperClosedAt > 0 && e.latestPaperClosedAt <= e.observedAt);
  if (!valid) throw new Error('INVALID_INTERNAL_LEARNING_EVIDENCE');
  return Object.freeze({
    ...e,
    status: e.recentPaperClosedCount || e.recentOwnerReportedOutcomes
      ? 'REVIEW_EVIDENCE_ONLY' as const : 'WAITING_FOR_OUTCOMES' as const,
    provenance: 'PAPER_RECORDS_AND_OWNER_REPORTED_FORECASTS_NOT_INDEPENDENTLY_VERIFIED' as const,
    calibrationScore: null, automaticPromotion: false as const, tradingAuthority: false as const,
  });
}

type Protection = ReturnType<typeof assessAutonomicProtection>;
type Learning = ReturnType<typeof summarizeLearningEvidence>;
let protection: Protection | null = null;
let learning: Learning | null = null;
export function recordAutonomicObservation(o: AutonomicObservation) {
  protection = assessAutonomicProtection(o);
  return protection;
}
export function recordLearningEvidence(e: LearningEvidence) {
  learning = summarizeLearningEvidence(e);
  return learning;
}
export function resetInternalProcesses() { protection = null; learning = null; }
export function internalProcessOverview(now: number, maxAgeMs: number) {
  const fresh = (at: number) => Number.isSafeInteger(now) && Number.isFinite(maxAgeMs) &&
    maxAgeMs > 0 && at > 0 && at <= now && now - at <= maxAgeMs;
  return {
    pathways: ['FAST', 'DEEP'] as const,
    autonomicProtection: { activation: 'AUTOMATIC' as const,
      observation: protection && fresh(protection.observedAt) ? protection : null },
    continuousLearning: { activation: 'AUTOMATIC' as const,
      observation: learning && fresh(learning.observedAt) ? learning : null },
    tradingAuthority: false as const,
    note: 'Internal evidence only; canonical protection, settlement and strategy review remain authoritative.',
  };
}
