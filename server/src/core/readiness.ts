import type { LeaseState } from '../bot/lease.js';

export type CheckStatus = 'PASS' | 'FAIL' | 'WARN';
export interface ReadinessInput {
  dbOk: boolean; startupOk: boolean; offline: boolean; running: boolean; leaseState: LeaseState;
  lastMonitorAt: number; monitorFailing: boolean; lastScanAt: number; tickersFetchedAt: number; tickerIntervalMs: number; policyAccepted: boolean; mode: string;
}
export const READY_NOTE = 'ready=true means this process is the active paper engine with fresh data; it grants no execution permission and says nothing about live eligibility. ready=false is not safe: open paper positions may be unmonitored.';
/** Market data older than this is stale (same threshold as /api/shell dataHealth). */
export const MARKET_STALE_MS = 60_000;

/**
 * Ticket 020: pure readiness verdict for GET /api/ready. heartbeat = age of the last committed position-monitor pass,
 * and FAIL while the latest pass failed. ready = no FAIL; reasons lists every check that is not PASS.
 */
export function readiness(i: ReadinessInput, now: number) {
  const age = (t: number) => (t > 0 ? Math.max(0, now - t) : null);
  const ticker = age(i.tickersFetchedAt); const scan = age(i.lastScanAt); const heartbeat = age(i.lastMonitorAt);
  const pf = (ok: boolean): CheckStatus => (ok ? 'PASS' : 'FAIL');
  const checks: Record<'db' | 'startup' | 'engine' | 'lease' | 'heartbeat' | 'marketData' | 'policy', CheckStatus> = {
    db: pf(i.dbOk),
    startup: pf(i.startupOk),
    engine: pf(!i.offline && i.running),
    lease: pf(i.leaseState === 'OWNER'),
    heartbeat: pf(!i.monitorFailing && heartbeat != null && heartbeat <= Math.max(45_000, 3 * i.tickerIntervalMs)),
    marketData: pf(ticker != null && ticker <= MARKET_STALE_MS),
    policy: !i.policyAccepted && (i.mode === 'PAPER' || i.mode === 'APPROVAL') ? 'WARN' : 'PASS',
  };
  const reasons = Object.entries(checks).filter(([, s]) => s !== 'PASS').map(([k]) => k);
  return { ready: !Object.values(checks).includes('FAIL'), scope: 'PAPER_ENGINE' as const, serverTime: now, reasons, checks, agesMs: { ticker, scan, heartbeat }, note: READY_NOTE };
}
