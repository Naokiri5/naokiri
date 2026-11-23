import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { all, closeDb } from '../src/db/db.js';
import { freshDb } from './helpers.js';
import {
  evaluateDeepPostClose, recordDeepPostClose, validateDeepBundle,
  type DeepPositionBundle, type DeepPostCloseInput, type DeepCloseReason,
} from '../src/choice/dpbm.js';

const NOW = Date.UTC(2026, 10, 23, 13, 0, 0);
const bundle = (): DeepPositionBundle => ({
  bundleId: 'BTCUSDT-thesis-1', thesisLineageId: 'lineage-a',
  strategyId: 'multi_timeframe_structure', symbol: 'BTCUSDT', side: 'LONG',
  plannedNotionalUsd: 500, aggregateRiskCapUsd: 10, currentOpenRiskUsd: 0,
  legs: [
    { legId: 'entry-a', weight: 0.4, maxNotionalUsd: 200, maxRiskUsd: 4, state: 'EXITED' },
    { legId: 'entry-b', weight: 0.35, maxNotionalUsd: 175, maxRiskUsd: 3.5, state: 'EXITED' },
    { legId: 'entry-c', weight: 0.25, maxNotionalUsd: 125, maxRiskUsd: 2.5, state: 'CANCELLED' },
  ],
});
const input = (closeReason: DeepCloseReason = 'TAKE_PROFIT'): DeepPostCloseInput => ({
  closeReason, ledgerReconciled: true, hasUnsettledOrders: false,
  freshContinuationTrigger: true, freshReversalTrigger: false,
  strategyStillEligible: true, forecastStillValid: true, now: NOW,
});
beforeEach(() => freshDb(false));
afterEach(() => closeDb());

describe('DEEP advisory position-bundle risk invariants', () => {
  it('validates 40/35/25 staged allocation and rejects exposure above hard cap', () => {
    expect(validateDeepBundle(bundle())).toEqual([]);
    const bad = bundle();
    bad.legs[1].legId = bad.legs[0].legId;
    bad.legs[2].weight = 0.4;
    bad.legs[2].maxRiskUsd = 30;
    bad.legs[2].maxNotionalUsd = 1_000;
    expect(validateDeepBundle(bad)).toEqual(expect.arrayContaining([
      'DUPLICATE_OR_EMPTY_LEG_ID', 'LEG_WEIGHTS_NOT_ONE',
      'SUM_LEG_RISK_EXCEEDS_CAP', 'SUM_LEG_NOTIONAL_EXCEEDS_CAP',
    ]));
    expect(() => evaluateDeepPostClose(bad, input())).toThrow('INVALID_DEEP_BUNDLE');
  });

  it.each([
    'STOP_LOSS', 'THESIS_INVALIDATED', 'ABNORMAL_COST_OR_SLIPPAGE', 'RECONCILIATION_MISMATCH',
  ] as DeepCloseReason[])('never reenters or upsizes after %s', closeReason => {
    const decision = evaluateDeepPostClose(bundle(), input(closeReason));
    expect(decision).toMatchObject({
      nextState: 'NO_TRADE_RECOVERY', behavior: 'NO_TRADE_RECOVERY',
      tradingAuthority: false, allowsUpsizedOrAutomaticRecovery: false,
    });
    recordDeepPostClose(decision);
  });

  it('blocks every reentry until financial reconciliation and ALL legs are settled', () => {
    expect(evaluateDeepPostClose(bundle(), { ...input(), ledgerReconciled: false }).reason)
      .toBe('UNRECONCILED_LEDGER_OR_ORDERS');
    expect(evaluateDeepPostClose(bundle(), { ...input(), hasUnsettledOrders: true }).nextState)
      .toBe('NO_TRADE_RECOVERY');
    const open = bundle(); open.legs[0].state = 'PARTIALLY_FILLED';
    expect(evaluateDeepPostClose(open, input()).reason).toBe('OPEN_OR_PARTIAL_BUNDLE_LEGS_REMAIN');
    const liveRisk = bundle(); liveRisk.currentOpenRiskUsd = 1;
    expect(evaluateDeepPostClose(liveRisk, input()).reason).toBe('OPEN_BUNDLE_RISK_REMAINS');
  });

  it('a fresh signal generates only a new research candidate, never an execution order', () => {
    const continuation = evaluateDeepPostClose(bundle(), input());
    expect(continuation).toMatchObject({
      behavior: 'CONTINUATION_REENTRY', nextState: 'REENTRY_CANDIDATE', tradingAuthority: false,
    });
    const opposite = evaluateDeepPostClose(bundle(), {
      ...input(), freshContinuationTrigger: false, freshReversalTrigger: true,
    });
    expect(opposite.behavior).toBe('REVERSAL_REENTRY');
    const conflict = evaluateDeepPostClose(bundle(), {
      ...input(), freshContinuationTrigger: true, freshReversalTrigger: true,
    });
    expect(conflict.nextState).toBe('NO_TRADE_RECOVERY');
    expect(evaluateDeepPostClose(bundle(), {
      ...input(), freshContinuationTrigger: false,
    }).nextState).toBe('CLOSED_ARCHIVED');
    recordDeepPostClose(continuation);
    recordDeepPostClose(continuation);
    expect(all('SELECT * FROM deep_postclose_decisions')).toHaveLength(1);
    for (const table of ['orders','fills','positions','ledger_entries'])
      expect(all('SELECT * FROM ' + table)).toHaveLength(0);
  });
});
