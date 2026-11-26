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
  /** Exact HTTPS hostnames this provider may call. A provider without hosts cannot fetch (fail closed). */
  hosts?: readonly string[];
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
  private tokens: number; private last = performance.now();
  constructor(private perMin: number) { this.tokens = perMin; }
  async take() {
    for (;;) {
      const t = performance.now();
      this.tokens = Math.min(this.perMin, this.tokens + ((t - this.last) / 60_000) * this.perMin);
      this.last = t;
      if (this.tokens >= 1) { this.tokens -= 1; return; }
      await new Promise((r) => setTimeout(r, Math.ceil(((1 - this.tokens) / this.perMin) * 60_000)));
    }
  }
}
const buckets = new Map<string, Bucket>();
export function setRateLimit(id: string, perMin: number) {
  if (!Number.isFinite(perMin) || perMin < 1) throw new Error('INVALID_PROVIDER_RATE_LIMIT');
  buckets.set(id, new Bucket(perMin));
}

export class ProviderError extends Error { constructor(public providerId: string, msg: string, public status?: number) { super(`${providerId}: ${msg}`); } }

// Shared across all callers of a provider (including scanner and position-book lanes).
// A cooldown suppresses HTTP calls, not the independent local protection monitor.
const cooldowns = new Map<string, { until: number; status: number }>();

function retryDelayMs(raw: string | null, status: number): number {
  const fallback = status === 418 ? 120_000 : 60_000;
  if (raw == null || !raw.trim()) return fallback;
  const value = raw.trim();
  const delay = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(delay) && delay > 0 ? Math.max(1000, delay) : fallback;
}
function enforceCooldown(id: string) {
  const current = cooldowns.get(id);
  if (!current) return;
  if (performance.now() < current.until) throw new ProviderError(id, 'rate-limit cooldown active', current.status);
  cooldowns.delete(id);
}

const MAX_REDIRECTS = 3;
const REDIRECT = new Set([301, 302, 303, 307, 308]);

/**
 * Destination check (SSRF guard): HTTPS only, no credentials or explicit port in the URL, and an exact match with one of
 * the provider's registered hostnames. IP-literal and unregistered hosts are refused. Messages name the host only,
 * because some provider URLs carry a token in their path.
 */
export function providerDestinationDenial(id: string, url: string | URL): string | null {
  const hosts = registry.get(id)?.hosts;
  if (!hosts?.length) return 'no allowed hosts registered';
  let u: URL;
  try { u = new URL(url); } catch { return 'invalid URL'; }
  if (u.protocol !== 'https:') return `refused non-HTTPS destination ${u.host}`;
  if (u.username || u.password || u.port) return `refused destination with credentials or port ${u.hostname}`;
  if (!hosts.includes(u.hostname)) return `refused destination ${u.hostname} (not registered for this provider)`;
  return null;
}

/** Fetch with timeout, rate limit, latency + health accounting. Never logs credentials. */
export async function fetchProvider(id: string, url: string, opts: { timeoutMs?: number; as?: 'json' | 'text'; headers?: Record<string, string> } = {}): Promise<any> {
  const info = registry.get(id);
  if (!info) throw new ProviderError(id, 'unregistered provider');
  if (config.offline) throw new ProviderError(id, 'offline mode');
  // Checked before rate limiting or health accounting: a refused destination is a code defect, not a provider outage.
  const denial = providerDestinationDenial(id, url);
  if (denial) throw new ProviderError(id, denial);
  enforceCooldown(id);
  await buckets.get(id)?.take();
  // Another caller may have received a 429 while this one waited for a token.
  enforceCooldown(id);
  const t0 = performance.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 10_000);
  try {
    const init = { signal: ctl.signal, redirect: 'manual' as const, headers: { 'user-agent': 'MIA/4.1 (read-only market data client)', accept: opts.as === 'text' ? '*/*' : 'application/json', ...opts.headers } };
    // Redirects are followed manually so every hop is checked against the same allowlist.
    let res = await fetch(url, init), target = new URL(url);
    for (let hop = 0; REDIRECT.has(res.status); hop++) {
      const location = res.headers.get('location');
      if (!location || hop >= MAX_REDIRECTS) throw new ProviderError(id, 'redirect refused (missing location or too many hops)', res.status);
      target = new URL(location, target);
      const redirectDenial = providerDestinationDenial(id, target);
      if (redirectDenial) throw new ProviderError(id, `redirect ${redirectDenial}`, res.status);
      res = await fetch(target, init);
    }
    if (res.status === 429 || (id === 'binance' && res.status === 418)) {
      const until = performance.now() + retryDelayMs(res.headers.get('retry-after'), res.status);
      const prior = cooldowns.get(id);
      if (!prior || until > prior.until) cooldowns.set(id, { until, status: res.status });
    }
    if (res.status === 404) { // resource-level miss (e.g. product not listed) — provider itself is reachable
      Object.assign(info, { lastOkAt: Date.now(), lastLatencyMs: Math.round(performance.now() - t0) });
      throw Object.assign(new ProviderError(id, 'HTTP 404 (resource not found)', 404), { resourceMiss: true });
    }
    if (!res.ok) throw new ProviderError(id, `HTTP ${res.status}`, res.status);
    const body = opts.as === 'text' ? await res.text() : await res.json();
    const ms = performance.now() - t0;
    record(`provider.${id}`, ms);
    const prev = info.status;
    // An earlier in-flight request succeeding does not cancel a later rate-limit response.
    const cooling = (cooldowns.get(id)?.until ?? -Infinity) > performance.now();
    const status = cooling ? 'DEGRADED' : 'LIVE';
    Object.assign(info, { status, lastOkAt: Date.now(), okCount: info.okCount + 1, lastLatencyMs: Math.round(ms) });
    if (prev !== status) bus.publish('health', { provider: id, status });
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
