/**
 * CCXT exchange-connectivity RESEARCH (read-only; optional sandbox URLs). Not a trading venue adapter, not a quote
 * authority, not a second market-data fabric: nothing here feeds the price cache, scanner, QCI, decision engine,
 * risk gate or OMS. Paper fills keep coming from MIA's own book-depth logic.
 *
 * Safety by construction:
 *  - No credentials, ever: exchanges are built without apiKey/secret/password, and the adapter refuses to run if a
 *    credential is present on the instance.
 *  - CCXT's HTTP layer is replaced: every request goes through MIA's `fetchProvider`, which can only send GET. Any
 *    POST/PUT/DELETE (orders, withdrawals, transfers) is refused before leaving the process. The same path gives CCXT
 *    MIA's offline mode, per-provider rate limit, Retry-After back-off and provider-health accounting.
 *  - Only allow-listed exchanges and allow-listed PUBLIC methods are callable.
 *  - MIA_CCXT_SANDBOX=1 switches supported exchanges to their official test URLs (still keyless, still GET-only).
 */
import { fetchProvider, providers, registerProvider, setRateLimit } from '../providers/http.js';

export const CCXT_EXCHANGES = ['binance', 'coinbaseexchange', 'kraken', 'okx', 'bybit'] as const;
export type CcxtExchangeId = typeof CCXT_EXCHANGES[number];
const SYMBOL_RE = /^[A-Z0-9]{1,20}\/[A-Z0-9]{1,20}(:[A-Z0-9]{1,20})?$/;
const TIMEFRAMES = ['1m', '5m', '15m', '1h', '4h', '1d'] as const;

export class CcxtResearchError extends Error { statusCode = 400; }

/** Minimal structural type for what MIA uses from a CCXT exchange instance (keeps the rest of CCXT out of reach). */
export interface CcxtLike {
  id: string; rateLimit: number; urls: { api?: unknown; test?: unknown }; has: Record<string, unknown>;
  apiKey?: string; secret?: string; password?: string; uid?: string; privateKey?: string; walletAddress?: string;
  fetch: (url: string, method?: string, headers?: Record<string, string>, body?: unknown) => Promise<unknown>;
  handleErrors?: (...args: unknown[]) => unknown;
  setSandboxMode: (on: boolean) => void;
  loadMarkets: () => Promise<Record<string, unknown>>;
  fetchTicker: (symbol: string) => Promise<unknown>;
  fetchOrderBook: (symbol: string, limit?: number) => Promise<unknown>;
  fetchOHLCV: (symbol: string, timeframe?: string, since?: number, limit?: number) => Promise<unknown>;
}
type Factory = (id: CcxtExchangeId) => Promise<CcxtLike>;
const defaultFactory: Factory = async (id) => {
  const ccxt = (await import('ccxt')).default as unknown as Record<string, new (o: object) => CcxtLike>;
  return new ccxt[id]({ enableRateLimit: true, timeout: 10_000 }); // no credentials, by design
};
let factory: Factory = defaultFactory;
/** Test hook: substitute a fake exchange factory (no network). */
export function _setCcxtFactoryForTests(f: Factory | null) { factory = f ?? defaultFactory; cache.clear(); }

const providerId = (id: CcxtExchangeId) => `ccxt-${id}`;
for (const id of CCXT_EXCHANGES) {
  registerProvider({ id: providerId(id), name: `CCXT research: ${id}`, sourceClass: 'cex', markets: ['crypto'],
    license: 'Exchange public API terms apply (via CCXT, MIT).', realtime: 'NEAR_REALTIME', requiresCredentials: false,
    note: 'Read-only research through CCXT. GET-only transport; never trades, never feeds the paper OMS.' });
}

export const sandboxMode = () => process.env.MIA_CCXT_SANDBOX === '1';
const cache = new Map<string, Promise<CcxtLike>>();

function assertKeyless(ex: CcxtLike) {
  for (const k of ['apiKey', 'secret', 'password', 'uid', 'privateKey', 'walletAddress'] as const) {
    if (ex[k]) throw new CcxtResearchError(`refusing to use ${ex.id}: a credential (${k}) is present; CCXT research is keyless`);
  }
}

