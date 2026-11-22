import { describe, expect, it, vi } from 'vitest';
import { MIA_FEATURES, assertUniqueFeatureIds, identifyFeatures, tradingParityInventory } from '../src/ops/featureIdentification.js';
import { MIA_GATE_IDS, allLiveGatesPass, executionKey, routeEntry, validateIntent,
  type BoundedLiveAuthorization, type ExecutionIntent, type ParityPorts, type RiskResult, type VenuePort } from '../src/exec/demoLiveParity.js';

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

function mockLivePorts() {
  const { ports } = mockPorts();
  const intent: ExecutionIntent = { ...INTENT, environment: 'LIVE', accountId: 'fixture-live-account', decision: 'APPROVED_FOR_BOUNDED_EXECUTION' };
  const authorization: BoundedLiveAuthorization = {
    attestationId: 'fixture-attestation', accountId: intent.accountId, commitSha: ports.buildSha(), policyVersion: 1,
    expiresAt: NOW + 60_000, maxOrderNotional: 150, eligibleInstruments: [intent.instrumentId], verifiedOwnerStepUp: true,
    isolatedSignerVerified: true, liveVenueVerified: true, protectionVerified: true, reconciliationVerified: true,
  };
  const submit = vi.fn(async () => ({ state: 'FILLED' as const, venueOrderId: 'fixture-live-order', filledQty: 1 }));
  const venue: VenuePort = { environment: 'LIVE', preflight: async () => ({ ok: true, nativeProtectionAvailable: true }), submit };
  ports.liveVenue = venue;
  ports.getControl = async () => ({ mode: 'BOUNDED_LIVE', emergency: false, pausedNewOrders: false, disabledStrategies: [] });
  ports.liveAuthorization = async () => authorization;
  return { ports, intent, authorization, venue, submit };
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

  it('exposes canonical demo/live capability gaps without inventing live certification', () => {
    const features = tradingParityInventory();
    expect(features.length).toBeGreaterThanOrEqual(15);
    expect(new Set(features.map(f => f.featureId)).size).toBe(features.length);
    for (const f of features) {
      const source = MIA_FEATURES.find(item => item.id === f.featureId);
      expect(source).toBeDefined();
      expect(f.owner).toBe(source!.owner);
      expect(f.canonicalPath).toBe(source!.inspectedMainPath ?? null);
      expect(f.candidatePr).toBe(source!.candidatePr ?? null);
    }
    expect(features.find(f => f.featureId === 'risk_authority')).toMatchObject({
      demo: 'PAPER_WIRED', live: 'UNVERIFIED', canonicalPath: 'server/src/risk/gate.ts',
    });
    expect(features.find(f => f.featureId === 'paper_oms')).toMatchObject({
      demo: 'PAPER_WIRED', live: 'NOT_OPERATIONAL', canonicalPath: 'server/src/exec/oms.ts',
    });
    expect(features.find(f => f.featureId === 'live_adapter')).toMatchObject({
      demo: 'NOT_APPLICABLE', live: 'NOT_OPERATIONAL', canonicalPath: null,
    });
    expect(features.find(f => f.featureId === 'live_order_state')).toMatchObject({
      live: 'PROPOSAL_ONLY', candidatePr: 97,
    });
    expect(features.filter(f => f.live === 'NOT_OPERATIONAL').length).toBeGreaterThan(0);
    expect(tradingParityInventory()).toEqual(features); // deterministic pure read model
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

  it('rejects a non-finite clock before touching order ports', async () => {
    const { ports, submitted, evaluated } = mockPorts();
    ports.now = () => NaN;
    expect(await routeEntry(INTENT, ports)).toMatchObject({ status: 'DENIED', reason: 'INVALID_EXECUTION_CLOCK' });
    expect(submitted()).toBe(0);
    expect(evaluated()).toBe(0);
  });

  it('rejects a changed planned loss even when the risk port reuses its result object', async () => {
    const { ports, submitted } = mockPorts();
    const result = structuredClone(RISK);
    let evaluations = 0;
    ports.evaluateRisk = async () => {
      if (++evaluations === 2) result.sizing!.plannedMaxLoss = 6;
      return result;
    };
    expect(await routeEntry(INTENT, ports)).toMatchObject({ status: 'DENIED', reason: 'LAST_MOMENT_RISK_MODE_OR_FENCE_CHANGED' });
    expect(submitted()).toBe(0);
  });

  it('refuses nonpositive loss budgets and policy versions', async () => {
    const { ports, submitted } = mockPorts();
    for (const risk of [{ ...RISK, policyVersion: 0 }, { ...RISK, sizing: { qty: 1, notional: 100, plannedMaxLoss: -3 } }]) {
      ports.evaluateRisk = async () => risk;
      expect(await routeEntry(INTENT, ports)).toMatchObject({ status: 'DENIED' });
    }
    expect(submitted()).toBe(0);
  });

  it('rechecks signal time and owner authorization after the last venue preflight', async () => {
    for (const expiring of ['consensus', 'authorization'] as const) {
      const { ports, intent, authorization, venue, submit } = mockLivePorts();
      const rejection = vi.fn(async () => {});
      ports.reservation.recordRejection = rejection;
      let now = NOW;
      let checks = 0;
      const reason = expiring === 'consensus' ? 'EXPIRED_CONSENSUS' : 'LIVE_CERTIFICATION_CHANGED';
      if (expiring === 'consensus') intent.consensusExpiresAt = NOW + 1;
      else authorization.expiresAt = NOW + 1;
      ports.now = () => now;
      venue.preflight = async () => {
        if (++checks === 2) now = NOW + 1;
        return { ok: true, nativeProtectionAvailable: true };
      };
      expect(await routeEntry(intent, ports)).toMatchObject({ status: 'DENIED', reason });
      expect(rejection).toHaveBeenCalledWith(executionKey(intent), reason);
      expect(submit).not.toHaveBeenCalled();
    }
  });

  it('reads the owner pause after the last venue preflight', async () => {
    const { ports, intent, venue, submit } = mockLivePorts();
    const getControl = ports.getControl;
    let checks = 0;
    let paused = false;
    ports.getControl = async () => ({ ...await getControl(), pausedNewOrders: paused });
    venue.preflight = async () => {
      if (++checks === 2) paused = true;
      return { ok: true, nativeProtectionAvailable: true };
    };
    expect(await routeEntry(intent, ports)).toMatchObject({ status: 'DENIED' });
    expect(submit).not.toHaveBeenCalled();
  });

  it('accepts a consistent receipt from the simulated LIVE port', async () => {
    const { ports, intent, submit } = mockLivePorts();
    expect(await routeEntry(intent, ports)).toMatchObject({ status: 'FILLED', venueOrderId: 'fixture-live-order', filledQty: 1 });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it.each([
    { state: 'ACKNOWLEDGED' },
    { state: 'FILLED', venueOrderId: 'fixture-order', filledQty: 0.5 },
    { state: 'FILLED', venueOrderId: 'fixture-order', filledQty: 2 },
    { state: 'REJECTED', filledQty: 1 },
  ] as const)('quarantines inconsistent venue receipt %j for reconciliation', async (receipt) => {
    const { ports, intent, venue } = mockLivePorts();
    const submit = vi.fn(async () => receipt);
    const recordReceipt = vi.fn(async () => {});
    const markUnknown = vi.fn(async () => {});
    venue.submit = submit;
    ports.reservation.recordReceipt = recordReceipt;
    ports.reservation.markUnknown = markUnknown;
    expect(await routeEntry(intent, ports)).toMatchObject({ status: 'UNKNOWN' });
    expect(await routeEntry(intent, ports)).toMatchObject({ status: 'DUPLICATE' });
    expect(submit).toHaveBeenCalledTimes(1);
    expect(recordReceipt).not.toHaveBeenCalled();
    expect(markUnknown).toHaveBeenCalledTimes(1);
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
