/**
 * Omega PR-07: read-only live feed of Pump.fun launches and graduations, straight from Solana.
 *
 * One WebSocket to the configured Solana endpoint with exactly two `logsSubscribe` subscriptions: logs mentioning the
 * Pump.fun mint authority (launches) and the withdraw authority (graduations to PumpSwap). Measured on the public
 * endpoint on 2026-11-19: about 0.3 messages and 3 kB per second, against ~330 messages and 475 kB per second for the
 * whole program, which would be wasteful and risk an IP block. Nothing else is ever sent.
 *
 * Opt-in: MIA_PUMPFUN_FEED=1 and a Solana RPC (MIA_SOLANA_RPC_URL; the WebSocket URL is the same host over wss, or
 * MIA_SOLANA_WS_URL). In memory only (latest 50 of each): a restart starts empty. Never an order, signal or link.
 * Anyone can send cheap transactions that mention these accounts, so the traffic guard can be tripped on purpose; that
 * only pauses the feed for 10 minutes (availability), it never costs unbounded bandwidth.
 */
import { solanaRpcUrl } from '../providers/solanaRpc.js';
import { closeSocketOnce } from '../core/util.js';
import { parsePumpLogs, PUMP_MINT_AUTHORITY, PUMP_WITHDRAW_AUTHORITY, type PumpLaunch, type PumpGraduation } from './pumpfun.js';

export const PUMP_FEED_KEEP = 50;
/** Launches arrive every few seconds; a connected socket silent this long is half-open and is reconnected. */
export const PUMP_FEED_STALL_MS = 120_000;
/** Far above the measured ~0.3/s: sustained traffic like this means the subscription is not narrow. Disconnect. */
export const PUMP_FEED_MAX_MSGS_PER_MIN = 600;
export const PUMP_FEED_TOO_MUCH_TRAFFIC_PAUSE_MS = 10 * 60_000;

export interface PumpFeedStatus {
  enabled: boolean; connected: boolean; lastEventAt: number | null; reconnects: number; lastError: string | null;
  launchesSeen: number; graduationsSeen: number;
}
export interface PumpFeedDeps { WebSocketImpl?: typeof WebSocket; now?: () => number; random?: () => number }

const launches: PumpLaunch[] = [];
const graduations: PumpGraduation[] = [];
const status: PumpFeedStatus = { enabled: false, connected: false, lastEventAt: null, reconnects: 0, lastError: null, launchesSeen: 0, graduationsSeen: 0 };
let stopFn: (() => void) | null = null;
/** Set by stopPumpFeed (the bot stopped): a background pass still in flight must not start the feed again. */
let halted = false;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;

export const pumpFeedEnabled = () => process.env.MIA_PUMPFUN_FEED?.trim() === '1';

/** wss URL for the configured RPC: MIA_SOLANA_WS_URL, else the RPC URL with https → wss. Null when unusable. */
export function pumpFeedUrl(): string | null {
  const explicit = process.env.MIA_SOLANA_WS_URL?.trim();
  let raw: string | null;
  try { raw = explicit || solanaRpcUrl(); } catch { return null; }
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol === 'https:') u.protocol = 'wss:';
    if (u.protocol !== 'wss:' || u.username || u.password || u.hash) return null;
    return u.href;
  } catch { return null; }
}

/** Adds the items not already held (a reconnect can replay recent notifications). Returns how many were new. */
function remember<T extends { signature: string; mint: string }>(list: T[], items: T[]) {
  let added = 0;
  for (const it of items) {
    if (list.some((x) => x.signature === it.signature && x.mint === it.mint)) continue;
    list.unshift(it); added++;
  }
  list.length = Math.min(list.length, PUMP_FEED_KEEP);
  return added;
}

/** Handle one WebSocket message (raw text or already parsed). Exported for tests. Returns the number of events stored. */
export function handlePumpMessage(raw: unknown, subs: Map<number, 'launch' | 'graduation'>, now: number): number {
  let m: any = raw;
  if (typeof raw === 'string') { try { m = JSON.parse(raw); } catch { return 0; } }
  if (m?.method !== 'logsNotification') return 0;
  const kind = subs.get(m.params?.subscription);
  const v = m.params?.result?.value; const slot = m.params?.result?.context?.slot;
  if (!kind || !v || v.err !== null || typeof v.signature !== 'string' || !SIGNATURE.test(v.signature) || !Array.isArray(v.logs) || !Number.isSafeInteger(slot)) return 0;
  const events = parsePumpLogs(v.logs, v.signature, slot);
  const ls = events.filter((e): e is PumpLaunch => e.kind === 'LAUNCH');
  const gs = events.filter((e): e is PumpGraduation => e.kind === 'GRADUATION');
  const stored = kind === 'launch' ? remember(launches, ls) : remember(graduations, gs);
  if (kind === 'launch') status.launchesSeen += stored; else status.graduationsSeen += stored;
  if (stored) status.lastEventAt = now;
  return stored;
}

/** Start (idempotent) or stop the feed to match the settings. Called from the background refresh. */
export function syncPumpFeed(deps: PumpFeedDeps = {}) {
  status.enabled = pumpFeedEnabled();
  if (halted) { closeFeed(); return; }
  const url = status.enabled ? pumpFeedUrl() : null;
  if (status.enabled && !url) status.lastError = 'NO_SOLANA_ENDPOINT';
  if (!url) { closeFeed(); return; }
  if (stopFn) return;
  stopFn = startPumpFeed(url, deps);
}

