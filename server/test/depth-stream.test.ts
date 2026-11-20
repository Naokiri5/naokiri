import { describe, it, expect } from 'vitest';
import { BookSync, parseDepthEvent, startDepthStream, type DepthEvent, type StreamBook } from '../src/market/depthStream.js';

/** Blueprint milestone 3: sequence-checked streaming books (Binance diff-depth algorithm), fully offline. */
const ev = (U: number, u: number, b: [string, string][] = [], a: [string, string][] = [], s = 'BTCUSDT'): DepthEvent => ({ E: 1_000 + u, s, U, u, b, a });
const snap = (L: number, ts = 1_000) => ({ lastUpdateId: L, ts, bids: [[100, 1], [99, 2]] as [number, number][], asks: [[101, 1], [102, 3]] as [number, number][] });

describe('BookSync (Binance diff-depth synchronization)', () => {
  it('buffers until a snapshot, drops events already in it, and applies the overlapping one', () => {
    const s = new BookSync('BTCUSDT');
    expect(s.onEvent(ev(95, 100))).toBe('BUFFERED');          // older than the snapshot: dropped later
    expect(s.onEvent(ev(101, 105, [['100', '5']]))).toBe('BUFFERED'); // overlaps L=103 → applied
    expect(s.book(1)).toBeNull();                                // never published while buffering
    expect(s.onSnapshot(snap(103))).toBe('SYNCED');
    expect(s.lastUpdateId).toBe(105);
    expect(s.book(1)!.bids[0]).toEqual([100, 5]);
    expect(s.onEvent(ev(106, 107, [], [['101', '0']]))).toBe('APPLIED'); // qty 0 removes the level
    expect(s.book(2)!.asks[0]).toEqual([102, 3]);
  });
  it('a snapshot older than the buffered events is rejected (must refetch)', () => {
    const s = new BookSync('BTCUSDT');
    s.onEvent(ev(200, 205));
    expect(s.onSnapshot(snap(150))).toBe('SNAPSHOT_TOO_OLD');
    expect(s.book(1)).toBeNull();
  });
  it('a gap in update ids discards the book and asks for a new snapshot', () => {
    const s = new BookSync('BTCUSDT'); s.onSnapshot(snap(10));
    expect(s.onEvent(ev(9, 12))).toBe('APPLIED');   // first event overlaps the snapshot
    expect(s.onEvent(ev(14, 15))).toBe('SNAPSHOT_NEEDED'); // 13 missing
    expect(s.state).toBe('BUFFERING'); expect(s.book(1)).toBeNull(); expect(s.resyncs).toBe(1);
  });
  it('duplicates are ignored; the first event after a snapshot must overlap it', () => {
    const s = new BookSync('BTCUSDT'); s.onSnapshot(snap(10));
    expect(s.onEvent(ev(12, 13))).toBe('SNAPSHOT_NEEDED'); // starts after L+1 = 11 → gap
    s.onSnapshot(snap(20)); expect(s.onEvent(ev(21, 22))).toBe('APPLIED');
    expect(s.onEvent(ev(21, 22))).toBe('IGNORED'); // replayed message
    expect(s.onEvent(ev(23, 23))).toBe('APPLIED');
  });
  it('malformed or crossed data is never published', () => {
    const s = new BookSync('BTCUSDT'); s.onSnapshot(snap(10));
    expect(s.onEvent(ev(11, 11, [['NaN', '1']]))).toBe('SNAPSHOT_NEEDED');
    s.onSnapshot(snap(20)); s.onEvent(ev(21, 21, [['105', '1']])); // bid above best ask → crossed
    expect(s.book(1)).toBeNull();
    expect(parseDepthEvent({ e: 'depthUpdate', s: 'X', U: 5, u: 4, E: 1, b: [], a: [] })).toBeNull(); // U > u
    expect(parseDepthEvent({ e: 'trade' })).toBeNull();
  });
});

