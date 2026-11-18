import { describe, it, expect } from 'vitest';
import { BookSync, parseDepthEvent, startDepthStream, type DepthEvent, type StreamBook } from '../src/market/depthStream.js';

/** Blueprint milestone 3: sequence-checked streaming books (Binance diff-depth algorithm), fully offline. */
const ev = (U: number, u: number, b: [string, string][] = [], a: [string, string][] = [], s = 'BTCUSDT'): DepthEvent => ({ E: 1_000 + u, s, U, u, b, a });
const snap = (L: number) => ({ lastUpdateId: L, bids: [[100, 1], [99, 2]] as [number, number][], asks: [[101, 1], [102, 3]] as [number, number][] });

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
    expect(snaps).toBe(1); expect(published.at(-1)!.lastUpdateId).toBe(10);
    FakeWS.last!.send({ e: 'depthUpdate', E: 4_990, s: 'BTCUSDT', U: 11, u: 12, b: [['100', '7']], a: [] });
    expect(published.at(-1)).toMatchObject({ lastUpdateId: 12, ts: 5_000 }); expect(published.at(-1)!.bids[0]).toEqual([100, 7]);
    L = 40; FakeWS.last!.send({ e: 'depthUpdate', E: 4_995, s: 'BTCUSDT', U: 30, u: 31, b: [], a: [] }); // gap → resync
    await tick(); await tick();
    expect(snaps).toBe(2); expect(h.status().resyncs).toBe(1);
    h.stop(); expect(FakeWS.last!.closed).toBe(true); expect(h.status().connected).toBe(false);
  });
});
