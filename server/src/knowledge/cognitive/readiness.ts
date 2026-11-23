import type {
  BrainAgentContract, BrainSkillContract, BrainSkillId, CapabilityObservation,
  MarketVenueClass, ReadinessStatus,
} from './contracts.js';

/** Only verified, causally current observations can satisfy required source contracts. */
export interface ReadinessEnvironment {
  nowMs: number;
  observationsBySource: Readonly<Record<string, CapabilityObservation>>;
  verifiedTimeframes: ReadonlySet<string>;
  verifiedVenues: ReadonlySet<MarketVenueClass>;
}
export interface ResolvedSkillState {
  skillId: BrainSkillId;
  status: ReadinessStatus;
  missingRequiredSources: string[];
  staleRequiredSources: string[];
  missingOptionalSources: string[];
  unsupportedTimeframes: string[];
  unsupportedVenue: boolean;
}
export interface ResolvedRoleState {
  roleId: string;
  status: ReadinessStatus;
  skillStatuses: Record<BrainSkillId, ReadinessStatus>;
  missingEvidence: string[];
  eligibleToDispatch: boolean;
}

export function isFreshVerified(
  observation: CapabilityObservation | undefined, nowMs: number, maximumAgeMs: number,
): boolean {
  if (!observation || !observation.available || observation.verified !== true) return false;
  const allowed = Math.min(observation.maxAgeMs, maximumAgeMs);
  return Number.isSafeInteger(nowMs) && Number.isSafeInteger(observation.observedAtMs)
    && observation.observedAtMs > 0 && observation.observedAtMs <= nowMs
    && Number.isFinite(allowed) && allowed > 0 && nowMs - observation.observedAtMs <= allowed;
}

export function resolveSkillReadiness(
  skill: BrainSkillContract, env: ReadinessEnvironment, venue?: MarketVenueClass,
): ResolvedSkillState {
  const missingRequiredSources: string[] = [], staleRequiredSources: string[] = [];
  const missingOptionalSources: string[] = [], unsupportedTimeframes: string[] = [];
  for (const src of skill.requiredSources) {
    const observation = env.observationsBySource[src];
    if (!observation || !observation.available || observation.verified !== true)
      missingRequiredSources.push(src);
    else if (!isFreshVerified(observation, env.nowMs, skill.maxEvidenceAgeMs))
      staleRequiredSources.push(src);
  }
  for (const src of skill.optionalSources ?? []) {
    if (!isFreshVerified(env.observationsBySource[src], env.nowMs, skill.maxEvidenceAgeMs))
      missingOptionalSources.push(src);
  }
  for (const interval of skill.requiredTimeframes ?? []) {
    if (!env.verifiedTimeframes.has(interval)) unsupportedTimeframes.push(interval);
  }
  const unsupportedVenue = venue !== undefined &&
    (!env.verifiedVenues.has(venue) || (skill.supportedMarkets !== undefined &&
      !skill.supportedMarkets.includes(venue)));
  // Required source staleness is BLOCKED (not DEGRADED) because no stale observation
  // is allowed to become a research or trading eligibility substitute.
  const critical = missingRequiredSources.length > 0 || staleRequiredSources.length > 0
    || unsupportedTimeframes.length > 0 || unsupportedVenue;
  const status: ReadinessStatus = skill.status === 'UNAVAILABLE' ? 'UNAVAILABLE'
    : skill.status === 'BLOCKED' || critical ? 'BLOCKED'
    : skill.status === 'DEGRADED' || missingOptionalSources.length > 0 ? 'DEGRADED'
    : 'READY';
  return { skillId: skill.id, status, missingRequiredSources,
    staleRequiredSources, missingOptionalSources, unsupportedTimeframes, unsupportedVenue };
}

export function resolveRoleReadiness(
  role: BrainAgentContract,
  skills: Readonly<Record<BrainSkillId, BrainSkillContract>>,
  env: ReadinessEnvironment,
  venue?: MarketVenueClass,
): ResolvedRoleState {
  const skillStatuses: Record<BrainSkillId, ReadinessStatus> = {};
  const missingEvidence = role.requiredEvidence.filter(
    src => !isFreshVerified(env.observationsBySource[src], env.nowMs, 60_000),
  );
  for (const id of role.skills)
    skillStatuses[id] = skills[id] ? resolveSkillReadiness(skills[id], env, venue).status : 'UNAVAILABLE';
  const statuses = Object.values(skillStatuses);
  const status: ReadinessStatus = !statuses.length || statuses.includes('UNAVAILABLE') ? 'UNAVAILABLE'
    : missingEvidence.length || statuses.includes('BLOCKED') ? 'BLOCKED'
    : statuses.includes('DEGRADED') ? 'DEGRADED' : 'READY';
  // Degraded roles can contribute noncritical explanation; never promote them to
  // a prerequisite for a risk-bearing futures/FAST action.
  return { roleId: role.id, status, skillStatuses, missingEvidence,
    eligibleToDispatch: status === 'READY' || status === 'DEGRADED' };
}
