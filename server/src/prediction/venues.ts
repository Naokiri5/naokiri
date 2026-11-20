/**
 * Read-only prediction-market data: Polymarket (Gamma market catalog + public CLOB order books) and Kalshi (public
 * market data). Keyless, GET-only, through MIA's provider layer (timeouts, rate limits, health, offline mode).
 *
 * There is deliberately NO order, signing, wallet, allowance, deposit or withdrawal code here — the uploaded bots'
 * live-trading paths (private keys, EIP-712 order signing, CLOB order posting) were reviewed and NOT installed.
 * Responses are untrusted third-party data: every field is validated, text is bounded, nothing is executed.
 */
import { fetchProvider, registerProvider, setRateLimit } from '../providers/http.js';
import { normaliseBook, type Book, type Level } from './analytics.js';

export const PM_GAMMA = 'polymarket-gamma';
export const PM_CLOB = 'polymarket-clob';
export const KALSHI = 'kalshi-public';
registerProvider({ id: PM_GAMMA, name: 'Polymarket markets (Gamma)', sourceClass: 'cex', markets: ['prediction-research'], license: 'Polymarket public API terms', realtime: 'DELAYED', requiresCredentials: false, note: 'Read-only market catalog. Never an order path.' });
registerProvider({ id: PM_CLOB, name: 'Polymarket order books (CLOB, public)', sourceClass: 'cex', markets: ['prediction-research'], license: 'Polymarket public API terms', realtime: 'NEAR_REALTIME', requiresCredentials: false, note: 'Public book reads only; no keys, no order posting.' });
registerProvider({ id: KALSHI, name: 'Kalshi public market data', sourceClass: 'cex', markets: ['prediction-research'], license: 'Kalshi public API terms', realtime: 'NEAR_REALTIME', requiresCredentials: false, note: 'Public market and order-book reads only; no account, no orders.' });
setRateLimit(PM_GAMMA, 30); setRateLimit(PM_CLOB, 60); setRateLimit(KALSHI, 30);

const GAMMA = 'https://gamma-api.polymarket.com';
const CLOB = 'https://clob.polymarket.com';
const KALSHI_API = 'https://api.elections.kalshi.com/trade-api/v2';

export class PredictionInputError extends Error { statusCode = 400; }
export type Venue = 'polymarket' | 'kalshi';

export interface PmOutcome { name: string; price: number | null; tokenId: string | null }
export interface PmMarket {
  venue: Venue; id: string; question: string; slug: string | null; endDate: string | null; outcomes: PmOutcome[];
  bestBid: number | null; bestAsk: number | null; volume24hUsd: number | null; liquidityUsd: number | null;
  tick: number; negRisk: boolean; eventId: string | null;
  rewards: { maxSpreadCents: number; minSize: number; dailyRateUsd: number | null } | null;
  takerFeeBps: number | null; url: string;
}

// ---- validation helpers -------------------------------------------------------------------------------------------
const str = (v: unknown, max = 300) => (typeof v === 'string' ? v.slice(0, max) : typeof v === 'number' ? String(v) : '');
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const prob = (v: unknown) => { const n = num(v); return n !== null && n >= 0 && n <= 1 ? n : null; };
/** Polymarket packs arrays as JSON strings ("[\"Yes\",\"No\"]"); accept either form, bounded. */
function arr(v: unknown): unknown[] {
  if (Array.isArray(v)) return v.slice(0, 50);
  if (typeof v === 'string' && v.length < 20_000) { try { const p = JSON.parse(v); return Array.isArray(p) ? p.slice(0, 50) : []; } catch { return []; } }
  return [];
}
export const TOKEN_ID_RE = /^\d{1,100}$/;
export const KALSHI_TICKER_RE = /^[A-Z0-9][A-Z0-9._-]{0,63}$/;

