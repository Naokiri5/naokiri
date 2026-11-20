import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { config } from '../src/config.js';
import { market } from '../src/market/store.js';
import { syncDepthStreams, stopDepthStreams, streamFresh, refreshBooks } from '../src/market/fabric.js';
import { seedInstrument } from './helpers.js';

/** Blueprint M3 integration: stream books feed market.deep through setBook; REST skips symbols the stream keeps fresh. */
class FakeWS {
  static last: FakeWS | null = null;
  onopen: any; onmessage: any; onclose: any; onerror: any; closed = false;
  constructor(public url: string) { FakeWS.last = this; queueMicrotask(() => this.onopen?.()); }
  send(m: object) { this.onmessage?.({ data: JSON.stringify({ data: m }) }); }
  close() { if (this.closed) return; this.closed = true; this.onclose?.(); }
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const flags = { streaming: config.streaming, offline: config.offline };
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(Date.UTC(2026, 10, 19)); });
afterEach(() => { stopDepthStreams(); Object.assign(config, flags); FakeWS.last = null; vi.restoreAllMocks(); });

describe('streaming books wired into the market fabric', () => {
  it('is a no-op unless MIA_STREAMING is on (and never runs offline)', () => {
    seedInstrument('STRMUSDT');
    Object.assign(config, { streaming: false, offline: false });
    expect(syncDepthStreams(['crypto:binance:STRMUSDT'], { WebSocketImpl: FakeWS as any })).toBeNull();
    Object.assign(config, { streaming: true, offline: true });
    expect(syncDepthStreams(['crypto:binance:STRMUSDT'], { WebSocketImpl: FakeWS as any })).toBeNull();
    expect(FakeWS.last).toBeNull();
  });

  it('publishes synchronized books into market.deep, marks them fresh, and REST then skips that symbol', async () => {
    const { inst, last } = seedInstrument('STRM2USDT');
    Object.assign(config, { streaming: true, offline: false });
    let snaps = 0;
    const snapshot = async () => { snaps++; return { lastUpdateId: 50, ts: Date.now(), bids: [[last * 0.999, 3]] as [number, number][], asks: [[last * 1.001, 4]] as [number, number][] }; };
    const h = syncDepthStreams([inst.id, inst.id], { WebSocketImpl: FakeWS as any, snapshot })!;
    expect(h).not.toBeNull();
    expect(FakeWS.last!.url).toContain('strm2usdt@depth@100ms');
    await tick(); await tick();
    expect(snaps).toBe(1);
    const book = market.deep.get(inst.id)!.book!;
    expect(book.lastUpdateId).toBe(50); expect(book.asks[0][1]).toBe(4);
    expect(streamFresh(inst.id)).toBe(true);

    FakeWS.last!.send({ e: 'depthUpdate', E: Date.now(), s: 'STRM2USDT', U: 51, u: 52, b: [[String(last * 0.999), '9']], a: [] });
    expect(market.deep.get(inst.id)!.book!).toMatchObject({ lastUpdateId: 52 });
    expect(market.deep.get(inst.id)!.book!.bids[0][1]).toBe(9);

    // Same symbol set: the existing connection is kept, not restarted.
    expect(syncDepthStreams([inst.id], { WebSocketImpl: FakeWS as any, snapshot })).toBe(h);
    // A fresh stream book means REST is not even asked: stub fetch so no outbound request can happen, and assert none did.
    const realFetch = globalThis.fetch; let restCalls = 0;
    globalThis.fetch = (async () => { restCalls++; throw new Error('network disabled in test'); }) as typeof fetch;
    try {
      expect(streamFresh(inst.id)).toBe(true);
      await refreshBooks([inst.id]);
    } finally { globalThis.fetch = realFetch; }
    expect(restCalls).toBe(0);
    expect(market.deep.get(inst.id)!.book!.lastUpdateId).toBe(52);

    stopDepthStreams();
    expect(FakeWS.last!.closed).toBe(true);
    expect(streamFresh(inst.id)).toBe(false); // REST takes over again after stop
  });

  it('a stream book with an older update id than the current book is refused', async () => {
    const { inst, last } = seedInstrument('STRM3USDT');
    market.deep.get(inst.id)!.book = { bids: [[last * 0.99, 1]], asks: [[last * 1.01, 1]], ts: Date.now(), lastUpdateId: 1_000 };
    Object.assign(config, { streaming: true, offline: false });
    syncDepthStreams([inst.id], { WebSocketImpl: FakeWS as any, snapshot: async () => ({ lastUpdateId: 10, ts: Date.now(), bids: [[last * 0.999, 3]], asks: [[last * 1.001, 4]] }) });
    await tick(); await tick();
    expect(market.deep.get(inst.id)!.book!.lastUpdateId).toBe(1_000);
  });
  it('keeps REST eligible when a snapshot-only book already exceeds its freshness window', async () => {
    const { inst, last } = seedInstrument('STRM6USDT');
    market.deep.get(inst.id)!.book = null;
    Object.assign(config, { streaming: true, offline: false });
    const ts = Date.now() - 3_000;
    syncDepthStreams([inst.id], { WebSocketImpl: FakeWS as any, snapshot: async () => ({
      lastUpdateId: 50, ts, bids: [[last * 0.999, 3]], asks: [[last * 1.001, 4]],
    }) });
    await tick(); await tick();
    expect(market.deep.get(inst.id)!.book).toMatchObject({ lastUpdateId: 50, ts });
    expect(streamFresh(inst.id)).toBe(false);
  });
  it('a sequence gap hands the symbol back to REST immediately (MA-18)', async () => {
    const { inst, last } = seedInstrument('STRM4USDT');
    Object.assign(config, { streaming: true, offline: false });
    let snapshotId = 50;
    syncDepthStreams([inst.id], { WebSocketImpl: FakeWS as any, snapshot: async () => ({ lastUpdateId: snapshotId, ts: Date.now(), bids: [[last * 0.999, 3]], asks: [[last * 1.001, 4]] }) });
    await tick(); await tick();
    expect(streamFresh(inst.id)).toBe(true);
    snapshotId = 51;
    FakeWS.last!.send({ e: 'depthUpdate', E: Date.now(), s: 'STRM4USDT', U: 60, u: 61, b: [], a: [] }); // gap: 51..59 missing
    expect(streamFresh(inst.id)).toBe(false);
    await tick(); await tick();
    expect(streamFresh(inst.id)).toBe(false);
    expect(market.deep.get(inst.id)!.book!.lastUpdateId).toBe(50);
  });
  it('a stream book that setBook rejects (older id) does not mark the symbol fresh (SAFE-03)', async () => {
    const { inst, last } = seedInstrument('STRM5USDT');
    market.deep.get(inst.id)!.book = { bids: [[last * 0.99, 1]], asks: [[last * 1.01, 1]], ts: Date.now(), lastUpdateId: 1_000 };
    Object.assign(config, { streaming: true, offline: false });
    syncDepthStreams([inst.id], { WebSocketImpl: FakeWS as any, snapshot: async () => ({ lastUpdateId: 10, ts: Date.now(), bids: [[last * 0.999, 3]], asks: [[last * 1.001, 4]] }) });
    await tick(); await tick();
    expect(market.deep.get(inst.id)!.book!.lastUpdateId).toBe(1_000);
    expect(streamFresh(inst.id)).toBe(false); // REST keeps refreshing this symbol
  });
});
