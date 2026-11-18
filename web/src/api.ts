import { useCallback, useEffect, useRef, useState } from 'react';

export class ApiError extends Error { constructor(public status: number, msg: string) { super(msg); } }
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(path, { method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', 'x-mia-csrf': '1' }, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
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

/** Fetch + auto-refresh on listed stream topics (debounced) and optional interval. */
export function useApi<T = any>(path: string | null, opts: { topics?: string[]; every?: number } = {}) {
  const [data, setData] = useState<T | null>(null); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(false);
  /** Monotonic (performance.now()) time the newest successful request was SENT; conservative for freshness checks. */
  const [requestedAt, setRequestedAt] = useState<number | null>(null);
  const timer = useRef<number | null>(null); const seq = useRef(0); const inFlight = useRef(false); const again = useRef(false);
  /** Forced load: supersedes anything in flight (used on mount, path change and reload() after a mutation, so a response
   *  requested before the mutation is never shown). The sequence guard drops superseded responses. */
  const load = useCallback(async () => {
    if (!path) return; setLoading(true);
    const n = ++seq.current; const sent = performance.now(); inFlight.current = true;
    try { const d = await api<T>(path); if (n !== seq.current) return; setData(d); setError(null); setRequestedAt(sent); }
    catch (e: any) { if (n === seq.current) setError(e.message); }
    finally {
      if (n === seq.current) {
        setLoading(false); inFlight.current = false;
        if (again.current) { again.current = false; void load(); } // a refresh was requested while this one ran
      }
    }
  }, [path]);
  /** Scheduled refresh (interval tick, stream topic): never supersedes a request in flight — it queues one follow-up
   *  instead. Before, a slow endpoint whose latency exceeded the trigger gap had every response dropped (CodeRabbit PR #9). */
  const schedule = useCallback(() => { if (inFlight.current) { again.current = true; return; } void load(); }, [load]);
  // MIA-WEB-013: a new path starts empty. Pending work for the old path is cancelled: its debounced refresh is cleared
  // and its in-flight response is invalidated, so it can never replace the new path's data (CodeRabbit PR #15).
  useEffect(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    seq.current++; inFlight.current = false; again.current = false;
    setData(null); setError(null); setRequestedAt(null);
  }, [path]);
  useEffect(() => { load(); if (!opts.every) return; const t = window.setInterval(schedule, opts.every); return () => clearInterval(t); }, [load, schedule, opts.every]);
  // MIA-WEB-002: a debounced stream refresh must not fire after the component is gone.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useStream((t) => { if (opts.topics?.includes(t)) { if (timer.current) clearTimeout(timer.current); timer.current = window.setTimeout(schedule, 600); } });
  return { data, error, loading, requestedAt, reload: load, setData };
}

export const fmt = {
  usd: (x: number | null | undefined, dp = 2) => (x == null || !Number.isFinite(x) ? '—' : `${x < 0 ? '-' : ''}$${Math.abs(x).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })}`),
  num: (x: number | null | undefined, dp = 2) => (x == null || !Number.isFinite(x) ? '—' : x.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })),
  px: (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '—' : x >= 1000 ? x.toLocaleString(undefined, { maximumFractionDigits: 2 }) : x >= 1 ? x.toFixed(4) : x.toPrecision(4)),
  pct: (x: number | null | undefined, dp = 2) => (x == null || !Number.isFinite(x) ? '—' : `${x > 0 ? '+' : ''}${x.toFixed(dp)}%`),
  big: (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? '—' : x >= 1e9 ? `${(x / 1e9).toFixed(2)}B` : x >= 1e6 ? `${(x / 1e6).toFixed(2)}M` : x >= 1e3 ? `${(x / 1e3).toFixed(1)}K` : x.toFixed(0)),
  ago: (t: number | string | null | undefined) => { if (!t) return '—'; const ms = Date.now() - (typeof t === 'string' ? Date.parse(t) : t); const s = Math.round(ms / 1000); return s < 0 ? 'in future' : s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : s < 86400 ? `${Math.round(s / 3600)}h ago` : `${Math.round(s / 86400)}d ago`; },
  time: (t: number | string | null | undefined) => (t ? new Date(t).toLocaleString() : '—'),
};
