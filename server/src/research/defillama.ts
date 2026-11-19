/**
 * DefiLlama yield and TVL intelligence (public, keyless, READ-ONLY research).
 *
 * Endpoints (official free API, api-docs.defillama.com): `yields.llama.fi/pools` (every tracked pool) and
 * `api.llama.fi/protocols`, `api.llama.fi/tvl/{slug}`. Responses are untrusted third-party data: every number is
 * validated, names are treated as untrusted text, and every result is labelled RESEARCH_ONLY / tradeEligible:false.
 * A yield is never a trade signal and never reaches the scanner, QCI, decision engine, risk gate or OMS. Advertised
 * APY is not a forecast: outliers, reward-token dependence and impermanent-loss exposure are flagged, not hidden.
 */
import { fetchProvider, registerProvider, setRateLimit } from '../providers/http.js';

export const YIELDS = 'defillama-yields';
export const LLAMA_API = 'defillama-api';
registerProvider({ id: YIELDS, name: 'DefiLlama Yields', sourceClass: 'aggregator', markets: ['defi-yield'], license: 'DefiLlama free API; attribution to DefiLlama.', realtime: 'DELAYED', requiresCredentials: false, note: 'Read-only yield research. Never a trade signal.' });
registerProvider({ id: LLAMA_API, name: 'DefiLlama TVL', sourceClass: 'aggregator', markets: ['defi-tvl'], license: 'DefiLlama free API; attribution to DefiLlama.', realtime: 'DELAYED', requiresCredentials: false, note: 'Read-only protocol TVL research.' });
setRateLimit(YIELDS, 20); setRateLimit(LLAMA_API, 30);

export class DefiResearchError extends Error { statusCode = 400; }
const CACHE_MS = 10 * 60_000;

export interface YieldPool {
  pool: string; chain: string; project: string; symbol: string; tvlUsd: number; apy: number | null; apyBase: number | null; apyReward: number | null;
  stablecoin: boolean; ilRisk: string | null; exposure: string | null; flags: string[];
}
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown, max = 80) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Validate and normalise one untrusted pool row; returns null when required fields are missing or invalid. */
export function normalisePool(r: unknown): YieldPool | null {
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  const tvlUsd = num(o.tvlUsd); const pool = str(o.pool, 100);
  if (tvlUsd === null || tvlUsd < 0 || !pool) return null;
  const apy = num(o.apy); const apyBase = num(o.apyBase); const apyReward = num(o.apyReward);
  const flags: string[] = [];
  if (apy !== null && apy > 100) flags.push('APY_OUTLIER');
  if (apy !== null && apy > 0 && apyReward !== null && apyReward / apy > 0.5) flags.push('REWARD_DEPENDENT');
  if (tvlUsd < 1_000_000) flags.push('LOW_TVL');
  if (o.ilRisk === 'yes') flags.push('IMPERMANENT_LOSS');
  if (apy === null) flags.push('APY_MISSING');
  return { pool, chain: str(o.chain, 40), project: str(o.project, 60), symbol: str(o.symbol, 80), tvlUsd, apy, apyBase, apyReward,
    stablecoin: o.stablecoin === true, ilRisk: typeof o.ilRisk === 'string' ? str(o.ilRisk, 10) : null, exposure: typeof o.exposure === 'string' ? str(o.exposure, 20) : null, flags };
}

let poolsCache: { at: number; pools: YieldPool[]; dropped: number } | null = null;
let poolsInFlight: Promise<{ at: number; pools: YieldPool[]; dropped: number }> | null = null;
export function _resetDefiCacheForTests() { poolsCache = null; poolsInFlight = null; protocolsCache = null; }

async function allPools() {
  if (poolsCache && Date.now() - poolsCache.at < CACHE_MS) return poolsCache;
  poolsInFlight ??= (async () => {
    try {
      const body = await fetchProvider(YIELDS, 'https://yields.llama.fi/pools', { timeoutMs: 30_000, redirectMode: 'error' });
      const rows = body && typeof body === 'object' && Array.isArray((body as any).data) ? (body as any).data as unknown[] : null;
      if (!rows) throw new DefiResearchError('unexpected DefiLlama yields response shape');
      const pools = rows.map(normalisePool).filter((p): p is YieldPool => p !== null);
      poolsCache = { at: Date.now(), pools, dropped: rows.length - pools.length };
      return poolsCache;
    } finally { poolsInFlight = null; }
  })();
  return poolsInFlight;
}

