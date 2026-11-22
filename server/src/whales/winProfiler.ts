import type { VerifiedWalletSwap } from './winEvidence.js';
import { makeWalletObservationKey, parseAtomicQuantity } from './winEvidence.js';

/**
 * WIN-02: deterministic, research-only FIFO reconstruction for verified swap
 * observations. This is NOT MIA's ledger, does not alter account positions,
 * and has no ability to send orders. Missing liquidity is valued at zero in
 * the stress scenario; it is not an actual executable price.
 */
export interface WinLiquidationQuote {
  mintAddress: string;
  tokenAmountAtomic: string;
  netProceedsUsd: number;
  receivedAt: number;
  expiresAt: number;
  sellExecutable: boolean;
  sourceSnapshotId: string;
}
export interface WinFollowerQuote {
  signature: string;
  instructionLeg: number;
  tokenAmountAtomic: string;
  priceUsd: number;
  totalFeesUsd: number;
  quoteReceivedAt: number;
  sourceSnapshotId: string;
  executable: boolean;
}
export interface WinProfileOptions {
  asOf: number;
  walletAddress: string;
  /** Independently established count from a complete wallet history scan. */
  verifiedHistorySwapCount?: number | null;
  liquidationQuotes?: readonly WinLiquidationQuote[];
  followerQuotes?: readonly WinFollowerQuote[];
  /** Historical replay assumption. Never a universal production threshold. */
  followerLagMs?: number;
  quoteToleranceMs?: number;
}
/** Immutable-in-memory research outcome reconstructed from one matched FIFO lot. */
export interface WinClosedLotOutcome {
  readonly outcomeId: string;
  readonly walletAddress: string;
  readonly instrumentId: string;
  readonly mintAddress: string;
  readonly entryEvidenceId: string;
  readonly exitEvidenceId: string;
  /** Every exit leg used to settle this entry, including earlier partial sells. */
  readonly exitEvidenceIds: readonly string[];
  readonly exitSourceSnapshotIds: readonly string[];
  readonly entryAt: number;
  readonly entryReceivedAt: number;
  readonly exitAt: number;
  readonly exitReceivedAt: number;
  readonly entrySourceSnapshotId: string;
  readonly exitSourceSnapshotId: string;
  readonly grossWhalePnlUsd: number;
  /** Historical delayed follower quote simulation, not actual wallet profit. */
  readonly simulatedFollowerNetPnlUsd: number | null;
}

export interface WinProfileResult {
  status: 'INSUFFICIENT_EVIDENCE' | 'QUARANTINED';
  reasonCodes: string[];
  observedSwapCount: number;
  matchedSellCount: number;
  orphanSellCount: number;
  duplicateEventCount: number;
  coverageRatio: number | null;
  grossClosedPnlUsd: number | null;
  openCostBasisUsd: number | null;
  stressUnrealizedPnlUsd: number | null;
  openTokens: number;
  liquidityMarkedTokens: number;
  zeroLiquidityStressTokens: number;
  medianHoldingMs: number | null;
  simulatedFollowerClosedPnlUsd: number | null;
  simulatedFollowerQuoteCoverage: number;
  /** FIFO outcome evidence for a future point-in-time DITAS memory join; not proof of wallet net PnL. */
  closedLots: readonly WinClosedLotOutcome[];
  /** Neither source is complete, calibrated, or trade-authorized. */
  automaticCopyEligible: false;
}

type Lot = { quantity: bigint; entryPrice: number; openedAt: number; receivedAt: number;
  sourceSnapshotId: string; entryEvidenceId: string; instrumentId: string;
  grossSettled: number; followerSettled: number; followerComplete: boolean;
  exitEvidenceIds: string[]; exitSourceSnapshotIds: string[];
  followerEntryPrice: number | null; followerFeePerToken: number | null };
