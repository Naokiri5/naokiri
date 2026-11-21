import { beforeEach, describe, expect, it } from 'vitest';
import { freshDb, seedInstrument } from './helpers.js';
import { market } from '../src/market/store.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { updateControl } from '../src/core/mode.js';
import { ledger, PAPER_ACCOUNT } from '../src/portfolio/ledger.js';
import { run, get, J } from '../src/db/db.js';
import { previewBundle, bundleCapabilities } from '../src/exec/bundles/preview.js';
import { assessBundle, type BundleIntent, type BundleEvidence } from '../src/exec/bundles/assessment.js';
import type { DecisionReport } from '../src/decision/engine.js';

const makeReport = (id: string, instrumentId: string, price: number): DecisionReport => ({
  id, candidateId: 'cand_' + id, traceId: 'bundle_fixture', asset: instrumentId.split(':').at(-1),
  instrumentId, market: 'crypto', venue: 'binance', strategy: { id: 'trend_pullback', version: '1.0.0' },
  entryRef: price, stopLoss: price * 0.97,
  takeProfit: [{ price: price * 1.05, fraction: 1, r: 1.5 }],
  consensus: { id: 'consensus_' + id, state: 'STRONG_CONSENSUS', support: 1, opposition: 0, expiresAt: new Date(Date.now() + 30_000).toISOString() },
  decision: 'PAPER_TRADE',
} as DecisionReport);
const save = (r: DecisionReport) => run(
  'INSERT INTO decisions(id,candidate_id,instrument,market,direction,strategy,decision,score,created_at,report) VALUES (?,?,?,?,?,?,?,?,?,?)',
  r.id, r.candidateId, r.instrumentId, 'crypto', 'LONG', r.strategy.id, r.decision, 70, Date.now(), J(r),
);
const req = { environment: 'PAPER' as const, mode: 'MULTI_ASSET_BASKET' as const, decisionIds: ['decision_btc', 'decision_eth'] };

describe('MIA bundle preflight using canonical PAPER authority', () => {
  beforeEach(() => {
    freshDb();
    market.reset();
    const btc = seedInstrument('BTCUSDT', { seed: 3 });
    const eth = seedInstrument('ETHUSDT', { seed: 2 });
    acceptPolicy('owner', DEFAULT_POLICY);
    updateControl('owner', { mode: 'PAPER' });
    ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
    save(makeReport('decision_btc', btc.inst.id, btc.last));
    save(makeReport('decision_eth', eth.inst.id, eth.last));
  });
  it('constructs preview from stored decisions without mutating orders, fills, positions or balances', () => {
    const before = {
      orders: get<{ n: number }>('SELECT COUNT(*) n FROM orders')!.n,
      fills: get<{ n: number }>('SELECT COUNT(*) n FROM fills')!.n,
      positions: get<{ n: number }>('SELECT COUNT(*) n FROM positions')!.n,
      ledger: get<{ n: number }>('SELECT COUNT(*) n FROM ledger_entries')!.n,
    };
    const res = previewBundle(req);
    expect(res.canSubmit).toBe(false);
    expect(res.environment).toBe('PAPER');
    expect(res.bundleId).toMatch(/^bundle-preview-/);
    expect(get<{ n: number }>('SELECT COUNT(*) n FROM orders')!.n).toBe(before.orders);
    expect(get<{ n: number }>('SELECT COUNT(*) n FROM fills')!.n).toBe(before.fills);
    expect(get<{ n: number }>('SELECT COUNT(*) n FROM positions')!.n).toBe(before.positions);
    expect(get<{ n: number }>('SELECT COUNT(*) n FROM ledger_entries')!.n).toBe(before.ledger);
  });
  it('PAPER_ATOMIC refuses to imply that a transactional multi-entry OMS exists', () => {
    const res = previewBundle({ ...req, mode: 'PAPER_ATOMIC' });
    expect(res.approved).toBe(false);
    expect(res.reasonCodes).toContain('PAPER_OMS_ATOMIC_COMMIT_NOT_INSTALLED');
  });
  it('TESTNET and LIVE remain locked without even reading a paper balance to authorize them', () => {
    for (const environment of ['TESTNET', 'LIVE'] as const) {
      const r = previewBundle({ ...req, environment });
      expect(r.approved).toBe(false);
      expect(r.canSubmit).toBe(false);
      expect(r.reasonCodes.some(x => /NOT_CERTIFIED|NOT_IMPLEMENTED/.test(x))).toBe(true);
    }
  });
  it('duplicates and missing decisions are rejected before any financial mutation', () => {
    expect(() => previewBundle({ ...req, decisionIds: ['decision_btc', 'decision_btc'] })).toThrow(/DISTINCT/);
    expect(() => previewBundle({ ...req, decisionIds: ['decision_btc', 'does_not_exist'] })).toThrow(/NOT_FOUND/);
  });
  it('pause and emergency never grant a bundle exception', () => {
    updateControl('owner', { pausedNewOrders: true });
    expect(previewBundle(req).reasonCodes).toContain('EMERGENCY_OR_PAUSE_ACTIVE');
  });
  it('capabilities truthfully describe the unavailable live and atomic order paths', () => {
    const s = bundleCapabilities();
    expect(s.environments.every(x => !x.canPlaceBundleOrders)).toBe(true);
  });
});

