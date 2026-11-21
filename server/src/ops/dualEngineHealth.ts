/**
 * MIA5-ID-05..08/10: non-authoritative System-1/System-2 health projection.
 * Takes the CANONICAL measurements from QHEF, worker pool and bot status.
 * It does NOT create a new risk governor, supervisor, server or market feed.
 */
export type HealthFlag = 'OBSERVED' | 'DEGRADED' | 'NO_DATA';

export interface StageLatency {
  stage: string;
  samples: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
}
export interface DualEngineInput {
  stages: readonly StageLatency[];
  activeWorkerCapacity: number;
  quarantinedWorkers: number;
  botRunning: boolean;
  botRole: 'LEADER' | 'STANDBY' | 'STOPPED';
  lastMonitorAt: number;
  monitorFailing: boolean;
  nowMs: number;
}
export interface DualEngineHealth {
  version: 'mia5-canonical-dual-engine-health-v1';
  system1: {
    status: HealthFlag;
    measuredDecisionP95Ms: number | null;
    measuredDecisionSamples: number;
    wireToDecision10msCertified: false;
    reflexWorkerStatus: 'NOT_INTEGRATED';
  };
  system2: {
    status: HealthFlag;
    workerPoolCapacity: number;
    quarantinedWorkers: number;
    deepThreadState: 'NOT_INTEGRATED';
    oomRestartAuthority: 'NONE';
  };
  positionProtection: {
    status: 'OBSERVED' | 'UNVERIFIED' | 'FAILED' | 'STANDBY';
    lastCompletedAt: number | null;
  };
  authority: 'READ_ONLY';
  note: string;
}

export function deriveDualEngineHealth(x: Readonly<DualEngineInput>): DualEngineHealth {
  const stage = x.stages.find(s => s.stage === 'decision.engine');
  const measured = !!stage && stage.samples > 0 &&
    typeof stage.p95 === 'number' && Number.isFinite(stage.p95);
  const stageMs = measured ? stage.p95 : null;
  const workerCapacity = Number.isSafeInteger(x.activeWorkerCapacity) && x.activeWorkerCapacity > 0
    ? x.activeWorkerCapacity : 0;
  const quarantined = Number.isSafeInteger(x.quarantinedWorkers) && x.quarantinedWorkers >= 0
    ? x.quarantinedWorkers : 0;
  const monitorStatus =
    x.botRole === 'STANDBY' ? 'STANDBY' as const :
    x.monitorFailing ? 'FAILED' as const :
    x.botRunning && x.lastMonitorAt > 0 && Number.isFinite(x.nowMs) &&
      x.nowMs >= x.lastMonitorAt ? 'OBSERVED' as const : 'UNVERIFIED' as const;

  return {
    version: 'mia5-canonical-dual-engine-health-v1',
    system1: {
      status: !measured ? 'NO_DATA' : stageMs! > 100 ? 'DEGRADED' : 'OBSERVED',
      measuredDecisionP95Ms: stageMs,
      measuredDecisionSamples: stage?.samples ?? 0,
      wireToDecision10msCertified: false,
      reflexWorkerStatus: 'NOT_INTEGRATED',
    },
    system2: {
      status: workerCapacity === 0 ? 'NO_DATA' : quarantined > 0 ? 'DEGRADED' : 'OBSERVED',
      workerPoolCapacity: workerCapacity,
      quarantinedWorkers: quarantined,
      deepThreadState: 'NOT_INTEGRATED',
      oomRestartAuthority: 'NONE',
    },
    positionProtection: {
      status: monitorStatus,
      lastCompletedAt: x.lastMonitorAt > 0 ? x.lastMonitorAt : null,
    },
    authority: 'READ_ONLY',
    note: 'Existing decision p95 is not wire-to-decision latency; 10ms reflex SLA and dedicated OOM worker are not yet certified. Existing risk/OMS and position monitoring remain authoritative.',
  };
}
