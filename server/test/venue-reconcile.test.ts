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
  it('keeps account and instrument boundaries when their identifiers contain colons', () => {
    const otherAccount = { ...observation, accountId: 'shadow-account:binance', instrumentId: 'BTCUSDT' };
    const result = assessVenueReconciliation([tracked], [otherAccount], options);
    expect(result.status).toBe('ATTENTION_REQUIRED');
    expect(result.findings.map(x => x.code)).toEqual(['UNKNOWN_VENUE_ORDER', 'MISSING_VENUE_ORDER']);
    expect(result.findings[0].orderKey).not.toBe(result.findings[1].orderKey);
  });
  it('keeps event IDs scoped to their account even when identifiers contain colons', () => {
    const first = { ...observation, eventId: 'binance:event-1' };
    const second = { ...observation, accountId: 'shadow-account:binance', instrumentId: 'BTCUSDT2' };
    const result = assessVenueReconciliation([first, second], [first, second], {
      ...options,
      quantityDecimalsByInstrument: { ...options.quantityDecimalsByInstrument, 'BINANCE_SPOT:shadow-account:binance:BTCUSDT2': 8 },
    });
    expect(result.status).toBe('CONSISTENT');
    expect(result.observedOrders).toBe(2);
    expect(result.findings).toEqual([]);
  });
  it('reports fill mismatches without synthesizing a trade', () => {
    const result = assessVenueReconciliation([tracked], [
      { ...observation, cumulativeFilledQty: '0.30000000' },
    ], options);
    expect(result.findings.map(x => x.code)).toContain('CUMULATIVE_FILL_MISMATCH');
  });
  it('flags conflicting event IDs and stale evidence', () => {
    const result = assessVenueReconciliation([tracked], [
      observation, { ...observation, state: 'CANCELED', receivedAtMs: now - 5000 },
    ], options);
    expect(result.findings.map(x => x.code)).toEqual(
      expect.arrayContaining(['DUPLICATE_EVENT_CONFLICT', 'EVIDENCE_STALE_OR_FUTURE']),
    );
  });
  it.each([0, 10])('requires attention for contradictory observations at the same venue time (%i ms apart at receipt)', offset => {
    const conflicting = {
      ...observation,
      eventId: 'event-2',
      cumulativeFilledQty: '0.30000000',
      receivedAtMs: observation.receivedAtMs - offset,
    };
    const result = assessVenueReconciliation([tracked], [observation, conflicting], options);
    const reversed = assessVenueReconciliation([tracked], [conflicting, observation], options);
    expect(result.status).toBe('ATTENTION_REQUIRED');
    expect(result.findings.map(x => x.code)).toEqual(['CONFLICTING_ORDER_OBSERVATIONS']);
    expect(result.canSendOrders).toBe(false);
    expect(reversed).toEqual(result);
  });
  it('treats compatible quantities at the same venue time as equivalent', () => {
    const other = { ...observation, eventId: 'event-2', requestedQty: '1', cumulativeFilledQty: '0.2' };
    const result = assessVenueReconciliation([tracked], [observation, other], options);
    expect(result.status).toBe('CONSISTENT');
  });
  it('does not treat a late-arriving exchange event as fresh evidence', () => {
    const result = assessVenueReconciliation([tracked], [
      { ...observation, exchangeEventAtMs: now - options.maxEvidenceAgeMs - 1 },
    ], options);
    expect(result.status).toBe('ATTENTION_REQUIRED');
    expect(result.findings.map(x => x.code)).toContain('EVIDENCE_STALE_OR_FUTURE');
    expect(result.canSendOrders).toBe(false);
  });
  it('requires venue evidence to confirm an already known exchange order ID', () => {
    const result = assessVenueReconciliation([tracked], [
      { ...observation, exchangeOrderId: null },
    ], options);
    expect(result.status).toBe('ATTENTION_REQUIRED');
    expect(result.findings.map(x => x.code)).toContain('EXCHANGE_ID_CONFLICT');
  });
  it('accepts a matching client order observation when the local exchange ID is unknown', () => {
    const result = assessVenueReconciliation([{ ...tracked, exchangeOrderId: null }], [observation], options);
    expect(result.status).toBe('CONSISTENT');
    expect(result.canSendOrders).toBe(false);
  });
  it.each([
    ['FILLED', '0.00000000'],
    ['FILLED', '0.20000000'],
    ['PARTIAL_FILL', '0.00000000'],
    ['PARTIAL_FILL', '1.00000000'],
  ] as const)('rejects %s with a contradictory cumulative fill of %s', (state, cumulativeFilledQty) => {
    const result = assessVenueReconciliation(
      [{ ...tracked, state, cumulativeFilledQty }],
      [{ ...observation, state, cumulativeFilledQty }],
      options,
    );
    expect(result.status).toBe('ATTENTION_REQUIRED');
    expect(result.findings.map(x => x.code)).toEqual(['INVALID_STATE', 'INVALID_STATE']);
  });
  it('accepts a fully filled order with an exact cumulative quantity match', () => {
    const result = assessVenueReconciliation(
      [{ ...tracked, state: 'FILLED', cumulativeFilledQty: '1' }],
      [{ ...observation, state: 'FILLED', cumulativeFilledQty: '1.00000000' }],
      options,
    );
    expect(result.status).toBe('CONSISTENT');
    expect(result.canSendOrders).toBe(false);
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
