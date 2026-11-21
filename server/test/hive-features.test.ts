import { describe, expect, it } from 'vitest';
import {
  HIVE_FEATURE_SLOTS, HIVE_REQUIRED_TICKS, HiveFeatureVectorBuilder,
  validHiveMarketTick, type HiveMarketTick,
} from '../src/market/hiveFeatureVector.js';
import {
  HIVE_META_STRIDE, HiveSharedSnapshotRouter, readHiveSnapshot,
} from '../src/telemetry/hiveSharedSnapshot.js';
import { auditHiveWiring, HIVE_TARGET_BUCKETS } from '../src/ops/hiveWiringAudit.js';

function tick(n: number, o: Partial<HiveMarketTick> = {}): HiveMarketTick {
  const mid = 100 + n * 0.001;
  return {
    symbol: 'BTCUSDT', sleeve: 'spot', timestampMs: 1_700_000_000_000 + n * 100,
    midPrice: mid, bidPrice: mid - 0.05, askPrice: mid + 0.05,
    bidSizeL1: 50, askSizeL1: 40, bidDepthL5: 800, askDepthL5: 700,
    tradeVolume: 10, buyVolume: 6, sellVolume: 4, ...o,
  };
}
const warm = (b: HiveFeatureVectorBuilder, offset = 0, overrides: Partial<HiveMarketTick> = {}) => {
  let last: Float64Array | null = null;
  for (let i = 0; i < HIVE_REQUIRED_TICKS; i++) {
    last = b.update(tick(offset + i, overrides));
    if (i < HIVE_REQUIRED_TICKS - 1) expect(last).toBeNull();
  }
  return last!;
};

describe('MIA 5.0 97-slot rolling observational feature pipeline', () => {
  it('requires a complete 233-lag window, not the source PDF 20-tick partial warmup', () => {
    const b = new HiveFeatureVectorBuilder();
    const out = warm(b);
    expect(out).toBeInstanceOf(Float64Array);
    expect(out).toHaveLength(HIVE_FEATURE_SLOTS);
    expect([...out].every(Number.isFinite)).toBe(true);
    expect([...out].every(x => Math.abs(x) <= 1)).toBe(true);
    expect(b.status('spot', 'BTCUSDT')).toMatchObject({
      samples: HIVE_REQUIRED_TICKS, ready: true, authority: 'OBSERVATION_ONLY',
    });
  });

  it('keeps different market sleeves separate and returns non-aliased vectors', () => {
    const b = new HiveFeatureVectorBuilder();
    const spot = warm(b);
    const futures = warm(b, 0, { sleeve: 'futures', fundingRate: 0.0002 });
    expect(spot[96]).toBe(0);
    expect(futures[96]).toBe(0.8);
    expect(b.status('spot', 'BTCUSDT').samples).toBe(HIVE_REQUIRED_TICKS);
    const oldSlot = spot[0];
    expect(b.update(tick(HIVE_REQUIRED_TICKS))).toBeInstanceOf(Float64Array);
    expect(spot[0]).toBe(oldSlot);
  });

  it('rejects crossed books, invalid prices, incomplete trades and NaN without state mutation', () => {
    const b = new HiveFeatureVectorBuilder();
    expect(validHiveMarketTick(tick(0))).toBe(true);
    expect(b.update(tick(0, { askPrice: 99 }))).toBeNull();
    expect(b.update(tick(0, { tradeVolume: 1 }))).toBeNull();
    expect(b.update(tick(0, { bidSizeL1: NaN }))).toBeNull();
    expect(b.update(tick(0, { onChainLiquidityUsd: -1 }))).toBeNull();
    expect(b.status('spot', 'BTCUSDT').samples).toBe(0);
    b.update(tick(0));
    expect(b.update(tick(0))).toBeNull(); // duplicate source timestamp
    expect(b.update(tick(-1))).toBeNull(); // stale source timestamp
    expect(b.status('spot', 'BTCUSDT').samples).toBe(1);
  });

  it('refuses unbounded symbols and discontinuous history', () => {
    const b = new HiveFeatureVectorBuilder({ maxSymbols: 1, maxGapMs: 500 });
    b.update(tick(0));
    expect(b.update(tick(1, { symbol: 'ETHUSDT' }))).toBeNull();
    expect(b.status('spot', 'ETHUSDT').samples).toBe(0);
    b.update(tick(1_000)); // 100 seconds: reset, never blend stale history
    expect(b.status('spot', 'BTCUSDT').samples).toBe(1);
    expect(() => new HiveFeatureVectorBuilder({ capacity: 32 })).toThrow();
  });

  it('maintains the rolling capacity over 1,000 ticks and emits finite vectors', () => {
    const b = new HiveFeatureVectorBuilder();
    let ready = 0;
    for (let i = 0; i < 1_000; i++) {
      const out = b.update(tick(i));
      if (out) {
        ready++;
        expect(out.length).toBe(97);
        expect(out.every(Number.isFinite)).toBe(true);
      }
    }
    expect(ready).toBe(1_000 - HIVE_REQUIRED_TICKS + 1);
    expect(b.status('spot', 'BTCUSDT').samples).toBe(256);
  });
});

