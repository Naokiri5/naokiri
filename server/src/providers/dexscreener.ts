import { fetchProvider, registerProvider, setRateLimit } from './http.js';
import { isKnownSolanaQuote, isSolanaAddress } from './solanaAddress.js';
registerProvider({
  hosts: ['api.dexscreener.com'],
  id: 'dexscreener', name: 'DEX Screener (public API)', sourceClass: 'dex', markets: ['crypto-dex'],
  license: 'DEX Screener API Terms — rate-limited public use.', realtime: 'NEAR_REALTIME', requiresCredentials: false,
});
setRateLimit('dexscreener', 50); // documented 60/min for profiles endpoints

export interface DexPair {
  chainId: string; dexId: string; pairAddress: string; url: string; baseSymbol: string; baseName: string; baseAddress: string; quoteSymbol: string;
  /** Provider-reported quote address, present only when its shape is valid for the chain. */
  quoteAddress?: string;
  priceUsd: number; liquidityUsd: number; fdv: number; marketCap: number; volume24h: number; volume1h: number;
  buys24h: number; sells24h: number; buys1h: number; sells1h: number; change1h: number; change24h: number; pairCreatedAt: number | null;
  hasSocials: boolean; hasWebsite: boolean;
}
const CHAIN_ID = /^[a-z0-9-]{1,32}$/;
const ADDRESS_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;
const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const isChainId = (value: unknown): value is string => typeof value === 'string' && CHAIN_ID.test(value);
const isAddress = (chain: string, value: unknown): value is string => chain === 'solana'
  ? isSolanaAddress(value) : typeof value === 'string' && ADDRESS_SEGMENT.test(value);
const addressKey = (address: string) => EVM_ADDRESS.test(address) ? address.toLowerCase() : address;

interface RawToken { address?: unknown; symbol?: string; name?: string }
interface RawPair {
  chainId?: unknown; dexId?: string; pairAddress?: unknown; url?: string;
  baseToken?: RawToken; quoteToken?: RawToken;
  priceUsd?: unknown; liquidity?: { usd?: unknown }; fdv?: unknown; marketCap?: unknown;
  volume?: { h24?: unknown; h1?: unknown }; priceChange?: { h24?: unknown; h1?: unknown };
  txns?: { h24?: { buys?: unknown; sells?: unknown }; h1?: { buys?: unknown; sells?: unknown } };
  pairCreatedAt?: number; info?: { socials?: unknown[]; websites?: unknown[] };
}
const metric = (value: unknown) => Number(value ?? 0);

function preferPair(pair: DexPair, previous: DexPair | undefined): boolean {
  if (!previous) return true;
  if (pair.chainId === 'solana') {
    const known = isKnownSolanaQuote(pair.quoteAddress);
    if (known !== isKnownSolanaQuote(previous.quoteAddress)) return known;
  }
  return pair.liquidityUsd > previous.liquidityUsd;
}

function mapPair(raw: unknown): DexPair | null {
  const p = raw as RawPair | null;
  if (!p || !isChainId(p.chainId) || !isAddress(p.chainId, p.pairAddress) || !isAddress(p.chainId, p.baseToken?.address)) return null;
  const quoteAddress = p.quoteToken?.address;
  return {
    chainId: p.chainId, dexId: p.dexId ?? '', pairAddress: p.pairAddress, url: p.url ?? '', baseSymbol: p.baseToken.symbol ?? '?', baseName: p.baseToken.name ?? '?',
    baseAddress: p.baseToken.address, quoteSymbol: p.quoteToken?.symbol ?? '?',
    ...(isAddress(p.chainId, quoteAddress) ? { quoteAddress } : {}),
    priceUsd: metric(p.priceUsd), liquidityUsd: metric(p.liquidity?.usd),
    fdv: metric(p.fdv), marketCap: metric(p.marketCap), volume24h: metric(p.volume?.h24), volume1h: metric(p.volume?.h1),
    buys24h: metric(p.txns?.h24?.buys), sells24h: metric(p.txns?.h24?.sells), buys1h: metric(p.txns?.h1?.buys), sells1h: metric(p.txns?.h1?.sells),
    change1h: metric(p.priceChange?.h1), change24h: metric(p.priceChange?.h24), pairCreatedAt: p.pairCreatedAt ?? null,
    hasSocials: !!p.info?.socials?.length, hasWebsite: !!p.info?.websites?.length,
  };
}

function pairRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  const pairs = (raw as { pairs?: unknown } | null)?.pairs;
  return Array.isArray(pairs) ? pairs : [];
}

/** Latest token profiles (new/updated listings) → their pairs. */
export async function latestTokenPairs(max = 30): Promise<DexPair[]> {
  const profiles: unknown = await fetchProvider('dexscreener', 'https://api.dexscreener.com/token-profiles/latest/v1');
  if (!Array.isArray(profiles)) throw new Error('INVALID_DEX_PROFILE_RESPONSE');
  const byChain = new Map<string, Map<string, string>>();
  for (const raw of profiles.slice(0, max)) {
    const profile = raw as { chainId?: unknown; tokenAddress?: unknown } | null;
    if (!isChainId(profile?.chainId) || !isAddress(profile.chainId, profile.tokenAddress)) continue;
    const addresses = byChain.get(profile.chainId) ?? new Map<string, string>();
    addresses.set(addressKey(profile.tokenAddress), profile.tokenAddress);
    byChain.set(profile.chainId, addresses);
  }
  const out: DexPair[] = [];
  for (const [chain, addresses] of byChain) {
    const tokens = [...addresses.entries()];
    for (let i = 0; i < tokens.length; i += 30) {
      const batch = tokens.slice(i, i + 30);
      const requested = new Set(batch.map(([key]) => key));
      const path = batch.map(([, address]) => encodeURIComponent(address)).join(',');
      const raw = await fetchProvider('dexscreener', `https://api.dexscreener.com/tokens/v1/${chain}/${path}`);
      const best = new Map<string, DexPair>();
      for (const row of pairRows(raw)) {
        const pair = mapPair(row);
        if (!pair || pair.chainId !== chain) continue;
        const key = addressKey(pair.baseAddress);
        if (!requested.has(key)) continue;
        const previous = best.get(key);
        if (preferPair(pair, previous)) best.set(key, pair);
      }
      out.push(...best.values());
    }
  }
  return out;
}
export async function search(q: string): Promise<DexPair[]> {
  const r = await fetchProvider('dexscreener', `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`);
  return pairRows(r).map(mapPair).filter(pair => pair !== null);
}
