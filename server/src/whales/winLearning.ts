import { compareFingerprints, type MarketFingerprint } from '../ditas/fingerprint.js';
import type { WinClosedLotOutcome } from './winProfiler.js';

/**
 * WIN-L01: source-backed whale outcome learning, reusing canonical DITAS Market DNA.
 *
 * Training examples must be assembled from the immutable WIN wallet swap ledger,
 * delayed historical follower quotes, and entry-time DITAS snapshots. No separate
 * model store, risk engine, trading route, LLM, signer, or permission exists here.
 *
 * This skill is research-only. Historical whales can have unseen hedges, fees,
 * transfers or lucky fills; it cannot certify a strategy or a live order.
 */
export interface WinLearningExample {
  readonly outcome: WinClosedLotOutcome;
  /** Captured before the whale's entry and available at that moment. */
  readonly entryFingerprint: MarketFingerprint | null;
  readonly fingerprintSourceId: string | null;
  readonly fingerprintAvailableAt: number | null;
}

export type WinLearningSignal =
  | 'INSUFFICIENT_EVIDENCE'
  | 'AVOID_SIMILAR_LOSS_PATTERN_RESEARCH'
  | 'STUDY_SIMILAR_WIN_PATTERN_RESEARCH'
  | 'MIXED_OR_UNSTABLE_RESEARCH';

export interface WinLearningAssessment {
  readonly version: 'win-learning-v1';
  readonly signal: WinLearningSignal;
  readonly researchOnly: true;
  readonly canAuthorizeTrade: false;
  readonly canChangeRiskLimits: false;
  /** A future explicitly reviewed Adaptive THINK adapter may use this only as an abstain hint. */
  readonly suggestedThinkHandling: 'ABSTAIN_REVIEW' | 'DEEP_REVIEW' | 'NO_CHANGE';
  readonly matchingClosedLots: number;
  readonly independentWallets: number;
  readonly matchedWinCount: number;
  readonly matchedLossCount: number;
  readonly matchedFlatCount: number;
  readonly winRate: number | null;
  readonly meanSimulatedFollowerPnlUsd: number | null;
  readonly rejectedEvidence: number;
  readonly reasonCodes: readonly string[];
  readonly matchedOutcomeIds: readonly string[];
}

const SIMILARITY_MIN = 0.85; // heuristic only; must be validated out-of-sample
const MIN_EXAMPLES = 6;
const MIN_WALLETS = 3;
const MAX_PER_WALLET = 4;
const MAX_TRAINING_AGE_MS = 90 * 24 * 60 * 60 * 1000;
const isTime = (x: number): boolean => Number.isSafeInteger(x) && x >= 0;
/** Prevent a Solana whale example from being generalized to stocks or futures. */
const instrumentFamily = (id: string): string => id.split(':').slice(0, 2).join(':');

function validFingerprint(f: MarketFingerprint | null): f is MarketFingerprint {
  if (!f || f.version !== 'market-dna-v1' || f.dataQuality !== 'PASS' ||
      !isTime(f.asOf) || !f.timeframe || !f.regime || f.regime === 'UNKNOWN' ||
      !f.instrumentId || !f.metrics || typeof f.metrics !== 'object') return false;
  // The existing DITAS fingerprint uses normalized [0,1] numbers or null.
  return Object.values(f.metrics).every(v =>
    v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1));
}

function trustworthyExample(e: WinLearningExample, at: number): boolean {
  const o = e.outcome;
  if (!validFingerprint(e.entryFingerprint) ||
      !e.fingerprintSourceId || !isTime(e.fingerprintAvailableAt ?? -1) ||
      !isTime(o.entryAt) || !isTime(o.entryReceivedAt) ||
      !isTime(o.exitAt) || !isTime(o.exitReceivedAt) ||
      o.entryAt > o.entryReceivedAt || o.entryAt > o.exitAt ||
      o.exitAt > o.exitReceivedAt || o.exitReceivedAt > at ||
      at - o.entryAt > MAX_TRAINING_AGE_MS ||
      e.entryFingerprint.asOf > e.fingerprintAvailableAt! ||
      e.fingerprintAvailableAt! > o.entryAt ||
      e.entryFingerprint.instrumentId !== o.instrumentId ||
      !o.entryEvidenceId || !o.exitEvidenceId ||
      !o.exitEvidenceIds?.length || !o.exitSourceSnapshotIds?.length ||
      o.exitEvidenceIds.length !== o.exitSourceSnapshotIds.length ||
      new Set(o.exitEvidenceIds).size !== o.exitEvidenceIds.length ||
      o.exitEvidenceIds[o.exitEvidenceIds.length - 1] !== o.exitEvidenceId ||
      o.exitSourceSnapshotIds.some(id => !id) ||
      !o.entrySourceSnapshotId || !o.exitSourceSnapshotId ||
      !o.outcomeId || !o.walletAddress ||
      !Number.isFinite(o.grossWhalePnlUsd) ||
      o.simulatedFollowerNetPnlUsd === null ||
      !Number.isFinite(o.simulatedFollowerNetPnlUsd)) return false;
  return true;
}

/**
 * Look back ONLY at closed outcomes that were actually received by candidate time.
 * Historical best setups are not auto-follow signals; consistent losses can only
 * suggest an additional future abstention review in Adaptive THINK.
 *
 * Enforces unique entry IDs, independent wallet diversity, temporal causality,
 * same-regime/timeframe comparison and a bounded contribution per wallet.
 */
