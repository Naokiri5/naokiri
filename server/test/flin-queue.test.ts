import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { all, closeDb } from '../src/db/db.js';
import { freshDb } from './helpers.js';
import type { DexPair } from '../src/providers/dexscreener.js';
import {
  FLIN_MAX_BATCH, FLIN_SOURCE_MAX_AGE_MS, evaluateFlinEvidence,
  flinQueueStatus, ingestFlinDexSnapshot, type FlinRoundTripProof, type FlinSafetyProof,
} from '../src/market/flinQueue.js';

const NOW = Date.UTC(2026, 10, 23, 13, 0, 0);
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const testPubkey = (n: number) => '1'.repeat(30) + alphabet[Math.floor((n + 256) / 58)] + alphabet[(n + 256) % 58];
const pair = (n: number): DexPair => ({
  chainId: 'solana', dexId: 'fixture', pairAddress: testPubkey(n + 1000),
  baseAddress: testPubkey(n), url: 'https://example.invalid/launch/' + n,
  baseName: 'Fixture', baseSymbol: 'F' + n, quoteSymbol: 'SOL',
  priceUsd: 0.02, liquidityUsd: 200_000, fdv: 1_000_000, marketCap: 1_000_000,
  volume24h: 100_000, volume1h: 12_000, buys24h: 60, sells24h: 40,
  buys1h: 15, sells1h: 10, change1h: 2, change24h: 3,
  pairCreatedAt: NOW - 5 * 60_000, hasSocials: true, hasWebsite: true,
});
const mint = 'verified-mint-address';
const safety = (): FlinSafetyProof => ({
  mintAddress: mint, verifiedAt: NOW, verificationComplete: true,
  mintAuthorityRevokedOrSafe: true, freezeAuthorityRevokedOrSafe: true,
  topHolderConcentrationPct: 12,
  extensions: { hasPermanentDelegate: false, hasTransferHook: false,
    hasNonTransferable: false, hasUnknownExtension: false },
  sellSimulationSucceeded: true,
});
const route = (): FlinRoundTripProof => ({
  mintAddress: mint, verifiedAt: NOW, plannedSizeSol: 0.2,
  buySimulationSucceeded: true, sellableAtPlannedSize: true,
  expectedGrossPnlSol: 0.002, allInRoundTripCostSol: 0.001,
});

beforeEach(() => freshDb(false));
afterEach(() => closeDb());

