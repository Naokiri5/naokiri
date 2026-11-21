/**
 * MIA bundle preview adapter — read-only, never an OMS or authorization source.
 * Reads decisions from canonical DB and calls canonical risk/gate.ts for each leg.
 * PAPER is the only funded simulator. TESTNET/LIVE are explicit locked previews.
 */
import { get, all, P } from '../../db/db.js';
import { getControl } from '../../core/mode.js';
import { sha256 } from '../../core/util.js';
import { market } from '../../market/store.js';
import { evaluateRisk } from '../../risk/gate.js';
import { currentPolicy } from '../../risk/policy.js';
import { accountState, openPositions, PAPER_ACCOUNT } from '../../portfolio/ledger.js';
import { correlation } from '../../portfolio/correlation.js';
import { reconcile } from '../../portfolio/calendar.js';
import type { DecisionReport } from '../../decision/engine.js';
import { assessBundle, type BundleEnvironment, type BundleMode, type BundleLeg, type LegRiskEvidence, type BundleEvidence } from './assessment.js';

export type BundlePreviewInput = {
  environment: BundleEnvironment;
  mode: BundleMode;
  decisionIds: readonly string[];
};

/** MIA's current PAPER ledger uses quote prices as simulated USD, not an FX feed. */
const SCALE = 1_000_000;
function asAtomic(value: number, round: 'up' | 'down' = 'up'): string {
  if (!Number.isFinite(value) || value < 0) throw new Error('INVALID_CANONICAL_AMOUNT');
  const scaled = value * SCALE;
  if (!Number.isSafeInteger(Math.ceil(scaled))) throw new Error('CANONICAL_AMOUNT_OUT_OF_RANGE');
  return String(round === 'up' ? Math.ceil(scaled - 1e-9) : Math.floor(scaled + 1e-9));
}

export function bundleCapabilities() {
  return {
    version: 1,
    maxPreviewLegs: 5,
    modes: ['BATCH_BEST_EFFORT', 'SPLIT_ORDER', 'MULTI_ASSET_BASKET', 'COORDINATED_STRATEGY', 'PAPER_ATOMIC', 'SOLANA_JITO_ATOMIC'] as const,
    environments: [
      { environment: 'PAPER', preview: true, canPlaceBundleOrders: false, reason: 'BUNDLE_ATOMIC_OMS_COMMIT_NOT_INSTALLED' },
      { environment: 'TESTNET', preview: false, canPlaceBundleOrders: false, reason: 'TESTNET_ORDER_ADAPTER_NOT_CERTIFIED' },
      { environment: 'LIVE', preview: false, canPlaceBundleOrders: false, reason: 'LIVE_G01_G14_AND_SIGNER_NOT_CERTIFIED' },
    ],
  };
}

