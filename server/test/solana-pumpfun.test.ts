import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { freshDb } from './helpers.js';
import { market } from '../src/market/store.js';
import { discover } from '../src/market/discover.js';
import { parsePumpLogs, decodeCreate, PUMP_PROGRAM, PUMP_MINT_AUTHORITY, PUMP_WITHDRAW_AUTHORITY, type PumpLaunch, type PumpGraduation } from '../src/solana/pumpfun.js';
import { syncPumpFeed, stopPumpFeed, resumePumpFeed, pumpFeedView, pumpFeedUrl, handlePumpMessage, _resetPumpFeed, PUMP_FEED_MAX_MSGS_PER_MIN } from '../src/solana/pumpFeed.js';

/**
 * Omega PR-07: read-only Pump.fun launch/graduation feed. The decoder is tested on real mainnet transaction logs
 * (fixtures/pumpfun-mainnet-logs.json); the feed uses a fake WebSocket, so nothing touches the network.
 */
const fx = JSON.parse(readFileSync(join(__dirname, 'fixtures', 'pumpfun-mainnet-logs.json'), 'utf8')) as Record<'create' | 'graduation' | 'duplicateMigration', { signature: string; slot: number; logs: string[] }>;
const CREATE_MINT = 'GS6Ab6FQbmv8cthkYXJRsazhy2wXMVzymmiQrcc2pump';
const GRAD_MINT = 'Fch8UPaxDCz1QMR2ZMwcDykk9FNih26LmgyGKveRpump';
/** Well-formed (base58, 87 chars) but not a real transaction: lets a test isolate one check from the signature check. */
const OTHER_SIG = '2'.repeat(87);

class FakeWS {
  static all: FakeWS[] = [];
  sent: string[] = []; closed = false;
  onopen?: () => void; onmessage?: (e: { data: string }) => void; onclose?: () => void; onerror?: () => void;
  constructor(public url: string) { FakeWS.all.push(this); }
  send(s: string) { this.sent.push(s); }
  close() { if (this.closed) return; this.closed = true; this.onclose?.(); }
  open() { this.onopen?.(); }
  msg(o: unknown) { this.onmessage?.({ data: typeof o === 'string' ? o : JSON.stringify(o) }); }
}
const note = (sub: number, tx: { signature: string; slot: number; logs: string[] }, err: unknown = null) =>
  ({ jsonrpc: '2.0', method: 'logsNotification', params: { subscription: sub, result: { context: { slot: tx.slot }, value: { signature: tx.signature, err, logs: tx.logs } } } });

const env = { feed: process.env.MIA_PUMPFUN_FEED, rpc: process.env.MIA_SOLANA_RPC_URL, ws: process.env.MIA_SOLANA_WS_URL };
const restore = (k: string, v: string | undefined) => { if (v === undefined) delete process.env[k]; else process.env[k] = v; };
beforeEach(() => { _resetPumpFeed(); FakeWS.all = []; delete process.env.MIA_SOLANA_WS_URL; process.env.MIA_SOLANA_RPC_URL = 'https://api.mainnet.solana.com'; process.env.MIA_PUMPFUN_FEED = '1'; });
afterEach(() => { _resetPumpFeed(); vi.useRealTimers(); restore('MIA_PUMPFUN_FEED', env.feed); restore('MIA_SOLANA_RPC_URL', env.rpc); restore('MIA_SOLANA_WS_URL', env.ws); });