// ---- Polymarket ---------------------------------------------------------------------------------------------------
export function normaliseGammaMarket(raw: unknown): PmMarket | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const id = str(m.id, 40); const question = str(m.question, 300);
  if (!id || !question) return null;
  const names = arr(m.outcomes).map((x) => str(x, 80)); const prices = arr(m.outcomePrices).map(prob);
  const tokens = arr(m.clobTokenIds).map((x) => str(x, 100)).map((t) => (TOKEN_ID_RE.test(t) ? t : null));
  const outcomes = names.map((name, i) => ({ name, price: prices[i] ?? null, tokenId: tokens[i] ?? null }));
  const maxSpread = num(m.rewardsMaxSpread); const minSize = num(m.rewardsMinSize);
  const clobRewards = arr(m.clobRewards)[0] as Record<string, unknown> | undefined;
  const tick = num(m.orderPriceMinTickSize);
  const slug = str(m.slug, 200) || null;
  return {
    venue: 'polymarket', id, question, slug, endDate: str(m.endDate, 40) || null, outcomes,
    bestBid: prob(m.bestBid), bestAsk: prob(m.bestAsk), volume24hUsd: num(m.volume24hr), liquidityUsd: num(m.liquidityNum ?? m.liquidity),
    tick: tick && tick > 0 && tick < 0.5 ? tick : 0.01, negRisk: m.negRisk === true,
    eventId: str((arr(m.events)[0] as Record<string, unknown> | undefined)?.id, 40) || null,
    rewards: maxSpread && maxSpread > 0 ? { maxSpreadCents: maxSpread, minSize: minSize ?? 0, dailyRateUsd: num(clobRewards?.rewardsDailyRate) } : null,
    takerFeeBps: num(m.takerBaseFee),
    url: slug ? `https://polymarket.com/market/${encodeURIComponent(slug)}` : 'https://polymarket.com',
  };
}

export async function polymarketMarkets(o: { query?: string; limit?: number } = {}): Promise<PmMarket[]> {
  const limit = Math.min(Math.max(o.limit ?? 25, 1), 100);
  const url = `${GAMMA}/markets?active=true&closed=false&order=volume24hr&ascending=false&limit=${o.query ? 100 : limit}`;
  const body = await fetchProvider(PM_GAMMA, url, { timeoutMs: 10_000 });
  if (!Array.isArray(body)) return [];
  let markets = body.map(normaliseGammaMarket).filter((x): x is PmMarket => !!x);
  if (o.query) { const q = o.query.toLowerCase(); markets = markets.filter((m) => m.question.toLowerCase().includes(q)); }
  return markets.slice(0, limit);
}
export async function polymarketMarket(id: string): Promise<PmMarket> {
  if (!/^\d{1,20}$/.test(id)) throw new PredictionInputError('Polymarket market id must be numeric');
  const m = normaliseGammaMarket(await fetchProvider(PM_GAMMA, `${GAMMA}/markets/${id}`, { timeoutMs: 10_000 }));
  if (!m) throw Object.assign(new Error('market not found or malformed'), { statusCode: 404 });
  return m;
}

const levels = (v: unknown): Level[] => arr(v).map((l) => {
  const o = (l ?? {}) as Record<string, unknown>;
  return { price: num(o.price) ?? NaN, size: num(o.size) ?? NaN };
});
export function normaliseClobBook(raw: unknown, tick = 0.01): Book {
  const o = (raw ?? {}) as Record<string, unknown>;
  return normaliseBook({ bids: levels(o.bids), asks: levels(o.asks), tick: num(o.tick_size) ?? tick });
}
export async function polymarketBook(tokenId: string, tick = 0.01): Promise<Book> {
  if (!TOKEN_ID_RE.test(tokenId)) throw new PredictionInputError('Polymarket token id must be numeric');
  return normaliseClobBook(await fetchProvider(PM_CLOB, `${CLOB}/book?token_id=${tokenId}`, { timeoutMs: 8_000 }), tick);
}

