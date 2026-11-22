import type { VerifiedWalletSwap } from './winEvidence.js';

/**
 * WIN-01: pure, fail-closed normalized net SPL-token balance-delta proof.
 * The upstream trusted RPC decoder must first authenticate the transaction,
 * finality, program invocation stack and transaction outcome. A balance delta
 * or token transfer by itself NEVER establishes a DEX swap.
 *
 * A valid result is research evidence only; mint safety, executable follower
 * quote, QCI, risk, OMS and trading certification are separate authorities.
 */
export interface WinSolanaTokenBalance {
  readonly owner: string;
  readonly mint: string;
  readonly amountAtomic: string;
  readonly decimals: number;
}
export interface WinFinalizedTransactionWitness {
  readonly walletAddress: string;
  readonly signature: string;
  readonly instructionLeg: number;
  readonly slot: number;
  readonly observedAt: number;
  readonly availableAt: number;
  readonly receivedAt: number;
  readonly sourceSnapshotId: string;
  readonly sourcePayloadHash: string;
  readonly transactionSucceeded: boolean;
  readonly finalized: boolean;
  readonly verifiedDexSwapInvocation: boolean;
  readonly verifiedProgramId: string;
  readonly approvedSwapProgramIds: readonly string[];
  readonly preTokenBalances: readonly WinSolanaTokenBalance[];
  readonly postTokenBalances: readonly WinSolanaTokenBalance[];
  readonly selectedBaseMint: string;
  readonly quoteMint: string;
  readonly quotePriceUsd: number;
  readonly feeLamports: string;
  readonly tipLamports: string;
  readonly solPriceUsd: number;
}

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ATOMIC = /^(?:0|[1-9][0-9]{0,76})$/;
const MAX_SOL_FEE_LAMPORTS = 5_000_000_000n;
const isInt = (x: number) => Number.isSafeInteger(x) && x >= 0;
function parseAtom(s: string): bigint | null {
  return typeof s === 'string' && ATOMIC.test(s) ? BigInt(s) : null;
}
function safeDecimal(n: bigint, decimals: number): number | null {
  // Do not round through MAX_SAFE_INTEGER in a financial event.
  if (n < 0n || n > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const value = Number(n) / 10 ** decimals;
  return Number.isFinite(value) ? value : null;
}
type BalanceTotals = { amount: bigint; decimals: number };
function tallyBalances(
  rows: readonly WinSolanaTokenBalance[], owner: string
): Map<string, BalanceTotals> | null {
  const totals = new Map<string, BalanceTotals>();
  for (const x of rows) {
    if (x.owner !== owner) continue;
    if (!ADDRESS.test(x.mint) || !Number.isInteger(x.decimals) ||
        x.decimals < 0 || x.decimals > 18) return null;
    const amount = parseAtom(x.amountAtomic);
    if (amount === null) return null;
    const old = totals.get(x.mint);
    if (old && old.decimals !== x.decimals) return null;
    totals.set(x.mint, { amount: (old?.amount ?? 0n) + amount, decimals: x.decimals });
  }
  return totals;
}

/** Returns null for transfers, airdrops, unrelated movements or ambiguous swaps. */
export function normalizeFinalizedSolanaSwapFromBalances(
  witness: WinFinalizedTransactionWitness
): VerifiedWalletSwap | null {
  const x = witness;
  if (!ADDRESS.test(x.walletAddress) || !ADDRESS.test(x.selectedBaseMint) ||
      !ADDRESS.test(x.quoteMint) || x.selectedBaseMint === x.quoteMint ||
      !ADDRESS.test(x.verifiedProgramId) || !x.approvedSwapProgramIds.includes(x.verifiedProgramId) ||
      !x.transactionSucceeded || !x.finalized || !x.verifiedDexSwapInvocation ||
      typeof x.signature !== 'string' || !ADDRESS.test(x.signature.slice(0,44)) ||
      !isInt(x.slot) || !isInt(x.instructionLeg) || !isInt(x.observedAt) ||
      !isInt(x.availableAt) || !isInt(x.receivedAt) ||
      x.observedAt > x.availableAt || x.availableAt > x.receivedAt ||
      !x.sourceSnapshotId || !/^[a-f0-9]{64}$/i.test(x.sourcePayloadHash) ||
      !Number.isFinite(x.quotePriceUsd) || x.quotePriceUsd <= 0 ||
      !Number.isFinite(x.solPriceUsd) || x.solPriceUsd <= 0) return null;
  const fee = parseAtom(x.feeLamports), tip = parseAtom(x.tipLamports);
  if (fee === null || tip === null || fee + tip > MAX_SOL_FEE_LAMPORTS) return null;
  const pre = tallyBalances(x.preTokenBalances, x.walletAddress);
  const post = tallyBalances(x.postTokenBalances, x.walletAddress);
  if (!pre || !post) return null;

  const mints = new Set([...pre.keys(), ...post.keys()]);
  const changes = new Map<string, { delta: bigint; decimals: number }>();
  for (const mint of mints) {
    const p = pre.get(mint), n = post.get(mint);
    if (p && n && p.decimals !== n.decimals) return null;
    const decimals = p?.decimals ?? n?.decimals;
    if (decimals === undefined) return null;
    const delta = (n?.amount ?? 0n) - (p?.amount ?? 0n);
    if (delta !== 0n) changes.set(mint, { delta, decimals });
  }
  // Exactly one base + one supported, external quote asset change.
  // Reject multi-asset fee-on-transfer, LP, unstaking or ambiguous multi-hop.
  if (changes.size !== 2 || !changes.has(x.selectedBaseMint) || !changes.has(x.quoteMint))
    return null;
  const base = changes.get(x.selectedBaseMint)!;
  const quote = changes.get(x.quoteMint)!;
  const isBuy = base.delta > 0n && quote.delta < 0n;
  const isSell = base.delta < 0n && quote.delta > 0n;
  if (!isBuy && !isSell) return null;
  const baseUnits = safeDecimal(base.delta < 0n ? -base.delta : base.delta, base.decimals);
  const quoteUnits = safeDecimal(quote.delta < 0n ? -quote.delta : quote.delta, quote.decimals);
  if (baseUnits === null || quoteUnits === null || baseUnits <= 0 || quoteUnits <= 0)
    return null;

  const totalFeesUsd = Number(fee + tip) / 1e9 * x.solPriceUsd;
  const quoteUsd = quoteUnits * x.quotePriceUsd;
  // Include explicit network and tip costs; rent/unwrapped SOL changes still
  // require separate treatment by the upstream proof before eligibility.
  const effectiveUsd = (quoteUsd + (isBuy ? totalFeesUsd : -totalFeesUsd)) / baseUnits;
  if (!Number.isFinite(effectiveUsd) || effectiveUsd <= 0) return null;
  return {
    kind: 'VERIFIED_WALLET_SWAP', attribution: 'VERIFIED_WALLET',
    chain: 'solana', walletAddress: x.walletAddress,
    signature: x.signature, instructionLeg: x.instructionLeg,
    mintAddress: x.selectedBaseMint, instrumentId: 'crypto-dex:solana:' + x.selectedBaseMint,
    side: isBuy ? 'BUY' : 'SELL',
    tokenAmountAtomic: (base.delta < 0n ? -base.delta : base.delta).toString(),
    tokenDecimals: base.decimals, observedAt: x.observedAt,
    availableAt: x.availableAt, receivedAt: x.receivedAt,
    sourceSnapshotId: x.sourceSnapshotId, sourcePayloadHash: x.sourcePayloadHash,
    finality: 'FINALIZED', verifiedAsSwap: true, effectiveWhalePriceUsd: effectiveUsd
  };
}
