import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { closeDb, openDb, run, get } from '../src/db/db.js';
import { SCHEMA_VERSION } from '../src/db/migrations.js';
import { followOneWalletReadOnly, unfollowWalletReadOnly, getWhaleFollow,
  getWinCopyStatus, recentWhaleObservations, storeProviderVerifiedSwap } from '../src/whales/winRegistry.js';
import { reconstructReadOnlyDeepFootprints } from '../src/whales/winDeep.js';
import { evaluateFastWhaleCandidate, evaluateDeepWhaleCandidate, previewWinExecutionEligibility,
  type VerifiedWalletSwap } from '../src/whales/winEvidence.js';

const wallet = '1'.repeat(32);
const other = '2'.repeat(32);
const mint = '3'.repeat(32);
const at = 1_700_000_005_000;
const swap = (): VerifiedWalletSwap => ({
  kind: 'VERIFIED_WALLET_SWAP',
  attribution: 'VERIFIED_WALLET', chain: 'solana', walletAddress: wallet,
  signature: 'sig-original', instructionLeg: 0, mintAddress: mint,
  instrumentId: 'crypto-dex:solana:' + mint, side: 'BUY',
  tokenAmountAtomic: '1000000000', tokenDecimals: 9,
  observedAt: at - 3000, availableAt: at - 2000, receivedAt: at - 1000,
  sourceSnapshotId: 'trusted-rpc-snapshot', sourcePayloadHash: 'a'.repeat(64),
  finality: 'FINALIZED', verifiedAsSwap: true, effectiveWhalePriceUsd: 0.001
});

describe('WIN-01 read-only whale registry (migration v6)', () => {
  beforeEach(() => { closeDb(); openDb(':memory:'); });
  afterEach(() => closeDb());

  it('adds append-only migration without replacing orders, fills, or positions', () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(6);
    expect(get<{ n: number }>("SELECT COUNT(*) n FROM sqlite_master WHERE name IN ('orders','fills','positions','win_whale_follows','win_whale_observations')")?.n).toBe(5);
  });

  it('enforces ONE followed Solana wallet per account and hard-codes READ_ONLY', () => {
    const a = followOneWalletReadOnly('paper-bot', wallet, at);
    expect(a.active).toBe(true);
    expect(a.executionMode).toBe('READ_ONLY');
    followOneWalletReadOnly('paper-bot', other, at + 1);
    expect(getWhaleFollow('paper-bot')?.walletAddress).toBe(other);
    expect(get<{ n: number }>('SELECT COUNT(*) n FROM win_whale_follows WHERE account=?', 'paper-bot')?.n).toBe(1);
    expect(getWinCopyStatus('paper-bot').automaticExecution).toBe('BLOCKED');
    expect(getWinCopyStatus('paper-bot').liveExecution).toBe('LOCKED_G01_G14');
    expect(() => followOneWalletReadOnly('paper-bot', 'not a wallet', at)).toThrow('INVALID_SOLANA_WALLET');
    expect(getWhaleFollow('paper-bot')?.walletAddress).toBe(other);
  });

  it('unfollows without deleting audit history or enabling trade execution', () => {
    followOneWalletReadOnly('paper-bot', wallet, at);
    expect(unfollowWalletReadOnly('paper-bot', at + 100)?.active).toBe(false);
    expect(getWinCopyStatus('paper-bot').status).toBe('NOT_CONFIGURED');
  });

  it('persists finalized provider evidence once, rejects pending/unverified activity', () => {
    followOneWalletReadOnly('paper-bot', wallet, at);
    expect(storeProviderVerifiedSwap(swap(), at)).toBe(true);
    expect(storeProviderVerifiedSwap(swap(), at)).toBe(false);
    expect(recentWhaleObservations('paper-bot')).toHaveLength(1);
    expect(getWinCopyStatus('paper-bot').verifiedObservationCount).toBe(1);
    expect(storeProviderVerifiedSwap({ ...swap(), signature: 'pending', finality: 'PENDING' }, at)).toBe(false);
    expect(storeProviderVerifiedSwap({ ...swap(), signature: 'transfer', verifiedAsSwap: false }, at)).toBe(false);
    expect(() => run('UPDATE win_whale_observations SET side=? WHERE signature=?', 'SELL', 'sig-original')).toThrow();
    expect(() => run('DELETE FROM win_whale_observations')).toThrow();
  });

  it('keeps recorded evidence separate from user-visible following account', () => {
    followOneWalletReadOnly('paper-bot', other, at);
    storeProviderVerifiedSwap(swap(), at);
    expect(recentWhaleObservations('paper-bot')).toHaveLength(0);
  });
});

