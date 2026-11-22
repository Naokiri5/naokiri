import { get } from '../db/db.js';
import { getControl } from '../core/mode.js';
import { getSetting } from '../core/settings.js';
import { botStatus } from '../bot/bot.js';
import { market } from '../market/store.js';
import { listIncidents } from '../exec/incidents.js';
import { reconcile } from '../portfolio/calendar.js';
import { currentPolicy } from '../risk/policy.js';
import { readiness, staleAfter } from './readiness.js';

/** Advisory-only operating status built from existing authorities. Never changes trading mode or orders. */
export type AutopilotState = 'RUNNING' | 'WAITING' | 'BLOCKED' | 'DEGRADED' | 'PAUSED' | 'STOPPED';
export interface AutopilotInput {
  running: boolean;
  role: 'STOPPED' | 'LEADER' | 'STANDBY';
  mode: 'OBSERVE' | 'PAPER' | 'APPROVAL' | 'BOUNDED_LIVE';
  emergency: boolean;
  pausedNewOrders: boolean;
  marketDataHealthy: boolean;
  positionMonitorHealthy: boolean;
  ledgerReconciled: boolean;
  policyAccepted: boolean;
  paperStrategyCount: number;
  openIncidents: number;
}
export function deriveAutopilotStatus(x: AutopilotInput) {
  const state = (status: AutopilotState, reason: string) => ({
    state: status, reason,
    canAcceptAutomaticPaperEntries: status === 'RUNNING' && x.mode === 'PAPER',
    canExecuteRealMoney: false as const, // independent live certification is not implemented here
  });
  if (x.emergency || x.pausedNewOrders) return state('PAUSED','CANONICAL_PAUSE_OR_EMERGENCY');
  if (!x.running || x.role === 'STOPPED') return state('STOPPED','ENGINE_NOT_RUNNING');
  if (!x.ledgerReconciled || !x.policyAccepted) return state('BLOCKED','RECONCILIATION_OR_POLICY_NOT_READY');
  if (x.role !== 'LEADER') return state('WAITING','STANDBY_NOT_LEADER');
  if (!x.marketDataHealthy || !x.positionMonitorHealthy || x.openIncidents > 0)
    return state('DEGRADED','MARKET_MONITOR_OR_PROTECTION_INCIDENT');
  if (x.mode === 'BOUNDED_LIVE') return state('BLOCKED','LIVE_NOT_CERTIFIED_BY_READ_MODEL');
  if (x.mode === 'OBSERVE') return state('WAITING','OBSERVE_READ_ONLY');
  if (x.mode === 'APPROVAL') return state('WAITING','OWNER_APPROVAL_REQUIRED');
  if (x.paperStrategyCount < 1) return state('WAITING','NO_OWNER_PROMOTED_PAPER_STRATEGY');
  return state('RUNNING','PAPER_SCHEDULER_ACTIVE_NOT_PROFIT_CERTIFICATION');
}

/** Authenticated /api/autopilot/status read model. Zero side effects and zero new execution authority. */
export function autopilotOperationalStatus(nowMs = Date.now()) {
  const ctl = getControl();
  const existingDisabled = new Set([
    ...ctl.disabledStrategies,
    ...getSetting<string[]>('suspendedStrategies', []),
  ]);
  const enabledCount = get<{n:number}>(
    "SELECT COUNT(*) n FROM strategies WHERE status='PAPER' AND id NOT IN (" +
    (existingDisabled.size ? [...existingDisabled].map(() => '?').join(',') : "SELECT id FROM strategies WHERE 1=0") +
    ")",
    ...existingDisabled,
  )?.n ?? 0;
  const checked = readiness(botStatus, nowMs);
  const openIncidents = listIncidents().filter(i => i.status === 'OPEN').length;
  const financial = reconcile();
  const input: AutopilotInput = {
    running: botStatus.running,
    role: botStatus.role,
    mode: ctl.mode,
    emergency: ctl.emergency,
    pausedNewOrders: ctl.pausedNewOrders,
    marketDataHealthy: market.tickersFetchedAt > 0 &&
      nowMs - market.tickersFetchedAt >= 0 && nowMs - market.tickersFetchedAt <= staleAfter().tickerMs,
    positionMonitorHealthy: !botStatus.monitorFailing &&
      checked.checks.every(c => c.name !== 'monitor' || c.status !== 'fail'),
    ledgerReconciled: financial.ok,
    policyAccepted: currentPolicy() !== null,
    paperStrategyCount: enabledCount,
    openIncidents,
  };
  const view = deriveAutopilotStatus(input);
  return {
    ...view, readOnly: true as const, observedAtMs: nowMs,
    canonical: { mode: ctl.mode, role: botStatus.role, paperStrategyCount: enabledCount,
      openProtectionIncidents: openIncidents, ledgerReconciliationScope: 'closed-paper-positions',
      healthReady: checked.ready, telemetry: input },
    limitations: [
      'RUNNING means scheduler eligibility, not calibrated accuracy or profitable strategy certification',
      'does not start/stop trading; owner actions remain in the existing authenticated control service',
      'real-money execution remains locked by independent release gates',
    ],
  };
}
