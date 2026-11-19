/**
 * Vike Data (https://data.vike.io/v1): credentialed market RESEARCH only. Never an execution venue, quote authority or
 * trade signal. Registered through MIA's existing provider registry and rate limiter; there is no second market store,
 * scanner, queue or API client.
 *
 * Contract checked against the official OpenAPI 3.1 spec (vike.io/data/openapi.json, "vike.io Data API" 1.0.0):
 *  - auth: `X-API-KEY: vk_...` header (server-side only, from MIA_VIKE_API_KEY);
 *  - limits: 200 requests/minute per key plus an hourly cap; 429 carries Retry-After (honoured by fetchProvider);
 *  - every success schema is `{}`, so responses are only checked to be JSON objects or arrays and are labelled
 *    as unverified research data.
 * Security: only the fixed paths below on the fixed host; redirects are errors (the key never follows a redirect);
 * the key never appears in a URL, log, response or browser bundle. This module imports nothing from OMS, signing,
 * wallet or transfer code.
 */
import { fetchProvider, registerProvider, setRateLimit } from './http.js';

export const VIKE_PROVIDER = 'vike-data';
const ROOT = 'https://data.vike.io/v1';
/** Local budget: half of Vike's 200/min, for one running process. A multi-process deployment needs a shared limiter. */
const MINUTE_BUDGET = 100;

const keyConfigured = () => !!process.env.MIA_VIKE_API_KEY?.trim();
registerProvider({
  id: VIKE_PROVIDER,
  name: 'Vike Data (on-chain, Hyperliquid, Polymarket, Predict.fun)',
  sourceClass: 'onchain',
  markets: ['crypto', 'crypto-dex', 'perpetual-research', 'prediction-research'],
  license: 'Vike Data API terms: check retention, display and commercial-use conditions.',
  realtime: 'NEAR_REALTIME', // endpoint-specific freshness can be much slower (e.g. Predict.fun catalog)
  requiresCredentials: true,
  status: keyConfigured() ? 'IDLE' : 'PENDING_CREDENTIALS',
  note: keyConfigured()
    ? 'Research-only. The key stays server-side; data can never authorize a trade.'
    : 'Set MIA_VIKE_API_KEY on the server (never in the browser or git). Host data.vike.io must be allow-listed.',
});
setRateLimit(VIKE_PROVIDER, MINUTE_BUDGET);

export class VikeValidationError extends Error {}
export class VikeNotConfiguredError extends Error {}

function apiKey() {
  const v = process.env.MIA_VIKE_API_KEY?.trim();
  if (!v) throw new VikeNotConfiguredError('Vike credentials are not configured (set MIA_VIKE_API_KEY on the server)');
  if (!/^vk_[A-Za-z0-9_-]{12,256}$/.test(v)) throw new VikeNotConfiguredError('MIA_VIKE_API_KEY has an invalid format (expected vk_...)');
  return v;
}
const integer = (n: number, name: string, min: number, max: number) => {
  if (!Number.isInteger(n) || n < min || n > max) throw new VikeValidationError(`${name} must be an integer in [${min}, ${max}]`);
  return n;
};
const text = (v: unknown, name: string, max = 256) => {
  if (typeof v !== 'string' || !v.trim() || v.length > max) throw new VikeValidationError(`${name} is invalid`);
  return v.trim();
};
function oneOf<T extends string>(v: unknown, options: readonly T[], name: string): T {
  if (!options.includes(v as T)) throw new VikeValidationError(`invalid ${name}`);
  return v as T;
}

const PATHS = ['/search', '/onchain/wallets/discover', '/onchain/tokens/screener', '/hyperliquid/ohlcv',
  '/predictfun/markets', '/polymarket/markets', '/polymarket/archive/url'] as const;
type VikePath = typeof PATHS[number];

/** Research envelope: the provenance travels with the data, so nothing downstream can mistake it for a quote. */
export interface VikeResearch<T = unknown> {
  source: 'vike-data'; endpoint: VikePath; fetchedAt: number;
  kind: 'RESEARCH_ONLY'; tradeEligible: false; freshness: 'UNVERIFIED'; data: T;
}

async function get(path: VikePath, query: Record<string, string | number | boolean | undefined>): Promise<VikeResearch> {
  if (!(PATHS as readonly string[]).includes(path)) throw new VikeValidationError('endpoint not allowlisted');
  const key = apiKey(); // validated before any network call
  const url = new URL(`${ROOT}${path}`);
  for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, String(v));
  if (url.origin !== 'https://data.vike.io') throw new VikeValidationError('host not allowlisted');
  const data = await fetchProvider(VIKE_PROVIDER, url.href, { timeoutMs: 10_000, redirectMode: 'error', headers: { 'X-API-KEY': key } });
  if (data === null || typeof data !== 'object') throw new VikeValidationError('unexpected Vike response shape');
  return { source: 'vike-data', endpoint: path, fetchedAt: Date.now(), kind: 'RESEARCH_ONLY', tradeEligible: false, freshness: 'UNVERIFIED', data };
}

const CHAINS = ['ethereum', 'bsc', 'base', 'hyperevm'] as const;

/** Cross-product search (tokens, wallets, markets). Names and symbols can collide: WATCH_ONLY. */
export function searchVike(q: string, limit = 10) {
  return get('/search', { q: text(q, 'q', 256), limit: integer(limit, 'limit', 1, 20) });
}

