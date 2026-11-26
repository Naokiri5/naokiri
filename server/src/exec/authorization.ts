/**
 * Entry execution authorization: the record the paper OMS must hold before it may book an entry fill.
 *
 * The canonical risk gate decides; this module only binds that decision to the exact order the OMS then executes.
 * An authorization is issued solely from an allowed gate decision with sizing, and is verified against the actual fill
 * before any order, position or ledger row is written. Anything missing, expired, malformed or mismatched refuses the
 * entry. There is no default: no fallback policy, environment or quantity can stand in for a refused authorization.
 *
 * Scope: in the paper OMS, issue and verification run inside one synchronous SQLite write transaction against one
 * market snapshot. Here the record is an invariant assertion that the booked order is exactly the order the gate
 * sized; it is not a capability token that survives across time or processes.
 */
import type { RiskDecision } from '../risk/gate.js';
import type { Mode } from '../core/mode.js';

/** Only paper execution exists in this build. TESTNET and LIVE are not authorizable here. */
export type ExecutionEnvironment = 'PAPER';
const PAPER_MODES: readonly Mode[] = ['PAPER', 'APPROVAL'];

export interface EntryAuthorization {
  readonly account: string;
  readonly environment: ExecutionEnvironment;
  readonly instrumentId: string;
  readonly side: 'buy';
  readonly qty: number;
  /** Worst fill price the gate sized for (best ask plus the slippage policy). */
  readonly limitPrice: number;
  /** Most the entry may spend, fees included: qty x limitPrice x (1 + feeRate). */
  readonly maxCost: number;
  readonly policyVersion: number;
  readonly decisionId: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

export interface EntryAuthorizationRequest {
  account: string; instrumentId: string; decisionId: string;
  /** NEEDS_REVIEW decisions are authorizable only for an owner-approved entry, as in submitEntry. */
  actor: 'bot' | 'owner';
  /** Control mode at issue time; only paper modes can be authorized. */
  mode: Mode;
  issuedAt: number;
  /** When the evidence behind the decision stops being valid (the consensus expiry). */
  expiresAt: number;
}

export interface ExecutedEntry {
  account: string; instrumentId: string; side: 'buy'; mode: Mode;
  qty: number; price: number; fee: number;
  /** Version of the risk policy in force when the fill is booked; null when none is accepted. */
  policyVersion: number | null;
  nowTs: number;
}

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Issue an authorization from an allowed gate decision, or explain why none can be issued. */
export function issueEntryAuthorization(decision: RiskDecision, req: EntryAuthorizationRequest):
  { authorization: EntryAuthorization } | { reason: string } {
  // Decided here from the gate's own verdict, never from a caller-supplied flag.
  const allowed = decision.decision === 'ALLOW' || (decision.decision === 'NEEDS_REVIEW' && req.actor === 'owner');
  if (!allowed) return { reason: `AUTHORIZATION_REFUSED: risk gate decision ${decision.decision}` };
  const sizing = decision.sizing;
  if (!sizing) return { reason: 'AUTHORIZATION_REFUSED: gate returned no sizing' };
  if (decision.policyVersion === null || !Number.isSafeInteger(decision.policyVersion)) return { reason: 'AUTHORIZATION_REFUSED: gate decision has no policy version' };
  if (!PAPER_MODES.includes(req.mode)) return { reason: `AUTHORIZATION_REFUSED: environment ${req.mode} is not paper` };
  if (![sizing.qty, sizing.limitPrice, sizing.maxCost].every(positive)) return { reason: 'AUTHORIZATION_REFUSED: sizing is not finite and positive' };
  if (!(Number.isSafeInteger(req.issuedAt) && Number.isFinite(req.expiresAt) && req.expiresAt > req.issuedAt)) return { reason: 'AUTHORIZATION_EXPIRED: evidence is no longer valid' };
  if (!req.account || !req.instrumentId || !req.decisionId) return { reason: 'AUTHORIZATION_REFUSED: order identity is incomplete' };
  return { authorization: Object.freeze({
    account: req.account, environment: 'PAPER', instrumentId: req.instrumentId, side: 'buy', qty: sizing.qty,
    limitPrice: sizing.limitPrice, maxCost: sizing.maxCost, policyVersion: decision.policyVersion,
    decisionId: req.decisionId, issuedAt: req.issuedAt, expiresAt: req.expiresAt,
  }) };
}

/** Reason the executed entry does not match its authorization, or null when it may be booked. */
export function entryExecutionDenial(auth: EntryAuthorization | null | undefined, fill: ExecutedEntry): string | null {
  if (!auth) return 'AUTHORIZATION_MISSING';
  if (auth.environment !== 'PAPER' || !PAPER_MODES.includes(fill.mode)) return `AUTHORIZATION_ENVIRONMENT_MISMATCH: ${fill.mode}`;
  if (auth.account !== fill.account) return 'AUTHORIZATION_ACCOUNT_MISMATCH';
  if (auth.instrumentId !== fill.instrumentId || auth.side !== fill.side) return 'AUTHORIZATION_INSTRUMENT_MISMATCH';
  if (fill.policyVersion === null) return 'POLICY_UNAVAILABLE: no accepted risk policy at execution';
  if (fill.policyVersion !== auth.policyVersion) return `POLICY_VERSION_MISMATCH: authorized v${auth.policyVersion}, current v${fill.policyVersion}`;
  if (!(Number.isFinite(fill.nowTs) && fill.nowTs >= auth.issuedAt && fill.nowTs < auth.expiresAt)) return 'AUTHORIZATION_EXPIRED';
  if (!(positive(fill.qty) && fill.qty === auth.qty)) return `AUTHORIZATION_QTY_MISMATCH: authorized ${auth.qty}, executing ${fill.qty}`;
  if (!positive(fill.price) || fill.price > auth.limitPrice) return `AUTHORIZATION_LIMIT_PRICE: fill ${fill.price} above limit ${auth.limitPrice}`;
  const cost = fill.qty * fill.price + fill.fee;
  if (!(Number.isFinite(fill.fee) && fill.fee >= 0) || !(cost <= auth.maxCost)) return `AUTHORIZATION_MAX_COST: cost ${cost.toFixed(2)} above ${auth.maxCost.toFixed(2)}`;
  return null;
}
