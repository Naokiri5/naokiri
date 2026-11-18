/**
 * Streaming order books (blueprint milestone 3). Binance diff-depth WebSocket + REST snapshot, synchronized exactly as
 * Binance documents it, so a local book is only ever published when it is provably continuous:
 *
 *   1. open the stream and BUFFER events;          2. fetch a REST snapshot (lastUpdateId = L);
 *   3. drop buffered events with u <= L;            4. the first applied event must satisfy U <= L+1 <= u;
 *   5. every later event must have U === previous u + 1 — anything else is a GAP: discard the book and resync;
 *   6. quantity 0 removes a level; malformed, crossed or non-finite data is rejected and forces a resync.
 *
 * Paper-only market data: this never places orders. Stream books feed the same `market.deep.book` the REST path does,
 * stamped with LOCAL receive time, so every freshness/depth check (risk gate, OMS, quality) applies unchanged. REST
 * polling stays the fallback: a symbol whose stream book is not fresh is refreshed by REST as before.
 * Off by default; enable with MIA_STREAMING=1.
 */
import { record } from '../core/latency.js';

export interface DepthEvent { E: number; s: string; U: number; u: number; b: [string, string][]; a: [string, string][] }
export interface Snapshot { lastUpdateId: number; bids: [number, number][]; asks: [number, number][] }
export interface StreamBook { bids: [number, number][]; asks: [number, number][]; ts: number; lastUpdateId: number }
export type SyncState = 'BUFFERING' | 'SYNCED';

const MAX_BUFFER = 2_000;
/** Snapshot retry policy (MA-10): per-symbol exponential backoff with jitter, and a cap on concurrent snapshot requests. */
export const SNAPSHOT_BACKOFF_MIN_MS = 1_000, SNAPSHOT_BACKOFF_MAX_MS = 60_000, MAX_CONCURRENT_SNAPSHOTS = 5;
/** A book whose provider event is older than this when it arrives is not published (MA-18: lag is checked, not just recorded). */
export const MAX_EVENT_LAG_MS = 5_000;
/** No message for this long on an open socket = half-open connection: close it and reconnect (MA-18). */
export const STALL_MS = 15_000;
const parseLevel = (l: unknown): [number, number] | null => {
  if (!Array.isArray(l) || l.length < 2) return null;
  const p = Number(l[0]), q = Number(l[1]);
  return Number.isFinite(p) && p > 0 && Number.isFinite(q) && q >= 0 ? [p, q] : null;
};
export function parseDepthEvent(raw: unknown): DepthEvent | null {
  const r = raw as any;
  if (!r || r.e !== 'depthUpdate' || typeof r.s !== 'string') return null;
  const U = Number(r.U), u = Number(r.u), E = Number(r.E);
  if (![U, u, E].every(Number.isSafeInteger) || U > u || !Array.isArray(r.b) || !Array.isArray(r.a)) return null;
  return { E, s: r.s, U, u, b: r.b, a: r.a };
}

/** Pure, deterministic book synchronizer for one symbol (no I/O; unit-tested offline). */
export class BookSync {
  state: SyncState = 'BUFFERING';
  lastUpdateId = 0;
  resyncs = 0;
  private buffer: DepthEvent[] = [];
  /** True until the first event after a snapshot: that one only has to OVERLAP the snapshot (U <= L+1 <= u). */
  private first = false;
  private bids = new Map<number, number>();
  private asks = new Map<number, number>();
  constructor(readonly symbol: string, private readonly depth = 100) {}