/** The untrusted client supplies only stored decision IDs and intent mode; all risk evidence is server derived. */
export function previewBundle(input: BundlePreviewInput, now = Date.now()) {
  if (input.decisionIds.length < 2 || input.decisionIds.length > 5 ||
      new Set(input.decisionIds).size !== input.decisionIds.length)
    throw new Error('BUNDLE_REQUIRES_TWO_TO_FIVE_DISTINCT_DECISIONS');
  const bundleId = 'bundle-preview-' + sha256(JSON.stringify([input.environment, input.mode, input.decisionIds])).slice(0, 24);
  if (input.environment !== 'PAPER') return {
    bundleId, environment: input.environment, approved: false, canSubmit: false,
    reasonCodes: [input.environment === 'LIVE' ? 'LIVE_BUNDLE_SUBMISSION_NOT_CERTIFIED' : 'TESTNET_ORDER_PLACEMENT_NOT_IMPLEMENTED'],
    note: 'READ_ONLY_PREVIEW_NO_ORDER_SUBMITTED',
  };

  const ctl = getControl();
  const accepted = currentPolicy();
  const policy = accepted?.policy;
  const acct = accountState(PAPER_ACCOUNT, now);
  const existing = openPositions(PAPER_ACCOUNT);
  const pending = all<{ id: string }>(
    "SELECT id FROM orders WHERE account=? AND purpose='ENTRY' AND status IN ('NEW','PENDING_APPROVAL','PARTIALLY_FILLED')",
    PAPER_ACCOUNT,
  ).length;
  // An unreserved pending order makes the simulated available balance indeterminate.
  const reconciled = reconcile().ok && pending === 0 && acct.marksMissing.length === 0;
  const reports = input.decisionIds.map(id => {
    const row = get<{ report: string }>('SELECT report FROM decisions WHERE id=?', id);
    if (!row) throw new Error('BUNDLE_DECISION_NOT_FOUND');
    return P<DecisionReport>(row.report);
  });
  // Only real decisions in the current paper pipeline may enter the preflight.
  const legs: BundleLeg[] = [];
  const evidence: LegRiskEvidence[] = [];
  const candidateInstruments: string[] = [];
  for (let n = 0; n < reports.length; n++) {
    const report = reports[n];
    const id = input.decisionIds[n];
    if (!report || report.id !== id || !report.candidateId || !report.strategy?.id ||
        !report.instrumentId || !report.consensus?.expiresAt || report.decision !== 'PAPER_TRADE')
      throw new Error('BUNDLE_DECISION_NOT_PAPER_ELIGIBLE');
    const inst = market.instruments.get(report.instrumentId);
    // Risk is canonical. Missing instruments, policy and data must fail closed.
    const risk = evaluateRisk({
      instrumentId: report.instrumentId, strategyId: report.strategy.id, side: 'buy',
      entryPrice: report.entryRef, stopPrice: report.stopLoss,
      idempotencyKey: 'entry-' + report.candidateId, traceId: report.traceId,
      account: PAPER_ACCOUNT,
    }, now);
    const quantity = risk.sizing?.qty ?? 0;
    const quantityAtomic = asAtomic(quantity);
    const legId = 'leg-' + (n + 1);
    legs.push({
      legId, decisionId: id, instrumentId: report.instrumentId,
      venueId: 'binance-paper', side: 'BUY', requestedUnits: quantityAtomic,
    });
    candidateInstruments.push(report.instrumentId);
    const expiresAt = Date.parse(report.consensus.expiresAt);
    const validUntil = Number.isFinite(expiresAt) ? Math.min(expiresAt, now + 2_000) : 0;
    const notional = risk.sizing?.notional ?? 0;
    const fee = (policy?.feeRate ?? 0) * notional;
    evidence.push({
      legId, decisionId: id, instrumentId: report.instrumentId,
      venueId: 'binance-paper', side: 'BUY', requestedUnits: quantityAtomic,
      decision: risk.decision, policyVersion: risk.policyVersion ?? 0, validUntil,
      currency: 'PAPER_USD', debitAtomic: asAtomic(notional), feeAtomic: asAtomic(fee),
      networkFeeAtomic: '0', plannedMaxLossAtomic: asAtomic(risk.sizing?.plannedMaxLoss ?? 0),
      qualityPassed: risk.decision === 'ALLOW', assetSafetyPassed: risk.decision === 'ALLOW' &&
        inst?.market === 'crypto' && inst?.venue === 'binance' && inst.quote === 'USDT',
      entryProtectionAvailable: risk.decision === 'ALLOW' && report.stopLoss > 0 &&
        report.stopLoss < report.entryRef,
    });
  }
  // Pairwise portfolio correlation includes planned legs, not only existing positions.
  const correlationPassed = candidateInstruments.every((instrument, i) => {
    let count = 0;
    for (const p of existing) {
      const c = correlation(p.instrument, instrument);
      if (c == null || c >= (policy?.correlationThreshold ?? 0)) count++;
    }
    for (let j = 0; j < candidateInstruments.length; j++) {
      if (j === i) continue;
      const c = correlation(candidateInstruments[j], instrument);
      if (c == null || c >= (policy?.correlationThreshold ?? 0)) count++;
    }
    return count < (policy?.maxCorrelatedPositions ?? 0);
  });
  const nowValid = Number.isSafeInteger(now) && now > 0;
  const intent = {
    bundleId, environment: 'PAPER' as const, accountId: PAPER_ACCOUNT,
    strategyId: reports[0]?.strategy.id ?? 'unknown',
    idempotencyKey: bundleId, mode: input.mode, expiresAt: now + 2_000, legs,
  };
  const proof: BundleEvidence = {
    account: {
      environment: 'PAPER', accountId: PAPER_ACCOUNT, currency: 'PAPER_USD',
      policyVersion: accepted?.version ?? 0, validUntil: nowValid ? now + 2_000 : 0,
      cashBalanceAtomic: asAtomic(Math.max(0, acct.cash), 'down'),
      reservedCashAtomic: '0',
      existingOpenRiskAtomic: asAtomic(Math.max(0, acct.openRiskUsd)),
      reservedRiskAtomic: '0',
      maxTotalOpenRiskAtomic: asAtomic(Math.max(0, acct.equity * (policy?.maxOpenRiskPct ?? 0) / 100), 'down'),
      openPositionCount: acct.openCount, pendingPositionCount: pending,
      maxConcurrentPositions: policy?.maxConcurrentPositions ?? 0,
      correlationPassed, concentrationPassed: evidence.every(e =>
        Number(e.debitAtomic) <= Number(asAtomic(Math.max(0, acct.equity * (policy?.maxPositionNotionalPct ?? 0) / 100)))),
      venueExposurePassed: policy?.approvedVenues.includes('binance-paper') ?? false,
      accountReconciled: reconciled,
    },
    legs: evidence,
    venue: {
      environment: 'PAPER', allowedVenues: ['binance-paper'],
      supportedModes: ['BATCH_BEST_EFFORT', 'SPLIT_ORDER', 'MULTI_ASSET_BASKET', 'COORDINATED_STRATEGY', 'PAPER_ATOMIC'],
      maxLegs: 5, expiresAt: now + 2_000, paperTransactionalCommitAvailable: false,
      jitoAtomicExecutionCertified: false,
    },
    control: { mode: ctl.mode, emergency: ctl.emergency, pausedNewOrders: ctl.pausedNewOrders },
  };
  const assessment = assessBundle(intent, proof, now);
  return { ...assessment, note: 'READ_ONLY_PREVIEW_NO_ORDER_SUBMITTED', previewExpiresAt: now + 2_000 };
}
