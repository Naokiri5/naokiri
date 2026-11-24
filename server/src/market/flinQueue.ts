import { all, get, J, run, tx } from '../db/db.js';
import type { DexPair } from '../providers/dexscreener.js';
import { assessDexPair } from '../safety/safety.js';

/**
 * FLIN intake of already-observed DEX profiles. This is NOT a Solana RPC launch subscriber,
 * an on-chain permission verifier, a Jupiter quote, an OMS, or trading authorization.
 * The single persistent queue is bounded per pass and replay-safe across process restarts.
 */
export const FLIN_MAX_BATCH = 250;
export const FLIN_SOURCE_MAX_AGE_MS = 4 * 60_000;
export const FLIN_LAUNCH_WINDOW_MS = 24 * 60 * 60_000;
export const FLIN_PROOF_MAX_AGE_MS = 30_000;
export type FlinResearchState = 'QUARANTINED' | 'REJECTED';

export interface FlinIntakeResult {
  source: 'DEX_PROFILE_OBSERVATION';
  tradingAuthority: false;
  scanned: number;
  newCandidates: number;
  updated: number;
  rejected: number;
  sourceAsOf: number;
  truncated: boolean;
  status: 'OK' | 'STALE_SOURCE';
}
export interface FlinPersistedCandidate {
  candidate_id: string;
  mint_address: string;
  pair_address: string;
  first_seen_at: number;
  last_seen_at: number;
  source_as_of: number;
  state: FlinResearchState;
  reason: string;
  evidence_json: string;
}

const validText = (s: string) => typeof s === 'string' && s.length >= 4 && s.length <= 200 && !/[\x00-\x1f]/.test(s);
const validTs = (n: number) => Number.isSafeInteger(n) && n > 0;

/** Reobserving the same pair updates its last-known evidence, not a second candidate or trade. */
export function ingestFlinDexSnapshot(
  pairs: readonly DexPair[], sourceAsOf: number, now = Date.now(),
): FlinIntakeResult {
  if (!validTs(now)) throw new Error('INVALID_FLIN_CLOCK');
  if (!Array.isArray(pairs)) throw new Error('INVALID_FLIN_PAIRS');
  const basic = { source: 'DEX_PROFILE_OBSERVATION' as const, tradingAuthority: false as const, sourceAsOf };
  if (!validTs(sourceAsOf) || sourceAsOf > now || now - sourceAsOf > FLIN_SOURCE_MAX_AGE_MS)
    return { ...basic, scanned: 0, newCandidates: 0, updated: 0, rejected: 0, truncated: false, status: 'STALE_SOURCE' };

  // Limit work in one pass, deduplicate by chain+mint+pool, and make order deterministic.
  const eligible = pairs.filter(p => p.chainId === 'solana'
    && validText(p.baseAddress) && validText(p.pairAddress)
    && validTs(p.pairCreatedAt ?? 0) && p.pairCreatedAt! <= sourceAsOf
    && sourceAsOf - p.pairCreatedAt! <= FLIN_LAUNCH_WINDOW_MS);
  const unique = new Map<string, DexPair>();
  for (const p of eligible) {
    const id = 'solana:' + p.baseAddress + ':' + p.pairAddress;
    if (!unique.has(id) || (p.liquidityUsd > (unique.get(id)?.liquidityUsd ?? -Infinity))) unique.set(id, p);
  }
  const ordered = [...unique.entries()].sort(([a], [b]) => a.localeCompare(b));
  const limited = ordered.slice(0, FLIN_MAX_BATCH);
  let newCandidates = 0, updated = 0, rejected = 0;
  tx(() => {
    for (const [id, pair] of limited) {
      const safety = assessDexPair(pair, now);
      const state: FlinResearchState = ['REJECTED','HIGH_RISK'].includes(safety.status) ? 'REJECTED' : 'QUARANTINED';
      if (state === 'REJECTED') rejected++;
      const reason = state === 'REJECTED'
        ? 'DEX_HEURISTIC_RISK:' + safety.status
        : 'ONCHAIN_PERMISSIONS_AND_EXECUTABLE_SELL_ROUTE_UNVERIFIED';
      const existing = get<{ source_as_of: number }>('SELECT source_as_of FROM flin_launch_candidates WHERE candidate_id=?', id);
      if (existing && existing.source_as_of > sourceAsOf) continue; // reject out-of-order evidence
      run(`INSERT INTO flin_launch_candidates(
        candidate_id,mint_address,pair_address,first_seen_at,last_seen_at,source_as_of,state,reason,evidence_json
      ) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(candidate_id) DO UPDATE SET
        last_seen_at=excluded.last_seen_at,source_as_of=excluded.source_as_of,
        state=excluded.state,reason=excluded.reason,evidence_json=excluded.evidence_json`,
        id, pair.baseAddress, pair.pairAddress, pair.pairCreatedAt!, now, sourceAsOf,
        state, reason, J({ source: 'DEX_PROFILE_OBSERVATION', safety, liquidityUsd: pair.liquidityUsd, volume1h: pair.volume1h }),
      );
      if (existing) updated++; else newCandidates++;
    }
  });
  return { ...basic, status: 'OK', scanned: limited.length, newCandidates, updated, rejected,
    truncated: ordered.length > FLIN_MAX_BATCH };
}