  /** Returns 'SNAPSHOT_NEEDED' when the caller must (re)fetch a REST snapshot. */
  onEvent(ev: DepthEvent): 'BUFFERED' | 'APPLIED' | 'IGNORED' | 'SNAPSHOT_NEEDED' {
    if (ev.s !== this.symbol) return 'IGNORED';
    if (this.state === 'BUFFERING') {
      this.buffer.push(ev); if (this.buffer.length > MAX_BUFFER) this.buffer.shift();
      return 'BUFFERED';
    }
    if (ev.u <= this.lastUpdateId) return 'IGNORED'; // duplicate / already applied
    if (!this.continues(ev)) return this.gap();
    return this.apply(ev) ? 'APPLIED' : this.gap();
  }
  /** Feed the REST snapshot while buffering. Returns false when the snapshot is too old for the buffered events. */
  onSnapshot(s: Snapshot): 'SYNCED' | 'SNAPSHOT_TOO_OLD' | 'WAITING' {
    const L = s.lastUpdateId;
    const pending = this.buffer.filter((e) => e.u > L);
    if (!pending.length) {
      // Nothing newer buffered yet: start from the snapshot; the next event only has to overlap it.
      this.load(s); this.state = 'SYNCED'; this.buffer = []; return 'SYNCED';
    }
    if (pending[0].U > L + 1) return 'SNAPSHOT_TOO_OLD'; // events are missing between the snapshot and the buffer
    this.load(s); this.state = 'SYNCED'; this.buffer = [];
    for (const ev of pending) {
      if (ev.u <= this.lastUpdateId) continue;
      if (!this.continues(ev) || !this.apply(ev)) { this.gap(); return 'WAITING'; }
    }
    return 'SYNCED';
  }
  book(ts: number): StreamBook | null {
    if (this.state !== 'SYNCED') return null;
    const bids = [...this.bids].sort((x, y) => y[0] - x[0]).slice(0, this.depth);
    const asks = [...this.asks].sort((x, y) => x[0] - y[0]).slice(0, this.depth);
    if (!bids.length || !asks.length || bids[0][0] >= asks[0][0]) return null; // empty or crossed: never publish
    return { bids, asks, ts, lastUpdateId: this.lastUpdateId };
  }
  private continues(ev: DepthEvent) {
    return this.first ? ev.U <= this.lastUpdateId + 1 && ev.u >= this.lastUpdateId + 1 : ev.U === this.lastUpdateId + 1;
  }
  private load(s: Snapshot) {
    this.bids = new Map(s.bids.filter(([p, q]) => p > 0 && q > 0)); this.asks = new Map(s.asks.filter(([p, q]) => p > 0 && q > 0));
    this.lastUpdateId = s.lastUpdateId; this.first = true;
  }
  private apply(ev: DepthEvent): boolean {
    const b = ev.b.map(parseLevel), a = ev.a.map(parseLevel);
    if (b.some((x) => !x) || a.some((x) => !x)) return false;
    for (const [p, q] of b as [number, number][]) q === 0 ? this.bids.delete(p) : this.bids.set(p, q);
    for (const [p, q] of a as [number, number][]) q === 0 ? this.asks.delete(p) : this.asks.set(p, q);
    this.lastUpdateId = ev.u; this.first = false;
    return true;
  }
  private gap(): 'SNAPSHOT_NEEDED' {
    this.state = 'BUFFERING'; this.buffer = []; this.bids.clear(); this.asks.clear(); this.resyncs++;
    return 'SNAPSHOT_NEEDED';
  }
}

// ── transport ─────────────────────────────────────────────────────────────────────────────────────────────────────
export interface StreamDeps {
  url: (symbols: string[]) => string;
  snapshot: (symbol: string) => Promise<Snapshot>;
  publish: (symbol: string, book: StreamBook) => void;
  /** Called when a symbol's published book can no longer be extended (gap, disconnect): REST should take over now. */
  invalidate?: (symbol: string) => void;
  now?: () => number;
  /** Test seam: random in [0,1) for jitter. */
  random?: () => number;
  WebSocketImpl?: typeof WebSocket;
}
export const binanceStreamUrl = (symbols: string[]) =>
  `wss://data-stream.binance.vision/stream?streams=${symbols.map((s) => `${s.toLowerCase()}@depth@100ms`).join('/')}`;

export interface StreamStatus { connected: boolean; symbols: string[]; lastMessageAt: number; reconnects: number; resyncs: number; synced: number }
/**
 * One combined connection for a set of symbols. Reconnects with exponential backoff + jitter (1 s … 60 s); every
 * (re)connect starts every symbol from BUFFERING and a fresh snapshot, so no book survives a disconnect.
 */