type MintLots = { decimals: number; lots: Lot[] };
type TokenInfo = { gross: number; remaining: bigint; observed: number; followerGross: number };
const validTime = (n: number) => Number.isSafeInteger(n) && n >= 0;
const validMoney = (n: number) => Number.isFinite(n) && n >= 0;
const quoteAmount = (n: bigint, decimals: number): number | null => {
  // Do not silently lose atomic-unit precision in a financial-looking summary.
  if (n > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const out = Number(n) / 10 ** decimals;
  return Number.isFinite(out) ? out : null;
};

export function profileVerifiedWalletSwaps(
  events: readonly VerifiedWalletSwap[],
  opts: WinProfileOptions
): WinProfileResult {
  const reasons = new Set<string>();
  const asOf = opts.asOf;
  const lagMs = opts.followerLagMs ?? 2500;
  const toleranceMs = opts.quoteToleranceMs ?? 1500;
  if (!validTime(asOf) || !validTime(lagMs) || !validTime(toleranceMs) || lagMs > 600_000 || toleranceMs > 60_000)
    throw new Error('INVALID_PROFILE_CLOCK_OR_REPLAY_POLICY');
  if (typeof opts.walletAddress !== 'string' || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(opts.walletAddress))
    throw new Error('INVALID_SOLANA_WALLET');

  const seen = new Set<string>();
  const perMint = new Map<string, MintLots>();
  const holdingDurations: number[] = [];
  const closedLots: WinClosedLotOutcome[] = [];
  const followerPrices = new Map<string, WinFollowerQuote>();
  let followerQuotesSeen = 0;
  let followerUsable = true;
  let closedGross = 0;
  let closedFollowerNet = 0;
  let orphanSells = 0;
  let duplicates = 0;
  let matchedSells = 0;
  let observed = 0;
  let precisionSupported = true;
  let openCost = 0;
  let liquidationValue = 0;
  let marksUsed = 0;
  let stressNoMark = 0;

  for (const q of opts.followerQuotes ?? []) {
    const k = q.signature + ':' + q.instructionLeg;
    if (followerPrices.has(k)) {
      reasons.add('DUPLICATE_FOLLOWER_QUOTE');
      followerUsable = false;
    }
    followerPrices.set(k, q);
  }
  for (const e of [...events].sort((a, b) => a.observedAt - b.observedAt ||
      a.availableAt - b.availableAt || a.signature.localeCompare(b.signature) ||
      a.instructionLeg - b.instructionLeg)) {
    const key = makeWalletObservationKey(e);
    if (seen.has(key)) { duplicates++; reasons.add('DUPLICATE_OBSERVATION'); continue; }
    seen.add(key);
    const q = parseAtomicQuantity(e.tokenAmountAtomic, e.tokenDecimals);
    const unitQty = q === null ? null : quoteAmount(q, e.tokenDecimals);
    if (e.walletAddress !== opts.walletAddress || e.chain !== 'solana' ||
        e.kind !== 'VERIFIED_WALLET_SWAP' || e.attribution !== 'VERIFIED_WALLET' ||
        e.finality !== 'FINALIZED' || !e.verifiedAsSwap ||
        !validTime(e.observedAt) || !validTime(e.availableAt) ||
        !validTime(e.receivedAt) || e.observedAt > e.availableAt ||
        e.availableAt > e.receivedAt || e.receivedAt > asOf ||
        e.observedAt > asOf || q === null || unitQty === null ||
        !Number.isFinite(e.effectiveWhalePriceUsd) || e.effectiveWhalePriceUsd <= 0) {
      reasons.add('UNTRUSTWORTHY_OR_UNREPLAYABLE_SWAP');
      precisionSupported = false;
      continue;
    }
    let mint = perMint.get(e.mintAddress);
    if (mint && mint.decimals !== e.tokenDecimals) {
      reasons.add('TOKEN_DECIMAL_CONFLICT');
      precisionSupported = false;
      continue;
    }
    if (!mint) {
      mint = { decimals: e.tokenDecimals, lots: [] };
      perMint.set(e.mintAddress, mint);
    }
    observed++;
    const price = e.effectiveWhalePriceUsd;
    const fq = followerPrices.get(e.signature + ':' + e.instructionLeg);
    const targetQuoteAt = e.receivedAt + lagMs;
    const usable = fq && fq.executable && fq.signature === e.signature &&
      fq.instructionLeg === e.instructionLeg &&
      fq.tokenAmountAtomic === e.tokenAmountAtomic &&
      validTime(fq.quoteReceivedAt) &&
      fq.quoteReceivedAt >= targetQuoteAt &&
      fq.quoteReceivedAt <= targetQuoteAt + toleranceMs &&
      fq.quoteReceivedAt <= asOf && fq.sourceSnapshotId &&
      Number.isFinite(fq.priceUsd) && fq.priceUsd > 0 &&
      validMoney(fq.totalFeesUsd);
    if (usable) followerQuotesSeen++;
    else { followerUsable = false; reasons.add('MISSING_EXECUTABLE_DELAYED_FOLLOWER_QUOTE'); }
    const followerPrice = usable ? fq.priceUsd : null;
    const feePerToken = usable && unitQty && unitQty > 0 ? fq.totalFeesUsd / unitQty : null;
    if (e.side === 'BUY') {
      mint.lots.push({
        quantity: q, entryPrice: price, openedAt: e.observedAt,
        receivedAt: e.receivedAt, sourceSnapshotId: e.sourceSnapshotId,
        entryEvidenceId: key, instrumentId: e.instrumentId,
        grossSettled: 0, followerSettled: 0, followerComplete: true,
        exitEvidenceIds: [], exitSourceSnapshotIds: [],
        followerEntryPrice: followerPrice, followerFeePerToken: feePerToken
      });
      continue;
    }
    if (e.side !== 'SELL') {
      reasons.add('INVALID_SWAP_SIDE');
      precisionSupported = false;
      continue;
    }
    let toMatch = q;
    let didMatch = false;
    for (const lot of mint.lots) {
      if (toMatch === 0n) break;
      if (lot.quantity === 0n) continue;
      if (lot.instrumentId !== e.instrumentId) {
        reasons.add('INSTRUMENT_IDENTITY_CONFLICT');
        precisionSupported = false;
        break;
      }
      const consumed = toMatch < lot.quantity ? toMatch : lot.quantity;
      const qty = quoteAmount(consumed, e.tokenDecimals);
      if (qty === null) { precisionSupported = false; reasons.add('UNSAFE_PNL_PRECISION'); break; }
      lot.quantity -= consumed;
      toMatch -= consumed;
      didMatch = true;
      const gross = qty * (price - lot.entryPrice);
      closedGross += gross;
      holdingDurations.push(e.observedAt - lot.openedAt);
      const followerNet = followerPrice !== null && feePerToken !== null &&
        lot.followerEntryPrice !== null && lot.followerFeePerToken !== null
        ? qty * (followerPrice - lot.followerEntryPrice - feePerToken - lot.followerFeePerToken)
        : null;
      if (followerNet !== null) closedFollowerNet += followerNet;
      else followerUsable = false;
      lot.grossSettled += gross;
      if (followerNet !== null) lot.followerSettled += followerNet;
      else lot.followerComplete = false;
      lot.exitEvidenceIds.push(key);
      lot.exitSourceSnapshotIds.push(e.sourceSnapshotId);
      // Only a FULLY sold entry can become a learning label. A first partial
      // take-profit can be green while the remaining position later loses.
      if (lot.quantity === 0n) closedLots.push({
        outcomeId: lot.entryEvidenceId,
        walletAddress: e.walletAddress, mintAddress: e.mintAddress,
        instrumentId: lot.instrumentId, entryEvidenceId: lot.entryEvidenceId,
        exitEvidenceId: key, exitEvidenceIds: [...lot.exitEvidenceIds],
        exitSourceSnapshotIds: [...lot.exitSourceSnapshotIds],
        entryAt: lot.openedAt, entryReceivedAt: lot.receivedAt,
        exitAt: e.observedAt, exitReceivedAt: e.receivedAt,
        entrySourceSnapshotId: lot.sourceSnapshotId,
        exitSourceSnapshotId: e.sourceSnapshotId,
        grossWhalePnlUsd: lot.grossSettled,
        simulatedFollowerNetPnlUsd: lot.followerComplete ? lot.followerSettled : null,
      });
    }
    if (didMatch) matchedSells++;
    if (toMatch > 0n) { orphanSells++; reasons.add('ORPHAN_SELL_MISSING_ENTRY_BASIS'); }
  }
  for (const [mintAddress, mint] of perMint) {
    let total = 0n;
    for (const lot of mint.lots) {
      if (lot.quantity === 0n) continue;
      total += lot.quantity;
      const qty = quoteAmount(lot.quantity, mint.decimals);
      if (qty === null) { reasons.add('UNSAFE_PNL_PRECISION'); precisionSupported = false; continue; }
      openCost += qty * lot.entryPrice;
    }
    if (total === 0n) continue;
    const mark = (opts.liquidationQuotes ?? []).find(x => x.mintAddress === mintAddress &&
      x.tokenAmountAtomic === total.toString() && x.sellExecutable &&
      validMoney(x.netProceedsUsd) && x.sourceSnapshotId &&
      validTime(x.receivedAt) && validTime(x.expiresAt) &&
      x.receivedAt <= asOf && x.expiresAt >= asOf);
    if (mark) { liquidationValue += mark.netProceedsUsd; marksUsed++; }
    else { stressNoMark++; reasons.add('NO_VERIFIED_EXIT_LIQUIDITY_STRESS_ZERO'); }
  }

  const coverage = opts.verifiedHistorySwapCount;
  const coverageRatio = coverage != null && Number.isSafeInteger(coverage) && coverage > 0 &&
    observed <= coverage ? observed / coverage : null;
  if (coverageRatio === null) reasons.add('NO_INDEPENDENT_HISTORY_COVERAGE');
  else if (coverageRatio < .85) reasons.add('LOW_VERIFIED_HISTORY_COVERAGE');
  if (observed < 25) reasons.add('SMALL_VERIFIED_HISTORY_SAMPLE');
  if (!followerUsable) reasons.add('FOLLOWER_REPLICATION_INCOMPLETE');
  if (!precisionSupported) reasons.add('INSUFFICIENT_FINANCIAL_PRECISION');
  if (!events.length) reasons.add('NO_VERIFIED_WALLET_SWAPS');
  // Fee inputs and positions at other venues remain unknown. Never infer net whale PnL.
  reasons.add('WHALE_EXTERNAL_HEDGES_AND_FEES_UNKNOWN');

  holdingDurations.sort((a,b) => a-b);
  const median = holdingDurations.length ?
    (holdingDurations.length % 2
      ? holdingDurations[(holdingDurations.length - 1) / 2]
      : (holdingDurations[holdingDurations.length / 2 - 1] +
         holdingDurations[holdingDurations.length / 2]) / 2) : null;
  if (median !== null && median < 3000 && matchedSells >= 5) reasons.add('MEV_LIKE_HOLDING_PERIOD');

  const quarantined = orphanSells > 0 || duplicates > 0 || !precisionSupported ||
    (coverageRatio !== null && coverageRatio < .85) ||
    (median !== null && median < 3000 && matchedSells >= 5);
  const financial = precisionSupported && Number.isFinite(closedGross) &&
    Number.isFinite(openCost) && Number.isFinite(liquidationValue);
  return {
    status: quarantined ? 'QUARANTINED' : 'INSUFFICIENT_EVIDENCE',
    reasonCodes: [...reasons].sort(),
    observedSwapCount: observed, matchedSellCount: matchedSells,
    orphanSellCount: orphanSells, duplicateEventCount: duplicates,
    coverageRatio,
    grossClosedPnlUsd: financial && matchedSells > 0 ? closedGross : null,
    openCostBasisUsd: financial ? openCost : null,
    stressUnrealizedPnlUsd: financial ? liquidationValue - openCost : null,
    openTokens: [...perMint.values()].filter(m => m.lots.some(x => x.quantity > 0n)).length,
    liquidityMarkedTokens: marksUsed, zeroLiquidityStressTokens: stressNoMark,
    medianHoldingMs: median,
    simulatedFollowerClosedPnlUsd: financial && followerUsable && matchedSells > 0 ? closedFollowerNet : null,
    simulatedFollowerQuoteCoverage: observed ? followerQuotesSeen / observed : 0,
    closedLots: financial ? closedLots : [],
    automaticCopyEligible: false
  };
}
