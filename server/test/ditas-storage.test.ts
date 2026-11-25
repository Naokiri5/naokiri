import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { freshDb, seedInstrument } from './helpers.js';
import { closeDb, get, run } from '../src/db/db.js';
import { migrate } from '../src/db/migrations.js';
import { memoryDetail, recordOpportunity, verifyMemory } from '../src/ditas/memory.js';
import { market } from '../src/market/store.js';
import { sha256 } from '../src/core/util.js';

/** Regression: every DITAS snapshot embedded ~220 KB of full candle history, filling the 500 MB Railway volume. */
describe('DITAS snapshot storage stays bounded', () => {
  let instrumentId: string;
  const bytes = (table: string, column: string) => get<{ n: number | null }>(`SELECT SUM(LENGTH(${column})) n FROM ${table}`)!.n ?? 0;
  const stored = () => bytes('ditas_snapshots', 'payload') + bytes('ditas_blobs', 'payload');
  const record = (dedupeKey: string, strategyId = 'trend_pullback', snapshotAt?: number) =>
    recordOpportunity({ kind: 'NO_SIGNAL', instrumentId, strategyId, dedupeKey, reason: 'Synthetic fixture: entry conditions absent', snapshotAt });
  beforeEach(() => { freshDb(false); market.reset(); instrumentId = seedInstrument('STORAGEUSDT').inst.id; });
  afterEach(() => { closeDb(); market.reset(); });

  it('stores a repeated snapshot of unchanged history in a small fraction of a full copy', () => {
    const first = record('fixture:first');
    const afterFirst = stored();
    const fullCopy = JSON.stringify(memoryDetail(first.id)!.snapshot!.candles).length;
    expect(fullCopy).toBeGreaterThan(100_000); // the history that used to be duplicated into every snapshot
    record('fixture:second'); // a later instant: a new snapshot, the same closed candle chunks
    const increment = stored() - afterFirst;
    expect(increment).toBeLessThan(fullCopy * 0.1);
    expect(get<{ n: number }>('SELECT COUNT(*) n FROM ditas_snapshots')!.n).toBe(2);
  });

  it('shares one snapshot across strategies rejected in the same scan pass', () => {
    const passAt = Date.now() - 5;
    const a = record('fixture:a', 'trend_pullback', passAt);
    const b = record('fixture:b', 'range_reversion', passAt);
    const c = record('fixture:c', 'donchian_breakout', passAt);
    expect(new Set([a.snapshotId, b.snapshotId, c.snapshotId]).size).toBe(1);
    expect(get<{ n: number }>('SELECT COUNT(*) n FROM ditas_snapshots')!.n).toBe(1);
    expect(get<{ n: number }>('SELECT COUNT(*) n FROM ditas_events')!.n).toBe(3);
    expect(() => record('fixture:future', 'trend_pullback', Date.now() + 60_000)).not.toThrow(); // a future instant is ignored
  });

  it('rehydrates the exact full candle history and keeps it tamper-evident', () => {
    const event = record('fixture:hydrate');
    const snapshot = memoryDetail(event.id)!.snapshot!;
    const engine = market.deep.get(instrumentId)!.engines['1h'].candles;
    expect(snapshot.candles['1h']).toHaveLength(400);
    expect(snapshot.candles['1h'].map((c: { t: number }) => c.t)).toEqual(engine.map((c) => c.t));
    expect(snapshot.schemaVersion).toBe('ditas.snapshot.v2');
    expect(verifyMemory()).toEqual({ ok: true, entries: 1 });
    const blob = get<{ hash: string; payload: string }>('SELECT hash,payload FROM ditas_blobs LIMIT 1')!;
    run('UPDATE ditas_blobs SET payload=? WHERE hash=?', blob.payload.replace(/"c":[0-9.]+/, '"c":1'), blob.hash);
    expect(verifyMemory()).toMatchObject({ ok: false, brokenAt: `blob_${blob.hash}` });
    expect(() => memoryDetail(event.id)).toThrow('DITAS_BLOB_INTEGRITY');
  });

  it('fails verification when a referenced chunk is missing', () => {
    record('fixture:missing');
    const blob = get<{ hash: string }>('SELECT hash FROM ditas_blobs LIMIT 1')!;
    run('DELETE FROM ditas_blobs WHERE hash=?', blob.hash);
    expect(verifyMemory().ok).toBe(false);
  });

  it('upgrades a v7 database without touching existing v1 snapshots', () => {
    closeDb();
    const raw = new DatabaseSync(':memory:');
    migrate(raw, 7);
    const payload = JSON.stringify({ schemaVersion: 'ditas.snapshot.v1', candles: { '1h': [{ t: 1, c: 2 }] } });
    const hash = sha256(payload);
    raw.prepare('INSERT INTO ditas_snapshots(id,created_at,instrument,payload,hash) VALUES (?,?,?,?,?)').run(`snap_${hash}`, 1, 'x', payload, hash);
    migrate(raw);
    expect(raw.prepare("SELECT name FROM sqlite_master WHERE name='ditas_blobs'").get()).toBeTruthy();
    const rows = raw.prepare('SELECT * FROM ditas_snapshots').all();
    expect(verifyMemory([], rows, [])).toEqual({ ok: true, entries: 0 });
    raw.close();
    freshDb(false);
  });
});
