/**
 * Display helpers for the S6 attention surfaces (notification center, "Why MIA is not trading"). Pure, so the ageing
 * rule is testable: the server sends each row's age at response time, and the client adds monotonic time elapsed since
 * that request was sent (performance.now(), never Date.now()), so evidence turns STALE between polls and a wall-clock
 * jump cannot make it fresh again. The server stays authoritative for every reason and blocker.
 */
export type ReasonGroup = 'data' | 'safety' | 'consensus' | 'risk' | 'mode';
export interface Reason { group: ReasonGroup; code: string; text: string }
export type Evidence = 'RECENT' | 'STALE' | 'UNKNOWN';

export const REASON_GROUPS: { id: ReasonGroup; label: string }[] = [
  { id: 'data', label: 'Data' }, { id: 'safety', label: 'Safety' }, { id: 'consensus', label: 'Consensus' }, { id: 'risk', label: 'Risk' }, { id: 'mode', label: 'Mode / policy' },
];

/** Age now = server-reported age + monotonic time since the request was sent. Unknown inputs stay UNKNOWN. */
export function liveEvidence(row: { evidence: Evidence; ageMs: number | null }, requestedAt: number | null, now: number, ttlMs: number): { evidence: Evidence; ageMs: number | null } {
  if (row.evidence === 'UNKNOWN' || row.ageMs == null || requestedAt == null || !Number.isFinite(row.ageMs)) return { evidence: 'UNKNOWN', ageMs: row.ageMs };
  const ageMs = row.ageMs + Math.max(0, now - requestedAt);
  return { evidence: ageMs >= ttlMs ? 'STALE' : 'RECENT', ageMs };
}

/** Reasons grouped in the fixed display order; empty groups are left out. */
export function groupReasons(reasons: Reason[]) {
  return REASON_GROUPS.map((g) => ({ ...g, reasons: reasons.filter((r) => r.group === g.id) })).filter((g) => g.reasons.length);
}
