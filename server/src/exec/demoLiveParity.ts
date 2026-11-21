/**
 * MIA DEMO/LIVE parity proposal (standalone, dependency-injected TypeScript).
 * READ THIS BEFORE ADOPTION:
 * - Does NOT execute trades on its own; it is NOT wired into the repository.
 * - No live adapter, signer, authorization or release bypass is provided.
 * - Production ports MUST delegate to existing risk/gate.ts, exec/oms.ts, mode.ts and qa/gates.ts.
 * - Do not replace the existing paper OMS or risk authority with this orchestrator.
 * - A durable transactional reservation and crash reconciliation MUST be implemented before execution.
 */

export type ExecutionEnvironment = 'DEMO' | 'LIVE';
import type { Mode } from '../core/mode.js';
import type { DecisionState } from '../decision/engine.js';
/** Aliases, not competing authorities: canonical mode and decision unions live in MIA. */
export type MiaMode = Mode;
export type CanonicalDecision = DecisionState;
export type VenueOrderState = 'ACKNOWLEDGED' | 'FILLED' | 'REJECTED';

/** Account IDs MUST be distinct for DEMO and LIVE, even for the same user. */
export interface ExecutionIntent {
  environment: ExecutionEnvironment;
  accountId: string;
  decisionId: string;
  candidateId: string;
  traceId: string;
  instrumentId: string;
  strategyId: string;
  strategyVersion: string;
  decision: CanonicalDecision;
  side: 'BUY'; // main currently supports spot long entries only
  entryReference: number;
  stopPrice: number;
  consensusExpiresAt: number;
  snapshotId: string;
  snapshotTakenAt: number;
  /** Populated only by a trusted backend using strategy+venue quality policy. */
  maxSnapshotAgeMs: number;
}
export interface ControlState {
  mode: MiaMode;
  emergency: boolean;
  pausedNewOrders: boolean;
  disabledStrategies: readonly string[];
}
export interface RiskResult {
  decision: 'ALLOW' | 'DENY' | 'NEEDS_REVIEW';
  policyVersion: number | null;
  reasonCodes: readonly string[];
  sizing: null | { qty: number; notional: number; plannedMaxLoss: number };
}
export interface ReleaseGate { id: string; status: 'PASS' | 'FAIL' | 'PENDING' | 'NOT_CERTIFIED' | 'NOT_IMPLEMENTED' }
export interface ReleaseEvidence {
  /** Must match the running backend build, not only the test branch. */
  commitSha: string;
  gates: readonly ReleaseGate[];
}
export interface BoundedLiveAuthorization {
  /** Auth server must independently verify and persist this attestation. Never accept it from browser JSON. */
  attestationId: string;
  accountId: string;
  commitSha: string;
  policyVersion: number;
  expiresAt: number;
  maxOrderNotional: number;
  eligibleInstruments: readonly string[];
  verifiedOwnerStepUp: true;
  isolatedSignerVerified: true;
  liveVenueVerified: true;
  protectionVerified: true;
  reconciliationVerified: true;
}
export interface VenueReceipt {
  state: VenueOrderState;
  venueOrderId?: string;
  filledQty?: number;
  reason?: string;
}
export interface VenuePort {
  readonly environment: ExecutionEnvironment;
  /** Must be derived from authoritative venue/instrument capabilities. */
  preflight(intent: ExecutionIntent, qty: number): Promise<{ ok: boolean; reason?: string; nativeProtectionAvailable: boolean }>;
  /** Explicit client ID is stable across retries; NEVER call twice blindly after an unknown outcome. */
  submit(intent: ExecutionIntent, qty: number, clientOrderId: string, fenceToken: string): Promise<VenueReceipt>;
}
export interface DurableExecutionReservation {
  /** Atomic DB insert with UNIQUE on environment/account/intent key. Never in-memory for production. */
  /** The DB allocates a venue-valid stable client order ID and stores it with UNIQUE constraints. */
  reserve(key: string, intent: ExecutionIntent): Promise<{ created: boolean; clientOrderId: string }>;
  /** Atomically record an ACK or FILL with canonical venue/order identity. */
  recordReceipt(key: string, receipt: VenueReceipt): Promise<void>;
  /** Persist non-executable rejection. */
  recordRejection(key: string, reason: string): Promise<void>;
  /** Persist uncertain state; operator/reconciler resolves from venue, never blindly resubmits. */
  markUnknown(key: string, reason: string): Promise<void>;
}
export interface ParityPorts {
  now(): number;
  buildSha(): string;
  getControl(): Promise<ControlState>;
  /** Adapter to existing evaluateRisk(); do not reproduce its numerical rules. */
  evaluateRisk(intent: ExecutionIntent): Promise<RiskResult>;
  /** Current singleton-engine leadership/fence, validated before any I/O. */
  currentFenceToken(): Promise<string | null>;
  /** Authoritative G01–G14, NOT independently fabricated statuses. */
  releaseEvidence(): Promise<ReleaseEvidence>;
  /** Backend-only owner authorization with independent step-up and bounded lifetime. */
  liveAuthorization(intent: ExecutionIntent): Promise<BoundedLiveAuthorization | null>;
  /** Existing PAPER OMS adapter; it also re-checks canonical risk before execution. */
  demoVenue: VenuePort;
  /** Deliberately undefined until certified live venue & signer are integrated. */
  liveVenue?: VenuePort;
  reservation: DurableExecutionReservation;
}
export type ExecutionResult =
  | { status: 'DENIED' | 'DUPLICATE' | 'UNKNOWN'; environment: ExecutionEnvironment; key: string; reason: string }
  | { status: 'ACKNOWLEDGED' | 'FILLED'; environment: ExecutionEnvironment; key: string; venueOrderId?: string; filledQty?: number };

