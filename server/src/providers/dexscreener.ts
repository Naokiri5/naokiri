import { fetchProvider, registerProvider, setRateLimit } from './http.js';
import { safeHttpUrl } from '../core/util.js';
registerProvider({
  id: 'dexscreener', name: 'DEX Screener (public API)', sourceClass: 'dex', markets: ['crypto-dex'],
  license: 'DEX Screener API Terms — rate-limited public use.', realtime: 'NEAR_REALTIME', requiresCredentials: false,
});
setRateLimit('dexscreener', 50); // documented 60/min for profiles endpoints

export interface DexPair {
  chainId: string; dexId: string; pairAddress: string; url: string; baseSymbol: string; baseName: string; baseAddress: string; quoteSymbol: string;
  priceUsd: number; liquidityUsd: number; fdv: number; marketCap: number; volume24h: number; volume1h: number;
  buys24h: number; sells24h: number; buys1h: number; sells1h: number; change1h: number; change24h: number; pairCreatedAt: number | null;
  hasSocials: boolean; hasWebsite: boolean;
}
function mapPair(p: any): DexPair {
  return {
    chainId: p.chainId, dexId: p.dexId, pairAddress: p.pairAddress, url: safeHttpUrl(p.url), baseSymbol: p.baseToken?.symbol ?? '?', baseName: p.baseToken?.name ?? '?',
    baseAddress: p.baseToken?.address ?? '', quoteSymbol: p.quoteToken?.symbol ?? '?', priceUsd: +(p.priceUsd ?? 0), liquidityUsd: +(p.liquidity?.usd ?? 0),
    fdv: +(p.fdv ?? 0), marketCap: +(p.marketCap ?? 0), volume24h: +(p.volume?.h24 ?? 0), volume1h: +(p.volume?.h1 ?? 0),
    buys24h: +(p.txns?.h24?.buys ?? 0), sells24h: +(p.txns?.h24?.sells ?? 0), buys1h: +(p.txns?.h1?.buys ?? 0), sells1h: +(p.txns?.h1?.sells ?? 0),
    change1h: +(p.priceChange?.h1 ?? 0), change24h: +(p.priceChange?.h24 ?? 0), pairCreatedAt: p.pairCreatedAt ?? null,
    hasSocials: !!p.info?.socials?.length, hasWebsite: !!p.info?.websites?.length,
  };
}
/** Latest token profiles (new/updated listings) → their pairs. */
export async function latestTokenPairs(max = 30): Promise<DexPair[]> {
  const profiles: any[] = await fetchProvider('dexscreener', 'https://api.dexscreener.com/token-profiles/latest/v1');
  const byChain = new Map<string, string[]>();
  for (const p of profiles.slice(0, max)) {
    if (!p.chainId || !p.tokenAddress) continue;
    const a = byChain.get(p.chainId) ?? []; a.push(p.tokenAddress); byChain.set(p.chainId, a);
  }
  const out: DexPair[] = [];
  for (const [chain, addrs] of byChain) {
    for (let i = 0; i < addrs.length; i += 30) {
      const r: any = await fetchProvider('dexscreener', `https://api.dexscreener.com/tokens/v1/${chain}/${addrs.slice(i, i + 30).join(',')}`);
      const pairs: any[] = Array.isArray(r) ? r : r?.pairs ?? [];
      // keep the most liquid pair per token
      const best = new Map<string, any>();
      for (const p of pairs) { const k = p.baseToken?.address; if (!k) continue; if (!best.has(k) || (p.liquidity?.usd ?? 0) > (best.get(k).liquidity?.usd ?? 0)) best.set(k, p); }
      out.push(...[...best.values()].map(mapPair));
    }
  }
  return out;
}
export async function search(q: string): Promise<DexPair[]> {
  const r = await fetchProvider('dexscreener', `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`);
  return (r.pairs ?? []).map(mapPair);
}