describe('WIN read-only research and hard execution locks', () => {
  it('never mislabels anonymous Binance prints as named wallets', () => {
    const observations = reconstructReadOnlyDeepFootprints([
      { instrumentId: 'crypto:binance:BTCUSDT', symbol: 'BTCUSDT', ts: at - 1000,
        price: 100, qty: 500, notional: 50_000, side: 'BUY', threshold: 20_000 },
      { instrumentId: 'crypto:binance:BTCUSDT', symbol: 'BTCUSDT', ts: at + 1,
        price: 100, qty: 500, notional: 50_000, side: 'BUY', threshold: 20_000 }
    ], at);
    expect(observations).toHaveLength(1);
    expect(observations[0].attribution).toBe('INFERRED_ENTITY');
    expect(observations[0].status).toBe('RESEARCH_ONLY');
    expect('walletAddress' in observations[0]).toBe(false);
  });

  it('FAST never approves a trade from a naked whale event', () => {
    const follow = { walletAddress: wallet, accountId: 'paper-bot', selectedBy: 'USER' as const,
      observeOnly: false, maxSignalAgeMs: 10_000, maxQuoteAgeMs: 5_000,
      maxEntryDriftBps: 200, maxPriceImpactBps: 80, minLiquidityUsd: 100_000,
      maxNotionalUsd: 100, requiredFinality: 'FINALIZED' as const };
    const unsafe = evaluateFastWhaleCandidate({
      observation: swap(), follow, mintSafety: null, obtainableQuote: null, now: at,
      estimatedExpectedMoveBps: 1000
    });
    expect(unsafe.verdict).toBe('REJECTED');
    expect(unsafe.reasonCodes).toContain('MINT_SAFETY_UNVERIFIED');
    expect(previewWinExecutionEligibility({
      candidate: unsafe, environment: 'LIVE', canonicalRiskDecision: 'ALLOW', canonicalDecisionId: 'd1'
    }).eligibleForPaperOmsReview).toBe(false);
  });

  it('DEEP requires point-in-time data and rejects historical lookahead', () => {
    const d = {
      id: 'h1', instrumentId: 'future:BTC', market: 'CRYPTO_PERPETUAL' as const,
      direction: 'LONG' as const, decisionTime: at - 500, triggerAt: at - 200,
      sourceRecords: [{ kind: 'INFERRED_FOOTPRINT' as const, attribution: 'INFERRED_ENTITY' as const,
        market: 'CRYPTO_PERPETUAL' as const, instrumentId: 'future:BTC',
        footprintId: 'f1', source: 'FUTURES_POSITIONING' as const, eventTime: at - 5000,
        availableAt: at + 1, receivedAt: at + 1, sourceSnapshotId: 's1',
        sourcePayloadHash: 'hash', inference: 'NEUTRAL' as const }],
      strategyVersion: 'v1', entryZone: { low: 95, high: 100 },
      invalidationPrice: 90, expectedNetReturnBps: 100,
      holdoutSampleSize: 50, brierScore: 0.1, baselineBrierScore: 0.2,
      modelValidated: true, sessionEligible: true, signalExpiryAt: at + 1000
    };
    const out = evaluateDeepWhaleCandidate(d, at);
    expect(out.verdict).not.toBe('CANDIDATE');
    expect(out.reasonCodes).toContain('FUTURE_OR_MISMATCHED_SOURCE_EVIDENCE');
  });
});
