import { describe, expect, it } from 'vitest';
import { profileVerifiedWalletSwaps, type WinFollowerQuote } from '../src/whales/winProfiler.js';
import type { VerifiedWalletSwap } from '../src/whales/winEvidence.js';

const wallet = '1'.repeat(32);
const mint = '3'.repeat(32);
const T = 1_700_000_000_000;

function swap(signature: string, side: 'BUY'|'SELL', atomic: string, price: number,
  offset: number, mintAddress = mint): VerifiedWalletSwap {
  return {
    kind: 'VERIFIED_WALLET_SWAP', attribution: 'VERIFIED_WALLET',
    chain: 'solana', walletAddress: wallet, signature, instructionLeg: 0,
    mintAddress, instrumentId: 'crypto-dex:solana:' + mintAddress,
    side, tokenAmountAtomic: atomic, tokenDecimals: 0,
    observedAt: T + offset, availableAt: T + offset + 100,
    receivedAt: T + offset + 150, sourceSnapshotId: 'trusted-provider-fixture',
    sourcePayloadHash: 'f'.repeat(64), finality: 'FINALIZED',
    verifiedAsSwap: true, effectiveWhalePriceUsd: price
  };
}
const a = swap('buy-a', 'BUY', '10', 1, 1000);
const b = swap('buy-b', 'BUY', '10', 2, 8000);
const c = swap('sell-c', 'SELL', '15', 3, 20000);
const asOf = T + 30000;
const config = { walletAddress: wallet, asOf, verifiedHistorySwapCount: 3 };