describe('Pure bundle aggregate gate never upgrades canonical risk', () => {
  const now = Date.now();
  const intent: BundleIntent = {
    bundleId: 'b_1', environment: 'PAPER', accountId: 'paper-bot',
    strategyId: 'trend_pullback', idempotencyKey: 'k_1', mode: 'MULTI_ASSET_BASKET',
    expiresAt: now + 5000,
    legs: [
      { legId: 'a', decisionId: 'd1', instrumentId: 'crypto:binance:BTCUSDT', venueId: 'binance-paper', side: 'BUY', requestedUnits: '100' },
      { legId: 'b', decisionId: 'd2', instrumentId: 'crypto:binance:ETHUSDT', venueId: 'binance-paper', side: 'BUY', requestedUnits: '100' },
    ],
  };
  const mkProof = (): BundleEvidence => ({
    account: {
      environment: 'PAPER', accountId: 'paper-bot', currency: 'PAPER_USD', policyVersion: 1,
      validUntil: now + 5000, cashBalanceAtomic: '1000', reservedCashAtomic: '0',
      existingOpenRiskAtomic: '100', reservedRiskAtomic: '0', maxTotalOpenRiskAtomic: '250',
      openPositionCount: 0, pendingPositionCount: 0, maxConcurrentPositions: 5,
      correlationPassed: true, concentrationPassed: true, venueExposurePassed: true,
      accountReconciled: true,
    },
    legs: intent.legs.map(leg => ({
      ...leg, decision: 'ALLOW' as const, policyVersion: 1, validUntil: now + 5000, currency: 'PAPER_USD',
      debitAtomic: '200', feeAtomic: '5', networkFeeAtomic: '0', plannedMaxLossAtomic: '90',
      qualityPassed: true, assetSafetyPassed: true, entryProtectionAvailable: true,
    })),
    venue: { environment: 'PAPER', allowedVenues: ['binance-paper'], supportedModes: ['MULTI_ASSET_BASKET'],
      maxLegs: 5, expiresAt: now + 5000, paperTransactionalCommitAvailable: false, jitoAtomicExecutionCertified: false },
    control: { mode: 'PAPER', emergency: false, pausedNewOrders: false },
  });
  it('denies combined risk exceeding the account cap though all legs allow individually', () => {
    const res = assessBundle(intent, mkProof(), now);
    expect(res.approved).toBe(false);
    expect(res.reasonCodes).toContain('BUNDLE_AGGREGATE_RISK_LIMIT');
    expect(res.canSubmit).toBe(false);
  });
  it('denies a single rejected leg regardless of the rest of the bundle', () => {
    const proof = mkProof();
    const res = assessBundle(intent, { ...proof, legs: proof.legs.map((e, i) => i ? { ...e, decision: 'DENY' as const } : e) }, now);
    expect(res.reasonCodes).toContain('CANONICAL_RISK_NOT_ALLOW');
  });
  it('catches reserved cash and prevents a false successful basket', () => {
    const proof = mkProof();
    const res = assessBundle(intent, { ...proof, account: { ...proof.account, cashBalanceAtomic: '410', reservedCashAtomic: '10', maxTotalOpenRiskAtomic: '1000' } }, now);
    expect(res.reasonCodes).toContain('BUNDLE_INSUFFICIENT_AVAILABLE_CASH');
  });
});
