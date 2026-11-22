import { all, get, run, tx, P } from '../db/db.js';
import { sha256 } from '../core/util.js';
import type { MarketFingerprint } from '../ditas/fingerprint.js';
import { assessWinAdaptiveLearning, type WinLearningExample } from './winLearning.js';
import type { VerifiedWalletSwap } from './winEvidence.js';
import { profileVerifiedWalletSwaps } from './winProfiler.js';
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


/**
 * WIN-02 account-scoped research replay from canonical immutable WIN evidence.
 * No broker, ledger, live mark, authenticated Solana feed or complete wallet
 * coverage is currently available: all outputs are explicitly non-tradable.
 * A bounded newest window MUST NOT imply the complete wallet history.
 */
export function getWinReadOnlyProfile(accountId: string, asOf = Date.now()) {
  const follow = getWhaleFollow(accountId);
  if (!follow || !follow.active) return {
    status: 'NOT_CONFIGURED' as const, walletAddress: null,
    profile: null, source: 'WIN_FINALIZED_EVIDENCE_ONLY' as const,
    executable: false as const
  };
  if (!Number.isSafeInteger(asOf) || asOf <= 0) throw new Error('INVALID_CLOCK');
  const rows = all<{
    signature: string; wallet_address: string; mint_address: string;
    instrument: string; instruction_leg: number; side: 'BUY' | 'SELL';
    token_amount_atomic: string; token_decimals: number;
    observed_at: number; available_at: number; received_at: number;
    source_snapshot: string; source_hash: string; effective_price_usd: number;
    finality: 'FINALIZED';
  }>('SELECT signature,wallet_address,mint_address,instrument,instruction_leg,side,' +
    'token_amount_atomic,token_decimals,observed_at,available_at,received_at,' +
    'source_snapshot,source_hash,effective_price_usd,finality FROM win_whale_observations ' +
    'WHERE wallet_address=? AND received_at<=? ORDER BY observed_at DESC LIMIT 1000',
    follow.walletAddress, asOf);
  const events: VerifiedWalletSwap[] = rows.map((r) => ({
    kind: 'VERIFIED_WALLET_SWAP', attribution: 'VERIFIED_WALLET', chain: 'solana',
    walletAddress: r.wallet_address, mintAddress: r.mint_address,
    signature: r.signature, instructionLeg: r.instruction_leg,
    instrumentId: r.instrument, side: r.side, tokenAmountAtomic: r.token_amount_atomic,
    tokenDecimals: r.token_decimals, observedAt: r.observed_at,
    availableAt: r.available_at, receivedAt: r.received_at,
    sourceSnapshotId: r.source_snapshot, sourcePayloadHash: r.source_hash,
    finality: r.finality, verifiedAsSwap: true,
    effectiveWhalePriceUsd: r.effective_price_usd
  }));
  const profile = profileVerifiedWalletSwaps(events, {
    asOf, walletAddress: follow.walletAddress
    // History completeness, follower quotes and executable exit liquidity
    // are unknown; never supply synthetic values to manufacture a score.
  });
  return {
    status: 'RESEARCH_ONLY' as const,
    walletAddress: follow.walletAddress,
    profile,
    source: 'WIN_FINALIZED_EVIDENCE_ONLY' as const,
    executable: false as const,
    note: 'Gross matched-swap PnL is not audited wallet net PnL. Missing hedges, fees, incomplete history and sellable liquidity prevent automatic whale ranking.'
  };
}

/**
 * WIN-L01: derive outcome memory from the existing immutable WIN observations
 * and the existing immutable DITAS pre-entry snapshots. Nothing is rewritten.
 * Historic follower quote evidence is NOT yet persisted by WIN; consequently
 * gross whale wins/losses cannot automatically become trained follower labels.
 */