/** Wallet leaderboard. Flow is window-specific, but some PnL fields are lifetime statistics. */
export function discoverVikeWallets(o: { chain?: typeof CHAINS[number]; window?: '24h' | '7d' | '30d' | '90d' | 'all'; sort?: 'volume' | 'inflow' | 'outflow' | 'net_flow' | 'tx_count'; size?: number } = {}) {
  return get('/onchain/wallets/discover', {
    chain: oneOf(o.chain ?? 'ethereum', CHAINS, 'chain'),
    window: oneOf(o.window ?? '30d', ['24h', '7d', '30d', '90d', 'all'] as const, 'window'),
    sort: o.sort === undefined ? undefined : oneOf(o.sort, ['volume', 'inflow', 'outflow', 'net_flow', 'tx_count'] as const, 'sort'),
    size: integer(o.size ?? 10, 'size', 1, 20),
  });
}

/** Token activity screen. WATCH_ONLY observations; not a contract or sellability check. */
export function getVikeOnchainTokenScreener(o: { chain?: typeof CHAINS[number]; window?: '24h' | '7d' | '30d' | '90d'; sort?: 'volume' | 'net_inflow' | 'holders' | 'smart_inflow'; minVolumeUsd?: number; limit?: number } = {}) {
  const chain = oneOf(o.chain ?? 'ethereum', CHAINS, 'chain');
  const sort = oneOf(o.sort ?? 'volume', ['volume', 'net_inflow', 'holders', 'smart_inflow'] as const, 'sort');
  if (sort === 'smart_inflow' && chain !== 'ethereum') throw new VikeValidationError('smart_inflow is available only for ethereum');
  if (o.minVolumeUsd !== undefined && (!Number.isFinite(o.minVolumeUsd) || o.minVolumeUsd < 0)) throw new VikeValidationError('invalid minVolumeUsd');
  return get('/onchain/tokens/screener', {
    chain, sort, window: oneOf(o.window ?? '24h', ['24h', '7d', '30d', '90d'] as const, 'window'),
    min_volume_usd: o.minVolumeUsd, limit: integer(o.limit ?? 50, 'limit', 1, 100), // spec: applied cap 100
  });
}

/** Executed-fill candles: RESEARCH data, never an executable order-book price. */
export function getVikeHyperliquidCandles(symbol: string, o: { interval?: '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d'; market?: 'perp' | 'spot'; limit?: number } = {}) {
  return get('/hyperliquid/ohlcv', {
    symbol: text(symbol, 'symbol', 80),
    interval: oneOf(o.interval ?? '1h', ['1m', '5m', '15m', '30m', '1h', '4h', '1d'] as const, 'interval'),
    market: oneOf(o.market ?? 'perp', ['perp', 'spot'] as const, 'market'),
    limit: integer(o.limit ?? 500, 'limit', 1, 5000), // spec: clamped to 5000
  });
}

/** Predict.fun catalog; can lag the underlying tape. Never live-quote evidence. */
export function getVikePredictFunMarkets(o: { status?: 'open' | 'closed' | 'resolved'; q?: string; sort?: 'volume_24h' | 'newest'; limit?: number } = {}) {
  return get('/predictfun/markets', {
    status: o.status === undefined ? undefined : oneOf(o.status, ['open', 'closed', 'resolved'] as const, 'status'),
    q: o.q === undefined ? undefined : text(o.q, 'q', 200),
    sort: oneOf(o.sort ?? 'volume_24h', ['volume_24h', 'newest'] as const, 'sort'),
    limit: integer(o.limit ?? 25, 'limit', 1, 100),
  });
}

/** Polymarket recorded market catalog; not a guaranteed live quote. */
export function getVikePolymarketMarkets(o: { query?: string; active?: boolean; limit?: number; offset?: number } = {}) {
  return get('/polymarket/markets', {
    query: o.query === undefined ? undefined : text(o.query, 'query', 150),
    active: o.active === undefined ? undefined : String(o.active),
    limit: integer(o.limit ?? 50, 'limit', 1, 100), // spec: hard cap 100
    offset: integer(o.offset ?? 0, 'offset', 0, 10_000),
  });
}

/**
 * Resolve ONE Polymarket archive dataset (spec: an object with a presigned `url` valid 7 days).
 * The presigned link needs no key and must not be shared: this returns metadata only and drops every URL-valued
 * field. A separate, host-allowlisted downloader (not part of this module) must save the complete Parquet file
 * locally before analysis. `redirect` is never set, so Vike answers 200 with metadata, not 302.
 */
export async function resolveVikePolymarketArchive(o: { date: string; stream: 'book_events' | 'trades' | 'l1_quotes'; asset?: string; tenor?: string }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.date) || Number.isNaN(Date.parse(`${o.date}T00:00:00Z`))) throw new VikeValidationError('date must be YYYY-MM-DD');
  const stream = oneOf(o.stream, ['book_events', 'trades', 'l1_quotes'] as const, 'stream');
  if (Boolean(o.asset) !== Boolean(o.tenor)) throw new VikeValidationError('asset and tenor must be provided together');
  const r = await get('/polymarket/archive/url', {
    date: o.date, stream,
    asset: o.asset === undefined ? undefined : text(o.asset, 'asset', 60),
    tenor: o.tenor === undefined ? undefined : text(o.tenor, 'tenor', 24),
  });
  return { ...r, data: stripUrls(r.data) };
}

/** Remove presigned links (any string that looks like a URL, and `url`/`href`/`link` keys) before data leaves the server. */
export function stripUrls(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripUrls);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      if (/^(url|href|link|location|download_url|presigned_url)$/i.test(k)) { out[k] = '[withheld: presigned link stays on the server]'; continue; }
      out[k] = stripUrls(val);
    }
    return out;
  }
  return typeof v === 'string' && /^https?:\/\//i.test(v) ? '[withheld]' : v;
}
