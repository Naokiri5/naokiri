import { useCallback, useEffect, useLayoutEffect, useRef, useState, type SetStateAction } from 'react';

export class ApiError extends Error { constructor(public status: number, msg: string) { super(msg); } }
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const res = await fetch(path, { method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', 'x-mia-csrf': '1' }, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin', signal: opts.signal });
  const data = await res.json().catch(() => ({}));
  // An obsolete request must not invalidate a newer authenticated resource.
  if (opts.signal?.aborted) throw new DOMException('Request aborted', 'AbortError');
  if (res.status === 401) window.dispatchEvent(new Event('mia:unauthorized'));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`);
  return data as T;
}
/** Raw file upload (Academy documents). Same auth/CSRF/error contract as `api`; bytes are sent unmodified. */
export async function uploadFile<T = any>(path: string, file: File): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'x-mia-csrf': '1', 'x-filename': encodeURIComponent(file.name) }, body: file, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) window.dispatchEvent(new Event('mia:unauthorized'));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `HTTP ${res.status}`);
  return data as T;
}

/** Live event stream (SSE). Components subscribe to topics to trigger refetches. */
type Handler = (topic: string, payload: any) => void;
const handlers = new Set<Handler>(); let es: EventSource | null = null;
export const streamState = { connected: false, lastEventAt: 0 };
const TOPICS = ['ticker', 'candle', 'scan', 'consensus', 'decision', 'order', 'position', 'risk', 'alert', 'news', 'whale', 'bot', 'health', 'mode', 'notification', 'knowledge'];
export function connectStream() {
  if (es) return; es = new EventSource('/api/stream');
  es.onopen = () => { streamState.connected = true; };
  es.onerror = () => { streamState.connected = false; };
  for (const t of TOPICS) es.addEventListener(t, (ev) => { streamState.lastEventAt = Date.now(); let p: any = null; try { p = JSON.parse((ev as MessageEvent).data); } catch { /* */ } handlers.forEach((h) => h(t, p)); });
}
export function disconnectStream() { es?.close(); es = null; streamState.connected = false; }
export function useStream(fn: Handler) { const ref = useRef(fn); ref.current = fn; useEffect(() => { const h: Handler = (t, p) => ref.current(t, p); handlers.add(h); return () => { handlers.delete(h); }; }, []); }

/** Fetch + auto-refresh. Data belongs to a resource path; only the newest request may publish it. */
export function useApi<T = any>(path: string | null, opts: { topics?: string[]; every?: number } = {}) {
  const [state, setState] = useState<{ path: string | null; data: T | null; error: string | null; loading: boolean; requestedAt: number | null; updatedAt: number | null }>({ path, data: null, error: null, loading: false, requestedAt: null, updatedAt: null });
  // Updated after commit, not during render (CodeRabbit PR #18): React may discard an uncommitted render, which must not
  // leave the ref pointing at a path the committed component never adopted. Layout effects run before the passive effect
  // that loads, so a path change is visible to load() in the same commit.
  const currentPath = useRef(path);
  useLayoutEffect(() => { currentPath.current = path; }, [path]);
  const mounted = useRef(false); const requestId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<number | null>(null);
  const inFlight = useRef(false); const again = useRef(false);
  /** Forced load: supersedes (aborts) anything in flight. Used on mount, path change and reload() after a mutation, so a
   *  response requested before the mutation is never shown. */
  const load = useCallback(async () => {
    if (path === null || !mounted.current || currentPath.current !== path) return;
    const id = ++requestId.current; const sent = performance.now(); inFlight.current = true;
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    const ownsRequest = () => mounted.current && currentPath.current === path && requestId.current === id && !request.signal.aborted;
    setState(previous => previous.path === path ? { ...previous, loading: true } : { path, data: null, error: null, loading: true, requestedAt: null, updatedAt: null });
    try {
      const data = await api<T>(path, { signal: request.signal });
      if (ownsRequest()) setState({ path, data, error: null, loading: false, requestedAt: sent, updatedAt: Date.now() });
    } catch (error) {
      if (ownsRequest()) setState(previous => ({ ...previous, error: error instanceof Error ? error.message : 'Request failed', loading: false }));
    } finally {
      if (requestId.current === id) {
        inFlight.current = false;
        if (again.current && mounted.current && currentPath.current === path) { again.current = false; void load(); } // queued refresh
      }
    }
  }, [path]);
  /** Scheduled refresh (interval tick, stream topic): never supersedes a request in flight, it queues one follow-up.
   *  Aborting on every tick meant a slow endpoint (latency above the trigger gap) never delivered (CodeRabbit PR #9). */
  const schedule = useCallback(() => { if (inFlight.current) { again.current = true; return; } void load(); }, [load]);
  useEffect(() => {
    mounted.current = true;
    if (path === null) setState({ path: null, data: null, error: null, loading: false, requestedAt: null, updatedAt: null });
    else void load();
    const interval = opts.every ? window.setInterval(schedule, opts.every) : null;
    return () => {
      mounted.current = false; requestId.current++; controller.current?.abort(); inFlight.current = false; again.current = false;
      if (interval !== null) window.clearInterval(interval);
      if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; }
    };
  }, [load, schedule, opts.every]);
  useStream(topic => {
    if (opts.topics?.includes(topic)) {
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => { timer.current = null; schedule(); }, 600);
    }
  });
  const setData = useCallback((action: SetStateAction<T | null>) => {
    if (!mounted.current || currentPath.current !== path) return;
    setState(previous => {
      const current = previous.path === path ? previous : { path, data: null, error: null, loading: false, requestedAt: null, updatedAt: null };
      return { ...current, data: typeof action === 'function' ? (action as (previous: T | null) => T | null)(current.data) : action };
    });
  }, [path]);
  // Guard during render too: path changes must never label an old resource before effect cleanup runs.
  const visible = state.path === path && path !== null ? state : { data: null, error: null, loading: false, requestedAt: null, updatedAt: null };
  return { data: visible.data, error: visible.error, loading: visible.loading, requestedAt: visible.requestedAt, updatedAt: visible.updatedAt, reload: load, setData };
}

export const fmt = {
  usd: (x: number | null | undefined, dp = 2) => (x == null || !Number.isFinite(x) ? '—' : `${x < 0 ? '-' : ''}$${Math.abs(x).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })}`),
  num: (x: number | null | undefined, dp = 2) => (x == null || !Number.isFinite(x) ? '—' : x.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })),
  px: (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '—' : x >= 1000 ? x.toLocaleString(undefined, { maximumFractionDigits: 2 }) : x >= 1 ? x.toFixed(4) : x.toPrecision(4)),
  pct: (x: number | null | undefined, dp = 2) => (x == null || !Number.isFinite(x) ? '—' : `${x > 0 ? '+' : ''}${x.toFixed(dp)}%`),
  /** Compact magnitude (1.23B, 4.56M, 7.8K). Negative values keep their sign (e.g. net outflows: -137.6K). */
  big: (x: number | null | undefined): string => {
    if (x == null || !Number.isFinite(x)) return '—';
    const a = Math.abs(x); const sign = x < 0 ? '-' : '';
    return sign + (a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : a.toFixed(0));
  },
  ago: (t: number | string | null | undefined) => { if (!t) return '—'; const ms = Date.now() - (typeof t === 'string' ? Date.parse(t) : t); const s = Math.round(ms / 1000); return s < 0 ? 'in future' : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; },
  time: (t: number | string | null | undefined) => (t ? new Date(t).toLocaleString() : '—'),
};

// ---- sign-in / step-up state shared by the shell and the step-up inputs ------------------------------------------
export type AuthMode = 'privy' | 'passphrase';
export type StepUpMethod = 'totp' | 'passphrase' | 'unavailable';
export interface AuthState {
  mode: AuthMode; setup: boolean; authenticated: boolean; setupCodeRequired?: boolean;
  privy: { enabled: boolean; appId: string | null; linked: boolean; ownerConfigured: boolean; embeddedWallets: boolean; walletActions: 'LOCKED' };
  stepUp?: StepUpMethod;
}
/** Set by App after /api/auth/state; read by StepUp inputs and sign-out. The server stays authoritative. */
export const authInfo: { mode: AuthMode; stepUp: StepUpMethod } = { mode: 'privy', stepUp: 'unavailable' };
/** Marks that the Privy browser session must also be ended the next time the sign-in screen mounts. */
export const PRIVY_LOGOUT_FLAG = 'mia:privy-logout';
/**
 * Step-up proof for a protected request. A 6-digit value is an authenticator code; anything else is the legacy
 * passphrase (passphrases are at least 10 characters, so the two can never be confused). Empty sends nothing and the
 * server refuses the action.
 */
export function stepUpBody(value: string): { otp?: string; password?: string } {
  const v = value.trim();
  if (!v) return {};
  return /^\d{6}$/.test(v) ? { otp: v } : { password: value };
}