export interface YieldQuery { chain?: string; project?: string; stablecoin?: boolean; minTvlUsd?: number; sort?: 'apy' | 'tvlUsd'; limit?: number; excludeFlagged?: boolean }
export async function yieldPools(q: YieldQuery = {}) {
  const { at, pools, dropped } = await allPools();
  const chain = q.chain?.toLowerCase(); const project = q.project?.toLowerCase();
  const minTvl = q.minTvlUsd ?? 1_000_000;
  let rows = pools.filter((p) => p.tvlUsd >= minTvl && (!chain || p.chain.toLowerCase() === chain) && (!project || p.project.toLowerCase() === project)
    && (q.stablecoin === undefined || p.stablecoin === q.stablecoin) && (!q.excludeFlagged || p.flags.length === 0));
  const key = q.sort ?? 'tvlUsd';
  rows = rows.sort((a, b) => ((b[key] ?? -Infinity) as number) - ((a[key] ?? -Infinity) as number)).slice(0, Math.min(Math.max(q.limit ?? 25, 1), 100));
  return { source: 'defillama', fetchedAt: at, kind: 'RESEARCH_ONLY' as const, tradeEligible: false as const, freshness: 'DELAYED' as const,
    note: 'Advertised APY is backward-looking and can change or vanish; reward tokens can fall in price. Not a forecast or a trade signal.',
    universe: pools.length, droppedInvalidRows: dropped, data: rows };
}

let protocolsCache: { at: number; rows: { name: string; slug: string; category: string; chains: string[]; tvl: number; change1d: number | null }[] } | null = null;
/** Top DeFi protocols by TVL. Centralised exchanges (DefiLlama category 'CEX') are excluded unless requested by category. */
export async function topProtocols(limit = 25, category?: string) {
  if (!protocolsCache || Date.now() - protocolsCache.at > CACHE_MS) {
    const body = await fetchProvider(LLAMA_API, 'https://api.llama.fi/protocols', { timeoutMs: 30_000, redirectMode: 'error' });
    if (!Array.isArray(body)) throw new DefiResearchError('unexpected DefiLlama protocols response shape');
    const rows = (body as unknown[]).flatMap((r) => {
      const o = (r ?? {}) as Record<string, unknown>; const tvl = num(o.tvl); const slug = str(o.slug, 80);
      if (tvl === null || !slug) return [];
      return [{ name: str(o.name), slug, category: str(o.category, 40), chains: Array.isArray(o.chains) ? o.chains.slice(0, 8).map((c) => str(c, 30)) : [], tvl, change1d: num(o.change_1d) }];
    });
    protocolsCache = { at: Date.now(), rows };
  }
  const cat = category?.toLowerCase();
  const rows = protocolsCache.rows.filter((r) => (cat ? r.category.toLowerCase() === cat : r.category.toLowerCase() !== 'cex')).sort((a, b) => b.tvl - a.tvl).slice(0, Math.min(Math.max(limit, 1), 100));
  return { source: 'defillama', fetchedAt: protocolsCache.at, kind: 'RESEARCH_ONLY' as const, tradeEligible: false as const, data: rows };
}

export async function protocolTvl(slug: string) {
  if (!/^[a-z0-9][a-z0-9.-]{0,79}$/.test(slug)) throw new DefiResearchError('invalid protocol slug');
  const v = await fetchProvider(LLAMA_API, `https://api.llama.fi/tvl/${slug}`, { timeoutMs: 15_000, redirectMode: 'error' });
  const tvl = num(v);
  if (tvl === null) throw new DefiResearchError('unexpected DefiLlama TVL response');
  return { source: 'defillama', fetchedAt: Date.now(), kind: 'RESEARCH_ONLY' as const, tradeEligible: false as const, data: { slug, tvlUsd: tvl } };
}
