import { describe, expect, it } from 'vitest';
import { assessPostFillMarkout, type PostFillMarkoutEvidence } from '../src/ditas/execution.js';

const sample = (): PostFillMarkoutEvidence => ({
  executionId: 'execution-123',
  accountId: 'paper-bot',
  executionVenueId: 'binance-paper',
  marketDataVenueId: 'binance',
  instrumentId: 'BTCUSDT',
  side: 'BUY',
  fillPrice: 100,
  fillAtMs: 100_000,
  quote: { venueId: 'binance', instrumentId: 'BTCUSDT', bid: 100.9, ask: 101.1, eventAtMs: 105_000, receivedAtMs: 105_100 },
});

describe('DITAS T+5 second markout research: identity, freshness, no invented market evidence', () => {
  it('calculates positive markout on BUY, from the matched bid/ask midpoint only', () => {
    const result = assessPostFillMarkout(sample());
    expect(result.status).toBe('MEASURED');
    if (result.status !== 'MEASURED') throw new Error('expected qualified evidence');
    expect(result.favorableMarkoutBps).toBeCloseTo(100);
    expect(result.horizonMs).toBe(5000);
    expect(result.quoteAgeFromFillMs).toBe(5000);
  });
  it('reverses the sign for SELL markout', () => {
    const input = sample();
    input.side = 'SELL';
    input.quote = { ...input.quote!, bid: 98.9, ask: 99.1 };
    const result = assessPostFillMarkout(input);
    expect(result.status).toBe('MEASURED');
    if (result.status !== 'MEASURED') throw new Error('expected qualified evidence');
    expect(result.favorableMarkoutBps).toBeCloseTo(100);
  });
  it('treats missing or non-matching quotes as UNKNOWN', () => {
    const input = sample();
    expect(assessPostFillMarkout({ ...input, quote: null })).toMatchObject({ status: 'UNKNOWN', favorableMarkoutBps: null, reasonCode: 'NO_MATCHED_QUOTE' });
    expect(assessPostFillMarkout({ ...input, quote: { ...input.quote!, venueId: 'bybit' } })).toMatchObject({ status: 'UNKNOWN', reasonCode: 'QUOTE_SOURCE_MISMATCH' });
    expect(assessPostFillMarkout({ ...input, quote: { ...input.quote!, instrumentId: 'ETHUSDT' } })).toMatchObject({ status: 'UNKNOWN', reasonCode: 'QUOTE_SOURCE_MISMATCH' });
  });
  it('prevents accidental latest-ticker fallback outside the measured T+5 window', () => {
    const input = sample();
    expect(assessPostFillMarkout({ ...input, quote: { ...input.quote!, eventAtMs: 106_000, receivedAtMs: 106_100 } })).toMatchObject({ status: 'UNKNOWN', reasonCode: 'T5_QUOTE_TIME_MISMATCH' });
    expect(assessPostFillMarkout({ ...input, quote: { ...input.quote!, eventAtMs: 104_000, receivedAtMs: 104_100 } })).toMatchObject({ status: 'UNKNOWN', reasonCode: 'T5_QUOTE_TIME_MISMATCH' });
  });
  it('rejects delayed, future-arrival and nonmonotonic timestamps', () => {
    const input = sample();
    expect(assessPostFillMarkout({ ...input, quote: { ...input.quote!, receivedAtMs: 107_100 } })).toMatchObject({ status: 'UNKNOWN', reasonCode: 'QUOTE_RECEIPT_TOO_LATE' });
    expect(assessPostFillMarkout({ ...input, quote: { ...input.quote!, receivedAtMs: 104_999 } })).toMatchObject({ status: 'UNKNOWN', reasonCode: 'TIMESTAMP_INVALID' });
    expect(assessPostFillMarkout({ ...input, fillAtMs: -1 })).toMatchObject({ status: 'UNKNOWN', reasonCode: 'TIMESTAMP_INVALID' });
  });
  it('rejects crossed, invalid or nonpositive market quotes', () => {
    const input = sample();
    expect(assessPostFillMarkout({ ...input, quote: { ...input.quote!, bid: 102, ask: 100 } })).toMatchObject({ status: 'UNKNOWN', reasonCode: 'QUOTE_OR_FILL_INVALID' });
    expect(assessPostFillMarkout({ ...input, fillPrice: Number.NaN })).toMatchObject({ status: 'UNKNOWN', reasonCode: 'QUOTE_OR_FILL_INVALID' });
    expect(assessPostFillMarkout({ ...input, quote: { ...input.quote!, ask: 0 } })).toMatchObject({ status: 'UNKNOWN', reasonCode: 'QUOTE_OR_FILL_INVALID' });
  });
  it('requires a scoped immutable execution identity', () => {
    const input = sample();
    expect(assessPostFillMarkout({ ...input, executionId: '' })).toMatchObject({ status: 'UNKNOWN', reasonCode: 'EXECUTION_IDENTITY_MISSING' });
    expect(assessPostFillMarkout({ ...input, accountId: '  ' })).toMatchObject({ status: 'UNKNOWN', reasonCode: 'EXECUTION_IDENTITY_MISSING' });
  });
});
