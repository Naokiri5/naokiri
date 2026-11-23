import { FAST_RESEARCH_MAX_AGE_MS } from '../choice/dualResearch.js';
import { DEEP_RESEARCH_MAX_AGE_MS, dualResearchStatus } from '../choice/dualRuntime.js';
import { config } from '../config.js';
import { getControl } from '../core/mode.js';
import { protectPositions } from '../exec/oms.js';
import { unreconciledPaperOrders } from '../exec/recovery.js';
import { reconcile } from '../portfolio/calendar.js';
import { provider } from '../providers/http.js';
import { recentReleaseGateEvidence } from '../qa/gates.js';
import { currentPolicy } from '../risk/policy.js';
import { stepUpMethod } from '../security/stepUp.js';
import { staleAfter, type EngineView } from './readiness.js';

export const SESSION_MINDS = ['FAST', 'DEEP'] as const;
export const SESSION_ENVIRONMENTS = ['PAPER', 'LIVE'] as const;
export type SessionMind = (typeof SESSION_MINDS)[number];
export type SessionEnvironment = (typeof SESSION_ENVIRONMENTS)[number];

interface PreflightCheck {
  id: string;
  label: string;
  status: 'PASS' | 'BLOCKED' | 'UNVERIFIED' | 'INFO';
  detail: string;
  observedAt?: number;
}

export interface SessionPreflight {
  schemaVersion: 'mia.session.preflight.v1';
  checkedAt: number;
  mind: SessionMind;
  environment: SessionEnvironment;
  state: 'PREFLIGHT' | 'EMERGENCY';
  canRun: boolean;
  canClose: boolean;
  checks: PreflightCheck[];
}

function researchChecks(mind: SessionMind, at: number): PreflightCheck[] {
  const research = dualResearchStatus(at);
  const source = mind === 'FAST' ? provider('dexscreener') : provider('binance-usdm-research');
  const name = mind === 'FAST' ? 'DEX Screener' : 'Binance USD-M public data';
  const maxAge = mind === 'FAST' ? FAST_RESEARCH_MAX_AGE_MS : DEEP_RESEARCH_MAX_AGE_MS;
  const lastOk = source?.lastOkAt ?? 0;
  const connected = source?.status === 'LIVE' && lastOk > 0 && lastOk <= at && at - lastOk <= maxAge;
  const connectionStopped = source?.status === 'DOWN' || source?.status === 'DISABLED' || source?.status === 'DEGRADED';
  const fresh = mind === 'FAST'
    ? !research.fast.stale && research.fast.checkedAt <= at
    : !research.deep.stale && research.deep.successAt <= at && research.deep.error === null;
  return [
    { id: 'connections', label: 'Research connection', status: connected ? 'PASS' : connectionStopped ? 'BLOCKED' : 'UNVERIFIED',
      detail: connected ? `${name} reports a recent successful connection.` : `${name} has no verified healthy connection on this server.` },
    { id: 'market-data', label: 'Research data freshness', status: fresh ? 'PASS' : 'UNVERIFIED',
      detail: fresh ? `A recent ${mind} research assessment is available.` : `The ${mind} research assessment is missing, stale, or currently unavailable.` },
  ];
}