export const MIA_GATE_IDS = Array.from({length:14}, (_,index) => `G${String(index+1).padStart(2,'0')}`);

export function allLiveGatesPass(evidence: ReleaseEvidence, runningBuildSha: string): boolean {
  if (!runningBuildSha || evidence.commitSha !== runningBuildSha) return false;
  if (evidence.gates.length !== MIA_GATE_IDS.length) return false;
  const byId = new Map(evidence.gates.map(g=>[g.id,g.status]));
  return byId.size === 14 && MIA_GATE_IDS.every(id=>byId.get(id)==='PASS');
}

export function validateIntent(intent: ExecutionIntent, now: number): string | null {
  if (!['DEMO','LIVE'].includes(intent.environment)) return 'INVALID_ENVIRONMENT';
  const ids = [intent.accountId,intent.decisionId,intent.candidateId,intent.traceId,intent.instrumentId,intent.strategyId,intent.strategyVersion,intent.snapshotId];
  if (ids.some(s=>typeof s!=='string' || s.trim().length===0 || s.length>200)) return 'INVALID_IDENTITY';
  if (intent.side!=='BUY') return 'UNSUPPORTED_SIDE';
  if (!Number.isFinite(intent.entryReference) || intent.entryReference<=0 || !Number.isFinite(intent.stopPrice) || intent.stopPrice<=0 || intent.stopPrice>=intent.entryReference) return 'INVALID_PRICE_OR_STOP';
  if (!Number.isFinite(intent.consensusExpiresAt) || intent.consensusExpiresAt<=now) return 'EXPIRED_CONSENSUS';
  if (!Number.isFinite(intent.snapshotTakenAt) || !Number.isFinite(intent.maxSnapshotAgeMs) || intent.maxSnapshotAgeMs<=0 || intent.maxSnapshotAgeMs>3_600_000 || intent.snapshotTakenAt>now || now-intent.snapshotTakenAt>intent.maxSnapshotAgeMs) return 'STALE_OR_FUTURE_SNAPSHOT';
  if (intent.environment==='DEMO' && intent.decision!=='PAPER_TRADE') return 'DEMO_DECISION_NOT_ELIGIBLE';
  if (intent.environment==='LIVE' && intent.decision!=='APPROVED_FOR_BOUNDED_EXECUTION') return 'LIVE_DECISION_NOT_ELIGIBLE';
  return null;
}

