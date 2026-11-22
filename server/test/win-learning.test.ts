import { describe, expect, it } from 'vitest';
import type { MarketFingerprint } from '../src/ditas/fingerprint.js';
import type { WinClosedLotOutcome } from '../src/whales/winProfiler.js';
import { assessWinAdaptiveLearning, type WinLearningExample } from '../src/whales/winLearning.js';

const T = 1_700_000_000_000;
const instrument = 'crypto-dex:solana:' + '3'.repeat(32);
const wallet = (i: number) => String(i + 1).repeat(32);
const dna = (at: number, overrides: Partial<MarketFingerprint> = {}): MarketFingerprint => ({
  version: 'market-dna-v1', asOf: at, instrumentId: instrument,
  timeframe: '1h', regime: 'TREND', dataQuality: 'PASS',
  metrics: {
    trendDirection: 1, trendStrength: 0.68, volatility: 0.22,
    relativeVolume: 0.45, liquidityCoverage: 0.78,
    spread: 0.12, impact: 0.13, momentum: 0.73,
    structureLocation: 0.81, correlationToBtc: 0.56,
    macro: null, fundamentals: null,
  },
  missing: ['macro', 'fundamentals'], limitations: [], ...overrides,
});

function example(i: number, pnl: number, group = Math.floor(i / 2)): WinLearningExample {
  const entry = T + 10_000 + i * 150_000;
  const o: WinClosedLotOutcome = {
    outcomeId: `lot-${i}`, walletAddress: wallet(group),
    instrumentId: instrument, mintAddress: '3'.repeat(32),
    entryEvidenceId: `buy-${i}`, exitEvidenceId: `sell-${i}`,
    exitEvidenceIds: [`sell-${i}`], exitSourceSnapshotIds: [`exit-${i}`],
    entryAt: entry, entryReceivedAt: entry + 200,
    exitAt: entry + 80_000, exitReceivedAt: entry + 80_100,
    entrySourceSnapshotId: `entry-${i}`, exitSourceSnapshotId: `exit-${i}`,
    grossWhalePnlUsd: pnl + 1, simulatedFollowerNetPnlUsd: pnl,
  };
  return {
    outcome: o, fingerprintSourceId: `snapshot-${i}`,
    fingerprintAvailableAt: entry - 500,
    entryFingerprint: dna(entry - 1000),
  };
}
const candidate = dna(T + 3_000_000);
const losses = Array.from({ length: 6 }, (_, i) => example(i, -10));
const wins = Array.from({ length: 6 }, (_, i) => example(i, 10));