// ---- Kalshi -------------------------------------------------------------------------------------------------------
/** Kalshi prices arrive as `*_dollars` strings (current API) or integer cents (older); both become 0–1. */
const kPrice = (m: Record<string, unknown>, field: string) => {
  const d = prob(m[`${field}_dollars`]); if (d !== null) return d;
  const c = num(m[field]); return c !== null && c >= 0 && c <= 100 ? c / 100 : null;
};
export function normaliseKalshiMarket(raw: unknown): PmMarket | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const ticker = str(m.ticker, 64);
  if (!KALSHI_TICKER_RE.test(ticker)) return null;
  const yesBid = kPrice(m, 'yes_bid'); const yesAsk = kPrice(m, 'yes_ask');
  const last = kPrice(m, 'last_price');
  const liq = num(m.liquidity_dollars) ?? (num(m.liquidity) !== null ? num(m.liquidity)! / 100 : null);
  return {
    venue: 'kalshi', id: ticker, question: str(m.title, 300) || ticker, slug: null, endDate: str(m.close_time, 40) || null,
    outcomes: [{ name: 'Yes', price: last, tokenId: null }, { name: 'No', price: last === null ? null : 1 - last, tokenId: null }],
    bestBid: yesBid, bestAsk: yesAsk, volume24hUsd: num(m.volume_24h_fp ?? m.volume_24h), liquidityUsd: liq, tick: 0.01, negRisk: false,
    eventId: str(m.event_ticker, 64) || null, rewards: null, takerFeeBps: null,
    url: `https://kalshi.com/markets/${encodeURIComponent(ticker.toLowerCase())}`,
  };
}
export async function kalshiMarkets(o: { query?: string; limit?: number } = {}): Promise<PmMarket[]> {
  const limit = Math.min(Math.max(o.limit ?? 25, 1), 100);
  const body = await fetchProvider(KALSHI, `${KALSHI_API}/markets?status=open&limit=${o.query ? 200 : limit}`, { timeoutMs: 10_000 }) as { markets?: unknown };
  const list: unknown[] = Array.isArray(body?.markets) ? body.markets.slice(0, 200) : [];
  let markets = list.map(normaliseKalshiMarket).filter((x): x is PmMarket => !!x);
  if (o.query) { const q = o.query.toLowerCase(); markets = markets.filter((m) => m.question.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)); }
  return markets.slice(0, limit);
}
/**
 * Kalshi publishes resting BIDS for YES and for NO. A NO bid at p is a YES ask at 1 − p, so the YES book is
 * bids = YES bids, asks = mirrored NO bids. Accepts `orderbook_fp.{yes,no}_dollars` ([["0.45","10"]]) or the older
 * `orderbook.{yes,no}` ([[45, 10]] in cents).
 */
export function normaliseKalshiBook(raw: unknown): Book {
  const root = (raw ?? {}) as Record<string, unknown>;
  const fp = root.orderbook_fp as Record<string, unknown> | undefined; const ob = root.orderbook as Record<string, unknown> | undefined;
  // Kalshi lists bids in ascending price order. Keep the highest 200 on each side before mirroring the NO bids.
  const levels = (v: unknown): unknown[] => (Array.isArray(v) ? v.slice(-200) : []);
  const pairs = (v: unknown, cents: boolean): Level[] => levels(v).map((p) => {
    const [a, b] = Array.isArray(p) ? p : [];
    const price = num(a); return { price: price === null ? NaN : cents ? price / 100 : price, size: num(b) ?? NaN };
  });
  const yes = fp ? pairs(fp.yes_dollars, false) : pairs(ob?.yes, true);
  const no = fp ? pairs(fp.no_dollars, false) : pairs(ob?.no, true);
  return normaliseBook({ bids: yes, asks: no.map((l) => ({ price: 1 - l.price, size: l.size })), tick: 0.01 });
}
export async function kalshiBook(ticker: string): Promise<Book> {
  if (!KALSHI_TICKER_RE.test(ticker)) throw new PredictionInputError('Kalshi ticker is invalid');
  return normaliseKalshiBook(await fetchProvider(KALSHI, `${KALSHI_API}/markets/${encodeURIComponent(ticker)}/orderbook`, { timeoutMs: 8_000 }));
}
