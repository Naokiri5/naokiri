/** Read-only, fail-closed Solana mint parser and optional JSON-RPC inspector. No wallet/signing. */
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
// MIA review (Omega PR-06, found by the live test): the starter's value 'TokenzQdBNbLqP5VEhdkAS6EPF4g7q5gghRXAgn4G5' is not
// a valid 32-byte key (the node answers "WrongSize"), so every Token-2022 mint was blocked as BLOCK_NOT_TOKEN_PROGRAM and
// its extensions were never checked. This is the Token-2022 program id from spl.solana.com, verified on chain (executable).
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export type MintAuditStatus = 'PASS_MINT_CHECKS_ONLY' | 'BLOCK' | 'UNKNOWN';
export interface MintAudit {
  mint: string;
  status: MintAuditStatus;
  tokenProgram: 'SPL_TOKEN' | 'TOKEN_2022' | 'UNKNOWN';
  mintAuthority: string | null;
  freezeAuthority: string | null;
  extensions: string[];
  reasons: string[];
  tradingEligible: false;
}
const report = (mint: string, reasons: string[], program: MintAudit['tokenProgram'] = 'UNKNOWN', mintAuthority: string | null = null, freezeAuthority: string | null = null, extensions: string[] = []): MintAudit =>
  ({ mint, status: reasons.length ? (reasons.some(r => r.startsWith('BLOCK_')) ? 'BLOCK' : 'UNKNOWN') : 'PASS_MINT_CHECKS_ONLY', tokenProgram: program, mintAuthority, freezeAuthority, extensions, reasons, tradingEligible: false });
const dangerExts = new Set(['transferfeeconfig', 'transferhook', 'permanentdelegate', 'nontransferable', 'defaultaccountstate', 'confidentialtransfermint', 'pausableconfig', 'pausable', 'transferfeeamount']);
// Unknown extensions get a review flag: never let an unrecognized extension silently pass.
const reviewedExts = new Set(['metadatapointer', 'tokenmetadata', 'grouppointer', 'tokengrouppointer', 'tokengroup', 'groupmemberpointer', 'tokengroupmember']);
/** This only checks mint-level permissions, not pool safety, holder distribution or sellability. */
export function assessParsedMint(mint: string, account: unknown): MintAudit {
  if (!B58.test(mint)) return report(mint, ['INVALID_ADDRESS_FORMAT']);
  if (!account || typeof account !== 'object') return report(mint, ['MISSING_ACCOUNT']);
  const a = account as Record<string, any>;
  const tokenProgram = a.owner === TOKEN_PROGRAM ? 'SPL_TOKEN' : a.owner === TOKEN_2022_PROGRAM ? 'TOKEN_2022' : 'UNKNOWN';
  if (tokenProgram === 'UNKNOWN') return report(mint, ['BLOCK_NOT_TOKEN_PROGRAM']);
  const parsed = a.data?.parsed;
  if (!parsed || parsed.type !== 'mint' || !parsed.info || typeof parsed.info !== 'object') return report(mint, ['UNPARSEABLE_MINT'], tokenProgram);
  const info = parsed.info;
  if (!('mintAuthority' in info) || !('freezeAuthority' in info) || !Number.isInteger(info.decimals) || info.decimals < 0 || info.decimals > 18) return report(mint, ['MISSING_OR_INVALID_MINT_FIELDS'], tokenProgram);
  const authority = (x: unknown): x is string | null => x === null || (typeof x === 'string' && B58.test(x));
  if (!authority(info.mintAuthority) || !authority(info.freezeAuthority)) return report(mint, ['MALFORMED_AUTHORITY'], tokenProgram);
  const reasons: string[] = [];
  if (info.mintAuthority !== null) reasons.push('BLOCK_ACTIVE_MINT_AUTHORITY');
  if (info.freezeAuthority !== null) reasons.push('BLOCK_ACTIVE_FREEZE_AUTHORITY');
  if (a.executable) reasons.push('BLOCK_EXECUTABLE_ACCOUNT');
  if (tokenProgram === 'TOKEN_2022') {
    if (!Array.isArray(info.extensions)) reasons.push('EXTENSION_COVERAGE_UNVERIFIED');
  }
  const extensions: string[] = [];
  if (Array.isArray(info.extensions)) {
    for (const entry of info.extensions) {
      const typ = typeof entry?.extension === 'string' ? entry.extension : typeof entry?.type === 'string' ? entry.type : null;
      if (!typ) { reasons.push('UNPARSEABLE_EXTENSION'); continue; }
      extensions.push(typ);
      const key = typ.toLowerCase().replace(/[^a-z]/g, '');
      if (dangerExts.has(key)) reasons.push('BLOCK_RISKY_EXTENSION_' + typ);
      else if (!reviewedExts.has(key)) reasons.push('UNKNOWN_EXTENSION_' + typ);
      else reasons.push('REVIEW_EXTENSION_AUTHORITY_' + typ); // metadata/group authorities may still be mutable
    }
  }
  return report(mint, reasons, tokenProgram, info.mintAuthority, info.freezeAuthority, extensions);
}

/** Injection-friendly RPC transport; URL must be server-configured and must never come from token metadata. */
export async function inspectSolanaMint(mint: string, rpcUrl: string, fetchImpl: typeof fetch = fetch): Promise<MintAudit> {
  if (!B58.test(mint)) return report(mint, ['INVALID_ADDRESS_FORMAT']);
  let url: URL;
  try { url = new URL(rpcUrl); } catch { return report(mint, ['RPC_NOT_CONFIGURED']); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) return report(mint, ['RPC_URL_INVALID']);
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), 4000);
  try {
    const response = await fetchImpl(url.toString(), { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [mint, { encoding: 'jsonParsed', commitment: 'confirmed' }] }), signal: ctl.signal, redirect: 'error' });
    if (!response.ok) return report(mint, ['RPC_HTTP_' + response.status]);
    const body = await response.json() as any;
    if (body?.error || !body?.result || !('value' in body.result)) return report(mint, ['RPC_INVALID_RESPONSE']);
    return assessParsedMint(mint, body.result.value);
  } catch { return report(mint, ['RPC_UNAVAILABLE']); }
  finally { clearTimeout(timeout); }
}
