import { describe, expect, it } from 'vitest';
import { normalizeFinalizedSolanaSwapFromBalances, type WinFinalizedTransactionWitness } from '../src/whales/winSolanaNormalize.js';

const wallet = '1'.repeat(32);
const mint = '3'.repeat(32);
const quote = '4'.repeat(32);
const approvedProgram = '5'.repeat(32);
const ts = 1_700_000_000_000;
const row = (owner: string,m: string,raw: string,decimals: number) => ({
  owner, mint:m, amountAtomic:raw, decimals
});
function witness(): WinFinalizedTransactionWitness {
  return {
    walletAddress: wallet, signature: '6'.repeat(88),
    instructionLeg: 0, slot: 99, observedAt: ts,
    availableAt: ts+500, receivedAt: ts+800,
    sourceSnapshotId: 'trusted-slot-99',
    sourcePayloadHash: 'a'.repeat(64),
    transactionSucceeded: true, finalized: true,
    verifiedDexSwapInvocation: true, verifiedProgramId: approvedProgram,
    approvedSwapProgramIds: [approvedProgram],
    trustedQuoteMints: [quote], quoteMint:quote, quotePriceSnapshotId:'price-USDC',
    selectedBaseMint: mint,
    preTokenBalances:[row(wallet,mint,'0',9),row(wallet,quote,'1000000000',6)],
    postTokenBalances:[row(wallet,mint,'1000000000',9),row(wallet,quote,'500000000',6)],
    quotePriceUsd:1,solPriceUsd:100,feeLamports:'5000',tipLamports:'0'
  };
}
describe('WIN-01 verified Solana balance-delta normalizer', () => {
  it('reconstructs a finalized two-asset buy with network fee into whale effective price', () => {
    const r=normalizeFinalizedSolanaSwapFromBalances(witness());
    expect(r?.kind).toBe('VERIFIED_WALLET_SWAP');
    expect(r?.side).toBe('BUY');
    expect(r?.tokenAmountAtomic).toBe('1000000000');
    expect(r?.effectiveWhalePriceUsd).toBeCloseTo(500.0005,5);
  });

  it('aggregates fragmented token accounts owned by the same wallet', () => {
    const w=witness();
    const x=normalizeFinalizedSolanaSwapFromBalances({
      ...w,
      preTokenBalances:[row(wallet,mint,'0',9),row(wallet,quote,'600000000',6),row(wallet,quote,'400000000',6)],
      postTokenBalances:[row(wallet,mint,'500000000',9),row(wallet,mint,'500000000',9),
        row(wallet,quote,'250000000',6),row(wallet,quote,'250000000',6)]
    });
    expect(x?.tokenAmountAtomic).toBe('1000000000');
    expect(x?.side).toBe('BUY');
  });

  it('reconstructs a sell net of the verified network fee and tip', () => {
    const w=witness();
    const x=normalizeFinalizedSolanaSwapFromBalances({
      ...w, preTokenBalances:[row(wallet,mint,'1000000000',9),row(wallet,quote,'0',6)],
      postTokenBalances:[row(wallet,mint,'0',9),row(wallet,quote,'600000000',6)],
      feeLamports:'5000',tipLamports:'5000'
    });
    expect(x?.side).toBe('SELL');
    expect(x?.effectiveWhalePriceUsd).toBeCloseTo(599.999,4);
  });

  it('refuses a transfer even if balances changed and someone labels it a swap', () => {
    const w=witness();
    expect(normalizeFinalizedSolanaSwapFromBalances({
      ...w,verifiedDexSwapInvocation:false
    })).toBeNull();
    expect(normalizeFinalizedSolanaSwapFromBalances({
      ...w,postTokenBalances:[row(wallet,mint,'1000000000',9),row(wallet,quote,'1000000000',6)]
    })).toBeNull();
  });

  it('rejects unrelated third mint movements and multi-asset ambiguity', () => {
    const w=witness();
    expect(normalizeFinalizedSolanaSwapFromBalances({...w,postTokenBalances:[
      ...w.postTokenBalances,row(wallet,'7'.repeat(32),'1',0)
    ]})).toBeNull();
  });

  it('rejects pending, failed, future-invisible and unverified-program events', () => {
    const w=witness();
    for (const bad of [
      {...w,finalized:false}, {...w,transactionSucceeded:false},
      {...w,approvedSwapProgramIds:[]}, {...w,availableAt:ts+2000},
      {...w,trustedQuoteMints:[]}, {...w,quotePriceSnapshotId:''},
      {...w,signature:'invalid-signature'}
    ]) expect(normalizeFinalizedSolanaSwapFromBalances(bad)).toBeNull();
  });

  it('rejects conflicting decimals, overflow and excessive fees', () => {
    const w=witness();
    expect(normalizeFinalizedSolanaSwapFromBalances({
      ...w,preTokenBalances:[row(wallet,mint,'0',8),row(wallet,quote,'1000000000',6)]
    })).toBeNull();
    expect(normalizeFinalizedSolanaSwapFromBalances({
      ...w,postTokenBalances:[row(wallet,mint,'9007199254740992',9),row(wallet,quote,'500000000',6)]
    })).toBeNull();
    expect(normalizeFinalizedSolanaSwapFromBalances({...w,feeLamports:'999999999999999999999'})).toBeNull();
  });

  it('never borrows other owners quote balance to create phantom buys', () => {
    const w=witness();
    expect(normalizeFinalizedSolanaSwapFromBalances({
      ...w,postTokenBalances:[row(wallet,mint,'1000000000',9),row('8'.repeat(32),quote,'500000000',6)]
    })).toBeNull();
  });
});
