import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  REFLEX_BUDGET_NS, REFLEX_STALL_TIMEOUT_NS, TELEMETRY_SAB_BYTES,
  ReflexSlot, ReflexWorkerState, ReflexTelemetryRecorder,
  createReflexTelemetryBuffer, readReflexTelemetry,
} from '../src/telemetry/reflexTelemetry.js';
import { DeepRecoveryBudget } from '../src/ops/deepRecovery.js';
import { deriveDualEngineHealth } from '../src/ops/dualEngineHealth.js';

/**
 * MIA5 source IDs 01..12: deterministic contract/regression/chaos fixtures.
 * There is intentionally NO fake <10ms market-to-trade benchmark here:
 * an empty worker callback cannot prove execution performance.
 */
describe('MIA5 shared-memory telemetry — actual clock-domain semantics', () => {
  it('uses a 128-byte two-cache-line BigInt64Array contract', () => {
    const sab = createReflexTelemetryBuffer();
    expect(sab.byteLength).toBe(TELEMETRY_SAB_BYTES);
    expect(TELEMETRY_SAB_BYTES).toBe(128);
    expect(ReflexSlot.ELD_MAX_NS).toBe(14);
    expect(REFLEX_BUDGET_NS).toBe(10_000_000n);
    expect(REFLEX_STALL_TIMEOUT_NS).toBeGreaterThan(50_000_000n);
  });

  it('refuses to report healthy before the worker provides real heartbeats/ticks', () => {
    const s = readReflexTelemetry(createReflexTelemetryBuffer(), 1_000n);
    expect(s).toMatchObject({
      healthy: false, stalled: false, warmingUp: false, wireTimingObserved: false,
      wireToDecisionLastMs: null, authority: 'TELEMETRY_ONLY',
    });
    expect(() => JSON.stringify(s)).not.toThrow(); // bigint serialized safely
  });

  it('uses observed compute times and never invents missing ingress measurements', () => {
    const recorder = new ReflexTelemetryRecorder(createReflexTelemetryBuffer(), 2n);
    recorder.start();
    try {
      recorder.recordSpan(1_000n, 2_000n);
      expect(readReflexTelemetry(recorder.buffer, 2_001n).healthy).toBe(false);
      recorder.recordSpan(3_000n, 4_000n);
      const snap = readReflexTelemetry(recorder.buffer, 4_001n);
      expect(snap.healthy).toBe(true);
      expect(snap.tickCount).toBe('2');
      expect(snap.computeOnlyLastMs).toBeCloseTo(0.001, 6);
      expect(snap.wireToDecisionLastMs).toBeNull();
      expect(snap.wireTimingObserved).toBe(false);
    } finally {
      recorder.stop();
    }
  });

  it('tracks a measured post-warmup breach and flags latency degradation', () => {
    const rec = new ReflexTelemetryRecorder(createReflexTelemetryBuffer(), 1n);
    rec.start();
    try {
      rec.recordSpan(1_000n, 2_000n, 500n);
      rec.recordSpan(3_000n, 3_000n + 20_000_000n, 2_000n);
      const s = readReflexTelemetry(rec.buffer, 20_003_001n);
      expect(s.state).toBe(ReflexWorkerState.DEGRADED_LATENCY);
      expect(s.healthy).toBe(false);
      expect(s.breachCount).toBe('1');
      expect(s.wireTimingObserved).toBe(true);
      expect(s.wireToDecisionLastMs!).toBeGreaterThan(10);
    } finally {
      rec.stop();
    }
  });

  it('recognizes a frozen heartbeat without asserting a wall-clock SLA', () => {
    const rec = new ReflexTelemetryRecorder(createReflexTelemetryBuffer(), 1n);
    rec.start();
    try {
      rec.recordSpan(1_000n, 2_000n);
      const now = 2_000n + REFLEX_STALL_TIMEOUT_NS + 1n;
      expect(readReflexTelemetry(rec.buffer, now).stalled).toBe(true);
      expect(readReflexTelemetry(rec.buffer, now).healthy).toBe(false);
    } finally {
      rec.stop();
    }
  });

  it('rejects invalid clock ordering and never clears an incident merely by resetting counters', () => {
    const rec = new ReflexTelemetryRecorder(createReflexTelemetryBuffer(), 1n);
    rec.start();
    try {
      expect(() => rec.recordSpan(8n, 7n)).toThrow('REFLEX_CLOCK_ORDER_INVALID');
      rec.recordSpan(2n, 11_000_002n, 1n);
      expect(readReflexTelemetry(rec.buffer, 11_000_003n).state)
        .toBe(ReflexWorkerState.DEGRADED_LATENCY);
      rec.resetWatermarks();
      expect(readReflexTelemetry(rec.buffer, 11_000_004n).state)
        .toBe(ReflexWorkerState.DEGRADED_LATENCY);
    } finally {
      rec.stop();
    }
  });
});

