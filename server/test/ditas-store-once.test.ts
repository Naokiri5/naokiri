import { describe, it, expect, beforeEach } from 'vitest';
import { freshDb, seedInstrument } from './helpers.js';
import { recordOpportunity, verifyMemory, memoryDetail, CANDLE_CHUNK } from '../src/ditas/memory.js';
import { all, get, run } from '../src/db/db.js';
import { market } from '../src/market/store.js';

/** Owner-approved store-once decision memory (schema v6): heavy market data stored once, referenced by hash. */
describe('DITAS store-once market data', () => {
  let id = '';
  beforeEach(() => { freshDb(); market.reset(); ({ inst: { id } } = seedInstrument('ETHUSDT', { seed: 2 }) as any); });
  const rec = (strategyId: string, key: string) => recordOpportunity({ kind: 'NO_SIGNAL', instrumentId: id, strategyId, interval: '1h', dedupeKey: key, reason: 't' } as any);

  it('strategies evaluated on the same market state share one stored copy of candles and book', () => {
    rec('trend_pullback', 'a'); const blobsAfterOne = get<any>('SELECT COUNT(*) n FROM ditas_blobs').n;
    rec('breakout', 'b'); rec('mean_reversion', 'c');
    expect(get<any>('SELECT COUNT(*) n FROM ditas_blobs').n).toBe(blobsAfterOne); // no new market-data blobs
    const sizes = all<any>('SELECT LENGTH(payload) b FROM ditas_snapshots').map((r) => r.b);
    expect(Math.max(...sizes)).toBeLessThan(30_000); // was ~223 KB per snapshot before schema v6
  });
  it('reads back exactly the market data that was recorded (candles and book)', () => {
    const e = rec('trend_pullback', 'a');
    const d = memoryDetail(e.id)!.snapshot;
    const engine = market.deep.get(id)!.engines['1h'].candles;
    expect(d.candles['1h']).toHaveLength(engine.length);
    expect(d.candles['1h'].at(-1).t).toBe(engine.at(-1)!.t); expect(d.candles['1h'].at(-1).c).toBe(engine.at(-1)!.c);
    expect(d.book.bids[0]).toEqual(market.deep.get(id)!.book!.bids[0]);
    expect(d.schemaVersion).toBe('ditas.snapshot.v2');
    // candle windows are chunked by time, so most chunks are reusable when the window slides
    const raw = JSON.parse(get<any>('SELECT payload FROM ditas_snapshots WHERE id=?', e.snapshotId).payload);
    expect(raw.candles['1h'].$chunks.length).toBeGreaterThanOrEqual(Math.ceil(engine.length / CANDLE_CHUNK));
  });
  it('verification catches a modified or missing blob', () => {
    rec('trend_pullback', 'a');
    const events = all<any>('SELECT * FROM ditas_events ORDER BY seq'); const snaps = all<any>('SELECT * FROM ditas_snapshots'); const blobs = all<any>('SELECT * FROM ditas_blobs');
    expect(verifyMemory(events, snaps, blobs).ok).toBe(true);
    const tampered = blobs.map((b, i) => (i === 0 ? { ...b, payload: b.payload.replace(/\d/, '9') } : b));
    expect(verifyMemory(events, snaps, tampered)).toMatchObject({ ok: false, brokenAt: expect.stringMatching(/^blob:/) });
    expect(verifyMemory(events, snaps, blobs.slice(1))).toMatchObject({ ok: false, brokenAt: expect.stringContaining('missing blob') });
  });
  it('blobs are immutable like every other DITAS record', () => {
    rec('trend_pullback', 'a');
    expect(() => run("UPDATE ditas_blobs SET payload='x'")).toThrow(/immutable/);
    expect(() => run('DELETE FROM ditas_blobs')).toThrow(/immutable/);
  });
});