export function startDepthStream(symbols: string[], deps: StreamDeps) {
  const now = deps.now ?? Date.now; const rand = deps.random ?? Math.random; const WS = deps.WebSocketImpl ?? (globalThis as any).WebSocket;
  const syncs = new Map(symbols.map((s) => [s, new BookSync(s)]));
  const status: StreamStatus = { connected: false, symbols, lastMessageAt: 0, reconnects: 0, resyncs: 0, synced: 0 };
  let ws: WebSocket | null = null; let stopped = false; let attempt = 0; let timer: ReturnType<typeof setTimeout> | null = null;
  const inFlight = new Set<string>();
  const failures = new Map<string, number>(); const nextSnapshotAt = new Map<string, number>();
  const invalidate = (sym: string) => { try { deps.invalidate?.(sym); } catch { /* the REST fallback still ages the book out */ } };
  const backoff = (sym: string) => {
    const n = (failures.get(sym) ?? 0) + 1; failures.set(sym, n);
    nextSnapshotAt.set(sym, now() + Math.min(SNAPSHOT_BACKOFF_MAX_MS, SNAPSHOT_BACKOFF_MIN_MS * 2 ** (n - 1)) * (0.5 + rand() / 2));
  };

  const snapshot = async (sym: string) => {
    if (inFlight.has(sym) || stopped || inFlight.size >= MAX_CONCURRENT_SNAPSHOTS || now() < (nextSnapshotAt.get(sym) ?? 0)) return;
    inFlight.add(sym);
    try {
      for (let tries = 0; tries < 3 && !stopped; tries++) {
        const r = syncs.get(sym)!.onSnapshot(await deps.snapshot(sym));
        if (r === 'SYNCED') { failures.delete(sym); nextSnapshotAt.delete(sym); const b = syncs.get(sym)!.book(now()); if (b) deps.publish(sym, b); return; }
        if (r === 'WAITING') return; // a gap was found while replaying; the next event triggers a new snapshot
      }
      backoff(sym); // still too old after 3 tries
    } catch { backoff(sym); /* snapshot failed: REST polling remains the fallback; retry after the backoff */ }
    finally { inFlight.delete(sym); }
  };
  const connect = () => {
    if (stopped || !WS) return;
    for (const s of syncs.values()) s.state = 'BUFFERING';
    const sock: WebSocket = new WS(deps.url(symbols)); ws = sock;
    sock.onopen = () => { status.connected = true; status.lastMessageAt = now(); for (const s of symbols) void snapshot(s); };
    sock.onmessage = (m: MessageEvent) => {
      const received = now(); status.lastMessageAt = received;
      let msg: any; try { msg = JSON.parse(String(m.data)); } catch { return; }
      const ev = parseDepthEvent(msg?.data ?? msg); if (!ev) return;
      attempt = 0; // reconnect backoff resets only after a VALID event, not on open (a server that accepts then closes must not cause a storm)
      const lag = Math.max(0, received - ev.E);
      record('stream.binance.eventLagMs', lag); // provider event time → local receipt
      const sync = syncs.get(ev.s); if (!sync) return;
      const r = sync.onEvent(ev);
      if (r === 'SNAPSHOT_NEEDED') { status.resyncs++; invalidate(ev.s); void snapshot(ev.s); }
      else if (r === 'APPLIED') { if (lag <= MAX_EVENT_LAG_MS) { const b = sync.book(received); if (b) deps.publish(ev.s, b); } }
      else if (r === 'BUFFERED' && sync.state === 'BUFFERING') void snapshot(ev.s);
    };
    sock.onclose = () => {
      status.connected = false; ws = null; for (const s of symbols) invalidate(s);
      if (stopped) return;
      status.reconnects++; const delay = Math.min(60_000, 1_000 * 2 ** attempt++) * (0.5 + rand() / 2);
      timer = setTimeout(connect, delay);
    };
    sock.onerror = () => { try { sock.close(); } catch { /* close triggers reconnect */ } };
  };
  // Half-open socket watchdog: no message for STALL_MS on a connected socket → close (onclose reconnects with backoff).
  const watchdog = setInterval(() => { if (status.connected && now() - status.lastMessageAt > STALL_MS) { try { ws?.close(); } catch { /* reconnect follows */ } } }, Math.min(STALL_MS, 5_000));
  (watchdog as any).unref?.();
  connect();
  return {
    status: () => ({ ...status, synced: [...syncs.values()].filter((s) => s.state === 'SYNCED').length }),
    /** Test seam: run the stall check now. */
    checkStall: () => { if (status.connected && now() - status.lastMessageAt > STALL_MS) { try { ws?.close(); } catch { /* reconnect follows */ } } },
    stop: () => { stopped = true; clearInterval(watchdog); if (timer) clearTimeout(timer); try { ws?.close(); } catch { /* already closed */ } },
  };
}
