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
import type { SolanaHuntResult } from './hunting.js';
import { getMultipleAccountsParsed, solanaRpcErrorCode, solanaRpcUrl, MAX_ACCOUNTS_PER_CALL } from '../providers/solanaRpc.js';
import { displayText } from '../core/util.js';

/** Re-read a mint at most this often (authorities change rarely; revocation is permanent). */
export const MINT_CHECK_TTL_MS = 10 * 60_000;
/** A pass older than this no longer counts (shown as not checked). A BLOCK always counts: blocking is the safe side. */
export const MINT_CHECK_MAX_AGE_MS = 30 * 60_000;
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

interface CachedCheck { audit: MintAudit; slot: number; checkedAt: number }
const cache = new Map<string, CachedCheck>();
let lastRunAt: number | null = null;
let lastError: string | null = null;
let inFlight = false;

/** Minimal pair shape needed here (DexPair satisfies it); kept local so this module never imports market state. */
export interface MintCheckPair { chainId: unknown; baseAddress: unknown; quoteAddress?: unknown }

/** The base mints the watchlist can show: Solana, trusted quote, well-formed address; first 100, deduplicated. */
export function watchlistMints(pairs: readonly MintCheckPair[]): string[] {
  const out = new Set<string>();
  for (const p of pairs) {
    if (typeof p.chainId !== 'string' || p.chainId.toLowerCase() !== 'solana' || !isTrustedSolanaQuote(p.quoteAddress)) continue;
    if (typeof p.baseAddress === 'string' && B58.test(p.baseAddress)) out.add(p.baseAddress);
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
  if (inFlight || !isConfigured()) return;
  const wanted = watchlistMints(pairs);
  const keep = new Set(wanted);
  for (const m of cache.keys()) if (!keep.has(m)) cache.delete(m);
  const due = wanted.filter((m) => { const c = cache.get(m); return !c || nowMs - c.checkedAt >= MINT_CHECK_TTL_MS || c.checkedAt > nowMs; });
  if (!due.length) return;
  inFlight = true;
  try {
    const { slot, accounts } = await getMultipleAccountsParsed(due);
    due.forEach((mint, i) => cache.set(mint, { audit: assessParsedMint(mint, accounts[i]), slot, checkedAt: nowMs }));
    lastError = null;
  } catch (e) {
    lastError = solanaRpcErrorCode(e);
  } finally {
    lastRunAt = nowMs;
    inFlight = false;
  }
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
  // Extension names come from the RPC node's parsed reply: display-safe text only.
  const reasons = c.audit.reasons.map((x) => displayText(x, '?', 80));
  return { status: c.audit.status, reasons, tokenProgram: c.audit.tokenProgram, slot: c.slot, checkedAt: c.checkedAt };
}

const ORDER: Record<SolanaHuntResult['status'], number> = { WATCH: 0, INSUFFICIENT_DATA: 1, REJECT: 2 };

/**
 * Join mint checks into ranked rows. Stricter only: BLOCK reasons become blockers and the row becomes REJECT; anything
 * else leaves the status as the ranker set it. Rows are re-sorted with the ranker's order (status, score, mint).
 */
export function applyMintChecks(rows: readonly SolanaHuntResult[], nowMs = Date.now()) {
  return rows.map((r) => {
    const mintCheck = mintCheckFor(r.mint, nowMs);
    if (mintCheck.status === 'BLOCK') {
      return { ...r, status: 'REJECT' as const, blockers: [...r.blockers, ...mintCheck.reasons.filter((x) => x.startsWith('BLOCK_'))], mintCheck };
    }
    const notes = mintCheck.status === 'PASS_MINT_CHECKS_ONLY'
      ? [...r.notes, `Mint and freeze authority revoked on-chain (slot ${mintCheck.slot}); holders, pool custody and sell route still not verified`]
      : mintCheck.status === 'UNKNOWN' ? [...r.notes, `On-chain mint check inconclusive: ${mintCheck.reasons.join(', ')}`] : r.notes;
    return { ...r, notes, mintCheck };
  }).sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.rankScore - a.rankScore || a.mint.localeCompare(b.mint));
}

/** Block-level status for the UI. Never contains the RPC URL. */
export function mintCheckSummary() {
  return { configured: isConfigured(), lastRunAt, lastError, checked: cache.size };
}

/** Tests only. */
export function _resetMintChecks() { cache.clear(); lastRunAt = null; lastError = null; inFlight = false; }
