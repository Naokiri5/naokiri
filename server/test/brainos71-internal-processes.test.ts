import { afterEach, describe, expect, it } from 'vitest';
import {
  assessAutonomicProtection, internalProcessOverview, recordAutonomicObservation,
  recordLearningEvidence, resetInternalProcesses, summarizeLearningEvidence,
} from '../src/knowledge/cognitive/internalProcesses.js';

const now = 1_800_000_000_000;
const healthy = { now, monitorAt: now - 100, monitorMaxAgeMs: 1000,
  monitorFailing: false, eventLoopUtilization: 0.4 };
const evidence = { observedAt: now, recentPaperClosedCount: 2,
  latestPaperClosedAt: now - 1000, recentOwnerReportedOutcomes: 3 };

afterEach(resetInternalProcesses);
describe('BrainOS 7.1 internal processes', () => {
  it('only exposes FAST and DEEP and does not claim a process has run before observation', () => {
    const view = internalProcessOverview(now, 1000);
    expect(view.pathways).toEqual(['FAST', 'DEEP']);
    expect(view.autonomicProtection.observation).toBeNull();
    expect(view.continuousLearning.observation).toBeNull();
    expect(view.tradingAuthority).toBe(false);
  });
  it('lets existing background research proceed only with current protection and capacity', () => {
    expect(assessAutonomicProtection(healthy).researchAllowed).toBe(true);
    for (const patch of [{ monitorAt: 0 }, { monitorAt: now + 1 },
      { monitorAt: now - 1001 }, { monitorFailing: true }, { monitorMaxAgeMs: NaN },
      { eventLoopUtilization: 0.81 }, { eventLoopUtilization: NaN },
      { eventLoopUtilization: -0.1 }]) {
      const result = assessAutonomicProtection({ ...healthy, ...patch });
      expect(result.researchAllowed).toBe(false);
      expect(result.tradingAuthority).toBe(false);
    }
  });
  it('does not treat owner-reported outcomes or paper records as verified calibration', () => {
    const result = summarizeLearningEvidence(evidence);
    expect(result.status).toBe('REVIEW_EVIDENCE_ONLY');
    expect(result.calibrationScore).toBeNull();
    expect(result.automaticPromotion).toBe(false);
    expect(result.tradingAuthority).toBe(false);
    expect(Object.isFrozen(result)).toBe(true);
  });
  it('rejects future, contradictory or oversized outcome evidence', () => {
    for (const patch of [{ latestPaperClosedAt: now + 1 }, { recentPaperClosedCount: 0 },
      { recentPaperClosedCount: 101 }, { recentOwnerReportedOutcomes: -1 }]) {
      expect(() => summarizeLearningEvidence({ ...evidence, ...patch })).toThrow('INVALID_INTERNAL_LEARNING_EVIDENCE');
    }
  });
  it('reports no evidence honestly', () => {
    expect(summarizeLearningEvidence({ observedAt: now, recentPaperClosedCount: 0,
      latestPaperClosedAt: null, recentOwnerReportedOutcomes: 0 }).status).toBe('WAITING_FOR_OUTCOMES');
  });
  it('expires stale observations and clears state on lifecycle reset', () => {
    recordAutonomicObservation(healthy);
    recordLearningEvidence(evidence);
    expect(internalProcessOverview(now, 1000).continuousLearning.observation).not.toBeNull();
    expect(internalProcessOverview(now - 1, 1000).autonomicProtection.observation).toBeNull();
    expect(internalProcessOverview(now + 1001, 1000).continuousLearning.observation).toBeNull();
    resetInternalProcesses();
    expect(internalProcessOverview(now, 1000).autonomicProtection.observation).toBeNull();
  });
});
