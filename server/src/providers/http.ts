import { bus } from '../core/bus.js';
import { record } from '../core/latency.js';
import { config } from '../config.js';

export type ProviderStatus = 'LIVE' | 'DEGRADED' | 'DOWN' | 'PENDING_CREDENTIALS' | 'DISABLED' | 'IDLE';

export interface ProviderInfo {
  id: string;
  name: string;
  sourceClass: 'cex' | 'dex' | 'aggregator' | 'fx_reference' | 'news' | 'onchain' | 'social' | 'broker' | 'messaging';
  markets: string[];
  license: string;
  realtime: 'REALTIME' | 'NEAR_REALTIME' | 'DELAYED' | 'DAILY_REFERENCE';
  requiresCredentials: boolean;
  status: ProviderStatus;
  lastOkAt: number | null;
  lastErrorAt: number | null;
  lastError: string | null;
  okCount: number;
  errorCount: number;
  lastLatencyMs: number | null;
  note?: string;
}

const registry = new Map<string, ProviderInfo>();

export function registerProvider(p: Omit<ProviderInfo, 'status' | 'lastOkAt' | 'lastErrorAt' | 'lastError' | 'okCount' | 'errorCount' | 'lastLatencyMs'> & { status?: ProviderStatus }) {
  const info: ProviderInfo = { status: 'IDLE', lastOkAt: null, lastErrorAt: null, lastError: null, okCount: 0, errorCount: 0, lastLatencyMs: null, ...p };
  if (config.offline && info.status === 'IDLE') info.status = 'DISABLED';
  registry.set(p.id, info);
  return info;
}
export const providers = () => [...registry.values()];
export const provider = (id: string) => registry.get(id);

/** Simple token bucket per provider to respect documented public rate limits. */
class Bucket {
  private tokens: number; private last = Date.now();
  constructor(private perMin: number) { this.tokens = perMin; }
  async take() {
    for (;;) {
      const t = Date.now();
      this.tokens = Math.min(this.perMin, this.tokens + ((t - this.last) / 60_000) * this.perMin);
      this.last = t;
      if (this.tokens >= 1) { this.tokens -= 1; return; }
      await new Promise((r) => setTimeout(r, Math.ceil(((1 - this.tokens) / this.perMin) * 60_000)));
    }
  }
}
const buckets = new Map<string, Bucket>();
/** Provider told us to back off (429/418, or 503 with Retry-After): fail fast without sending until this time. */
const blockedUntil = new Map<string, number>();
const MAX_BLOCK_MS = 3_600_000;
function retryAfterMs(res: Response, status: number): number | null {
  const h = res.headers.get('retry-after');
  if (h) {
    const s = Number(h); if (Number.isFinite(s) && s >= 0) return Math.min(s * 1000, MAX_BLOCK_MS);
    const d = Date.parse(h); if (Number.isFinite(d)) return Math.min(Math.max(0, d - Date.now()), MAX_BLOCK_MS);
  }
  return status === 418 ? 120_000 : status === 429 ? 60_000 : null; // 418 = IP ban escalation: back off longer
}
export const providerBlockedUntil = (id: string) => blockedUntil.get(id) ?? 0;
export function _resetProviderBlocks() { blockedUntil.clear(); }
export function setRateLimit(id: string, perMin: number) { buckets.set(id, new Bucket(perMin)); }

export class ProviderError extends Error { constructor(public providerId: string, msg: string, public status?: number) { super(`${providerId}: ${msg}`); } }

/** Fetch with timeout, rate limit, latency + health accounting. Never logs credentials. */
/**
 * `redirectMode: 'error'` is for credentialed providers: a redirect must never carry an API key to another host
 * (fetch keeps custom headers across redirects). Default stays 'follow' for the public, keyless providers.
 */
export async function fetchProvider(id: string, url: string, opts: { timeoutMs?: number; as?: 'json' | 'text'; headers?: Record<string, string>; redirectMode?: 'error' | 'follow'; method?: 'GET' | 'POST'; body?: string } = {}): Promise<any> {
  const info = registry.get(id);
  if (!info) throw new ProviderError(id, 'unregistered provider');
  if (config.offline) throw new ProviderError(id, 'offline mode');
  const until = blockedUntil.get(id) ?? 0;
  if (Date.now() < until) throw new ProviderError(id, `rate limited by provider; retry after ${new Date(until).toISOString()}`, 429);
  await buckets.get(id)?.take();
  const t0 = performance.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await fetch(url, { signal: ctl.signal, method: opts.method ?? 'GET', body: opts.body, redirect: opts.redirectMode ?? 'follow', headers: { 'user-agent': 'MIA/4.1 (read-only market data client)', accept: opts.as === 'text' ? '*/*' : 'application/json', ...opts.headers } });
    if (res.status === 404) { // resource-level miss (e.g. product not listed) — provider itself is reachable
      Object.assign(info, { lastOkAt: Date.now(), lastLatencyMs: Math.round(performance.now() - t0) });
      throw Object.assign(new ProviderError(id, 'HTTP 404 (resource not found)', 404), { resourceMiss: true });
    }
    if (!res.ok) {
      if (res.status === 429 || res.status === 418 || res.status === 503) { const ms = retryAfterMs(res, res.status); if (ms != null) blockedUntil.set(id, Date.now() + ms); }
      throw new ProviderError(id, `HTTP ${res.status}`, res.status);
    }
    const body = opts.as === 'text' ? await res.text() : await res.json();
    const ms = performance.now() - t0;
    record(`provider.${id}`, ms);
    const prev = info.status;
    Object.assign(info, { status: 'LIVE', lastOkAt: Date.now(), okCount: info.okCount + 1, lastLatencyMs: Math.round(ms) });
    if (prev !== 'LIVE') bus.publish('health', { provider: id, status: 'LIVE' });
    return body;
  } catch (e: any) {
    if (e?.resourceMiss) throw e;
    const msg = e?.name === 'AbortError' ? 'timeout' : String(e?.message ?? e).replace(/(key|token)=[^&\s]+/gi, '$1=***');
    info.errorCount++; info.lastErrorAt = Date.now(); info.lastError = msg;
    const recentOk = info.lastOkAt && Date.now() - info.lastOkAt < 120_000;
    const prev = info.status;
    info.status = recentOk ? 'DEGRADED' : 'DOWN';
    if (prev !== info.status) bus.publish('health', { provider: id, status: info.status, error: msg });
    throw e instanceof ProviderError ? e : new ProviderError(id, msg);
  } finally { clearTimeout(timer); }
}
