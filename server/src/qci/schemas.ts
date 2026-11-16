import { z } from 'zod';

/** Part 29.6 versioned evidence + consensus contracts. Validated at every boundary. */
export const EVIDENCE_SCHEMA_VERSION = '1.0' as const;
export const DomainEnum = z.enum(['trend', 'momentum', 'volatility', 'flow', 'liquidity', 'structure', 'regime', 'news', 'onchain', 'risk', 'execution']);
export const StanceEnum = z.enum(['SUPPORT', 'OPPOSE', 'ABSTAIN']);
const Feat = z.record(z.string(), z.union([z.number(), z.string(), z.boolean(), z.null()]));

export const EvidencePacket = z.object({
  schema_version: z.literal(EVIDENCE_SCHEMA_VERSION),
  packet_id: z.string().min(8).max(64),
  event_id: z.string().min(1).max(64),
  candidate_id: z.string().min(1).max(64),
  instrument_id: z.string().min(1).max(64),
  venue_or_chain: z.string().min(1).max(32),
  worker_id: z.string().regex(/^W-[A-Z]{3}-\d{2}$/),
  worker_version: z.string().max(16),
  model_or_algorithm_version: z.string().max(32).nullable(),
  analysis_timestamp: z.string().datetime(),
  source_ids: z.array(z.string().max(64)).max(10),
  source_freshness_ms: z.number().int().min(0).nullable(),
  stance: StanceEnum,
  evidence_domain: DomainEnum,
  dependency_group: z.string().max(64),
  features: Feat,
  confidence: z.literal('NOT_CALIBRATED'),
  uncertainty_notes: z.array(z.string().max(300)).max(10),
  invalidation_conditions: z.array(z.string().max(300)).max(10),
  reason_codes: z.array(z.string().max(300)).max(20),
  veto: z.boolean(),
  latency_ms: z.number().min(0),
  trace_id: z.string().max(64),
});
export type EvidencePacket = z.infer<typeof EvidencePacket>;
export const SignedPacket = z.object({ packet: EvidencePacket, sig: z.string().regex(/^[0-9a-f]{64}$/) });
export type SignedPacket = z.infer<typeof SignedPacket>;

export const ConsensusState = z.enum(['STRONG_CONSENSUS', 'MIXED_CONSENSUS', 'NO_QUORUM', 'VETOED', 'EXPIRED']);
export type ConsensusState = z.infer<typeof ConsensusState>;
export const ChallengeFinding = z.object({ reviewer: z.enum(['BULL', 'BEAR', 'CONTRARIAN', 'DATA_AUDITOR', 'EXECUTION']), stance: StanceEnum, critical: z.boolean(), findings: z.array(z.string()) });
export type ChallengeFinding = z.infer<typeof ChallengeFinding>;

export interface ConsensusRecord {
  schema_version: '1.0'; consensus_id: string; candidate_id: string; event_id: string; instrument_id: string; strategy_id: string;
  state: ConsensusState; reason_codes: string[];
  created_at: string; expires_at: string; analysis_ms: number;
  method: { id: 'domain-capped-weighted-v1'; support_threshold: number; max_opposition: number; min_response_ratio: number; calibration: 'NOT_CALIBRATED' };
  workers: { eligible: number; responding: number; abstaining: number; failed: number; quarantined: number; rejected_packets: number };
  domains: { domain: string; groups: number; support: number; oppose: number; abstain: number; score: number | null; weight: number; required: boolean }[];
  dependency_groups: number;
  weighted_support: number; weighted_opposition: number;
  vetoes: { worker_id: string; reasons: string[] }[];
  challenge: ChallengeFinding[];
  missing_inputs: string[];
  coordinator_version: string; trace_id: string;
}
