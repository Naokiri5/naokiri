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
import { brainOverview } from '../knowledge/brain.js';
import { requiredReadEvidenceGaps, type CapabilityGraphId } from '../knowledge/capabilityGraph.js';
import { stepUpMethod } from '../security/stepUp.js';
import { staleAfter, type EngineView } from './readiness.js';
import { currentLease } from './lease.js';
import { durableSessionStatus, paperSpotEntryDenial, type BrainosSessionState } from './paperSpotEntry.js';
import { MANDATE_LIMITS, openPaperExposure, sessionMandate, type TradingMandate } from './tradingMandate.js';

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

export interface PaperSpotSessionPreflight {
  canRun: boolean;
  canClose: boolean;
  state: BrainosSessionState;
  checks: PreflightCheck[];
  /** The persisted mandate of the current or most recent session; null before the first mandate. */
  mandate: (TradingMandate & { openExposure: number; expired: boolean }) | null;
  /** Bounds for a new authorization, from the paper ledger at check time. */
  authorization: { maxCapital: number; minDurationHours: number; maxDurationHours: number };
}

const MANDATE_DENIAL_DETAIL: Record<string, string> = {
  SESSION_MANDATE_MISSING: 'This session has no trading mandate. Close it and authorize a new session with a capital limit.',
  SESSION_MANDATE_EXPIRED: 'The session mandate has expired. New entries are blocked while MIA drains the session.',
  SESSION_RISK_POLICY_CHANGED: 'The risk policy changed after authorization. Close the session and authorize a new one.',
  SESSION_STRATEGY_CONFIG_CHANGED: 'The deployed strategy set changed after authorization. Close the session and authorize a new one.',
};

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

/**
 * The existing BrainOS bridge is refreshed on the leader lane. Treat the graph as
 * advisory evidence ONLY: the execution lane and release gates still fail closed.
 */
function capabilityEvidenceChecks(mind: SessionMind, at: number): PreflightCheck[] {
  const network = brainOverview(at).network;
  const required: readonly CapabilityGraphId[] = mind === 'FAST'
    ? ['autopilot.asset_discovery', 'settings.risk_center', 'settings.connections_hub']
    : ['autopilot.market_terminal', 'autopilot.ai_scanner', 'settings.strategy_lab',
       'settings.risk_center', 'settings.connections_hub'];
  const missing = requiredReadEvidenceGaps(network, required, mind);
  const status = missing.length === 0 ? 'PASS'
    : missing.every(c => c.reason === 'UNAVAILABLE' || c.reason === 'UNVERIFIED') ? 'UNVERIFIED' : 'BLOCKED';
  return [{
    id: 'brainos-dependencies',
    label: 'Internal capability evidence',
    status,
    detail: missing.length
      ? 'Unverified or blocked source evidence: ' + missing.map(c => `${c.id} (${c.reason})`).join(', ')
      : 'Selected intelligence sources have fresh supporting evidence. Trading eligibility is evaluated separately.',
    observedAt: network.evaluatedAt,
  }];
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
    ...capabilityEvidenceChecks(mind, at),
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

/** Readiness for the existing Binance spot simulator and its independent protection lane. */
export function paperSpotSessionPreflight(engine: EngineView & { instanceId?: string }, at = Date.now()): PaperSpotSessionPreflight {
  const state = durableSessionStatus()?.state ?? 'CLOSED';
  const control = getControl();
  const policy = currentPolicy();
  const stepUp = stepUpMethod();
  const lease = currentLease('engine');
  const leader = engine.running && engine.role === 'LEADER' && lease !== null && lease.acquired_at <= at && lease.expires_at >= at &&
    (engine.instanceId === undefined || lease.holder === engine.instanceId);
  const paperMode = control.mode === 'PAPER' || control.mode === 'APPROVAL';
  const controlsReady = paperMode && !control.emergency && !control.pausedNewOrders;
  const session = durableSessionStatus();
  const activeDenial = state === 'RUNNING' ? paperSpotEntryDenial(lease, at) : null;
  const leaseDetail = activeDenial && MANDATE_DENIAL_DETAIL[activeDenial] ? MANDATE_DENIAL_DETAIL[activeDenial]
    : activeDenial === 'SESSION_OWNER_CONTROL_CHANGED'
    ? 'Paper controls changed after authorization. Close the session and authorize a new one.'
    : activeDenial === 'STALE_OR_LOST_ENGINE_FENCE'
      ? 'The current engine lease does not authorize entries for this session.'
      : activeDenial ? 'New entries are blocked by the current paper session checks.'
        : leader ? 'The current leader holds the paper execution lease.' : 'The active paper engine must hold a current execution lease.';
  const checks: PreflightCheck[] = [
    { id: 'environment', label: 'Trading environment', status: 'INFO', detail: 'Binance spot simulation uses the paper account.' },
    { id: 'risk-policy', label: 'Risk policy', status: policy ? 'PASS' : 'BLOCKED',
      detail: policy ? `You have accepted risk policy version ${policy.version}.` : 'Review and accept a risk policy in Risk Center.' },
    { id: 'owner-control', label: 'Owner controls', status: controlsReady ? 'PASS' : 'BLOCKED',
      detail: control.emergency ? 'Emergency stop is active.' : control.pausedNewOrders ? 'New orders are paused.'
        : !paperMode ? 'Select Paper or User approval in Paper Account.' : 'Paper entry controls permit a session.' },
    { id: 'owner-verification', label: 'Owner verification', status: stepUp === 'unavailable' ? 'BLOCKED' : 'PASS',
      detail: stepUp === 'unavailable' ? 'Set up an authenticator in Security Center to authorize sensitive actions.' : 'Owner verification is available for sensitive actions.' },
    ...paperChecks(engine, at),
    { id: 'execution-lane', label: 'Spot paper execution', status: leader && !activeDenial ? 'PASS' : 'BLOCKED', detail: leaseDetail },
    { id: 'session-lifecycle', label: 'Session controls', status: state === 'CLOSED' ? 'PASS' : 'BLOCKED',
      detail: state === 'CLOSED' ? 'A new spot paper session requires explicit owner authorization.'
        : state === 'CLOSING_DRAINING_ENTRIES' ? 'Entry authority is revoked while positions and orders are reconciled.'
          : 'Close the existing session before starting a new one.' },
  ];
  const mandate = session ? sessionMandate(session) : null;
  const ledger = reconcile();
  const openExposure = openPaperExposure();
  return {
    canRun: checks.every(check => check.status === 'PASS' || check.status === 'INFO'),
    canClose: state !== 'CLOSED' && !(state === 'EMERGENCY_KILL_SWITCH' && control.emergency),
    state,
    checks,
    mandate: mandate ? { ...mandate, openExposure, expired: at >= mandate.expires_at } : null,
    authorization: {
      maxCapital: Number.isFinite(ledger.cash) ? Math.max(0, ledger.cash + openExposure) : 0,
      minDurationHours: MANDATE_LIMITS.minDurationHours,
      maxDurationHours: MANDATE_LIMITS.maxDurationHours,
    },
  };
}