class FakeWS {
  static last: FakeWS | null = null;
  onopen: any; onmessage: any; onclose: any; onerror: any; closed = false;
  constructor(public url: string) { FakeWS.last = this; queueMicrotask(() => this.onopen?.()); }
  send(m: object) { this.onmessage?.({ data: JSON.stringify({ stream: 'btcusdt@depth@100ms', data: m }) }); }
  close() { if (this.closed) return; this.closed = true; this.onclose?.(); }
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('depth stream transport (fake socket)', () => {
  it('snapshots on open, publishes continuous books, resyncs on a gap, and stops cleanly', async () => {
    const published: StreamBook[] = []; let snaps = 0; let L = 10;
    const h = startDepthStream(['BTCUSDT'], { url: () => 'wss://test', snapshot: async () => { snaps++; return snap(L); }, publish: (_s, b) => published.push(b), now: () => 5_000, WebSocketImpl: FakeWS as any });
    await tick(); await tick();
    expect(snaps).toBe(1); expect(published.at(-1)).toMatchObject({ lastUpdateId: 10, ts: 1_000 });
    FakeWS.last!.send({ e: 'depthUpdate', E: 4_990, s: 'BTCUSDT', U: 11, u: 12, b: [['100', '7']], a: [] });
    expect(published.at(-1)).toMatchObject({ lastUpdateId: 12, ts: 5_000 }); expect(published.at(-1)!.bids[0]).toEqual([100, 7]);
    L = 40; FakeWS.last!.send({ e: 'depthUpdate', E: 4_995, s: 'BTCUSDT', U: 30, u: 31, b: [], a: [] }); // gap → resync
    await tick(); await tick();
    expect(snaps).toBe(2); expect(h.status().resyncs).toBe(1);
    h.stop(); expect(FakeWS.last!.closed).toBe(true); expect(h.status().connected).toBe(false);
  });
});

describe('stream retry, lag and stall safety (MA-10, MA-18)', () => {
  const upd = (U: number, u: number, E: number) => ({ e: 'depthUpdate', E, s: 'BTCUSDT', U, u, b: [['100', '1']], a: [] });
  it('a failing snapshot is retried with backoff, not on every event', async () => {
    let calls = 0; let t = 10_000;
    const h = startDepthStream(['BTCUSDT'], { url: () => 'wss://t', snapshot: async () => { calls++; throw new Error('HTTP 429'); }, publish: () => {}, now: () => t, random: () => 0.999, WebSocketImpl: FakeWS as any });
    await tick(); await tick();
    expect(calls).toBe(1);
    for (let i = 0; i < 50; i++) FakeWS.last!.send(upd(i * 2 + 1, i * 2 + 2, t)); // 50 events ~ 5 s of a busy stream
    await tick(); await tick();
    expect(calls).toBe(1); // was 50: a new snapshot per buffered event
    t += 1_100; FakeWS.last!.send(upd(201, 202, t)); await tick(); await tick();
    expect(calls).toBe(2); // after the first backoff (~1 s)
    t += 1_100; FakeWS.last!.send(upd(203, 204, t)); await tick(); await tick();
    expect(calls).toBe(2); // second backoff is ~2 s
    h.stop();
  });
  it('a lagging event is applied (sync kept) but its book is not published', async () => {
    const published: StreamBook[] = []; const t = 50_000;
    const h = startDepthStream(['BTCUSDT'], { url: () => 'wss://t', snapshot: async () => snap(10), publish: (_s, b) => published.push(b), now: () => t, WebSocketImpl: FakeWS as any });
    await tick(); await tick(); const n = published.length;
    FakeWS.last!.send(upd(11, 12, t - 6_000)); // 6 s behind the provider clock
    expect(published.length).toBe(n);
    FakeWS.last!.send(upd(13, 14, t - 100));
    expect(published.at(-1)!.lastUpdateId).toBe(14); // continuity kept across the lagging update
    h.stop();
  });
  it('keeps REST active until a snapshot covers a rejected future update', async () => {
    const published: StreamBook[] = [];
    const invalid: string[] = [];
    const pending: ((value: ReturnType<typeof snap>) => void)[] = [];
    const t = 50_000;
    const h = startDepthStream(['BTCUSDT'], {
      url: () => 'wss://test', snapshot: () => new Promise(resolve => pending.push(resolve)),
      publish: (_symbol, book) => published.push(book), invalidate: symbol => invalid.push(symbol),
      now: () => t, WebSocketImpl: FakeWS as any,
    });
    try {
      await tick();
      FakeWS.last!.send(upd(11, 12, t + 1));
      pending.shift()!(snap(10, t - 100));
      await tick();
      expect(invalid).toEqual(['BTCUSDT']);
      expect(published).toHaveLength(0);
      FakeWS.last!.send(upd(13, 14, t - 10));
      pending.shift()!(snap(12, t - 50));
      await tick();
      expect(published).toEqual([expect.objectContaining({ lastUpdateId: 14, ts: t })]);
    } finally { h.stop(); }
  });
  it('discards a pending snapshot that completes after its socket closed', async () => {
    const published: StreamBook[] = [];
    let resolveSnapshot!: (value: ReturnType<typeof snap>) => void;
    const h = startDepthStream(['BTCUSDT'], {
      url: () => 'wss://test', snapshot: () => new Promise(resolve => { resolveSnapshot = resolve; }),
      publish: (_symbol, book) => published.push(book), now: () => 50_000, WebSocketImpl: FakeWS as any,
    });
    try {
      await tick();
      FakeWS.last!.close();
      resolveSnapshot(snap(10));
      await tick();
      expect(published).toHaveLength(0);
    } finally { h.stop(); }
  });
  it('rejects malformed metadata and does not publish future or stale buffered events', async () => {
    const published: StreamBook[] = [];
    const invalid: string[] = [];
    const t = 50_000;
    let resolveSnapshot!: (value: ReturnType<typeof snap>) => void;
    expect(parseDepthEvent({ ...upd(11, 12, t), E: [t] })).toBeNull();
    expect(parseDepthEvent({ ...upd(11, 12, t), U: false })).toBeNull();
    const h = startDepthStream(['BTCUSDT'], {
      url: () => 'wss://test', snapshot: () => new Promise(resolve => { resolveSnapshot = resolve; }),
      publish: (_symbol, book) => published.push(book), invalidate: symbol => invalid.push(symbol),
      now: () => t, WebSocketImpl: FakeWS as any,
    });
    try {
      await tick();
      FakeWS.last!.send(upd(11, 12, t - 6_000));
      resolveSnapshot(snap(10));
      await tick();
      expect(published).toHaveLength(0);
      FakeWS.last!.send(upd(13, 14, t + 1));
      expect(published).toHaveLength(0);
      expect(invalid).toEqual(['BTCUSDT', 'BTCUSDT']);
    } finally { h.stop(); }
  });
  it('a gap and a disconnect invalidate the published book; a silent socket is closed', async () => {
    const invalid: string[] = []; let t = 70_000;
    const h = startDepthStream(['BTCUSDT'], { url: () => 'wss://t', snapshot: async () => snap(10), publish: () => {}, invalidate: (s) => invalid.push(s), now: () => t, WebSocketImpl: FakeWS as any });
    await tick(); await tick();
    FakeWS.last!.send(upd(30, 31, t)); // gap
    expect(invalid).toEqual(['BTCUSDT']);
    const sock = FakeWS.last!; t += 16_000; h.checkStall();
    expect(sock.closed).toBe(true); expect(invalid.length).toBe(2); expect(h.status().reconnects).toBe(1);
    h.stop();
  });
});

describe('local book stays bounded (MA-19)', () => {
  it('levels far from the top are trimmed; the published top of book is unchanged', () => {
    const s = new BookSync('BTCUSDT', 100); s.onSnapshot(snap(1));
    let u = 1;
    for (let i = 0; i < 5_000; i++) { s.onEvent(ev(u + 1, u + 1, [[String(99 - i * 0.001), '1']], [[String(102 + i * 0.001), '1']])); u++; }
    const lv = s.levels();
    expect(lv.bids).toBeLessThanOrEqual(400); expect(lv.asks).toBeLessThanOrEqual(400); // was 5,002 per side
    const b = s.book(1)!;
    expect(b.bids[0]).toEqual([100, 1]); expect(b.asks[0]).toEqual([101, 1]); // best levels kept
    expect(b.bids).toHaveLength(100);
  });
});

describe('CodeRabbit PR #18 stream findings (SAFE-03)', () => {
  it('a null or empty quantity is malformed (resync), never a level deletion', () => {
    for (const bad of [null, '', ' ']) {
      const s = new BookSync('BTCUSDT'); s.onSnapshot(snap(10));
      expect(s.onEvent(ev(11, 11, [['100', bad as any]]))).toBe('SNAPSHOT_NEEDED');
      expect(s.book(1)).toBeNull();
    }
  });
  it('an update that crosses the book or empties a side forces a resync', () => {
    const s = new BookSync('BTCUSDT'); s.onSnapshot(snap(10));
    expect(s.onEvent(ev(11, 11, [['105', '1']]))).toBe('SNAPSHOT_NEEDED'); // bid 105 above ask 101
    const e = new BookSync('BTCUSDT'); e.onSnapshot(snap(10));
    expect(e.onEvent(ev(11, 11, [], [['101', '0'], ['102', '0']]))).toBe('SNAPSHOT_NEEDED'); // all asks removed
  });
  it('a snapshot that completes after stop() is discarded', async () => {
    let resolve!: (v: any) => void; const published: StreamBook[] = [];
    const h = startDepthStream(['BTCUSDT'], { url: () => 'wss://t', snapshot: () => new Promise((r) => { resolve = r; }), publish: (_s, b) => published.push(b), WebSocketImpl: FakeWS as any });
    await tick(); h.stop();
    resolve(snap(10)); await tick(); await tick();
    expect(published).toHaveLength(0);
  });
});
