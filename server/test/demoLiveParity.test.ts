import { describe, expect, it } from 'vitest';
import { MIA_FEATURES, assertUniqueFeatureIds, identifyFeatures } from '../src/ops/featureIdentification.js';
import { MIA_GATE_IDS, allLiveGatesPass, executionKey, routeEntry, validateIntent,
  type ExecutionIntent, type ParityPorts, type RiskResult } from '../src/exec/demoLiveParity.js';

/** Contract-level mocks only. There is NO live venue, signer or production DB adapter here. */
const NOW = 1_800_000_000_000;
const INTENT: ExecutionIntent = {
  environment: 'DEMO', accountId: 'paper-bot', decisionId: 'dec_1', candidateId: 'cand_1',
  traceId: 'trace_1', instrumentId: 'crypto:binance:BTCUSDT', strategyId: 'trend_pullback',
  strategyVersion: '1.0', decision: 'PAPER_TRADE', side: 'BUY', entryReference: 100,
  stopPrice: 97, consensusExpiresAt: NOW + 30_000, snapshotId: 'snap_1',
  snapshotTakenAt: NOW - 500, maxSnapshotAgeMs: 10_000,
};
const RISK: RiskResult = { decision: 'ALLOW', policyVersion: 1, reasonCodes: [],
  sizing: { qty: 1, notional: 100, plannedMaxLoss: 3 } };

function mockPorts() {
  let submitted = 0;
  let riskEvaluations = 0;
  const keys = new Set<string>();
  const ports: ParityPorts = {
    now: () => NOW,
    buildSha: () => 'current-build',
    getControl: async () => ({ mode: 'PAPER', emergency: false, pausedNewOrders: false, disabledStrategies: [] }),
    evaluateRisk: async () => { riskEvaluations++; return RISK; },
    currentFenceToken: async () => 'leader-fence',
    releaseEvidence: async () => ({ commitSha: 'current-build',
      gates: MIA_GATE_IDS.map(id => ({ id, status: 'PASS' as const })) }),
    liveAuthorization: async () => null,
    demoVenue: { environment: 'DEMO',
      preflight: async () => ({ ok: true, nativeProtectionAvailable: false }),
      submit: async () => { submitted++; return { state: 'FILLED' as const, venueOrderId: 'simulated-paper-id', filledQty: 1 }; } },
    reservation: {
      reserve: async (key) => { const created = !keys.has(key); keys.add(key); return { created, clientOrderId: 'paper_client_000001' }; },
      recordReceipt: async () => {}, recordRejection: async () => {}, markUnknown: async () => {},
    },
  };
  return { ports, submitted: () => submitted, evaluated: () => riskEvaluations };
}

