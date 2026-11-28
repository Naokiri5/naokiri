import { fetchProvider, ProviderError, registerProvider, setRateLimit } from './http.js';
import { isSolanaAddress } from './solanaAddress.js';

const SOURCE = 'solana_rpc';
const ENDPOINT = 'https://api.mainnet-beta.solana.com/';
const MAX_RESPONSE_BYTES = 524_288;
export const MAX_FAST_MINTS_PER_PASS = 8;

registerProvider({
  id: SOURCE, name: 'Solana RPC (public finalized mint checks)', sourceClass: 'onchain', markets: ['crypto-dex'],
  license: 'Solana public RPC terms and shared rate limits apply.', realtime: 'NEAR_REALTIME',
  requiresCredentials: false, hosts: ['api.mainnet-beta.solana.com'],
  note: 'Batched finalized mint account observation for FAST research. Public endpoint availability is best effort.',
});
setRateLimit(SOURCE, 12);

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const RESTRICTIVE_EXTENSIONS = new Set(['transferFeeConfig', 'transferHook', 'permanentDelegate', 'nonTransferable',
  'defaultAccountState', 'confidentialTransferMint', 'pausableConfig', 'pausable', 'transferFeeAmount']);

export interface MintObservation {
  mintAddress: string;
  commitment: 'finalized';
  slot: number;
  checkedAt: number;
  status: 'MINT_CHECKS_PASSED' | 'BLOCKED' | 'UNVERIFIED';
  program: 'SPL_TOKEN' | 'TOKEN_2022' | null;
  reasons: string[];
}

const asObject = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

// Authority and Token-2022 checks adapted from the repository's Omega PR #50. Keep the evidence strictly mint-scoped.
function assessMint(mintAddress: string, value: unknown, slot: number, checkedAt: number): MintObservation {
  const base = { mintAddress, commitment: 'finalized' as const, slot, checkedAt };
  const account = asObject(value);
  const program = account?.owner === TOKEN_PROGRAM ? 'SPL_TOKEN' : account?.owner === TOKEN_2022_PROGRAM ? 'TOKEN_2022' : null;
  const result = (status: MintObservation['status'], reasons: string[]): MintObservation => ({ ...base, status, program, reasons });
  if (!account) return result('UNVERIFIED', ['MINT_ACCOUNT_MISSING_OR_INVALID']);
  if (!program || account.executable === true) return result('BLOCKED', ['MINT_ACCOUNT_OWNER_OR_TYPE_UNSAFE']);
  const parsed = asObject(asObject(account.data)?.parsed);
  const info = asObject(parsed?.info);
  const validAuthority = (authority: unknown) => authority === null || isSolanaAddress(authority);
  if (account.executable !== false || parsed?.type !== 'mint' || !info || info.isInitialized !== true ||
      typeof info.decimals !== 'number' || !Number.isInteger(info.decimals) || info.decimals < 0 || info.decimals > 18 ||
      !validAuthority(info.mintAuthority) || !validAuthority(info.freezeAuthority)) {
    return result('UNVERIFIED', ['MINT_ACCOUNT_FIELDS_UNVERIFIED']);
  }
  const blockers: string[] = [];
  if (info.mintAuthority !== null) blockers.push('ACTIVE_MINT_AUTHORITY');
  if (info.freezeAuthority !== null) blockers.push('ACTIVE_FREEZE_AUTHORITY');
  const extensions = info.extensions;
  if (Array.isArray(extensions) && extensions.length <= 32 && extensions.some((entry) => {
    const extension = asObject(entry)?.extension;
    return typeof extension === 'string' && RESTRICTIVE_EXTENSIONS.has(extension);
  })) blockers.push('RESTRICTIVE_TOKEN_EXTENSION');
  if (blockers.length) return result('BLOCKED', blockers);
  if ((program === 'TOKEN_2022' || extensions !== undefined) && (!Array.isArray(extensions) || extensions.length > 0)) {
    return result('UNVERIFIED', ['TOKEN_EXTENSIONS_REQUIRE_REVIEW']);
  }
  return result('MINT_CHECKS_PASSED', []);
}

/** One ordered getMultipleAccounts call. No vendor text, arbitrary methods, signing or wallet state. */
export async function fetchFinalizedMintObservations(addresses: readonly string[]): Promise<MintObservation[]> {
  if (!addresses.length || addresses.length > MAX_FAST_MINTS_PER_PASS || !addresses.every(isSolanaAddress) ||
      new Set(addresses).size !== addresses.length) throw new ProviderError(SOURCE, 'invalid mint batch');
  const checkedAt = Date.now();
  return fetchProvider(SOURCE, ENDPOINT, { timeoutMs: 4_000, jsonRpc: {
    request: { jsonrpc: '2.0', id: 1, method: 'getMultipleAccounts',
      params: [addresses, { encoding: 'jsonParsed', commitment: 'finalized' }] },
    maxResponseBytes: MAX_RESPONSE_BYTES,
    decode(reply) {
      const envelope = asObject(reply);
      const result = asObject(envelope?.result);
      const slot = asObject(result?.context)?.slot;
      const accounts = result?.value;
      if (envelope?.jsonrpc !== '2.0' || envelope.id !== 1 || Object.hasOwn(envelope, 'error') ||
          typeof slot !== 'number' || !Number.isSafeInteger(slot) || slot <= 0 ||
          !Array.isArray(accounts) || accounts.length !== addresses.length) {
        throw new ProviderError(SOURCE, 'invalid finalized mint response');
      }
      return addresses.map((mint, i) => assessMint(mint, accounts[i], slot, checkedAt));
    },
  } });
}