describe('FLIN persisted continuous research, not order execution', () => {
  it('processes at least 100 distinct recent observations with one canonical candidate per pair', () => {
    const batch = Array.from({ length: 150 }, (_, i) => pair(i));
    const first = ingestFlinDexSnapshot(batch, NOW, NOW);
    expect(first).toMatchObject({ scanned: 150, newCandidates: 150, updated: 0, tradingAuthority: false });
    expect(flinQueueStatus(2)).toMatchObject({ totalObserved: 150, tradingAuthority: false });
    const second = ingestFlinDexSnapshot([...batch, ...batch.slice(0, 12)], NOW, NOW + 1_000);
    expect(second).toMatchObject({ scanned: 150, newCandidates: 0, updated: 0 });
    expect(flinQueueStatus(5).totalObserved).toBe(150);
    for (const table of ['orders','fills','positions','ledger_entries'])
      expect(all('SELECT * FROM ' + table)).toHaveLength(0);
  });

  it('bounds workload, rejects future/outdated sources and excludes non-Solana/invalid pools', () => {
    const batch = Array.from({ length: FLIN_MAX_BATCH + 10 }, (_, i) => pair(i));
    const capped = ingestFlinDexSnapshot(batch, NOW, NOW);
    expect(capped.scanned).toBe(FLIN_MAX_BATCH);
    expect(capped.truncated).toBe(true);
    expect(ingestFlinDexSnapshot(batch, NOW, NOW + FLIN_SOURCE_MAX_AGE_MS + 1).status).toBe('STALE_SOURCE');
    expect(ingestFlinDexSnapshot(batch, NOW + 1, NOW).status).toBe('STALE_SOURCE');
    expect(ingestFlinDexSnapshot([{ ...pair(999), chainId: 'ethereum' }], NOW, NOW).scanned).toBe(0);
    expect(ingestFlinDexSnapshot([{ ...pair(999), pairCreatedAt: NOW + 1 }], NOW, NOW).scanned).toBe(0);
    expect(ingestFlinDexSnapshot([{ ...pair(999), pairAddress: 'pool-address-999' }], NOW, NOW).scanned).toBe(0);
  });

  it('keeps age risk visible while quarantining an otherwise observable new token', () => {
    ingestFlinDexSnapshot([pair(1), { ...pair(2), liquidityUsd: 500 }], NOW, NOW);
    expect(flinQueueStatus().recent).toEqual(expect.arrayContaining([
      expect.objectContaining({ mintAddress: pair(1).baseAddress, state: 'QUARANTINED' }),
      expect.objectContaining({ mintAddress: pair(2).baseAddress, state: 'REJECTED' }),
    ]));
    const stored = all<{ evidence_json: string }>('SELECT evidence_json FROM flin_launch_candidates WHERE mint_address=?', pair(1).baseAddress);
    expect(JSON.parse(stored[0].evidence_json)).toMatchObject({
      expiresAt: NOW + FLIN_SOURCE_MAX_AGE_MS, safety: { status: 'HIGH_RISK', eligibleForAutomation: false },
    });
  });

  it('does not replace safety evidence or refresh last-seen time on equal-timestamp replay', () => {
    ingestFlinDexSnapshot([pair(1)], NOW, NOW);
    const before = all('SELECT * FROM flin_launch_candidates');
    const replay = ingestFlinDexSnapshot([{ ...pair(1), liquidityUsd: 1 }], NOW, NOW + 1_000);
    expect(replay.updated).toBe(0);
    expect(all('SELECT * FROM flin_launch_candidates')).toEqual(before);
    expect(ingestFlinDexSnapshot([pair(1)], NOW + 2_000, NOW + 2_000).updated).toBe(1);
    expect(flinQueueStatus(1).recent[0].lastSeenAt).toBe(NOW + 2_000);
  });

  it('cannot overwrite newer evidence from an older source snapshot', () => {
    const first = ingestFlinDexSnapshot([pair(1)], NOW, NOW);
    expect(first.newCandidates).toBe(1);
    const next = ingestFlinDexSnapshot([pair(1)], NOW + 1_000, NOW + 1_000);
    expect(next.updated).toBe(1);
    expect(ingestFlinDexSnapshot([pair(1)], NOW, NOW + 2_000).updated).toBe(0);
    expect(flinQueueStatus(1).recent[0].sourceAsOf).toBe(NOW + 1_000);
  });

  it('rejects unknown permissions and every high-risk Token-2022 extension', () => {
    const good = safety();
    expect(evaluateFlinEvidence(mint, null, route(), NOW).disposition).toBe('NO_TRADE');
    expect(evaluateFlinEvidence(mint, { ...good, verificationComplete: false }, route(), NOW).reason)
      .toBe('TOKEN_SAFETY_UNVERIFIED_OR_STALE');
    for (const flag of ['hasPermanentDelegate', 'hasTransferHook', 'hasNonTransferable', 'hasUnknownExtension'] as const) {
      expect(evaluateFlinEvidence(mint, { ...good, extensions: { ...good.extensions, [flag]: true } }, route(), NOW).reason)
        .toBe('TOKEN_AUTHORITY_OR_EXTENSION_RISK');
    }
    expect(evaluateFlinEvidence(mint, { ...good, topHolderConcentrationPct: undefined }, route(), NOW).reason)
      .toBe('CONCENTRATED_OR_UNVERIFIED_HOLDERS');
  });

  it('rejects buy-only tokens, mismatched/stale sell routes, and nonpositive net edge', () => {
    expect(evaluateFlinEvidence(mint, { ...safety(), sellSimulationSucceeded: false }, route(), NOW).reason)
      .toBe('SELL_SIMULATION_FAILED');
    expect(evaluateFlinEvidence(mint, safety(), { ...route(), mintAddress: 'wrong-mint' }, NOW).disposition)
      .toBe('NO_TRADE');
    expect(evaluateFlinEvidence(mint, safety(), { ...route(), sellableAtPlannedSize: false }, NOW).disposition)
      .toBe('NO_TRADE');
    expect(evaluateFlinEvidence(mint, safety(), { ...route(), allInRoundTripCostSol: 0.002 }, NOW).reason)
      .toBe('NONPOSITIVE_ROUND_TRIP_NET_EDGE');
    expect(evaluateFlinEvidence(mint, safety(), route(), NOW + 30_001).disposition).toBe('NO_TRADE');
    expect(evaluateFlinEvidence(mint, safety(), { ...route(), allInRoundTripCostSol: Number.NaN }, NOW).disposition)
      .toBe('NO_TRADE');
  });

  it('a fully evidenced positive round trip still has zero execution authority', () => {
    expect(evaluateFlinEvidence(mint, safety(), route(), NOW)).toEqual({
      disposition: 'RESEARCH_QUALIFIED', expectedNetEdgeSol: 0.001, tradingAuthority: false,
      reason: 'ADVISORY_ONLY_OMS_AND_RELEASE_GATES_REQUIRED',
    });
  });
});

describe('FLIN untrusted runtime proof validation', () => {
  it('requires explicit negative extension evidence and affirmative proof flags', () => {
    for (const value of [undefined, null, 'false', 0]) {
      const malformed = { ...safety(), extensions: { ...safety().extensions, hasTransferHook: value } };
      expect(evaluateFlinEvidence(mint, malformed as unknown as FlinSafetyProof, route(), NOW).disposition).toBe('NO_TRADE');
    }
    expect(evaluateFlinEvidence(mint, { ...safety(), extensions: undefined } as unknown as FlinSafetyProof, route(), NOW).disposition).toBe('NO_TRADE');
    for (const field of ['verificationComplete', 'mintAuthorityRevokedOrSafe', 'freezeAuthorityRevokedOrSafe', 'sellSimulationSucceeded'] as const) {
      const malformed = { ...safety(), [field]: 'true' } as unknown as FlinSafetyProof;
      expect(evaluateFlinEvidence(mint, malformed, route(), NOW).disposition).toBe('NO_TRADE');
    }
    for (const field of ['buySimulationSucceeded', 'sellableAtPlannedSize'] as const) {
      const malformed = { ...route(), [field]: 'true' } as unknown as FlinRoundTripProof;
      expect(evaluateFlinEvidence(mint, safety(), malformed, NOW).disposition).toBe('NO_TRADE');
    }
  });
});