describe('MIA 5.0 zero-copy shared storage with bounded consistent reads', () => {
  it('publishes 97 slots and gives readers an immutable-by-convention copy', () => {
    const r = new HiveSharedSnapshotRouter(2);
    const first = r.register('crypto:binance:BTCUSDT');
    expect(r.register('crypto:binance:BTCUSDT')).toBe(first);
    const input = new Float64Array(97).fill(0.25);
    expect(r.read(first)).toBeNull(); // never treat zero-initialized storage as data
    expect(r.publish(first, input, 42)).toBe(true);
    expect(r.publish(first, input, 42)).toBe(false); // never replay a tick
    expect(r.publish(first, input, 41)).toBe(false); // never regress source sequence
    const snap = r.read(first)!;
    expect(snap).toMatchObject({
      sequence: 2, sourceSequence: 42, authority: 'OBSERVATION_ONLY',
    });
    expect(snap.features[0]).toBe(0.25);
    snap.features[0] = 999;
    input[0] = -999;
    expect(r.read(first)!.features[0]).toBe(0.25);
    expect(r.read(1)).toBeNull(); // no accidental data leakage between instruments
  });

  it('never accepts an in-progress odd version, and rejects nonfinite buffers', () => {
    const r = new HiveSharedSnapshotRouter(1);
    r.register('BTCUSDT');
    const v = new Float64Array(97).fill(1);
    expect(r.publish(0, v, 1)).toBe(true);
    v[3] = NaN;
    expect(r.publish(0, v, 2)).toBe(false);
    const meta = new Int32Array(r.buffers().metadata);
    Atomics.store(meta, 0, 3); // simulate writer in progress
    expect(readHiveSnapshot(r.buffers(), 0, 2)).toBeNull();
    expect(r.publish(0, new Float64Array(97), 3)).toBe(false);
    Atomics.store(meta, 0, 2);
    expect(r.read(0)!.sourceSequence).toBe(1);
    expect(r.buffers().metadata.byteLength).toBe(HIVE_META_STRIDE * 4);
  });

  it('fails closed on wrong shapes, invalid identifiers and exhausted capacity', () => {
    const r = new HiveSharedSnapshotRouter(1);
    expect(() => r.register('')).toThrow();
    r.register('BTCUSDT');
    expect(() => r.register('ETHUSDT')).toThrow(/CAPACITY/);
    expect(r.publish(-1, new Float64Array(97), 1)).toBe(false);
    expect(r.publish(0, new Float64Array(96), 1)).toBe(false);
    expect(r.publish(0, new Float64Array(97), 0)).toBe(false);
    expect(() => r.read(1)).toThrow();
    expect(() => readHiveSnapshot({
      features: new SharedArrayBuffer(8), metadata: new SharedArrayBuffer(8),
    }, 0)).toThrow(/SHAPE/);
  });
});

describe('MIA 100-worker Hive static routing audit', () => {
  it('reuses unique canonical W-* workers and labels unfinished target capabilities', () => {
    const report = auditHiveWiring();
    expect(report.allHundredRegistered).toBe(true);
    expect(report.canonicalWorkers).toBe(100);
    expect(report.uniqueWorkerIds).toBe(100);
    expect(report.featureSlots).toBe(97);
    expect(report.buckets).toHaveLength(HIVE_TARGET_BUCKETS.length);
    expect(report.buckets.every(x => x.relatedCanonicalWorkerIds.every(id => id.startsWith('W-')))).toBe(true);
    expect(report.buckets.find(x => x.id === 'B04_VPIN_TOXICITY')?.coverage).toBe('NOT_INTEGRATED');
    expect(report.buckets.find(x => x.id === 'B08_YIELD_CARRY_ARB')?.coverage).toBe('NOT_INTEGRATED');
    expect(report).toMatchObject({
      canAuthorizeTrade: false, canSubmitOrder: false, certifiedUnder4ms: false,
      sharedMemoryAuthority: 'OBSERVATION_ONLY',
    });
  });
});