/** Close the socket now. A later syncPumpFeed may open it again (unlike stopPumpFeed). */
function closeFeed() { stopFn?.(); stopFn = null; status.connected = false; }
/** Stop the feed and keep it stopped until resumePumpFeed() (bot start). */
export function stopPumpFeed() { halted = true; closeFeed(); }
export function resumePumpFeed() { halted = false; }

function startPumpFeed(url: string, deps: PumpFeedDeps) {
  const WS = deps.WebSocketImpl ?? (globalThis as any).WebSocket;
  const now = deps.now ?? Date.now; const rand = deps.random ?? Math.random;
  let ws: WebSocket | null = null; let stopped = false; let attempt = 0; let timer: ReturnType<typeof setTimeout> | null = null;
  let lastMessageAt = 0; let window: number[] = [];
  const subs = new Map<number, 'launch' | 'graduation'>(); const pending = new Map<number, 'launch' | 'graduation'>();
  const scheduleReconnect = (delay: number) => {
    status.reconnects++; timer = setTimeout(connect, delay);
    (timer as unknown as { unref?: () => void }).unref?.(); // never keeps the process alive on its own
  };
  const backoff = () => Math.min(60_000, 1_000 * 2 ** attempt++) * (0.5 + rand() / 2);
  function connect() {
    if (stopped || !WS) { if (!WS) status.lastError = 'NO_WEBSOCKET'; return; }
    subs.clear(); pending.clear(); window = [];
    const sock: WebSocket = new WS(url); ws = sock;
    sock.onopen = () => {
      if (stopped || ws !== sock) return;
      status.connected = true; lastMessageAt = now();
      const req = (id: number, mention: string) => JSON.stringify({ jsonrpc: '2.0', id, method: 'logsSubscribe', params: [{ mentions: [mention] }, { commitment: 'confirmed' }] });
      pending.set(1, 'launch'); pending.set(2, 'graduation');
      sock.send(req(1, PUMP_MINT_AUTHORITY)); sock.send(req(2, PUMP_WITHDRAW_AUTHORITY));
    };
    sock.onmessage = (ev: MessageEvent) => {
      if (stopped || ws !== sock) return;
      const t = now(); lastMessageAt = t;
      window.push(t); while (window.length && window[0] < t - 60_000) window.shift();
      if (window.length > PUMP_FEED_MAX_MSGS_PER_MIN) {
        status.lastError = 'TOO_MUCH_TRAFFIC'; status.connected = false; ws = null;
        closeSocketOnce(sock);
        scheduleReconnect(PUMP_FEED_TOO_MUCH_TRAFFIC_PAUSE_MS);
        return;
      }
      let m: any; try { m = JSON.parse(String(ev.data)); } catch { return; }
      const kind = pending.get(m?.id);
      if (kind) {
        pending.delete(m.id);
        if (Number.isSafeInteger(m.result)) subs.set(m.result, kind); else status.lastError = 'SUBSCRIBE_REJECTED';
        return;
      }
      if (handlePumpMessage(m, subs, t) > 0) { attempt = 0; status.lastError = null; }
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      status.connected = false; ws = null;
      if (stopped) return;
      scheduleReconnect(backoff());
    };
    sock.onerror = () => {
      if (stopped) return; // errors from a socket we are closing on purpose are expected
      if (ws === sock) status.lastError = status.lastError ?? 'SOCKET_ERROR';
      closeSocketOnce(sock); // at most once: closing a connecting socket fires another error event
    };
  }
  const watchdog = setInterval(() => {
    // A half-open socket may never deliver onclose, so do not wait for it: drop it and reconnect now (review fix).
    if (status.connected && ws && now() - lastMessageAt > PUMP_FEED_STALL_MS) {
      const stale = ws; ws = null; status.connected = false; status.lastError = 'STALLED';
      closeSocketOnce(stale);
      scheduleReconnect(backoff());
    }
  }, 10_000);
  (watchdog as unknown as { unref?: () => void }).unref?.();
  connect();
  return () => { stopped = true; clearInterval(watchdog); if (timer) clearTimeout(timer); closeSocketOnce(ws); ws = null; };
}

/** Read-only view for the watchlist card. Copies, so callers cannot change the feed's state. */
export function pumpFeedView(limit = 20) {
  return { ...status, enabled: pumpFeedEnabled(), launches: launches.slice(0, limit).map((x) => ({ ...x })), graduations: graduations.slice(0, limit).map((x) => ({ ...x })) };
}
/** Graduation record for a mint, if seen (used to annotate watchlist rows). */
export const pumpGraduationOf = (mint: string) => graduations.find((g) => g.mint === mint) ?? null;
export const pumpLaunchOf = (mint: string) => launches.find((l) => l.mint === mint) ?? null;

/** Tests only. */
export function _resetPumpFeed() {
  stopPumpFeed(); halted = false; launches.length = 0; graduations.length = 0;
  Object.assign(status, { enabled: false, connected: false, lastEventAt: null, reconnects: 0, lastError: null, launchesSeen: 0, graduationsSeen: 0 });
}