describe('MIA identification-first and guarded environment contract', () => {
  it('preserves one owner per feature and marks missing main paths for review', () => {
    expect(() => assertUniqueFeatureIds()).not.toThrow();
    expect(MIA_FEATURES.length).toBeGreaterThanOrEqual(25);
    const paths = new Set(['server/src/risk/gate.ts', 'server/src/exec/oms.ts']);
    expect(identifyFeatures(paths).find(f => f.id === 'paper_oms')?.presentOnScannedMain).toBe(true);
    expect(identifyFeatures(paths).find(f => f.id === 'event_bus')?.reviewRequired).toBe(true);
    expect(MIA_FEATURES.find(f => f.id === 'live_order_state')?.status).toBe('UNMERGED_CANDIDATE');
  });

  it('validates old, expired, future or invalid decisions before any order effects', async () => {
    const { ports, submitted } = mockPorts();
    expect(validateIntent({ ...INTENT, consensusExpiresAt: NOW }, NOW)).toBe('EXPIRED_CONSENSUS');
    expect(validateIntent({ ...INTENT, snapshotTakenAt: NOW + 1 }, NOW)).toBe('STALE_OR_FUTURE_SNAPSHOT');
    expect(validateIntent({ ...INTENT, decision: 'APPROVED_FOR_BOUNDED_EXECUTION' }, NOW)).toBe('DEMO_DECISION_NOT_ELIGIBLE');
    expect((await routeEntry({ ...INTENT, consensusExpiresAt: NOW }, ports)).status).toBe('DENIED');
    expect(submitted()).toBe(0);
  });

  it('routes DEMO through the injected adapter and repeats canonical risk before submission', async () => {
    const { ports, submitted, evaluated } = mockPorts();
    const outcome = await routeEntry(INTENT, ports);
    expect(outcome.status).toBe('FILLED');
    expect(submitted()).toBe(1);
    expect(evaluated()).toBe(2);
  });

  it('prevents a second entry with the same reservation key', async () => {
    const { ports, submitted } = mockPorts();
    const outcomes = await Promise.all([routeEntry(INTENT, ports), routeEntry(INTENT, ports)]);
    expect(outcomes.map(o => o.status).sort()).toEqual(['DUPLICATE', 'FILLED']);
    expect(submitted()).toBe(1);
    expect(executionKey({ ...INTENT, environment: 'LIVE' })).not.toBe(executionKey(INTENT));
  });

  it('blocks emergency and mode mismatch in either environment', async () => {
    const { ports, submitted } = mockPorts();
    ports.getControl = async () => ({ mode: 'PAPER', emergency: true, pausedNewOrders: false, disabledStrategies: [] });
    expect((await routeEntry(INTENT, ports)).status).toBe('DENIED');
    ports.getControl = async () => ({ mode: 'OBSERVE', emergency: false, pausedNewOrders: false, disabledStrategies: [] });
    expect((await routeEntry(INTENT, ports)).status).toBe('DENIED');
    expect(submitted()).toBe(0);
  });

  it('blocks LIVE without an adapter, with missing gate, or with forged/stale evidence', async () => {
    const { ports, submitted } = mockPorts();
    const live = { ...INTENT, environment: 'LIVE' as const, accountId: 'live-account',
      decision: 'APPROVED_FOR_BOUNDED_EXECUTION' as const };
    ports.getControl = async () => ({ mode: 'BOUNDED_LIVE', emergency: false, pausedNewOrders: false, disabledStrategies: [] });
    expect((await routeEntry(live, ports)).status).toBe('DENIED');
    expect(allLiveGatesPass({ commitSha: 'current-build',
      gates: MIA_GATE_IDS.slice(0, -1).map(id => ({ id, status: 'PASS' as const })) }, 'current-build')).toBe(false);
    expect(allLiveGatesPass({ commitSha: 'wrong-build',
      gates: MIA_GATE_IDS.map(id => ({ id, status: 'PASS' as const })) }, 'current-build')).toBe(false);
    ports.liveVenue = { environment: 'LIVE', preflight: async () => ({ ok: true, nativeProtectionAvailable: false }),
      submit: async () => { submitted(); throw Error('must never reach live'); } };
    expect((await routeEntry(live, ports)).status).toBe('DENIED');
    expect(submitted()).toBe(0);
  });

  it('rejects changed risk sizing after reservation and before submission', async () => {
    const { ports, submitted } = mockPorts();
    let calls = 0;
    ports.evaluateRisk = async () => ++calls === 1 ? RISK : { ...RISK, sizing: { qty: 2, notional: 200, plannedMaxLoss: 6 } };
    const result = await routeEntry(INTENT, ports);
    expect(result.status).toBe('DENIED');
    expect(submitted()).toBe(0);
  });

  it('quarantines unknown submission outcomes, never blind-retries', async () => {
    const { ports } = mockPorts();
    let unknown = 0;
    let calls = 0;
    ports.demoVenue.submit = async () => { calls++; throw new Error('simulated timeout after possible acknowledgement'); };
    ports.reservation.markUnknown = async () => { unknown++; };
    expect((await routeEntry(INTENT, ports)).status).toBe('UNKNOWN');
    expect((await routeEntry(INTENT, ports)).status).toBe('DUPLICATE');
    expect(unknown).toBe(1);
    expect(calls).toBe(1);
  });
});
