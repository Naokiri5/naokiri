/**
 * Omega PR-06: read-only on-chain mint checks for the Solana watchlist.
 *
 * In the background, after DEX Screener refreshes, the watchlist's base mints are read in ONE batched
 * `getMultipleAccounts` call and judged by the owner's `assessParsedMint` (mint authority, freeze authority, executable,
 * Token-2022 extensions). Each result keeps the slot it was read at. The watchlist joins these results and they can only
 * make a row stricter: a BLOCK turns a row into REJECT, while a pass adds a note and never upgrades a row. Every row
 * stays `tradingEligible: false`; holder distribution, pool custody and an executable sell route are still unverified.
 */
import { assessParsedMint, type MintAudit } from './mint-audit.js';
import { isTrustedSolanaQuote } from './quotes.js';
import { compareSolanaRows, type SolanaHuntResult } from './hunting.js';
import { getMultipleAccountsParsed, isSolanaAddress, solanaRpcErrorCode, solanaRpcUrl, MAX_ACCOUNTS_PER_CALL } from '../providers/solanaRpc.js';
import { displayText } from '../core/util.js';

/** Re-read a mint at most this often (authorities change rarely; revocation is permanent). */
export const MINT_CHECK_TTL_MS = 10 * 60_000;
/** A pass older than this no longer counts (shown as not checked). A BLOCK always counts: blocking is the safe side. */
export const MINT_CHECK_MAX_AGE_MS = 30 * 60_000;
/** After a failure, wait before asking again; longer when retrying cannot help (blocked, malformed, misconfigured). */
export const RETRY_AFTER_FAILURE_MS = 60_000;
export const RETRY_AFTER_PERSISTENT_FAILURE_MS = 5 * 60_000;
const PERSISTENT = new Set(['HTTP_403', 'RPC_ERROR', 'MALFORMED', 'URL_INVALID', 'TOO_LARGE', 'NOT_CONFIGURED']);
/** Token-2022 defines about 20 extension types; a longer list is not a real mint (and must not bloat every response). */
const MAX_EXTENSIONS = 32;
const MAX_REASONS_SHOWN = 10;

interface CachedCheck { audit: MintAudit; slot: number; checkedAt: number }
const cache = new Map<string, CachedCheck>();
let lastRunAt: number | null = null;
let lastError: string | null = null;
let inFlight = false;
let nextAttemptAt = 0;

/** Minimal pair shape needed here (DexPair satisfies it); kept local so this module never imports market state. */
export interface MintCheckPair { chainId: unknown; baseAddress: unknown; quoteAddress?: unknown }

/** The base mints the watchlist can show: Solana, trusted quote, well-formed address; first 100, deduplicated. */
export function watchlistMints(pairs: readonly MintCheckPair[]): string[] {
  const out = new Set<string>();
  for (const p of pairs) {
    if (typeof p.chainId !== 'string' || p.chainId.toLowerCase() !== 'solana' || !isTrustedSolanaQuote(p.quoteAddress)) continue;
    if (isSolanaAddress(p.baseAddress)) out.add(p.baseAddress);
    if (out.size >= MAX_ACCOUNTS_PER_CALL) break;
  }
  return [...out];
}

const isConfigured = () => { try { return solanaRpcUrl() !== null; } catch { return true; } }; // a bad URL is reported, not hidden

/**
 * Background refresh. Never throws; one request at a time; only mints that are new or older than the TTL are read.
 * Mints that left the DEX sample are dropped from the cache.
 */
export async function refreshMintChecks(pairs: readonly MintCheckPair[], nowMs = Date.now()): Promise<void> {
  if (inFlight || nowMs < nextAttemptAt || !isConfigured()) return;
  inFlight = true; // set before any work, so nothing below can run twice or throw outside the try
  let attempted = false;
  try {
    const wanted = watchlistMints(pairs);
    const keep = new Set(wanted);
    for (const m of cache.keys()) if (!keep.has(m)) cache.delete(m);
    const due = wanted.filter((m) => { const c = cache.get(m); return !c || nowMs - c.checkedAt >= MINT_CHECK_TTL_MS || c.checkedAt > nowMs; });
    if (!due.length) return;
    attempted = true;
    const { slot, accounts } = await getMultipleAccountsParsed(due);
    due.forEach((mint, i) => cache.set(mint, { audit: auditAccount(mint, accounts[i]), slot, checkedAt: nowMs }));
    lastError = null;
    nextAttemptAt = 0;
  } catch (e) {
    lastError = solanaRpcErrorCode(e);
    lastRunAt = nowMs;
    nextAttemptAt = nowMs + (PERSISTENT.has(lastError) ? RETRY_AFTER_PERSISTENT_FAILURE_MS : RETRY_AFTER_FAILURE_MS);
  } finally {
    if (attempted) lastRunAt = nowMs;
    inFlight = false;
  }
}