describe('decoding real mainnet logs with the official IDL layout', () => {
  it('a create_v2 transaction yields exactly one launch with the right accounts', () => {
    const evs = parsePumpLogs(fx.create.logs, fx.create.signature, fx.create.slot);
    expect(evs).toHaveLength(1); // the creator's first buy (TradeEvent) in the same transaction is not a launch
    expect(evs[0]).toMatchObject({ kind: 'LAUNCH', mint: CREATE_MINT, bondingCurve: 'FFwbZjm6EsMmTTy2SBCrf7YCpjqhyU1DKyKAsz4992ru',
      creator: '8sd7SVuBC3fhNHWqhyPrLLscRPhbtYMRq1Co1PaykRki', tokenProgram: 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', symbol: 'GTAMVSW', name: 'GTA MEN VS WOMEN' });
    expect((evs[0] as PumpLaunch).createdAt).toBeGreaterThan(Date.UTC(2026, 10, 18));
  });
  it('a migrate_v2 transaction yields the graduation with its PumpSwap pool; a duplicate migration yields nothing', () => {
    expect(parsePumpLogs(fx.graduation.logs, fx.graduation.signature, fx.graduation.slot)).toEqual([expect.objectContaining({
      kind: 'GRADUATION', mint: GRAD_MINT, pool: '88drjfVSrKQBdgj6cT6CdemKjkQuugZsZw5NiuMMsjpp', bondingCurve: 'EUwajQTcX4oexhPtyEhkSR5CdMBVmvPRYqef7H3JNLhR' })]);
    expect(parsePumpLogs(fx.duplicateMigration.logs, fx.duplicateMigration.signature, fx.duplicateMigration.slot)).toEqual([]);
  });
  it('event bytes printed by another program, or outside any program, are ignored (no forged launches)', () => {
    const dataLine = fx.create.logs.find((l) => l.startsWith('Program data: ') && decodeCreate(Buffer.from(l.slice(14), 'base64'), 's', 1))!;
    const FAKE = 'Fake111111111111111111111111111111111111111';
    expect(parsePumpLogs([`Program ${FAKE} invoke [1]`, dataLine, `Program ${FAKE} success`], 'sig', 1)).toEqual([]);
    expect(parsePumpLogs([dataLine], 'sig', 1)).toEqual([]);
    // A Pump.fun call made from another program (a CPI) is still Pump.fun executing: accepted.
    expect(parsePumpLogs([`Program ${FAKE} invoke [1]`, `Program ${PUMP_PROGRAM} invoke [2]`, dataLine, `Program ${PUMP_PROGRAM} success`, `Program ${FAKE} success`], 'sig', 1)).toHaveLength(1);
  });
  it('truncated data, oversized names and junk never throw and never produce an event', () => {
    const dataLine = fx.create.logs.find((l) => l.startsWith('Program data: ') && decodeCreate(Buffer.from(l.slice(14), 'base64'), 's', 1))!;
    const full = Buffer.from(dataLine.slice(14), 'base64');
    expect(decodeCreate(full.subarray(0, 60), 's', 1)).toBeNull();
    const huge = Buffer.concat([full.subarray(0, 8), Buffer.from([0xff, 0xff, 0x00, 0x00])]); // name length 65535
    expect(decodeCreate(huge, 's', 1)).toBeNull();
    expect(parsePumpLogs([`Program ${PUMP_PROGRAM} invoke [1]`, 'Program data: !!!not base64', 'Program data: ', 42, null], 'sig', 1)).toEqual([]);
  });
  describe('the invoke stack cannot be forged (review fixes)', () => {
    const dataLine = () => fx.create.logs.find((l) => l.startsWith('Program data: ') && decodeCreate(Buffer.from(l.slice(14), 'base64'), 's', 1))!;
    const FAKE = 'Fake111111111111111111111111111111111111111';
    it('text a program prints ("Program log: ...") never opens or closes a frame', () => {
      // Inside a real Pump.fun frame, printed frame-like text must not hide the real event...
      expect(parsePumpLogs([`Program ${PUMP_PROGRAM} invoke [1]`, 'Program log: invoke [2]', dataLine(), 'Program log: success', `Program ${PUMP_PROGRAM} success`], 'sig', 1)).toHaveLength(1);
      // ...and inside another program's frame, a printed "success" must not pop it to expose a Pump.fun frame below.
      expect(parsePumpLogs([`Program ${PUMP_PROGRAM} invoke [1]`, `Program ${FAKE} invoke [2]`, 'Program log: success', dataLine(), `Program ${FAKE} success`, `Program ${PUMP_PROGRAM} success`], 'sig', 1)).toEqual([]);
    });
    it('a frame at the wrong depth rejects the whole transaction', () => {
      expect(parsePumpLogs([`Program ${PUMP_PROGRAM} invoke [2]`, dataLine(), `Program ${PUMP_PROGRAM} success`], 'sig', 1)).toEqual([]);
    });
    it('a frame closed by a different program rejects the whole transaction, including events already decoded', () => {
      expect(parsePumpLogs([`Program ${PUMP_PROGRAM} invoke [1]`, dataLine(), `Program ${FAKE} success`], 'sig', 1)).toEqual([]);
      expect(parsePumpLogs([`Program ${PUMP_PROGRAM} invoke [1]`, dataLine(), `Program ${FAKE} failed: custom program error: 0x1`], 'sig', 1)).toEqual([]);
    });
  });
});

describe('the live feed (fake WebSocket)', () => {
  const start = () => { syncPumpFeed({ WebSocketImpl: FakeWS as unknown as typeof WebSocket, random: () => 0.5 }); return FakeWS.all.at(-1)!; };
  const subscribe = (ws: FakeWS) => { ws.open(); ws.msg({ jsonrpc: '2.0', id: 1, result: 11 }); ws.msg({ jsonrpc: '2.0', id: 2, result: 22 }); };

  it('is off unless MIA_PUMPFUN_FEED=1, and needs a Solana endpoint', () => {
    delete process.env.MIA_PUMPFUN_FEED;
    syncPumpFeed({ WebSocketImpl: FakeWS as unknown as typeof WebSocket });
    expect(FakeWS.all).toHaveLength(0);
    process.env.MIA_PUMPFUN_FEED = '1'; delete process.env.MIA_SOLANA_RPC_URL;
    syncPumpFeed({ WebSocketImpl: FakeWS as unknown as typeof WebSocket });
    expect(FakeWS.all).toHaveLength(0);
    expect(pumpFeedView().lastError).toBe('NO_SOLANA_ENDPOINT');
  });
  it('derives wss from the RPC URL, accepts an explicit wss URL, and refuses anything else', () => {
    expect(pumpFeedUrl()).toBe('wss://api.mainnet.solana.com/');
    process.env.MIA_SOLANA_WS_URL = 'wss://ws.example.com/'; expect(pumpFeedUrl()).toBe('wss://ws.example.com/');
    for (const bad of ['ws://plain.example.com', 'wss://u:p@ws.example.com', 'http://x.example.com', 'nope']) { process.env.MIA_SOLANA_WS_URL = bad; expect(pumpFeedUrl(), bad).toBeNull(); }
  });
  it('sends exactly two narrow logsSubscribe requests and nothing else, ever', () => {
    const ws = start(); subscribe(ws);
    ws.msg(note(11, fx.create)); ws.msg(note(22, fx.graduation));
    expect(ws.sent.map((s) => JSON.parse(s))).toEqual([
      { jsonrpc: '2.0', id: 1, method: 'logsSubscribe', params: [{ mentions: [PUMP_MINT_AUTHORITY] }, { commitment: 'confirmed' }] },
      { jsonrpc: '2.0', id: 2, method: 'logsSubscribe', params: [{ mentions: [PUMP_WITHDRAW_AUTHORITY] }, { commitment: 'confirmed' }] },
    ]);
  });
  it('stores launches and graduations from their own subscriptions; failed, unknown and replayed messages are ignored', () => {
    const ws = start(); subscribe(ws);
    ws.msg(note(11, fx.create)); ws.msg(note(11, fx.create)); // replay after a reconnect: stored once
    ws.msg(note(11, fx.graduation)); // a graduation on the launch subscription is trusted as neither kind
    expect(pumpFeedView().graduations).toEqual([]);
    ws.msg(note(22, fx.graduation));
    ws.msg(note(22, { ...fx.graduation, signature: OTHER_SIG }, { InstructionError: [0, 'x'] })); // failed transaction
    ws.msg(note(99, fx.create)); ws.msg('not json');
    const v = pumpFeedView();
    expect(v.launches.map((l) => l.mint)).toEqual([CREATE_MINT]);
    expect(v.graduations.map((g) => g.mint)).toEqual([GRAD_MINT]);
    expect(v).toMatchObject({ enabled: true, connected: true, launchesSeen: 1, graduationsSeen: 1 });
    v.launches[0].mint = 'tampered'; expect(pumpFeedView().launches[0].mint).toBe(CREATE_MINT); // copies only
  });
  it('disconnects and pauses when traffic is far above a narrow subscription (no runaway bandwidth)', () => {
    vi.useFakeTimers();
    const ws = start(); subscribe(ws);
    for (let i = 0; i <= PUMP_FEED_MAX_MSGS_PER_MIN; i++) ws.msg({ jsonrpc: '2.0', method: 'logsNotification', params: { subscription: 11, result: { context: { slot: 1 }, value: { signature: `s${i}`, err: null, logs: [] } } } });
    expect(ws.closed).toBe(true);
    expect(pumpFeedView()).toMatchObject({ connected: false, lastError: 'TOO_MUCH_TRAFFIC' });
    vi.advanceTimersByTime(9 * 60_000); expect(FakeWS.all).toHaveLength(1);   // still paused
    vi.advanceTimersByTime(2 * 60_000); expect(FakeWS.all).toHaveLength(2);   // reconnects after the pause
  });
  it('reconnects with backoff after a drop, and stop() ends it for good', () => {
    vi.useFakeTimers();
    const ws = start(); subscribe(ws);
    ws.close();
    expect(pumpFeedView()).toMatchObject({ connected: false, reconnects: 1 });
    vi.advanceTimersByTime(1_000); expect(FakeWS.all).toHaveLength(2);
    stopPumpFeed();
    expect(FakeWS.all[1].closed).toBe(true);
    vi.advanceTimersByTime(120_000); expect(FakeWS.all).toHaveLength(2);
  });
  it('handlePumpMessage only accepts logsNotification for a known subscription', () => {
    const subs = new Map<number, 'launch' | 'graduation'>([[11, 'launch']]);
    expect(handlePumpMessage(JSON.stringify({ method: 'somethingElse' }), subs, 1)).toBe(0);
    expect(handlePumpMessage(JSON.stringify(note(11, fx.create)), subs, 1)).toBe(1);
  });
  it('a message whose signature is not a base58 transaction signature is dropped (review fix)', () => {
    const subs = new Map<number, 'launch' | 'graduation'>([[11, 'launch']]);
    for (const signature of ['not a signature!', 'abc', `${fx.create.signature}<b>`, '2'.repeat(89), 42]) {
      expect(handlePumpMessage(note(11, { ...fx.create, signature: signature as string }), subs, 1), String(signature)).toBe(0);
    }
    expect(pumpFeedView().launches).toEqual([]);
    expect(handlePumpMessage(note(11, fx.create), subs, 1)).toBe(1); // the real one (already parsed object) is accepted
  });
  it('after the bot stops, a background pass cannot start the feed again until the bot starts (review fix)', () => {
    stopPumpFeed();
    syncPumpFeed({ WebSocketImpl: FakeWS as unknown as typeof WebSocket });
    expect(FakeWS.all).toHaveLength(0);
    resumePumpFeed();
    syncPumpFeed({ WebSocketImpl: FakeWS as unknown as typeof WebSocket });
    expect(FakeWS.all).toHaveLength(1);
  });
  it('turning the setting off closes the socket; turning it back on reopens it (not a bot stop)', () => {
    const ws = start();
    delete process.env.MIA_PUMPFUN_FEED; start();
    expect(ws.closed).toBe(true);
    process.env.MIA_PUMPFUN_FEED = '1'; start();
    expect(FakeWS.all).toHaveLength(2);
  });
  it('a silent half-open socket (close() never reports back) is dropped and replaced (review fix)', () => {
    vi.useFakeTimers();
    class HalfOpenWS extends FakeWS { close() { this.closed = true; } } // never fires onclose
    syncPumpFeed({ WebSocketImpl: HalfOpenWS as unknown as typeof WebSocket, random: () => 0.5 });
    const ws = FakeWS.all[0]; subscribe(ws);
    vi.advanceTimersByTime(110_000); expect(FakeWS.all).toHaveLength(1);       // quiet, but not yet stalled
    vi.advanceTimersByTime(20_000);
    expect(ws.closed).toBe(true);
    expect(pumpFeedView()).toMatchObject({ connected: false, lastError: 'STALLED', reconnects: 1 });
    vi.advanceTimersByTime(1_000); expect(FakeWS.all).toHaveLength(2);          // replaced without waiting for onclose
  });
});

describe('closing a connecting socket (error-storm regression, found by the live run)', () => {
  class ReentrantErrorWS {
    static all: ReentrantErrorWS[] = [];
    readyState = 0; errorEvents = 0; sent: string[] = [];
    onopen?: () => void; onmessage?: (m: unknown) => void; onclose?: () => void; onerror?: () => void;
    constructor(public url: string) { ReentrantErrorWS.all.push(this); }
    send(s: string) { this.sent.push(s); }
    close() {
      if (this.readyState === 0) { this.errorEvents++; if (this.errorEvents > 100) throw new Error('error storm'); this.onerror?.(); }
      if (this.readyState !== 3) { this.readyState = 3; this.onclose?.(); }
    }
  }
  it('stopping while connecting fires one error, not ~900', () => {
    ReentrantErrorWS.all = [];
    syncPumpFeed({ WebSocketImpl: ReentrantErrorWS as unknown as typeof WebSocket });
    stopPumpFeed();
    expect(ReentrantErrorWS.all[0].errorEvents).toBe(1);
  });
  it('a network error while connecting closes once and schedules one reconnect', () => {
    vi.useFakeTimers();
    ReentrantErrorWS.all = [];
    syncPumpFeed({ WebSocketImpl: ReentrantErrorWS as unknown as typeof WebSocket, random: () => 0 });
    ReentrantErrorWS.all[0].onerror?.();
    expect(ReentrantErrorWS.all[0].errorEvents).toBe(1);
    expect(pumpFeedView()).toMatchObject({ reconnects: 1, lastError: 'SOCKET_ERROR' });
  });
});

describe('watchlist integration', () => {
  it('the watchlist carries the feed view, and a graduated token gets an informational note (status unchanged)', () => {
    freshDb(); market.reset();
    const NOW = Date.now();
    const ws = (syncPumpFeed({ WebSocketImpl: FakeWS as unknown as typeof WebSocket }), FakeWS.all.at(-1)!);
    ws.open(); ws.msg({ jsonrpc: '2.0', id: 2, result: 22 }); ws.msg(note(22, fx.graduation));
    const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
    market.dex = [{ chainId: 'solana', dexId: 'pumpswap', pairAddress: USDC, url: '', baseSymbol: 'GRAD', baseName: 'g', baseAddress: GRAD_MINT, quoteSymbol: 'USDC', quoteAddress: USDC,
      priceUsd: 0.01, liquidityUsd: 100_000, fdv: 100_000, marketCap: 100_000, volume24h: 90_000, volume1h: 30_000, buys24h: 100, sells24h: 50, buys1h: 35, sells1h: 15,
      change1h: 4, change24h: 5, pairCreatedAt: NOW - 60_000, hasSocials: false, hasWebsite: false }];
    market.dexFetchedAt = NOW - 30_000;
    const s = discover(1e6, NOW).solanaHunter;
    expect(s.pumpfun).toMatchObject({ enabled: true, graduationsSeen: 1 });
    const row = s.candidates.find((c) => c.mint === GRAD_MINT)!;
    expect(row.notes).toContain('Graduated from Pump.fun to PumpSwap (pool 88drjfVSrKQBdgj6cT6CdemKjkQuugZsZw5NiuMMsjpp)');
    expect(row.status).toBe('WATCH');
    expect(row.tradingEligible).toBe(false);
  });
});

// Type-level guard: graduations and launches are separate shapes.
const _typecheck: PumpGraduation['kind'] = 'GRADUATION'; void _typecheck;