export function assessWinAdaptiveLearning(
  examples: readonly WinLearningExample[],
  candidate: MarketFingerprint,
  asOf = candidate.asOf,
): WinLearningAssessment {
  if (!isTime(asOf) || !validFingerprint(candidate) || candidate.asOf > asOf) {
    return {
      version: 'win-learning-v1', signal: 'INSUFFICIENT_EVIDENCE',
      researchOnly: true, canAuthorizeTrade: false, canChangeRiskLimits: false,
      suggestedThinkHandling: 'NO_CHANGE', matchingClosedLots: 0,
      independentWallets: 0, matchedWinCount: 0, matchedLossCount: 0,
      matchedFlatCount: 0, winRate: null, meanSimulatedFollowerPnlUsd: null,
      rejectedEvidence: examples.length, reasonCodes: ['INVALID_OR_UNTRUSTED_CANDIDATE_DNA'],
      matchedOutcomeIds: [],
    };
  }

  const seenEntry = new Set<string>();
  const seenOutcome = new Set<string>();
  const perWallet = new Map<string, number>();
  const matched: WinLearningExample[] = [];
  const reasons = new Set<string>();
  let rejected = 0;

  for (const e of [...examples].sort((a, b) =>
    a.outcome.exitReceivedAt - b.outcome.exitReceivedAt ||
    a.outcome.outcomeId.localeCompare(b.outcome.outcomeId))) {
    const o = e.outcome;
    if (!trustworthyExample(e, Math.min(asOf, candidate.asOf))) {
      rejected++;
      reasons.add('MISSING_CAUSAL_OR_COST_VERIFIED_OUTCOME');
      continue;
    }
    const entryKey = o.walletAddress + '|' + o.entryEvidenceId;
    if (seenEntry.has(entryKey) || seenOutcome.has(o.outcomeId)) {
      rejected++;
      reasons.add('DUPLICATED_OR_SPLIT_ENTRY_NOT_INDEPENDENT');
      continue;
    }
    seenEntry.add(entryKey);
    seenOutcome.add(o.outcomeId);
    if (instrumentFamily(o.instrumentId) !== instrumentFamily(candidate.instrumentId) ||
        e.entryFingerprint!.timeframe !== candidate.timeframe ||
        e.entryFingerprint!.regime !== candidate.regime) continue;
    const similarity = compareFingerprints(e.entryFingerprint!, candidate);
    if (!similarity.comparable || similarity.similarity === null ||
        similarity.similarity < SIMILARITY_MIN) continue;
    if ((perWallet.get(o.walletAddress) ?? 0) >= MAX_PER_WALLET) {
      rejected++;
      reasons.add('WALLET_CORRELATION_CAP');
      continue;
    }
    perWallet.set(o.walletAddress, (perWallet.get(o.walletAddress) ?? 0) + 1);
    matched.push(e);
  }

  const wins = matched.filter(x => x.outcome.simulatedFollowerNetPnlUsd! > 0).length;
  const losses = matched.filter(x => x.outcome.simulatedFollowerNetPnlUsd! < 0).length;
  const flat = matched.length - wins - losses;
  const mean = matched.length
    ? matched.reduce((n, x) => n + x.outcome.simulatedFollowerNetPnlUsd!, 0) / matched.length
    : null;
  const qualified = matched.length >= MIN_EXAMPLES && perWallet.size >= MIN_WALLETS &&
    mean !== null && Number.isFinite(mean);
  if (!qualified) reasons.add('INSUFFICIENT_INDEPENDENT_OUTCOME_EVIDENCE');

  const lossDominated = qualified && losses / matched.length >= 0.7 && mean! < 0;
  const winDominated = qualified && wins / matched.length >= 0.7 && mean! > 0;
  const signal: WinLearningSignal = !qualified ? 'INSUFFICIENT_EVIDENCE'
    : lossDominated ? 'AVOID_SIMILAR_LOSS_PATTERN_RESEARCH'
    : winDominated ? 'STUDY_SIMILAR_WIN_PATTERN_RESEARCH'
    : 'MIXED_OR_UNSTABLE_RESEARCH';
  if (winDominated) reasons.add('WINNER_NEEDS_HOLDOUT_VALIDATION');
  if (lossDominated) reasons.add('LOSS_PATTERN_PROPOSED_AS_ABSTAIN_ONLY');
  if (qualified && !winDominated && !lossDominated) reasons.add('MIXED_OUTCOME_COHORT');
  reasons.add('SIMULATED_FOLLOWER_NOT_ACTUAL_LIVE_PNL');

  return {
    version: 'win-learning-v1', signal, researchOnly: true,
    canAuthorizeTrade: false, canChangeRiskLimits: false,
    suggestedThinkHandling: lossDominated ? 'ABSTAIN_REVIEW'
      : winDominated ? 'DEEP_REVIEW' : 'NO_CHANGE',
    matchingClosedLots: matched.length, independentWallets: perWallet.size,
    matchedWinCount: wins, matchedLossCount: losses, matchedFlatCount: flat,
    winRate: matched.length ? wins / matched.length : null,
    meanSimulatedFollowerPnlUsd: qualified ? mean : null,
    rejectedEvidence: rejected,
    reasonCodes: [...reasons].sort(),
    matchedOutcomeIds: matched.map(x => x.outcome.outcomeId),
  };
}
