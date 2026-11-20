import { describe, expect, it } from 'vitest';
import { projectBehaviorEvidence } from '../src/bmind/evidence.js';
import { QUALITY_LIMITS } from '../src/market/quality.js';

const asOf = 1_800_000_000_000;
const instrument = 'crypto:binance:BTCUSDT';
const ticker = {
  instrumentId: instrument, symbol: 'BTCUSDT', base: 'BTC', quote: 'USDT', source: 'binance',
  providerTs: asOf - 1_000, receivedAt: asOf - 500, last: 100, bid: 99, ask: 101, quoteVolume: 3_000,
};
const book = { ts: asOf - 100, bids: [[99, 10]], asks: [[101, 10]] };
const snapshot = { schemaVersion: 'ditas.snapshot.v1', instrumentId: instrument, asOf, quality: { status: 'OK' }, ticker, book };
const project = (changes: Partial<typeof snapshot> = {}) => projectBehaviorEvidence({ ...snapshot, ...changes }, instrument, asOf);

describe('B-MIND frozen evidence boundaries', () => {
  it('groups Binance observations and deduplicates the same ticker received twice', () => {
    const first = project()!.evidence;
    const second = project({ ticker: { ...ticker, receivedAt: asOf - 100 } })!.evidence;
    expect(first.map(ref => ref.status)).toEqual(['AVAILABLE', 'AVAILABLE']);
    expect(first[0]).toHaveProperty('originId');
    expect(second[0]).toEqual({ ...first[0], receivedTimeMs: asOf - 100 });
    expect(first.map(ref => ref.status === 'AVAILABLE' && ref.dependencyGroup)).toEqual(['binance', 'binance']);
  });

  it('rejects mismatched identity, late receipt, malformed prices, and unsupported snapshot schemas', () => {
    for (const change of [{ instrumentId: 'crypto:binance:ETHUSDT' }, { receivedAt: asOf + 1 },
      { providerTs: asOf + 1 }, { last: NaN }, { ask: Infinity }, { last: -1 }]) {
      expect(project({ ticker: { ...ticker, ...change } })).toMatchObject({
        status: 'UNKNOWN', evidence: [{ status: 'UNKNOWN' }, { status: 'UNKNOWN' }],
      });
    }
    expect(project({ schemaVersion: 'ditas.snapshot.v2' })).toBeNull();
    expect(project({ instrumentId: 'crypto:binance:ETHUSDT' })).toBeNull();
  });

  it('distinguishes stale inputs from malformed data at the capture cutoff', () => {
    const oldBook = { ...book, ts: asOf - QUALITY_LIMITS.maxBookAgeMs - 1 };
    expect(project({ book: oldBook })!.evidence[1]).toMatchObject({ status: 'STALE' });
    const oldTicker = { ...ticker, providerTs: asOf - QUALITY_LIMITS.maxQuoteAgeMs - 1 };
    expect(project({ ticker: oldTicker })!.evidence[0]).toMatchObject({ status: 'STALE' });
    expect(project({ book: { ...book, ts: asOf + 1 } })!.evidence[1]).toMatchObject({ status: 'UNKNOWN' });
    expect(project({ book: { ...book, asks: [[98, 10]] } })!.evidence[1]).toMatchObject({ status: 'UNKNOWN' });
  });

  it('keeps failed snapshots unusable and excludes unrelated payload text', () => {
    const report = projectBehaviorEvidence({ ...snapshot, quality: { status: 'FAIL' },
      context: { notes: 'Fixture instruction-like natural language' } }, instrument, asOf);
    expect(report).toMatchObject({ status: 'UNKNOWN', dataQuality: 'FAIL', use: 'RESEARCH_ONLY',
      evidence: [{ status: 'UNKNOWN' }, { status: 'UNKNOWN' }] });
    expect(JSON.stringify(report)).not.toContain('Fixture instruction-like natural language');
  });
});