/** Route CCXT's HTTP through MIA's provider layer, GET only. */
function installTransport(ex: CcxtLike, id: CcxtExchangeId) {
  const pid = providerId(id);
  ex.fetch = async (url, method = 'GET', headers, body) => {
    if (String(method).toUpperCase() !== 'GET' || (body !== undefined && body !== null && body !== '')) {
      throw new CcxtResearchError(`blocked ${method} request: CCXT research is read-only (GET only)`);
    }
    if (!/^https:\/\//.test(url)) throw new CcxtResearchError('blocked non-HTTPS request');
    const json = await fetchProvider(pid, url, { headers: (headers ?? {}) as Record<string, string>, timeoutMs: 10_000 });
    // Let CCXT map exchange-specific error payloads that arrive with HTTP 200 (e.g. Kraken `{ error: [...] }`).
    ex.handleErrors?.(200, 'OK', url, 'GET', {}, JSON.stringify(json), json, headers, undefined);
    return json;
  };
}

async function exchange(id: string): Promise<CcxtLike> {
  if (!(CCXT_EXCHANGES as readonly string[]).includes(id)) throw new CcxtResearchError(`exchange not allow-listed: ${id}`);
  const eid = id as CcxtExchangeId;
  const key = `${eid}:${sandboxMode() ? 'sandbox' : 'live-data'}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const ex = await factory(eid);
      assertKeyless(ex);
      if (sandboxMode()) {
        if (!ex.urls.test) throw new CcxtResearchError(`${eid} has no official sandbox in CCXT`);
        ex.setSandboxMode(true);
      }
      installTransport(ex, eid);
      setRateLimit(providerId(eid), Math.max(10, Math.floor((60_000 / Math.max(ex.rateLimit, 50)) / 2))); // half of CCXT's documented pace
      return ex;
    })();
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  const ex = await p;
  assertKeyless(ex); // re-check: nothing may have attached a credential since construction
  return ex;
}

export interface CcxtResearch<T = unknown> { source: string; exchange: CcxtExchangeId; sandbox: boolean; fetchedAt: number; kind: 'RESEARCH_ONLY'; tradeEligible: false; data: T }
const envelope = <T>(exchange: CcxtExchangeId, data: T): CcxtResearch<T> =>
  ({ source: 'ccxt', exchange, sandbox: sandboxMode(), fetchedAt: Date.now(), kind: 'RESEARCH_ONLY', tradeEligible: false, data });

function symbolOf(s: string) { const v = s.toUpperCase(); if (!SYMBOL_RE.test(v)) throw new CcxtResearchError('symbol must look like BTC/USDT'); return v; }

export function ccxtOverview() {
  const health = new Map(providers().map((p) => [p.id, p]));
  return { sandbox: sandboxMode(), kind: 'RESEARCH_ONLY' as const, exchanges: CCXT_EXCHANGES.map((id) => {
    const h = health.get(providerId(id));
    return { id, provider: providerId(id), status: h?.status ?? 'IDLE', lastOkAt: h?.lastOkAt ?? null, lastError: h?.lastError ?? null };
  }) };
}
export async function ccxtMarkets(id: string, limit = 50) {
  const ex = await exchange(id); const markets = await ex.loadMarkets();
  const symbols = Object.keys(markets).sort();
  return envelope(ex.id as CcxtExchangeId, { count: symbols.length, symbols: symbols.slice(0, Math.min(Math.max(limit, 1), 500)) });
}
export async function ccxtTicker(id: string, symbol: string) {
  const ex = await exchange(id); return envelope(ex.id as CcxtExchangeId, await ex.fetchTicker(symbolOf(symbol)));
}
export async function ccxtOrderBook(id: string, symbol: string, limit = 20) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new CcxtResearchError('limit must be 1..100');
  const ex = await exchange(id); return envelope(ex.id as CcxtExchangeId, await ex.fetchOrderBook(symbolOf(symbol), limit));
}
export async function ccxtCandles(id: string, symbol: string, timeframe: string = '1h', limit = 100) {
  if (!(TIMEFRAMES as readonly string[]).includes(timeframe)) throw new CcxtResearchError(`timeframe must be one of ${TIMEFRAMES.join(', ')}`);
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new CcxtResearchError('limit must be 1..1000');
  const ex = await exchange(id); return envelope(ex.id as CcxtExchangeId, await ex.fetchOHLCV(symbolOf(symbol), timeframe, undefined, limit));
}
