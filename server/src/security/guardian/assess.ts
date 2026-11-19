/**
 * MIA Guardian: pure severity assessment of a security event. Based on the owner-supplied Guardian Shield prototype
 * (assess.ts, 2026-11-19), extended with event kinds MIA can actually observe.
 *
 * It only SUGGESTS defensive next steps. It NEVER trades, signs, withdraws, raises a limit, resumes trading or
 * enables Live: the return type pins `canAuthorizeTrading/canSignTransactions/canWithdraw` to `false`. Every action
 * still goes through MIA's existing owner, step-up and risk controls. A severity is a rule outcome, not proof of an
 * attacker's identity or intent.
 */
export type SecurityEventKind =
  | 'LOGIN_FAILURE_BURST' | 'STEP_UP_FAILURE_BURST' | 'UNAUTHORIZED_MODE_CHANGE' | 'UNEXPECTED_SIGNER_REQUEST'
  | 'UNEXPECTED_ALLOWANCE' | 'PROMPT_INJECTION' | 'HOST_EXEC_ANOMALY' | 'WEB_FLOOD' | 'VENUE_BALANCE_MISMATCH'
  | 'AUDIT_CHAIN_BROKEN' | 'OWNER_IDENTITY_CHANGED' | 'WITHDRAWAL_ATTEMPT' | 'UNKNOWN';

export interface GuardianEvent {
  readonly kind: SecurityEventKind;
  readonly timestampMs: number;
  /** Where the signal came from (e.g. 'audit_log'), never a claim about who the attacker is. */
  readonly sourceId: string;
  /** Pointer to the evidence (e.g. an audit row id), so the owner can verify it. */
  readonly evidenceId: string;
  /** Minimised, secret-free text. Never raw request bodies, tokens or untrusted HTML. */
  readonly sanitizedSummary: string;
}
export type Severity = 'P0' | 'P1' | 'P2' | 'P3';
export type Suggestion = 'DENY_PRIVILEGED_ACTION' | 'PAUSE_NEW_EXPOSURE_REQUEST' | 'QUARANTINE_INPUT' | 'THROTTLE_AT_EDGE'
  | 'REVOKE_SESSIONS_REQUEST' | 'VERIFY_IDENTITY' | 'INVESTIGATE';
export interface GuardianAssessment {
  readonly severity: Severity;
  readonly suggestions: readonly Suggestion[];
  readonly reasons: readonly string[];
  readonly canAuthorizeTrading: false;
  readonly canSignTransactions: false;
  readonly canWithdraw: false;
}

const MAX_AGE_MS = 24 * 3600_000;

/** This is not an execution authorisation. Untrustworthy timestamps or provenance are quarantined, not acted on. */
export function assessSecurityEvent(event: GuardianEvent, nowMs: number): GuardianAssessment {
  const reasons: string[] = [];
  let severity: Severity = 'P3';
  let suggestions: Suggestion[] = ['INVESTIGATE'];
  if (!Number.isFinite(nowMs) || !Number.isFinite(event.timestampMs) || !event.sourceId || !event.evidenceId ||
      event.timestampMs > nowMs + 1000 || nowMs - event.timestampMs > MAX_AGE_MS) {
    severity = 'P1'; suggestions = ['QUARANTINE_INPUT']; reasons.push('UNTRUSTWORTHY_EVENT_TIMESTAMP_OR_PROVENANCE');
  } else {
    switch (event.kind) {
      case 'UNEXPECTED_SIGNER_REQUEST':
      case 'UNAUTHORIZED_MODE_CHANGE':
      case 'VENUE_BALANCE_MISMATCH':
        severity = 'P0'; suggestions = ['DENY_PRIVILEGED_ACTION', 'PAUSE_NEW_EXPOSURE_REQUEST']; reasons.push(event.kind); break;
      case 'AUDIT_CHAIN_BROKEN':
        // The local record may have been rewritten: stop adding risk until the owner compares independent records.
        severity = 'P0'; suggestions = ['PAUSE_NEW_EXPOSURE_REQUEST', 'INVESTIGATE']; reasons.push(event.kind); break;
      case 'UNEXPECTED_ALLOWANCE':
      case 'HOST_EXEC_ANOMALY':
        severity = 'P1'; suggestions = ['PAUSE_NEW_EXPOSURE_REQUEST', 'INVESTIGATE']; reasons.push(event.kind); break;
      case 'PROMPT_INJECTION':
        severity = 'P1'; suggestions = ['QUARANTINE_INPUT', 'DENY_PRIVILEGED_ACTION']; reasons.push(event.kind); break;
      case 'OWNER_IDENTITY_CHANGED':
        severity = 'P1'; suggestions = ['VERIFY_IDENTITY', 'REVOKE_SESSIONS_REQUEST']; reasons.push(event.kind); break;
      case 'STEP_UP_FAILURE_BURST':
        // Failures on an AUTHENTICATED session: someone holding a session is guessing the second factor.
        severity = 'P1'; suggestions = ['REVOKE_SESSIONS_REQUEST', 'INVESTIGATE']; reasons.push(event.kind); break;
      case 'LOGIN_FAILURE_BURST':
      case 'WEB_FLOOD':
        severity = 'P2'; suggestions = ['THROTTLE_AT_EDGE', 'INVESTIGATE']; reasons.push(event.kind); break;
      case 'WITHDRAWAL_ATTEMPT':
        severity = 'P2'; suggestions = ['VERIFY_IDENTITY', 'INVESTIGATE']; reasons.push(event.kind); break;
      default:
        severity = 'P3'; suggestions = ['INVESTIGATE']; reasons.push('UNKNOWN_OR_LOW_PRIORITY');
    }
  }
  return Object.freeze({ severity, suggestions: Object.freeze(suggestions), reasons: Object.freeze(reasons),
    canAuthorizeTrading: false as const, canSignTransactions: false as const, canWithdraw: false as const });
}