export function executionKey(intent: ExecutionIntent): string {
  // Tuple encoding avoids delimiter collisions between account/decision IDs.
  // This is an INTERNAL reservation key, not the venue-specific client order ID.
  return JSON.stringify([intent.environment,intent.accountId,intent.decisionId,intent.candidateId,'ENTRY']);
}

/** No owner override for NEEDS_REVIEW: explicit owner approval uses existing separate approval flow. */
function validRisk(result: RiskResult): boolean {
  return result.decision==='ALLOW' && result.policyVersion!==null && Number.isInteger(result.policyVersion) &&
    !!result.sizing && result.sizing.qty>0 && result.sizing.notional>0 &&
    [result.sizing.qty,result.sizing.notional,result.sizing.plannedMaxLoss].every(Number.isFinite);
}
function validControl(c: ControlState, intent: ExecutionIntent): boolean {
  return !c.emergency && !c.pausedNewOrders && !c.disabledStrategies.includes(intent.strategyId) &&
    c.mode === (intent.environment==='DEMO'?'PAPER':'BOUNDED_LIVE');
}
function validLiveAuthorization(auth: BoundedLiveAuthorization | null, intent: ExecutionIntent, risk: RiskResult, now: number, runningBuildSha: string): boolean {
  return !!auth && !!auth.attestationId && auth.accountId===intent.accountId &&
    auth.commitSha===runningBuildSha && auth.policyVersion===risk.policyVersion &&
    auth.expiresAt>now && auth.expiresAt<=now+86_400_000 &&
    Number.isFinite(auth.maxOrderNotional) && auth.maxOrderNotional>0 &&
    risk.sizing!==null && risk.sizing.notional<=auth.maxOrderNotional &&
    auth.eligibleInstruments.includes(intent.instrumentId) &&
    auth.verifiedOwnerStepUp===true && auth.isolatedSignerVerified===true &&
    auth.liveVenueVerified===true && auth.protectionVerified===true && auth.reconciliationVerified===true;
}

/**
 * Single orchestration path, independent of demo/live venue choice.
 * Must not run from a frontend or LLM. It is an isolated implementation sketch;
 * production adoption needs DB-backed reservation + a vetted OMS adapter.
 */