function paperChecks(engine: EngineView, at: number): PreflightCheck[] {
  const ledger = reconcile();
  const funded = Number.isFinite(ledger.cash) && ledger.cash > 0;
  const unresolved = unreconciledPaperOrders();
  const monitorFresh = engine.lastMonitorAt > 0 && engine.lastMonitorAt <= at && at - engine.lastMonitorAt <= staleAfter().monitorMs;
  const monitoring = !config.offline && engine.running && engine.role === 'LEADER' && !engine.monitorFailing && monitorFresh;
  const unprotected = monitoring ? protectPositions().positions.filter((position) => !position.protected).length : null;
  return [
    { id: 'paper-account', label: 'Paper account', status: funded ? 'PASS' : 'BLOCKED',
      detail: funded ? 'The paper ledger has simulated cash available.' : 'Allocate simulated cash in Paper Account before trading.' },
    { id: 'paper-recovery', label: 'Paper reconciliation', status: !ledger.ok || unresolved ? 'BLOCKED' : 'PASS',
      detail: !ledger.ok ? 'The paper ledger and closed positions disagree.'
        : unresolved ? `${unresolved} paper ${unresolved === 1 ? 'order requires' : 'orders require'} reconciliation.`
          : 'Closed positions reconcile with the ledger and all submitted paper orders are settled.' },
    { id: 'position-protection', label: 'Paper position protection', status: unprotected === null ? 'UNVERIFIED' : unprotected > 0 ? 'BLOCKED' : 'PASS',
      detail: engine.role === 'STANDBY' ? 'This server is on standby. Current protection must be confirmed on the active engine.'
        : unprotected ? `${unprotected} open paper ${unprotected === 1 ? 'position has' : 'positions have'} unverified protection.`
          : monitoring ? 'The protection monitor is current and all open paper stops were verified.'
            : 'The position monitor has no recent successful pass on this server.' },
  ];
}

function liveChecks(at: number): PreflightCheck[] {
  const release = recentReleaseGateEvidence(at);
  return [
    { id: 'live-account', label: 'Live venue account', status: 'BLOCKED',
      detail: 'Live needs a verified venue account, isolated signer, and explicit owner permission.' },
    { id: 'release-gates', label: 'Live release gates', status: release ? release.liveAllowed ? 'PASS' : 'BLOCKED' : 'UNVERIFIED',
      detail: !release ? 'A current evaluation is unavailable. Open Release Gates to review the latest evidence.'
        : release.unmetGateIds.length ? `${release.summary}. Evidence is still required for ${release.unmetGateIds.join(', ')}.` : release.summary,
      ...(release ? { observedAt: release.checkedAt } : {}) },
  ];
}

/** Read-only assessment of a selection. The legacy spot scheduler follows its own canonical controls. */
export function sessionPreflight(engine: EngineView, mind: SessionMind, environment: SessionEnvironment, at = Date.now()): SessionPreflight {
  const control = getControl();
  const policy = currentPolicy();
  const stepUp = stepUpMethod();
  const checks: PreflightCheck[] = [
    { id: 'environment', label: 'Trading environment', status: 'INFO',
      detail: environment === 'PAPER' ? 'Paper uses simulated funds.' : 'Live would use real funds.' },
    { id: 'risk-policy', label: 'Risk policy', status: policy ? 'PASS' : 'BLOCKED',
      detail: policy ? `You have accepted risk policy version ${policy.version}.` : 'Review and accept a risk policy in Risk Center.' },
    { id: 'owner-control', label: 'Owner controls', status: control.emergency || control.pausedNewOrders ? 'BLOCKED' : 'PASS',
      detail: control.emergency ? 'Emergency stop is active.' : control.pausedNewOrders ? 'New orders are paused.' : 'Emergency stop and entry pause are clear.' },
    { id: 'owner-verification', label: 'Owner verification', status: stepUp === 'unavailable' ? 'BLOCKED' : 'PASS',
      detail: stepUp === 'unavailable' ? 'Set up an authenticator in Security Center to authorize sensitive actions.' : 'Owner verification is available for sensitive actions.' },
    ...researchChecks(mind, at),
    ...(environment === 'PAPER' ? paperChecks(engine, at) : liveChecks(at)),
    { id: 'execution-lane', label: `${mind} execution`, status: 'BLOCKED',
      detail: mind === 'FAST'
        ? 'FAST research needs verified token permissions and an executable sell route before trading.'
        : 'DEEP research needs validated strategies, futures margin and liquidation checks, and executable order books before trading.' },
    { id: 'session-lifecycle', label: 'Session controls', status: 'BLOCKED',
      detail: 'Run and Close require a durable session tied to the selected execution lane.' },
  ];
  return {
    schemaVersion: 'mia.session.preflight.v1', checkedAt: at, mind, environment,
    state: control.emergency ? 'EMERGENCY' : 'PREFLIGHT', canRun: false, canClose: false, checks,
  };
}