export function flinQueueStatus(limit = 10) {
  if (!Number.isInteger(limit) || limit < 0 || limit > 100) throw new Error('INVALID_FLIN_LIMIT');
  const totals = get<{ total: number; rejected: number }>(
    `SELECT COUNT(*) total, COALESCE(SUM(CASE WHEN state='REJECTED' THEN 1 ELSE 0 END),0) rejected
     FROM flin_launch_candidates`,
  )!;
  const recent = all<FlinPersistedCandidate>(
    'SELECT * FROM flin_launch_candidates ORDER BY last_seen_at DESC,candidate_id LIMIT ?', limit,
  );
  return { tradingAuthority: false as const, source: 'DEX_PROFILE_OBSERVATION' as const,
    totalObserved: totals.total, rejected: totals.rejected, quarantined: totals.total - totals.rejected,
    recent: recent.map(r => ({
      candidateId: r.candidate_id, mintAddress: r.mint_address, pairAddress: r.pair_address,
      state: r.state, sourceAsOf: r.source_as_of, lastSeenAt: r.last_seen_at, reason: r.reason,
    })) };
}

export interface FlinSafetyProof {
  mintAddress: string;
  verifiedAt: number;
  verificationComplete: boolean;
  mintAuthorityRevokedOrSafe: boolean;
  freezeAuthorityRevokedOrSafe: boolean;
  topHolderConcentrationPct?: number;
  extensions: { hasPermanentDelegate: boolean; hasTransferHook: boolean;
    hasNonTransferable: boolean; hasUnknownExtension: boolean };
  sellSimulationSucceeded: boolean;
}
export interface FlinRoundTripProof {
  mintAddress: string; verifiedAt: number; plannedSizeSol: number;
  buySimulationSucceeded: boolean; sellableAtPlannedSize: boolean;
  expectedGrossPnlSol: number; allInRoundTripCostSol: number;
}
export type FlinExecutionEvidenceDecision = {
  tradingAuthority: false;
  disposition: 'NO_TRADE' | 'RESEARCH_QUALIFIED';
  reason: string; expectedNetEdgeSol: number | null;
};

/**
 * Only a verified token-proof AND same-size round-trip quote may pass RESEARCH_QUALIFIED.
 * This is still advisory; existing Choice/Risk/OMS and a certified signer must independently approve.
 */
export function evaluateFlinEvidence(
  mint: string, safety: FlinSafetyProof | null, route: FlinRoundTripProof | null, now = Date.now(),
): FlinExecutionEvidenceDecision {
  const no = (reason: string): FlinExecutionEvidenceDecision =>
    ({ tradingAuthority: false, disposition: 'NO_TRADE', reason, expectedNetEdgeSol: null });
  if (!validTs(now) || !validText(mint)) return no('INVALID_MINT_OR_CLOCK');
  if (!safety || safety.mintAddress !== mint || safety.verificationComplete !== true
    || !validTs(safety.verifiedAt) || safety.verifiedAt > now || now - safety.verifiedAt > FLIN_PROOF_MAX_AGE_MS)
    return no('TOKEN_SAFETY_UNVERIFIED_OR_STALE');
  if (safety.mintAuthorityRevokedOrSafe !== true || safety.freezeAuthorityRevokedOrSafe !== true ||
      safety.extensions?.hasPermanentDelegate !== false || safety.extensions?.hasTransferHook !== false ||
      safety.extensions?.hasNonTransferable !== false || safety.extensions?.hasUnknownExtension !== false)
    return no('TOKEN_AUTHORITY_OR_EXTENSION_RISK');
  if (safety.topHolderConcentrationPct == null || !Number.isFinite(safety.topHolderConcentrationPct)
    || safety.topHolderConcentrationPct < 0 || safety.topHolderConcentrationPct > 100
    || safety.topHolderConcentrationPct > 25)
    return no('CONCENTRATED_OR_UNVERIFIED_HOLDERS');
  if (safety.sellSimulationSucceeded !== true) return no('SELL_SIMULATION_FAILED');
  if (!route || route.mintAddress !== mint || !validTs(route.verifiedAt)
    || route.verifiedAt > now || now - route.verifiedAt > FLIN_PROOF_MAX_AGE_MS
    || route.buySimulationSucceeded !== true || route.sellableAtPlannedSize !== true
    || !Number.isFinite(route.plannedSizeSol) || route.plannedSizeSol <= 0)
    return no('ROUND_TRIP_ROUTE_UNVERIFIED_OR_STALE');
  if (![route.expectedGrossPnlSol, route.allInRoundTripCostSol].every(Number.isFinite)
    || route.allInRoundTripCostSol < 0) return no('INVALID_COST_EVIDENCE');
  const edge = route.expectedGrossPnlSol - route.allInRoundTripCostSol;
  if (!Number.isFinite(edge) || !(edge > 0)) return no('NONPOSITIVE_ROUND_TRIP_NET_EDGE');
  return { tradingAuthority: false, disposition: 'RESEARCH_QUALIFIED',
    reason: 'ADVISORY_ONLY_OMS_AND_RELEASE_GATES_REQUIRED', expectedNetEdgeSol: edge };
}
