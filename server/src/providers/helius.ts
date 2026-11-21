/**
 * Helius Solana DAS read-only metadata.
 * Only getAsset is permitted. Never use Helius transaction submission,
 * wallet signing or account mutation from this provider.
 *
 * Fixed Helius RPC host; API key is used only on the backend and never
 * returned in any API payload. The shared provider HTTP client owns rate
 * limits, health and latency. No testnet/live account is created.
 */
import { fetchProvider, registerProvider, setRateLimit, ProviderError } from './http.js';

registerProvider({
  id: 'helius', name: 'Helius Solana DAS (read-only)',
  sourceClass: 'onchain', markets: ['solana'],
  license: 'Helius API license and rate limits; Solana RPC is not proof of token safety.',
  realtime: 'NEAR_REALTIME', requiresCredentials: true,
  status: 'PENDING_CREDENTIALS',
  note: 'Read-only getAsset metadata; wallets, transactions and signing unavailable.',
});
setRateLimit('helius', 30);

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const RPC_HOST = 'https://mainnet.helius-rpc.com/';

export function validSolanaMint(mint: string): boolean {
  return typeof mint === 'string' && MINT.test(mint);
}
export function heliusConfigured() { return Boolean(process.env.HELIUS_API_KEY?.trim()); }

export interface SolanaAssetMetadata {
  mint: string;
  source: 'helius';
  environment: 'READ_ONLY';
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  automationEligible: false;
  /** Helius metadata is not itself a honeypot or mint-authority audit. */
  safetyStatus: 'UNASSESSED';
}

export async function heliusAsset(mint: string): Promise<SolanaAssetMetadata> {
  if (!validSolanaMint(mint)) throw new ProviderError('helius', 'INVALID_SOLANA_MINT');
  const apiKey = process.env.HELIUS_API_KEY?.trim();
  if (!apiKey || /[\r\n&?#]/.test(apiKey))
    throw new ProviderError('helius', 'HELIUS_API_KEY_NOT_CONFIGURED');
  const response = await fetchProvider('helius', RPC_HOST + '?api-key=' + encodeURIComponent(apiKey), {
    method: 'POST', redirectMode: 'error', timeoutMs: 8_000,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 'mia-helius-get-asset', method: 'getAsset',
      params: { id: mint, options: { showFungible: true } },
    }),
  }) as Record<string, unknown>;
  if (response.error || !response.result || typeof response.result !== 'object')
    throw new ProviderError('helius', 'HELIUS_ASSET_UNAVAILABLE');
  const a = response.result as Record<string, unknown>;
  const content = a.content && typeof a.content === 'object' ? a.content as Record<string, unknown> : {};
  const metadata = content.metadata && typeof content.metadata === 'object'
    ? content.metadata as Record<string, unknown> : {};
  const token = a.token_info && typeof a.token_info === 'object'
    ? a.token_info as Record<string, unknown> : {};
  const authorities = Array.isArray(a.authorities) ? a.authorities : [];
  const m = (x: unknown) => typeof x === 'string' && x.length <= 120 ? x : null;
  const authority = authorities.find(x => x && typeof x === 'object' &&
    typeof (x as Record<string, unknown>).address === 'string') as Record<string, unknown> | undefined;
  const decimals = token.decimals;
  return {
    mint, source: 'helius', environment: 'READ_ONLY',
    name: m(metadata.name), symbol: m(metadata.symbol),
    decimals: typeof decimals === 'number' && Number.isInteger(decimals) &&
      decimals >= 0 && decimals <= 18 ? decimals : null,
    mintAuthority: m(token.mint_authority ?? authority?.address),
    freezeAuthority: m(token.freeze_authority),
    automationEligible: false, safetyStatus: 'UNASSESSED',
  };
}