export async function routeEntry(intent: ExecutionIntent, ports: ParityPorts): Promise<ExecutionResult> {
  const key = executionKey(intent);
  const deny = (reason: string): ExecutionResult => ({status:'DENIED',environment:intent.environment,key,reason});
  try {
    const firstNow = ports.now();
    const invalid = validateIntent(intent, firstNow);
    if (invalid) return deny(invalid);

    const currentControl = await ports.getControl();
    if (!validControl(currentControl,intent)) return deny('EXECUTION_MODE_OR_SAFETY_BLOCK');
    const risk = await ports.evaluateRisk(intent);
    if (!validRisk(risk)) return deny(`CANONICAL_RISK_${risk.decision}:${risk.reasonCodes.join(',').slice(0,200)}`);

    const fence1 = await ports.currentFenceToken();
    if (!fence1) return deny('ENGINE_NOT_LEADER');
    let liveAuth: BoundedLiveAuthorization | null = null;
    if (intent.environment==='LIVE') {
      if (!ports.liveVenue) return deny('LIVE_ADAPTER_NOT_INSTALLED');
      if (!allLiveGatesPass(await ports.releaseEvidence(),ports.buildSha())) return deny('G01_G14_NOT_CERTIFIED_FOR_THIS_BUILD');
      liveAuth = await ports.liveAuthorization(intent);
      if (!validLiveAuthorization(liveAuth,intent,risk,ports.now(),ports.buildSha())) return deny('LIVE_OWNER_AUTHORIZATION_OR_SIGNER_INVALID');
    }

    const venue = intent.environment==='DEMO' ? ports.demoVenue : ports.liveVenue;
    if (!venue || venue.environment!==intent.environment) return deny('VENUE_ENVIRONMENT_MISMATCH');
    const size = risk.sizing!;
    const p = await venue.preflight(intent,size.qty);
    if (!p.ok) return deny(`VENUE_PREFLIGHT:${p.reason??'failed'}`);
    if (intent.environment==='LIVE' && !p.nativeProtectionAvailable) return deny('NATIVE_LIVE_PROTECTION_UNAVAILABLE');

    // This must be a durable atomic reservation, not a Map/Set or a bare check-before-write.
    const reservation = await ports.reservation.reserve(key,intent);
    if (!reservation.created) return {status:'DUPLICATE',environment:intent.environment,key,reason:'EXISTING_RESERVATION_MUST_BE_RECONCILED'};
    // The venue adapter must validate stricter exchange-specific client-ID limits.
    if (!/^[A-Za-z0-9_-]{8,36}$/.test(reservation.clientOrderId)) {
      await ports.reservation.recordRejection(key,'INVALID_DURABLE_CLIENT_ORDER_ID');
      return deny('INVALID_DURABLE_CLIENT_ORDER_ID');
    }

    // Any asynchronous I/O above may have made evidence stale or risk policy outdated.
    const finalReason = validateIntent(intent,ports.now());
    const finalControl = await ports.getControl();
    const finalRisk = await ports.evaluateRisk(intent);
    const fence2 = await ports.currentFenceToken();
    if (finalReason || !validControl(finalControl,intent) || !validRisk(finalRisk) ||
        finalRisk.sizing?.qty!==size.qty || finalRisk.sizing?.notional!==size.notional ||
        finalRisk.policyVersion!==risk.policyVersion || !fence2 || fence1!==fence2) {
      const reason = finalReason??'LAST_MOMENT_RISK_MODE_OR_FENCE_CHANGED';
      await ports.reservation.recordRejection(key,reason);
      return deny(reason);
    }
    if (intent.environment==='LIVE') {
      if (!allLiveGatesPass(await ports.releaseEvidence(),ports.buildSha()) ||
          !validLiveAuthorization(await ports.liveAuthorization(intent),intent,finalRisk,ports.now(),ports.buildSha())) {
        await ports.reservation.recordRejection(key,'LIVE_CERTIFICATION_CHANGED');
        return deny('LIVE_CERTIFICATION_CHANGED');
      }
    }

    // LIVE capability/protection must still hold immediately before venue submission.
    if (intent.environment==='LIVE') {
      const lastPreflight = await venue.preflight(intent,finalRisk.sizing!.qty);
      if (!lastPreflight.ok || !lastPreflight.nativeProtectionAvailable) {
        await ports.reservation.recordRejection(key,'FINAL_VENUE_PREFLIGHT_FAILED');
        return deny('FINAL_VENUE_PREFLIGHT_FAILED');
      }
    }
    if (await ports.currentFenceToken() !== fence2) {
      await ports.reservation.recordRejection(key,'LEADER_FENCE_CHANGED');
      return deny('LEADER_FENCE_CHANGED');
    }
    // Last point where any automatic order can be sent. Production venue adapters
    // MUST enforce fencing, idempotency and reconciliation as well.
    try {
      const receipt = await venue.submit(intent,finalRisk.sizing!.qty,reservation.clientOrderId,fence2);
      await ports.reservation.recordReceipt(key,receipt);
      if (receipt.state==='REJECTED') return deny(`VENUE_REJECTED:${receipt.reason??'unspecified'}`);
      return {status:receipt.state,environment:intent.environment,key,venueOrderId:receipt.venueOrderId,filledQty:receipt.filledQty};
    } catch {
      // Never blindly re-submit on a timeout: external venue may have accepted it.
      await ports.reservation.markUnknown(key,'SUBMISSION_OUTCOME_UNCERTAIN_RECONCILE_FIRST');
      return {status:'UNKNOWN',environment:intent.environment,key,reason:'SUBMISSION_OUTCOME_UNCERTAIN_RECONCILE_FIRST'};
    }
  } catch {
    // Ports should persist any reserved state. No false success on database/network faults.
    return {status:'UNKNOWN',environment:intent.environment,key,reason:'ORCHESTRATION_OR_PERSISTENCE_EXCEPTION_REQUIRES_RECONCILIATION'};
  }
}