describe('WIN-L01 outcome-conditioned market DNA learning (no trade authority)', () => {
  it('proposes an abstain review for independently repeated similar losing setups', () => {
    const result = assessWinAdaptiveLearning(losses, candidate);
    expect(result).toMatchObject({
      signal: 'AVOID_SIMILAR_LOSS_PATTERN_RESEARCH',
      suggestedThinkHandling: 'ABSTAIN_REVIEW',
      matchingClosedLots: 6, independentWallets: 3,
      matchedLossCount: 6, matchedWinCount: 0,
      canAuthorizeTrade: false, canChangeRiskLimits: false, researchOnly: true,
    });
    expect(result.meanSimulatedFollowerPnlUsd).toBe(-10);
  });

  it('remembers similar winning outcomes only as a DEEP research hypothesis', () => {
    const result = assessWinAdaptiveLearning(wins, candidate);
    expect(result.signal).toBe('STUDY_SIMILAR_WIN_PATTERN_RESEARCH');
    expect(result.suggestedThinkHandling).toBe('DEEP_REVIEW');
    expect(result.reasonCodes).toContain('WINNER_NEEDS_HOLDOUT_VALIDATION');
    expect(result.canAuthorizeTrade).toBe(false);
  });

  it('does not infer a reusable pattern from a single whale or a small sample', () => {
    const singleWallet = Array.from({ length: 10 }, (_, i) => example(i, -10, 0));
    const r = assessWinAdaptiveLearning(singleWallet, candidate);
    expect(r.signal).toBe('INSUFFICIENT_EVIDENCE');
    expect(r.matchingClosedLots).toBe(4);
    expect(r.reasonCodes).toContain('WALLET_CORRELATION_CAP');
    expect(r.independentWallets).toBe(1);
    expect(assessWinAdaptiveLearning(wins.slice(0, 5), candidate).signal).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('will not train on future-visible outcomes, future entry fingerprints or missing snapshots', () => {
    const future = { ...losses[0], outcome: { ...losses[0].outcome,
      exitReceivedAt: candidate.asOf + 1 } };
    const futureDna = { ...losses[1], fingerprintAvailableAt: losses[1].outcome.entryAt + 1 };
    const missing = { ...losses[2], entryFingerprint: null };
    const r = assessWinAdaptiveLearning([future, futureDna, missing, ...losses.slice(3)], candidate);
    expect(r.signal).toBe('INSUFFICIENT_EVIDENCE');
    expect(r.rejectedEvidence).toBe(3);
    expect(r.matchingClosedLots).toBe(3);
  });

  it('does not use gross whale profitability when independent follower costs are unavailable', () => {
    const noFollower = losses.map(e => ({ ...e, outcome: {
      ...e.outcome, grossWhalePnlUsd: 100,
      simulatedFollowerNetPnlUsd: null,
    } }));
    const r = assessWinAdaptiveLearning(noFollower, candidate);
    expect(r.matchingClosedLots).toBe(0);
    expect(r.meanSimulatedFollowerPnlUsd).toBeNull();
    expect(r.signal).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('refuses an incomplete or contradictory exit-proof chain', () => {
    const tampered = { ...wins[0], outcome: {
      ...wins[0].outcome, exitEvidenceIds: ['different-exit'],
    } };
    const missing = { ...wins[1], outcome: {
      ...wins[1].outcome, exitSourceSnapshotIds: [],
    } };
    const r = assessWinAdaptiveLearning([tampered, missing, ...wins.slice(2)], candidate);
    expect(r.rejectedEvidence).toBe(2);
    expect(r.matchingClosedLots).toBe(4);
    expect(r.signal).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('deduplicates replayed outcomes and partially closed entries, resisting inflated samples', () => {
    const replay = [...wins.slice(0, 5), wins[0], {
      ...wins[5],
      outcome: { ...wins[5].outcome, entryEvidenceId: wins[4].outcome.entryEvidenceId,
        walletAddress: wins[4].outcome.walletAddress },
    }];
    const r = assessWinAdaptiveLearning(replay, candidate);
    expect(r.matchingClosedLots).toBe(5);
    expect(r.rejectedEvidence).toBe(2);
    expect(r.signal).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('abstains from a mixed history and does not generalize across regimes', () => {
    const mixed = wins.map((e, i) => i % 2 ? { ...e, outcome: {
      ...e.outcome, simulatedFollowerNetPnlUsd: -20 } } : e);
    const r = assessWinAdaptiveLearning(mixed, candidate);
    expect(r.signal).toBe('MIXED_OR_UNSTABLE_RESEARCH');
    expect(r.suggestedThinkHandling).toBe('NO_CHANGE');
    const wrongRegime = wins.map(e => ({ ...e, entryFingerprint: dna(e.outcome.entryAt - 1000,
      { regime: 'RANGE' }) }));
    expect(assessWinAdaptiveLearning(wrongRegime, candidate).matchingClosedLots).toBe(0);
  });

  it('cannot treat invalid, unknown or unavailable candidate DNA as authorization', () => {
    const bad = assessWinAdaptiveLearning(wins, dna(candidate.asOf, { dataQuality: 'FAIL' }));
    expect(bad).toMatchObject({ signal: 'INSUFFICIENT_EVIDENCE',
      reasonCodes: ['INVALID_OR_UNTRUSTED_CANDIDATE_DNA'], canAuthorizeTrade: false });
    expect(assessWinAdaptiveLearning(wins, candidate, candidate.asOf - 1).signal).toBe('INSUFFICIENT_EVIDENCE');
  });
});
