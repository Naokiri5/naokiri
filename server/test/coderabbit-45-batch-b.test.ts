import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { freshDb } from './helpers.js';
import { run } from '../src/db/db.js';
import { config } from '../src/config.js';
import { BookSync, type DepthEvent } from '../src/market/depthStream.js';
import { expandSnapshot } from '../src/ditas/memory.js';
import { fetchProvider, providerBlockedUntil, setRateLimit, _resetProviderBlocks } from '../src/providers/http.js';
import '../src/providers/binance.js'; // registers the 'binance' provider used below
import { scenarioTable } from '../src/decision/profitLab.js';
import { normaliseKalshiBook } from '../src/prediction/venues.js';
import { endStream } from '../src/api/sse.js';

/** CodeRabbit review of #45, batch B: trading and data-integrity findings, each reproduced before its fix. */
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

describe('depth stream: a discarded gap event is not forgotten', () => {
  const ev = (U: number, u: number): DepthEvent => ({ E: 1_700_000_000_000 + u, s: 'BTCUSDT', U, u, b: [['100', '1']], a: [['101', '1']] });
  const snap = (L: number) => ({ lastUpdateId: L, bids: [[100, 1]] as [number, number][], asks: [[101, 1]] as [number, number][] });
  it('after a gap at update 103, a lagging snapshot at 101 is refused; one through 103 syncs', () => {
    const b = new BookSync('BTCUSDT');
    expect(b.onSnapshot(snap(100))).toBe('SYNCED');
    expect(b.onEvent(ev(101, 101))).toBe('APPLIED');
    expect(b.onEvent(ev(103, 103))).toBe('SNAPSHOT_NEEDED'); // 102 is missing
    expect(b.onSnapshot(snap(101))).toBe('SNAPSHOT_TOO_OLD'); // was SYNCED: published over the known-missing 103
    expect(b.book(Date.now())).toBeNull();
    expect(b.onSnapshot(snap(103))).toBe('SYNCED');
    expect(b.book(Date.now())).not.toBeNull();
  });
});

describe('DITAS: frozen evidence must still match its hash', () => {
  beforeEach(() => freshDb());
  it('a stored blob whose payload does not hash to its key is refused, not returned as evidence', () => {
    const good = JSON.stringify({ bids: [[100, 5]] }); const goodHash = sha(good);
    run('INSERT INTO ditas_blobs(hash,kind,created_at,payload) VALUES (?,?,?,?)', goodHash, 'book', 1, good);
    const ok = expandSnapshot({ schemaVersion: 'ditas.snapshot.v2', candles: {}, book: { $blob: goodHash } });
    expect(ok.book).toEqual({ bids: [[100, 5]] });
    const forgedKey = sha(JSON.stringify({ bids: [[100, 9999]] }));
    run('INSERT INTO ditas_blobs(hash,kind,created_at,payload) VALUES (?,?,?,?)', forgedKey, 'book', 1, JSON.stringify({ bids: [[1, 1]] }));
    expect(() => expandSnapshot({ schemaVersion: 'ditas.snapshot.v2', candles: {}, book: { $blob: forgedKey } })).toThrow(/does not match its hash/);
    expect(expandSnapshot({ schemaVersion: 'ditas.snapshot.v1', book: { inline: true } })).toEqual({ schemaVersion: 'ditas.snapshot.v1', book: { inline: true } }); // v1 unchanged
  });
});