describe('WIN-02 wallet reconstruction (research only)', () => {
  it('reconstructs partial FIFO lots, does not hide illiquid dead bags and never authorizes copy', () => {
    const r = profileVerifiedWalletSwaps([c, b, a], config);
    expect(r.observedSwapCount).toBe(3);
    expect(r.matchedSellCount).toBe(1);
    expect(r.grossClosedPnlUsd).toBe(25); // 10*(3-1)+5*(3-2)
    expect(r.closedLots).toHaveLength(2);
    expect(r.closedLots.map(x => x.grossWhalePnlUsd)).toEqual([20, 5]);
    expect(r.closedLots[0]).toMatchObject({
      entryEvidenceId: expect.stringContaining('buy-a'),
      exitEvidenceId: expect.stringContaining('sell-c'),
      simulatedFollowerNetPnlUsd: null,
    });
    expect(r.openCostBasisUsd).toBe(10); // five units at $2
    expect(r.stressUnrealizedPnlUsd).toBe(-10); // no verified full sell route
    expect(r.zeroLiquidityStressTokens).toBe(1);
    expect(r.liquidityMarkedTokens).toBe(0);
    expect(r.coverageRatio).toBe(1);
    expect(r.simulatedFollowerClosedPnlUsd).toBeNull();
    expect(r.reasonCodes).toContain('NO_VERIFIED_EXIT_LIQUIDITY_STRESS_ZERO');
    expect(r.automaticCopyEligible).toBe(false);
  });

  it('uses only fresh executable full-amount sell quotes and never a misleading mid-price', () => {
    const r = profileVerifiedWalletSwaps([a, b, c], {
      ...config, liquidationQuotes: [{ mintAddress: mint, tokenAmountAtomic: '5',
        netProceedsUsd: 4.5, receivedAt: asOf - 10, expiresAt: asOf + 1000,
        sellExecutable: true, sourceSnapshotId: 'realized-sell-quote' }]
    });
    expect(r.stressUnrealizedPnlUsd).toBe(-5.5);
    expect(r.zeroLiquidityStressTokens).toBe(0);
    expect(r.liquidityMarkedTokens).toBe(1);
    const expired = profileVerifiedWalletSwaps([a, b, c], {
      ...config, liquidationQuotes: [{ mintAddress: mint, tokenAmountAtomic: '5',
        netProceedsUsd: 10000, receivedAt: asOf - 9000, expiresAt: asOf - 8000,
        sellExecutable: true, sourceSnapshotId: 'stale' }]
    });
    expect(expired.stressUnrealizedPnlUsd).toBe(-10);
  });

  it('quarantines orphan sells and refuses to fabricate cost basis or a win rate', () => {
    const r = profileVerifiedWalletSwaps([swap('orphan', 'SELL', '5', 3, 3000)], {
      walletAddress: wallet, asOf, verifiedHistorySwapCount: 9
    });
    expect(r.status).toBe('QUARANTINED');
    expect(r.orphanSellCount).toBe(1);
    expect(r.grossClosedPnlUsd).toBeNull();
    expect(r.coverageRatio).toBeCloseTo(1/9);
    expect(r.reasonCodes).toContain('ORPHAN_SELL_MISSING_ENTRY_BASIS');
    expect(r.automaticCopyEligible).toBe(false);
  });

  it('rejects duplicate signatures and does not double-count profit', () => {
    const r = profileVerifiedWalletSwaps([a, a, c], config);
    expect(r.duplicateEventCount).toBe(1);
    expect(r.status).toBe('QUARANTINED');
    expect(r.grossClosedPnlUsd).toBe(20);
  });

  it('estimates follower PnL at obtainable delayed quotes with fees, never whale prices', () => {
    const inputs = [a,b,c];
    const prices = [1.1, 2.2, 2.9];
    const fees = [0.1,0.2,0.15];
    const quotes: WinFollowerQuote[] = inputs.map((x,i) => ({
      signature: x.signature, instructionLeg: 0,
      tokenAmountAtomic: x.tokenAmountAtomic, priceUsd: prices[i],
      totalFeesUsd: fees[i], quoteReceivedAt: x.receivedAt + 2500,
      executable: true, sourceSnapshotId: 'simulated-historical-fill'
    }));
    const r = profileVerifiedWalletSwaps([a,b,c], {...config,followerQuotes:quotes});
    expect(r.simulatedFollowerQuoteCoverage).toBe(1);
    expect(r.simulatedFollowerClosedPnlUsd).toBeCloseTo(21.15,8);
    expect(r.closedLots.map(x => x.simulatedFollowerNetPnlUsd)).toHaveLength(2);
    expect(r.closedLots.reduce((s, x) => s + (x.simulatedFollowerNetPnlUsd ?? 0), 0))
      .toBeCloseTo(21.15, 8);
    expect(r.grossClosedPnlUsd).toBe(25);
    expect(r.automaticCopyEligible).toBe(false);
  });

  it('refuses follower profit when even one quote is too early to be available', () => {
    const inputs = [a,b,c];
    const quotes: WinFollowerQuote[] = inputs.map(x => ({
      signature:x.signature,instructionLeg:0,
      tokenAmountAtomic:x.tokenAmountAtomic,priceUsd:x.effectiveWhalePriceUsd,
      totalFeesUsd:0,quoteReceivedAt:x.receivedAt + 2500,
      sourceSnapshotId:'replayed',executable:true
    }));
    quotes[2] = {...quotes[2],quoteReceivedAt:c.receivedAt + 100};
    const r=profileVerifiedWalletSwaps(inputs,{...config,followerQuotes:quotes});
    expect(r.simulatedFollowerClosedPnlUsd).toBeNull();
    expect(r.reasonCodes).toContain('FOLLOWER_REPLICATION_INCOMPLETE');
  });

  it('refuses future-visible observations and unsafe atomic precision', () => {
    const invalid = profileVerifiedWalletSwaps([
      {...a,receivedAt:asOf+1},
      {...b,tokenAmountAtomic:'9007199254740992'}
    ],config);
    expect(invalid.status).toBe('QUARANTINED');
    expect(invalid.grossClosedPnlUsd).toBeNull();
    expect(invalid.reasonCodes).toContain('UNTRUSTWORTHY_OR_UNREPLAYABLE_SWAP');
  });

  it('does not claim coverage from just a partial exported history', () => {
    const p = profileVerifiedWalletSwaps([a,b,c],{walletAddress:wallet,asOf});
    expect(p.coverageRatio).toBeNull();
    expect(p.reasonCodes).toContain('NO_INDEPENDENT_HISTORY_COVERAGE');
    expect(p.status).toBe('INSUFFICIENT_EVIDENCE');
  });
});
