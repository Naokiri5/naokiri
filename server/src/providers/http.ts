import { isIP } from 'node:net';
import { bus } from '../core/bus.js';
import { record } from '../core/latency.js';
import { config } from '../config.js';

export type ProviderStatus = 'LIVE' | 'DEGRADED' | 'DOWN' | 'PENDING_CREDENTIALS' | 'DISABLED' | 'IDLE';

export interface ProviderInfo {
  id: string;
  name: string;
  sourceClass: 'cex' | 'dex' | 'aggregator' | 'fx_reference' | 'news' | 'onchain' | 'social' | 'broker' | 'messaging' | 'regulator';
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

const CREDENTIAL_ORIGINS = new Map([
  ['telegram', 'https://api.telegram.org'],
  ['vike-data', 'https://data.vike.io'],
]);
export const ETHEREUM_READ_ONLY_PROVIDER = 'eth-rpc-readonly';
export function configuredEthereumRpc(): string {
  const configured = process.env.MIA_ETH_RPC_URL?.trim();
  return configured ? new URL(configured).href : 'https://ethereum-rpc.publicnode.com';
}

function assertProviderDestination(info: ProviderInfo, url: string): void {
  const denied = () => new ProviderError(info.id, 'provider destination is not permitted');
  let destination: URL;
  try { destination = new URL(url); } catch { throw denied(); }
  const host = destination.hostname.replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (destination.protocol !== 'https:' || destination.username || destination.password || destination.hash ||
      isIP(host) || !host.includes('.') || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw denied();
  }
  const expectedOrigin = CREDENTIAL_ORIGINS.get(info.id);
  if (expectedOrigin ? destination.origin !== expectedOrigin : info.requiresCredentials) throw denied();
  if (info.id === ETHEREUM_READ_ONLY_PROVIDER) {
    let rpc: URL;
    try { rpc = new URL(configuredEthereumRpc()); }
    catch { throw denied(); }
    if (destination.href !== rpc.href) throw denied();
  }
}

/**
 * Fetch with timeout, rate limit, latency and health accounting. Redirects are always refused; an API key may sit
 * in a header, the URL path or query, and even keyless adapters control which destination receives their requests.
 * `jsonBody` sends a JSON POST (used only for read-only JSON-RPC such as eth_call); everything else is a GET.
 * `decode` (Codex four-layer) validates the raw payload into a typed result inside the provider boundary.
 */
export async function fetchProvider<T = any>(id: string, url: string, opts: {
  timeoutMs?: number;
  as?: 'json' | 'text';
  headers?: Record<string, string>;
  redirect?: 'follow' | 'error';
  redirectMode?: 'error' | 'follow';
  jsonBody?: unknown;
  decode?: (raw: unknown) => T;
} = {}): Promise<T> {
  const info = registry.get(id);
  if (!info) throw new ProviderError(id, 'unregistered provider');
  if (config.offline) throw new ProviderError(id, 'offline mode');
  assertProviderDestination(info, url);
  if (opts.redirect === 'follow' || opts.redirectMode === 'follow') throw new ProviderError(id, 'automatic redirects are disabled');
  const post = opts.jsonBody !== undefined;
  const hideTransportDetails = info.requiresCredentials || CREDENTIAL_ORIGINS.has(id) || id === ETHEREUM_READ_ONLY_PROVIDER ||
    post || Object.keys(opts.headers ?? {}).length > 0;
  const assertNotBlocked = () => {
    const until = blockedUntil.get(id) ?? 0;
    if (Date.now() < until) throw new ProviderError(id, `rate limited by provider; retry after ${new Date(until).toISOString()}`, 429);
  };
  assertNotBlocked();
  await buckets.get(id)?.take();
  assertNotBlocked(); // another call may have hit 429 while this one waited for a token (CodeRabbit #45)
  const t0 = performance.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await fetch(url, { signal: ctl.signal, redirect: 'error', method: post ? 'POST' : 'GET', body: post ? JSON.stringify(opts.jsonBody) : undefined,
      headers: { 'user-agent': 'MIA/4.1 (read-only market data client)', accept: opts.as === 'text' ? '*/*' : 'application/json', ...(post ? { 'content-type': 'application/json' } : {}), ...opts.headers } });
    if (res.status === 404) { // resource-level miss (e.g. product not listed) — provider itself is reachable
      Object.assign(info, { lastOkAt: Date.now(), lastLatencyMs: Math.round(performance.now() - t0) });
      throw Object.assign(new ProviderError(id, 'HTTP 404 (resource not found)', 404), { resourceMiss: true });
    }
    if (!res.ok) {
      if (res.status === 429 || res.status === 418 || res.status === 503) {
        // Keep the longest active backoff: a shorter Retry-After from a concurrent response must not cut it short.
        const ms = retryAfterMs(res, res.status); if (ms != null) blockedUntil.set(id, Math.max(blockedUntil.get(id) ?? 0, Date.now() + ms));
      }
      throw new ProviderError(id, `HTTP ${res.status}`, res.status);
    }
    const raw: unknown = opts.as === 'text' ? await res.text() : await res.json();
    const body = opts.decode ? opts.decode(raw) : raw as T;
    const ms = performance.now() - t0;
    record(`provider.${id}`, ms);
    const prev = info.status;
    Object.assign(info, { status: 'LIVE', lastOkAt: Date.now(), okCount: info.okCount + 1, lastLatencyMs: Math.round(ms) });
    if (prev !== 'LIVE') bus.publish('health', { provider: id, status: 'LIVE' });
    return body;
  } catch (e: any) {
    if (e?.resourceMiss) throw e;
    const msg = e?.name === 'AbortError' ? 'timeout'
      : hideTransportDetails && !(e instanceof ProviderError) ? 'request failed'
        : String(e?.message ?? e).replace(/(key|token)=[^&\s]+/gi, '$1=***');
    info.errorCount++; info.lastErrorAt = Date.now(); info.lastError = msg;
    const recentOk = info.lastOkAt && Date.now() - info.lastOkAt < 120_000;
    const prev = info.status;
    info.status = recentOk ? 'DEGRADED' : 'DOWN';
    if (prev !== info.status) bus.publish('health', { provider: id, status: info.status, error: msg });
    throw e instanceof ProviderError ? e : new ProviderError(id, msg);
  } finally { clearTimeout(timer); }
}
