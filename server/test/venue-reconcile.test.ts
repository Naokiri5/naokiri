import { describe, expect, it } from 'vitest';
import {
  assessVenueReconciliation, exactQuantityUnits,
  type TrackedOrderEvidence, type VenueOrderEvidence,
} from '../src/exec/venue-reconcile.js';

const now = 1730000000000;
const tracked: TrackedOrderEvidence = {
  venue: 'BINANCE_SPOT', accountId: 'shadow-account',
  instrumentId: 'binance:BTCUSDT',
  clientOrderId: 'order-1', exchangeOrderId: 'exchange-1',
  state: 'PARTIAL_FILL', requestedQty: '1.00000000',
  cumulativeFilledQty: '0.20000000',
};
const observation: VenueOrderEvidence = {
  ...tracked, source: 'REST_RECOVERY', eventId: 'event-1',
  exchangeEventAtMs: now - 100, receivedAtMs: now - 25,
};
const options = {
  nowMs: now, maxEvidenceAgeMs: 3000,
  coverage: 'COMPLETE_ORDERS_AND_FILLS' as const,
  quantityDecimalsByInstrument: { 'BINANCE_SPOT:shadow-account:binance:BTCUSDT': 8 },
};

describe('venue reconciliation: evidence only, never an execution gate', () => {
  it('never permits sending orders even when consistent', () => {
    const result = assessVenueReconciliation([tracked], [observation], options);
    expect(result.status).toBe('CONSISTENT');
    expect(result.canSendOrders).toBe(false);
  });
  it('rejects incomplete paginated coverage', () => {
    const result = assessVenueReconciliation([tracked], [observation], { ...options, coverage: 'PARTIAL' });
    expect(result.findings.map(x => x.code)).toContain('INCOMPLETE_COVERAGE');
  });
  it('does not assume a missing venue order was canceled', () => {
    const result = assessVenueReconciliation([tracked], [], options);
    expect(result.findings.map(x => x.code)).toContain('MISSING_VENUE_ORDER');
  });
  it('does not auto-adopt unknown venue orders', () => {
    const result = assessVenueReconciliation([], [observation], options);
    expect(result.findings.map(x => x.code)).toContain('UNKNOWN_VENUE_ORDER');
  });
  it('reports fill mismatches without synthesizing a trade', () => {
    const result = assessVenueReconciliation([tracked], [
      { ...observation, cumulativeFilledQty: '0.30000000' },
    ], options);
    expect(result.findings.map(x => x.code)).toContain('CUMULATIVE_FILL_MISMATCH');
  });
  it('flags conflicting event IDs and stale evidence', () => {
    const result = assessVenueReconciliation([tracked], [
      observation, { ...observation, state: 'FILLED', receivedAtMs: now - 5000 },
    ], options);
    expect(result.findings.map(x => x.code)).toEqual(
      expect.arrayContaining(['DUPLICATE_EVENT_CONFLICT', 'EVIDENCE_STALE_OR_FUTURE']),
    );
  });
  it('uses exact decimal quantities with no silent rounding', () => {
    expect(exactQuantityUnits('0.00000001', 8)).toBe(1n);
    expect(exactQuantityUnits('0.000000001', 8)).toBeNull();
    expect(exactQuantityUnits('NaN', 8)).toBeNull();
    expect(exactQuantityUnits('1e-8', 8)).toBeNull();
  });
  it('rejects reported fills greater than submitted quantity', () => {
    const result = assessVenueReconciliation([tracked], [
      { ...observation, cumulativeFilledQty: '1.20000000' },
    ], options);
    expect(result.findings.map(x => x.code)).toContain('INVALID_QUANTITY');
  });
});