describe('provider backoff', () => {
  const realFetch = globalThis.fetch; const flags = { offline: config.offline };
  beforeEach(() => { _resetProviderBlocks(); Object.assign(config, { offline: false }); });
  afterEach(() => { globalThis.fetch = realFetch; Object.assign(config, flags); _resetProviderBlocks(); vi.useRealTimers(); setRateLimit('binance', 1200); });
  const r429 = (seconds: number) => new Response('{}', { status: 429, headers: { 'retry-after': String(seconds) } });
  it('a shorter Retry-After from a concurrent response never shortens an active block', async () => {
    const pending: Array<(r: Response) => void> = [];
    globalThis.fetch = (() => new Promise<Response>((res) => pending.push(res))) as typeof fetch;
    const a = fetchProvider('binance', 'https://api.binance.com/a').catch(() => null);
    const b = fetchProvider('binance', 'https://api.binance.com/b').catch(() => null);
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    pending[0](r429(120)); await a;
    pending[1](r429(1)); await b;
    expect(providerBlockedUntil('binance')).toBeGreaterThan(Date.now() + 100_000); // was ~1 s: the 120 s block was cut short
  });
  it('a request that waited for a rate-limit token re-checks a block set meanwhile and does not send', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date', 'performance'] });
    setRateLimit('binance', 1); // one request a minute: the second call waits for a token
    let sent = 0; let release!: (r: Response) => void;
    globalThis.fetch = (() => { sent++; return sent > 1 ? Promise.resolve(new Response('{}')) : new Promise<Response>((res) => { release = res; }); }) as typeof fetch;
    const a = fetchProvider('binance', 'https://api.binance.com/a').catch(() => null);
    const b = fetchProvider('binance', 'https://api.binance.com/b').catch((e) => e);
    await vi.waitFor(() => expect(sent).toBe(1));
    release(r429(120)); await a;                   // the first call gets 429 while the second waits for its token
    await vi.advanceTimersByTimeAsync(61_000);    // the token arrives; the 120 s block is still active
    const err = await b;
    expect(err?.status).toBe(429);
    expect(sent).toBe(1);                          // was 2: the waiting call sent during the provider's backoff
  });
});

describe('profit lab: worst case is chosen before rounding', () => {
  it('with tiny per-unit values the liquidity-pull loss, not the target gain, is the worst stress', () => {
    const r = scenarioTable({ entry: 0.00001, stop: 0.000009, targets: [{ price: 0.000012, fraction: 1 }], qty: 10_000_000, feeRate: 0, spreadBps: 0, slippageBps: 0 } as any);
    expect(r.valid).toBe(true);
    expect(r.worstStressUsd).toBe(30); // was -20: every per-unit value rounded to 0 and the first scenario (the target) won
  });
});

describe('Kalshi book: the best levels survive parsing', () => {
  it('a YES book with 51 ascending levels keeps its best bid (0.51), and the mirrored NO side keeps its best ask', () => {
    const yes = Array.from({ length: 51 }, (_, i) => [((i + 1) / 100).toFixed(2), '10']);
    const no = Array.from({ length: 60 }, (_, i) => [((i + 1) / 100).toFixed(2), '10']); // best NO bid 0.60 -> YES ask 0.40
    const book = normaliseKalshiBook({ orderbook_fp: { yes_dollars: yes, no_dollars: no } });
    expect(book.bids[0].price).toBe(0.51); // was 0.50: the 50-entry metadata bound dropped the last (best) level
    expect(book.asks[0].price).toBe(0.4);  // was 0.50
  });
});

describe('live stream shutdown is bounded', () => {
  afterEach(() => vi.useRealTimers());
  const fakeRes = (finishes: boolean) => {
    const r = { ended: false, destroyed: false, writableFinished: false, onFinish: null as null | (() => void),
      end() { this.ended = true; if (finishes) { this.writableFinished = true; } },
      destroy() { this.destroyed = true; },
      once(_e: 'finish', f: () => void) { this.onFinish = f; } };
    return r;
  };
  it('a client that stopped reading is cut off after the flush window; a draining client ends normally', () => {
    vi.useFakeTimers();
    const stalled = fakeRes(false); endStream(stalled, 2_000);
    expect(stalled.ended).toBe(true); expect(stalled.destroyed).toBe(false);
    vi.advanceTimersByTime(2_001);
    expect(stalled.destroyed).toBe(true); // was: waited for the drain until the 30 s hard exit
    const healthy = fakeRes(true); endStream(healthy, 2_000);
    vi.advanceTimersByTime(5_000);
    expect(healthy.destroyed).toBe(false);
  });
});
