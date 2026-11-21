/**
 * GoPlus token-risk evidence, never a "safe to trade" approval.
 * Solana endpoint is beta and may return partial/unknown fields; incomplete
 * data must NOT confer automation eligibility.
 */
import { fetchProvider, registerProvider, setRateLimit, ProviderError } from './http.js';
import { validSolanaMint } from './helius.js';

registerProvider({
  id: 'goplus', name: 'GoPlus Security (Solana risk evidence)',
  sourceClass: 'onchain', markets: ['solana'],
  license: 'GoPlus API terms; risk checks are incomplete and cannot guarantee token safety.',
  realtime: 'NEAR_REALTIME', requiresCredentials: false,
  note: 'Beta Solana token-security evidence. UNKNOWN and partial are ineligible for automation.',
});
setRateLimit('goplus', 20);

export interface GoPlusRiskEvidence {
  source: 'goplus';
  mint: string;
  environment: 'READ_ONLY';
  status: 'RISK_FLAGS' | 'NO_KNOWN_FLAGS' | 'UNKNOWN';
  flags: readonly string[];
  receivedAt: number;
  automationEligible: false;
  /** An empty flags list does not mean the token is safe. */
  notProofOfSafety: true;
}

const DANGER_FIELDS = [
  'is_honeypot', 'is_mintable', 'is_freezable', 'is_blacklisted',
  'is_proxy', 'hidden_owner', 'can_take_back_ownership',
  'transfer_pausable', 'trading_cooldown', 'is_airdrop_scam',
  'is_rugpull', 'is_scam', 'is_locked',
] as const;

/** Prefer false negatives to invented certainty: unusual/absent data => UNKNOWN. */
export async function goPlusSolanaRisk(mint: string): Promise<GoPlusRiskEvidence> {
  if (!validSolanaMint(mint)) throw new ProviderError('goplus', 'INVALID_SOLANA_MINT');
  const apiKey = process.env.GOPLUS_ACCESS_TOKEN?.trim();
  if (apiKey && /[\r\n]/.test(apiKey)) throw new ProviderError('goplus', 'INVALID_ACCESS_TOKEN');
  const headers = apiKey ? { Authorization: 'Bearer ' + apiKey } : {};
  const query = new URLSearchParams({ contract_addresses: mint });
  const data = await fetchProvider('goplus',
    'https://api.gopluslabs.io/api/v1/solana/token_security?' + query,
    { redirectMode: 'error', headers, timeoutMs: 8_000 }) as Record<string, unknown>;
  const result = data.result && typeof data.result === 'object'
    ? data.result as Record<string, unknown> : {};
  const asset = Object.entries(result).find(([key]) => key.toLowerCase() === mint.toLowerCase())?.[1];
  const assessment = asset && typeof asset === 'object'
    ? asset as Record<string, unknown> : {};
  const flagged = DANGER_FIELDS
    .filter(field => field !== 'is_locked' && (assessment[field] === '1' || assessment[field] === 1 || assessment[field] === true))
    .map(field => 'GOPLUS_' + field.toUpperCase());
  // "is_locked" = 0 can signal insufficient liquidity locking, but it is
  // not sufficient alone to diagnose a scam. Record as caution evidence.
  if (assessment.is_locked === '0' || assessment.is_locked === 0)
    flagged.push('GOPLUS_LIQUIDITY_NOT_VERIFIED_LOCKED');
  const known = Object.keys(assessment).length > 0 && String(data.code) === '1';
  return {
    source: 'goplus', mint, environment: 'READ_ONLY',
    status: !known ? 'UNKNOWN' : flagged.length ? 'RISK_FLAGS' : 'NO_KNOWN_FLAGS',
    flags: flagged, receivedAt: Date.now(),
    automationEligible: false, notProofOfSafety: true,
  };
}