describe('MIA5 OOM/backoff recovery policy — no duplicate OMS authority', () => {
  it('schedules exponential retry windows and never authorizes a trade', () => {
    const d = new DeepRecoveryBudget({
      baseBackoffMs: 100, maxBackoffMs: 400, maxRespawnAttempts: 3,
      stabilityWindowMs: 1000,
    });
    expect(d.recordFailure('OOM', 1000)).toMatchObject({
      state: 'BACKING_OFF', attempt: 1, retryAfterMs: 100, canAuthorizeTrade: false,
    });
    expect(d.canAttemptRespawn(1099)).toBe(false);
    expect(d.canAttemptRespawn(1100)).toBe(true);
    expect(d.observeReady(1, 1100)).toBe(true);
    expect(d.recordFailure('OOM', 1101)).toMatchObject({
      state: 'BACKING_OFF', attempt: 2, retryAfterMs: 200,
    });
    expect(d.observeReady(2, 1301)).toBe(true);
    expect(d.recordFailure('WORKER_EXIT', 1302)).toMatchObject({
      state: 'BACKING_OFF', attempt: 3, retryAfterMs: 400,
    });
    expect(d.observeReady(3, 1702)).toBe(true);
    expect(d.recordFailure('OOM', 1703)).toMatchObject({
      state: 'EXHAUSTED', attempt: 3, canAuthorizeTrade: false,
    });
    expect(d.canAttemptRespawn(100_000)).toBe(false);
  });

  it('ignores repeated crash reports during backoff and rejects stale READY generations', () => {
    const d = new DeepRecoveryBudget({ baseBackoffMs: 100, maxBackoffMs: 400 });
    d.recordFailure('OOM', 100);
    expect(d.recordFailure('OOM', 101).attempt).toBe(1);
    expect(d.observeReady(1, 199)).toBe(false);
    expect(d.observeReady(1, 200)).toBe(true);
    d.recordFailure('OOM', 201);
    expect(d.observeReady(1, 401)).toBe(false);
    expect(d.observeReady(2, 401)).toBe(true);
  });

  it('needs stable READY evidence before resetting attempt count', () => {
    const d = new DeepRecoveryBudget({ baseBackoffMs: 100, stabilityWindowMs: 200 });
    d.recordFailure('OOM', 100);
    expect(d.observeReady(1, 200)).toBe(true);
    expect(d.markStable(399)).toBe(false);
    expect(d.markStable(400)).toBe(true);
    expect(d.snapshot(400).attempt).toBe(0);
  });

  it('only owner review clears exhaustion; no automatic risk or OMS unlock', () => {
    const d = new DeepRecoveryBudget({ maxRespawnAttempts: 1, baseBackoffMs: 10 });
    d.recordFailure('OOM', 10); d.observeReady(1, 510);
    d.recordFailure('OOM', 511);
    expect(d.snapshot(511).state).toBe('EXHAUSTED');
    expect(() => d.resetAfterReview('bot')).toThrow('OWNER_REVIEW_REQUIRED');
    d.resetAfterReview('owner');
    expect(d.snapshot(512)).toMatchObject({
      state: 'OFFLINE', canAuthorizeTrade: false,
    });
  });
});

describe('MIA5 QHEF canonical integration and source preservation', () => {
  it('shows honest measured stages and never claims the 10ms reflex worker is certified', () => {
    const x = deriveDualEngineHealth({
      stages: [{ stage: 'decision.engine', samples: 100,
        p50: 12, p95: 150, p99: 200, max: 300 }],
      activeWorkerCapacity: 16, quarantinedWorkers: 2,
      botRunning: true, botRole: 'LEADER', lastMonitorAt: 100, monitorFailing: false,
      nowMs: 150,
    });
    expect(x.system1).toMatchObject({
      status: 'DEGRADED', measuredDecisionP95Ms: 150,
      wireToDecision10msCertified: false, reflexWorkerStatus: 'NOT_INTEGRATED',
    });
    expect(x.system2).toMatchObject({
      status: 'DEGRADED', quarantinedWorkers: 2, oomRestartAuthority: 'NONE',
    });
    expect(x.positionProtection.status).toBe('OBSERVED');
    expect(x.authority).toBe('READ_ONLY');
  });

  it('never masks an unverified position monitor as healthy', () => {
    const x = deriveDualEngineHealth({
      stages: [], activeWorkerCapacity: 16, quarantinedWorkers: 0,
      botRunning: true, botRole: 'LEADER', lastMonitorAt: 0, monitorFailing: true,
      nowMs: 100,
    });
    expect(x.system1.status).toBe('NO_DATA');
    expect(x.positionProtection.status).toBe('FAILED');
  });

  it('preserves all 12 original source payloads with SHA-256 (none removed)', () => {
    const original = readFileSync(new URL('../../docs/source-archive/MIA5_20261121_ORIGINAL_BOOTSTRAP_DO_NOT_RUN.sh.txt', import.meta.url));
    expect(createHash('sha256').update(original).digest('hex'))
      .toBe('87760d51b4c40a592d545f6ccfbde15e85f726a8bc06ab2838771cf9d44f8561');
    const text = original.toString('utf8');
    expect([...text.matchAll(/^sync_file "MIA5-ID-\d{2}" /gm)]).toHaveLength(12);
    for (let i = 1; i <= 12; i++) {
      const n = String(i).padStart(2, '0');
      expect(text).toContain("<<'EOF_MIA5_ID_" + n + "'");
      expect(text).toContain('\nEOF_MIA5_ID_' + n + '\r\n');
    }
  });
});
