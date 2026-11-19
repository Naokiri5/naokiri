/**
 * Read-only Solana JSON-RPC (Omega PR-06).
 *
 * The only method this module can send is `getMultipleAccounts` (jsonParsed, `confirmed` commitment): there is no
 * transaction builder, no signer, no `sendTransaction` and no wallet. The endpoint comes only from the server setting
 * MIA_SOLANA_RPC_URL (https). A provider URL may embed an API key, so the URL is never logged, returned or shown.
 * Without the setting, nothing is requested and the provider stays PENDING_CREDENTIALS.
 *
 * The owner's choice is the public `https://api.mainnet.solana.com`: rate-limited (about 100 requests per 10 s per IP,
 * 40 per 10 s per method), no uptime guarantee, not meant for production. MIA sends one batched request per refresh.
 */
import { fetchProvider, registerProvider, setRateLimit, ProviderError } from './http.js';

export const SOLANA_RPC = 'solana_rpc';
/** Solana's documented ceiling for one getMultipleAccounts call. */
export const MAX_ACCOUNTS_PER_CALL = 100;
/** jsonParsed mints are small (Token-2022 metadata included); 2 MB for 100 accounts is a generous ceiling. */
export const MAX_RPC_RESPONSE_BYTES = 2_000_000;
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const configuredAtStart = !!process.env.MIA_SOLANA_RPC_URL?.trim();
registerProvider({
  id: SOLANA_RPC, name: 'Solana RPC (read-only mint and freeze authority checks)', sourceClass: 'onchain', markets: ['crypto-dex'],
  license: 'Terms of the configured endpoint. The public api.mainnet.solana.com is rate-limited and not for production.',
  realtime: 'NEAR_REALTIME', requiresCredentials: false, status: configuredAtStart ? 'IDLE' : 'PENDING_CREDENTIALS',
  note: configuredAtStart ? 'Read-only getMultipleAccounts for Solana watchlist mint checks. No transactions, no signer.'
    : 'Set MIA_SOLANA_RPC_URL (https) on the server to enable read-only Solana mint checks.',
});
setRateLimit(SOLANA_RPC, 30); // far below the public limits; MIA needs about one call per DEX refresh

/** Why the RPC could not be used, as a short code that is safe to show (never the URL). */
export type SolanaRpcErrorCode = 'NOT_CONFIGURED' | 'URL_INVALID' | 'HTTP' | 'TOO_LARGE' | 'RPC_ERROR' | 'MALFORMED' | 'UNAVAILABLE';
export class SolanaRpcError extends ProviderError {
  constructor(public code: SolanaRpcErrorCode, msg: string, status?: number) { super(SOLANA_RPC, msg, status); }
}

/** The configured endpoint, or null when unset. Throws on an unusable value (fail closed, never a guess). */
export function solanaRpcUrl(): string | null {
  const v = process.env.MIA_SOLANA_RPC_URL?.trim();
  if (!v) return null;
  let u: URL;
  try { u = new URL(v); } catch { throw new SolanaRpcError('URL_INVALID', 'MIA_SOLANA_RPC_URL is not a valid URL'); }
  if (u.protocol !== 'https:') throw new SolanaRpcError('URL_INVALID', 'MIA_SOLANA_RPC_URL must use https');
  if (u.username || u.password || u.hash) throw new SolanaRpcError('URL_INVALID', 'MIA_SOLANA_RPC_URL must not contain credentials or a fragment');
  return u.href;
}

export interface AccountsAtSlot { slot: number; accounts: unknown[] }

/** Validate a getMultipleAccounts reply: one entry per requested address and the slot it was read at. */
export function decodeMultipleAccounts(raw: unknown, expected: number): AccountsAtSlot {
  const r = raw as { error?: { code?: unknown }; result?: { context?: { slot?: unknown }; value?: unknown } } | null;
  if (r && typeof r === 'object' && r.error) {
    const code = typeof r.error.code === 'number' && Number.isInteger(r.error.code) ? r.error.code : 'unknown';
    throw new SolanaRpcError('RPC_ERROR', `RPC error ${code}`); // the node's message text is not echoed
  }
  const slot = r?.result?.context?.slot;
  const value = r?.result?.value;
  if (typeof slot !== 'number' || !Number.isSafeInteger(slot) || slot < 0 || !Array.isArray(value) || value.length !== expected) {
    throw new SolanaRpcError('MALFORMED', 'malformed getMultipleAccounts response');
  }
  return { slot, accounts: value };
}

/**
 * Read up to 100 accounts in one request. Order is preserved: `accounts[i]` belongs to `addresses[i]` (null when the
 * account does not exist). Redirects are refused so a keyed URL is never replayed to another host.
 */
export async function getMultipleAccountsParsed(addresses: readonly string[]): Promise<AccountsAtSlot> {
  if (!addresses.length || addresses.length > MAX_ACCOUNTS_PER_CALL || !addresses.every((a) => B58.test(a))) {
    throw new SolanaRpcError('MALFORMED', 'getMultipleAccounts needs 1 to 100 base58 addresses');
  }
  const url = solanaRpcUrl();
  if (!url) throw new SolanaRpcError('NOT_CONFIGURED', 'MIA_SOLANA_RPC_URL is not set');
  return fetchProvider(SOLANA_RPC, url, {
    timeoutMs: 10_000, redirectMode: 'error', maxBytes: MAX_RPC_RESPONSE_BYTES,
    jsonBody: { jsonrpc: '2.0', id: 1, method: 'getMultipleAccounts', params: [addresses, { encoding: 'jsonParsed', commitment: 'confirmed' }] },
    decode: (raw) => decodeMultipleAccounts(raw, addresses.length),
  });
}

/** Map any failure to a short, display-safe code. */
export function solanaRpcErrorCode(e: unknown): SolanaRpcErrorCode | `HTTP_${number}` {
  if (e instanceof SolanaRpcError) return e.code;
  if (e instanceof ProviderError) {
    if (typeof e.status === 'number') return `HTTP_${e.status}`;
    if (/exceeds \d+ bytes/.test(e.message)) return 'TOO_LARGE';
  }
  return 'UNAVAILABLE';
}