/** The owner's parser, behind two guards: an absurd extension list and any parser exception become UNKNOWN. */
function auditAccount(mint: string, account: unknown): MintAudit {
  const unknown = (reason: string): MintAudit => ({ mint, status: 'UNKNOWN', tokenProgram: 'UNKNOWN', mintAuthority: null, freezeAuthority: null, extensions: [], reasons: [reason], tradingEligible: false });
  const ext = (account as { data?: { parsed?: { info?: { extensions?: unknown } } } } | null)?.data?.parsed?.info?.extensions;
  if (Array.isArray(ext) && ext.length > MAX_EXTENSIONS) return unknown('EXTENSION_LIST_TOO_LONG');
  try { return assessParsedMint(mint, account); } catch { return unknown('UNPARSEABLE_ACCOUNT'); }
}

export type MintCheckStatus = MintAudit['status'] | 'NOT_CHECKED';
export interface MintCheckView {
  status: MintCheckStatus;
  reasons: string[];
  tokenProgram: MintAudit['tokenProgram'];
  slot: number | null;
  checkedAt: number | null;
}

/** The check to show for one mint at `nowMs`. A stale or future-dated pass is NOT_CHECKED; a BLOCK always stands. */
export function mintCheckFor(mint: string, nowMs = Date.now()): MintCheckView {
  const c = cache.get(mint);
  if (!c) return { status: 'NOT_CHECKED', reasons: [], tokenProgram: 'UNKNOWN', slot: null, checkedAt: null };
  const age = nowMs - c.checkedAt;
  const current = age >= 0 && age <= MINT_CHECK_MAX_AGE_MS;
  if (c.audit.status !== 'BLOCK' && !current) return { status: 'NOT_CHECKED', reasons: ['STALE_CHECK'], tokenProgram: c.audit.tokenProgram, slot: c.slot, checkedAt: c.checkedAt };
  // Extension names come from the RPC node's parsed reply: display-safe text only, deduplicated and capped.
  const unique = [...new Set(c.audit.reasons.map((x) => displayText(x, '?', 80)))];
  const reasons = unique.length > MAX_REASONS_SHOWN ? [...unique.slice(0, MAX_REASONS_SHOWN), `+${unique.length - MAX_REASONS_SHOWN} more`] : unique;
  return { status: c.audit.status, reasons, tokenProgram: c.audit.tokenProgram, slot: c.slot, checkedAt: c.checkedAt };
}

/**
 * Join mint checks into ranked rows. Stricter only:
 * - BLOCK: the BLOCK reasons become blockers and the row becomes REJECT;
 * - UNKNOWN (missing account, unparseable mint, unreviewed Token-2022 extension...): fail closed, a WATCH row becomes
 *   INSUFFICIENT_DATA with blocker MINT_CHECK_INCONCLUSIVE;
 * - a pass adds a note; NOT_CHECKED (no RPC, failed or stale check) leaves the ranker's status unchanged.
 * Rows are re-sorted with the ranker's own comparator.
 */
export function applyMintChecks(rows: readonly SolanaHuntResult[], nowMs = Date.now()) {
  return rows.map((r) => {
    const mintCheck = mintCheckFor(r.mint, nowMs);
    if (mintCheck.status === 'BLOCK') {
      return { ...r, status: 'REJECT' as const, blockers: [...r.blockers, ...mintCheck.reasons.filter((x) => x.startsWith('BLOCK_'))], mintCheck };
    }
    if (mintCheck.status === 'UNKNOWN') {
      return { ...r, status: r.status === 'WATCH' ? 'INSUFFICIENT_DATA' as const : r.status, blockers: [...r.blockers, 'MINT_CHECK_INCONCLUSIVE'],
        notes: [...r.notes, `On-chain mint check inconclusive: ${mintCheck.reasons.join(', ')}`], mintCheck };
    }
    const notes = mintCheck.status === 'PASS_MINT_CHECKS_ONLY'
      ? [...r.notes, `Mint and freeze authority revoked on-chain (slot ${mintCheck.slot}); holders, pool custody and sell route still not verified`]
      : r.notes;
    return { ...r, notes, mintCheck };
  }).sort(compareSolanaRows);
}

/** Block-level status for the UI. Never contains the RPC URL. */
export function mintCheckSummary() {
  return { configured: isConfigured(), lastRunAt, lastError, checked: cache.size };
}

/** Tests only. */
export function _resetMintChecks() { cache.clear(); lastRunAt = null; lastError = null; inFlight = false; nextAttemptAt = 0; }
