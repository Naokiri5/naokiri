import { all, get, run, tx } from '../db/db.js';
import type { VerifiedWalletSwap } from './winEvidence.js';
import { makeWalletObservationKey, parseAtomicQuantity } from './winEvidence.js';

/**
 * WIN-01: one owner-selected Solana wallet per account, READ_ONLY only.
 * This repository has no authenticated Solana wallet transaction feed or
 * Solana paper fills on main. This registry cannot initiate orders.
 */
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface FollowRow {
  account: string;
  wallet_address: string;
  execution_mode: 'READ_ONLY';
  active: number;
  created_at: number;
  updated_at: number;
}
export interface WhaleFollow {
  accountId: string;
  walletAddress: string;
  executionMode: 'READ_ONLY';
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export function validSolanaWallet(value: unknown): value is string {
  return typeof value === 'string' && SOLANA_ADDRESS.test(value);
}
function validatedAccount(account: string) {
  if (typeof account !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(account)) throw new Error('INVALID_ACCOUNT_SCOPE');
  return account;
}
function rowToFollow(r: FollowRow): WhaleFollow {
  return { accountId: r.account, walletAddress: r.wallet_address, executionMode: 'READ_ONLY',
    active: r.active === 1, createdAt: r.created_at, updatedAt: r.updated_at };
}
export function getWhaleFollow(accountId: string): WhaleFollow | null {
  const row = get<FollowRow>('SELECT * FROM win_whale_follows WHERE account=?', validatedAccount(accountId));
  return row ? rowToFollow(row) : null;
}
export function followOneWalletReadOnly(accountId: string, walletAddress: string, now = Date.now()): WhaleFollow {
  validatedAccount(accountId);
  if (!validSolanaWallet(walletAddress)) throw new Error('INVALID_SOLANA_WALLET');
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error('INVALID_CLOCK');
  tx(() => {
    run('INSERT INTO win_whale_follows(account,wallet_address,execution_mode,active,created_at,updated_at) VALUES (?,?,' +
      "'READ_ONLY',1,?,?) ON CONFLICT(account) DO UPDATE SET wallet_address=excluded.wallet_address," +
      "execution_mode='READ_ONLY',active=1,updated_at=excluded.updated_at",
      accountId, walletAddress, now, now);
  });
  return getWhaleFollow(accountId)!;
}
export function unfollowWalletReadOnly(accountId: string, now = Date.now()): WhaleFollow | null {
  validatedAccount(accountId);
  if (!Number.isSafeInteger(now) || now <= 0) throw new Error('INVALID_CLOCK');
  run('UPDATE win_whale_follows SET active=0,updated_at=? WHERE account=?', now, accountId);
  return getWhaleFollow(accountId);
}
export function getWinCopyStatus(accountId: string) {
  const follow = getWhaleFollow(accountId);
  const count = follow ? get<{ n: number }>(
    'SELECT COUNT(*) n FROM win_whale_observations WHERE wallet_address=?',
    follow.walletAddress)?.n ?? 0 : 0;
  return {
    version: 'WIN-01',
    lane: 'FAST',
    status: follow?.active ? 'READ_ONLY_WATCHLIST' : 'NOT_CONFIGURED',
    followedWallet: follow,
    verifiedObservationCount: count,
    automaticExecution: 'BLOCKED',
    demoExecution: 'NOT_WIRED',
    liveExecution: 'LOCKED_G01_G14',
    sourceProvider: 'NOT_WIRED',
    note: 'Wallet selection is persisted only. No live whale feed, Solana signer, swap adapter, or paper fills are connected.'
  } as const;
}
export interface StoredWhaleObservation {
  evidenceId: string;
  signature: string;
  walletAddress: string;
  mintAddress: string;
  instrumentId: string;
  instructionLeg: number;
  side: 'BUY' | 'SELL';
  observedAt: number;
  receivedAt: number;
  sourceSnapshotId: string;
}

/**
 * Only a separately reviewed, authenticated backend RPC adapter may call this.
 * Never expose as an API accepting user-declared "verified" transactions.
 * A finalized balance delta alone is not sufficient to prove a swap.
 */
export function storeProviderVerifiedSwap(e: VerifiedWalletSwap, now = Date.now()): boolean {
  if (e.kind !== 'VERIFIED_WALLET_SWAP' || e.attribution !== 'VERIFIED_WALLET' ||
      e.chain !== 'solana' || !e.verifiedAsSwap || e.finality !== 'FINALIZED' ||
      !validSolanaWallet(e.walletAddress) || !validSolanaWallet(e.mintAddress) ||
      !e.signature || e.signature.length > 128 ||
      !Number.isSafeInteger(e.instructionLeg) || e.instructionLeg < 0 ||
      !e.sourceSnapshotId || !e.sourcePayloadHash ||
      !Number.isSafeInteger(now) || !Number.isSafeInteger(e.observedAt) ||
      !Number.isSafeInteger(e.availableAt) || !Number.isSafeInteger(e.receivedAt) ||
      e.observedAt < 0 || e.observedAt > e.availableAt ||
      e.availableAt > e.receivedAt || e.receivedAt > now ||
      now - e.observedAt > MAX_AGE_MS ||
      parseAtomicQuantity(e.tokenAmountAtomic, e.tokenDecimals) === null ||
      !Number.isFinite(e.effectiveWhalePriceUsd) || e.effectiveWhalePriceUsd <= 0) {
    return false;
  }
  const result = run('INSERT OR IGNORE INTO win_whale_observations ' +
    '(evidence_id,signature,wallet_address,mint_address,instrument,instruction_leg,side,token_amount_atomic,' +
    'token_decimals,observed_at,available_at,received_at,finality,source_snapshot,source_hash,effective_price_usd) ' +
    'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    makeWalletObservationKey(e), e.signature, e.walletAddress, e.mintAddress, e.instrumentId,
    e.instructionLeg, e.side, e.tokenAmountAtomic, e.tokenDecimals, e.observedAt, e.availableAt,
    e.receivedAt, e.finality, e.sourceSnapshotId, e.sourcePayloadHash, e.effectiveWhalePriceUsd);
  return result.changes === 1;
}
export function recentWhaleObservations(accountId: string, limit = 100): StoredWhaleObservation[] {
  const follow = getWhaleFollow(accountId);
  if (!follow) return [];
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new Error('INVALID_LIMIT');
  const rows = all<{
    evidence_id: string; signature: string; wallet_address: string; mint_address: string;
    instrument: string; instruction_leg: number; side: 'BUY' | 'SELL';
    observed_at: number; received_at: number; source_snapshot: string;
  }>('SELECT evidence_id,signature,wallet_address,mint_address,instrument,instruction_leg,side,' +
    'observed_at,received_at,source_snapshot FROM win_whale_observations ' +
    'WHERE wallet_address=? ORDER BY observed_at DESC LIMIT ?', follow.walletAddress, limit);
  return rows.map((r) => ({ evidenceId: r.evidence_id, signature: r.signature,
    walletAddress: r.wallet_address, mintAddress: r.mint_address,
    instrumentId: r.instrument, instructionLeg: r.instruction_leg, side: r.side,
    observedAt: r.observed_at, receivedAt: r.received_at, sourceSnapshotId: r.source_snapshot }));
}