function winLearningExamples(accountId: string, asOf: number): {
  examples: WinLearningExample[];
  totalClosed: number;
  preEntryDnaCount: number;
  independentlyCovered: boolean;
} {
  const read = getWinReadOnlyProfile(accountId, asOf);
  if (read.status !== 'RESEARCH_ONLY' || !read.profile) {
    return { examples: [], totalClosed: 0, preEntryDnaCount: 0, independentlyCovered: false };
  }
  // A bounded wallet-window or quarantined history cannot prove that losses,
  // hidden unsold lots, or earlier entries were not selectively omitted.
  if (read.profile.status === 'QUARANTINED' ||
      read.profile.coverageRatio === null || read.profile.coverageRatio < 0.85) {
    return { examples: [], totalClosed: read.profile.closedLots.length,
      preEntryDnaCount: 0, independentlyCovered: false };
  }
  const outcomes = [...read.profile.closedLots]
    .sort((a, b) => b.exitReceivedAt - a.exitReceivedAt)
    .slice(0, 100); // Strict read-only bounded study set; never claim full wallet history.
  let dnaCount = 0;
  const examples: WinLearningExample[] = outcomes.map(outcome => {
    // The DITAS snapshot MUST predate the original whale entry, and its
    // immutable content hash must still match. No future market view is used.
    const snapshot = get<{ id: string; created_at: number; payload: string; hash: string }>(
      'SELECT id,created_at,payload,hash FROM ditas_snapshots ' +
      'WHERE instrument=? AND created_at<=? AND created_at>=? ' +
      'ORDER BY created_at DESC LIMIT 1',
      outcome.instrumentId, outcome.entryAt, outcome.entryAt - 300_000);
    if (!snapshot || sha256(snapshot.payload) !== snapshot.hash ||
        snapshot.id !== 'snap_' + snapshot.hash) {
      return { outcome, entryFingerprint: null,
        fingerprintAvailableAt: null, fingerprintSourceId: null };
    }
    let fingerprint: MarketFingerprint | null = null;
    try {
      const parsed = P(snapshot.payload) as { fingerprint?: MarketFingerprint | null };
      fingerprint = parsed.fingerprint ?? null;
    } catch { /* Malformed historic data is not trusted. */ }
    if (!fingerprint || fingerprint.instrumentId !== outcome.instrumentId ||
        fingerprint.asOf > snapshot.created_at) {
      return { outcome, entryFingerprint: null,
        fingerprintAvailableAt: null, fingerprintSourceId: null };
    }
    dnaCount++;
    return { outcome, entryFingerprint: fingerprint,
      fingerprintAvailableAt: snapshot.created_at, fingerprintSourceId: snapshot.id };
  });
  return { examples, totalClosed: read.profile.closedLots.length,
    preEntryDnaCount: dnaCount, independentlyCovered: true };
}

/**
 * Callable by a FUTURE reviewed THINK adapter with its own canonical market
 * fingerprint. No immediate OMS/risk/decision integration is made here.
 */
export function assessWinLearningForCandidate(
  accountId: string, candidate: MarketFingerprint, asOf = candidate.asOf
) {
  const evidence = winLearningExamples(accountId, asOf);
  return assessWinAdaptiveLearning(evidence.examples, candidate, asOf);
}

/** Existing owner-authenticated GET /api/copy/learning exposes truthful readiness. */
export function getWinLearningReadOnlyStatus(accountId: string, asOf = Date.now()) {
  const source = winLearningExamples(accountId, asOf);
  const followerCosted = source.examples.filter(x =>
    x.outcome.simulatedFollowerNetPnlUsd !== null).length;
  return {
    version: 'WIN-L01' as const,
    status: followerCosted >= 6 && source.preEntryDnaCount >= 6
      ? 'RESEARCH_INPUTS_PRESENT' as const : 'AWAITING_VERIFIED_LEARNING_INPUTS' as const,
    source: 'WIN_IMMUTABLE_SWAPS_AND_DITAS_SNAPSHOTS' as const,
    totalReconstructedClosedLots: source.totalClosed,
    studiedRecentClosedLots: source.examples.length,
    entryTimeDnaSnapshots: source.preEntryDnaCount,
    delayedCostedFollowerOutcomes: followerCosted,
    independentlyVerifiedHistoryCoverage: source.independentlyCovered,
    sampledWindowIsCompleteHistory: false as const,
    automaticModelPromotion: false as const,
    canTrade: false as const,
    canDisableRisk: false as const,
    liveExecution: 'LOCKED' as const,
    nextRequirements: [
      'Certified continuous wallet ingestion and complete history coverage',
      'Independent delayed historical follower buy/sell quotes and transaction fees',
      'Source-hashed pre-entry market fingerprints for each studied instrument',
      'Independent-wallet holdout and walk-forward validation before any abstain-only THINK wiring',
    ],
    note: 'Research memory is reconstructed from existing immutable source events. Gross whale PnL is not an actual follower win/loss, and no unverified setup can automatically enter trading decisions.',
  };
}
