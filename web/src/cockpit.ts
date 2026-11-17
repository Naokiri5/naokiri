/** Existing /api/shell fields used by the read-only view. No execution permission is inferred. */
export interface CockpitSnapshot {
  mode?: string; display?: string; offline?: boolean; policyAccepted?: boolean;
  control?: { emergency?: boolean; pausedNewOrders?: boolean };
  account?: { equity?: number; dailyPnlPct?: number; openRiskPct?: number };
  dataHealth?: { stale?: boolean; tickersAt?: number; scanAt?: number };
}
export type SourceState = 'CURRENT' | 'STALE' | 'UNKNOWN';
export function sourceState(timestamp: number | null | undefined, now: number, maxAge: number): SourceState {
  if (!Number.isFinite(timestamp) || !timestamp || !Number.isFinite(now) || timestamp > now || timestamp <= 0) return 'UNKNOWN';
  return now - timestamp > maxAge ? 'STALE' : 'CURRENT';
}
export function monitorState(snapshot: CockpitSnapshot | null, now: number, receivedAt: number | null, requestError: string | null) {
  const receipt = sourceState(receivedAt, now, 45_000);
  const market = sourceState(snapshot?.dataHealth?.tickersAt, now, 60_000);
  const scanner = sourceState(snapshot?.dataHealth?.scanAt, now, 300_000);
  const known = snapshot != null;
  const mode = snapshot && ['OBSERVE', 'PAPER', 'APPROVAL', 'BOUNDED_LIVE'].includes(snapshot.mode ?? '') ? snapshot.display ?? snapshot.mode! : 'UNKNOWN';
  return { mode, market: snapshot?.dataHealth?.stale && market === 'CURRENT' ? 'STALE' as const : market, scanner,
    lastKnown: known && (!!requestError || receipt !== 'CURRENT'),
    message: !known ? 'Status unavailable — no verified account snapshot.' : snapshot.control?.emergency ? 'EMERGENCY — new entries blocked. Review the Risk Center.'
      : requestError || receipt !== 'CURRENT' ? 'LAST KNOWN — account connection is stale or unavailable.'
      : snapshot.control?.pausedNewOrders ? 'New entries paused. Existing positions still need monitoring.'
      : snapshot.offline ? 'OFFLINE — market feeds are disabled.'
      : snapshot.policyAccepted !== true ? 'Waiting for an accepted risk policy.'
      : market !== 'CURRENT' || snapshot.dataHealth?.stale !== false ? 'Waiting for current market data.'
      : scanner !== 'CURRENT' ? 'Scanner has not produced a current heartbeat.'
      : 'Monitoring only — entries still require independent strategy, consensus, risk and mode checks.' };
}
