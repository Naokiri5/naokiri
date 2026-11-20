/**
 * Guardian security events, derived from MIA's existing append-only, hash-chained audit log (no second event store).
 *
 * Each event points back to the audit row(s) it came from (`evidenceId`) so the owner can verify it. Summaries are
 * built from fixed text plus counts and action names only: no request bodies, tokens, passwords, codes or IP
 * addresses (an IP behind a proxy is not an identity; GUARD-084).
 */
import { all } from '../../db/db.js';
import { verifyAuditChain } from '../../core/audit.js';
import type { GuardianEvent } from './assess.js';

const WINDOW_MS = 15 * 60_000;
export const LOGIN_BURST = 5;   // failed sign-ins within 15 minutes
export const STEPUP_BURST = 3;  // failed step-ups within 15 minutes (these happen on an authenticated session)
const LOOKBACK_MS = 24 * 3600_000;

interface Row { id: number; ts: number; actor: string; action: string; detail: string | null }
const parse = (d: string | null): Record<string, unknown> => { try { const v = d ? JSON.parse(d) : null; return v && typeof v === 'object' ? v : {}; } catch { return {}; } };

/** Densest 15-minute window of a sorted list of rows; returns the count and the last row of that window. */
function burst(rows: Row[]): { count: number; last: Row | null } {
  let best = { count: 0, last: null as Row | null }; let i = 0;
  for (let j = 0; j < rows.length; j++) {
    while (rows[j].ts - rows[i].ts > WINDOW_MS) i++;
    if (j - i + 1 > best.count) best = { count: j - i + 1, last: rows[j] };
  }
  return best;
}

const IDENTITY_ACTIONS: Record<string, string> = {
  'auth.privy.owner_bound': 'The owner\'s Privy identity was bound',
  'auth.privy.link': 'The owner\'s Privy identity was (re)linked',
  'auth.privy.unlink': 'The owner\'s Privy identity was unlinked',
  'auth.2fa.enrolled': 'An authenticator app was enrolled for step-up',
  'auth.2fa.reset': 'The owner\'s authenticator was reset from the server command line',
  'auth.password.change': 'The owner passphrase was changed',
};

/** Most rows read per pass. When the window holds more, the NEWEST are read and the pass reports truncation. */
export const MAX_EVIDENCE_ROWS = 20_000;
let lastPass = { truncated: false, rows: 0 };
/** Whether the latest pass had to leave older rows of the 24-hour window unread (incomplete evidence, shown in the report). */
export const lastEvidencePass = () => ({ ...lastPass });

export function collectEvents(nowMs = Date.now()): GuardianEvent[] {
  const since = nowMs - LOOKBACK_MS;
  // Newest first, then back to chronological order: a flood of old rows must never hide a new signer event,
  // mode change or step-up burst (CodeRabbit #45).
  const rows = all<Row>(
    `SELECT id, ts, actor, action, detail FROM audit_log WHERE ts > ? AND (
       action IN ('auth.login.failed','auth.stepup.failed','control.update','withdrawal.preview','withdrawal.freeze')
       OR action LIKE 'auth.privy.%' OR action LIKE 'auth.2fa.%' OR action = 'auth.password.change'
       OR action LIKE '%signer%' OR action LIKE '%signature%' OR action LIKE '%injection%')
     ORDER BY id DESC LIMIT ?`, since, MAX_EVIDENCE_ROWS).reverse();
  lastPass = { truncated: rows.length >= MAX_EVIDENCE_ROWS, rows: rows.length };
  const events: GuardianEvent[] = [];
  const ev = (kind: GuardianEvent['kind'], r: Row, summary: string, evidence = `audit:${r.id}`) =>
    events.push({ kind, timestampMs: r.ts, sourceId: 'audit_log', evidenceId: evidence, sanitizedSummary: summary });

  const logins = burst(rows.filter((r) => r.action === 'auth.login.failed'));
  if (logins.count >= LOGIN_BURST && logins.last) ev('LOGIN_FAILURE_BURST', logins.last, `${logins.count} failed sign-ins within 15 minutes (the shared limiter throttles each client and the server)`);
  const stepups = burst(rows.filter((r) => r.action === 'auth.stepup.failed'));
  if (stepups.count >= STEPUP_BURST && stepups.last) ev('STEP_UP_FAILURE_BURST', stepups.last, `${stepups.count} failed step-up confirmations within 15 minutes on signed-in sessions`);

  for (const r of rows) {
    if (IDENTITY_ACTIONS[r.action]) {
      // A first enrollment or first binding is expected setup; anything that REPLACES an identity is worth a look.
      const d = parse(r.detail);
      const replacing = r.action === 'auth.privy.link' ? !!d.replaced : r.action === 'auth.2fa.enrolled' ? false : true;
      if (replacing || r.action === 'auth.privy.owner_bound') ev('OWNER_IDENTITY_CHANGED', r, IDENTITY_ACTIONS[r.action]);
    } else if (r.action === 'control.update') {
      const d = parse(r.detail); const to = (d.to ?? {}) as Record<string, unknown>; const from = (d.from ?? {}) as Record<string, unknown>;
      const modeChanged = to.mode !== undefined && to.mode !== from.mode;
      if (modeChanged && (r.actor !== 'owner' || to.mode === 'BOUNDED_LIVE')) ev('UNAUTHORIZED_MODE_CHANGE', r, `Execution mode changed to ${String(to.mode).slice(0, 20)} by "${r.actor.slice(0, 20)}"`);
    } else if (r.action === 'withdrawal.preview') {
      ev('WITHDRAWAL_ATTEMPT', r, 'A withdrawal preview was requested (real withdrawals are locked in this build)');
    } else if (r.action === 'withdrawal.freeze' && parse(r.detail).on === false) {
      ev('WITHDRAWAL_ATTEMPT', r, 'The withdrawal freeze was lifted');
    } else if (/signer|signature/.test(r.action)) {
      ev('UNEXPECTED_SIGNER_REQUEST', r, `Signer-related action "${r.action.slice(0, 40)}" recorded; this build has no signer`);
    } else if (/injection/.test(r.action)) {
      ev('PROMPT_INJECTION', r, `Possible prompt injection recorded ("${r.action.slice(0, 40)}"); the input was treated as data`);
    }
  }

  const chain = verifyAuditChain();
  if (!chain.ok) events.push({ kind: 'AUDIT_CHAIN_BROKEN', timestampMs: nowMs, sourceId: 'audit_chain_verifier', evidenceId: `audit:${chain.brokenAt}`,
    sanitizedSummary: `The audit hash chain breaks at entry ${chain.brokenAt}: local records may have been altered` });
  return events.sort((a, b) => b.timestampMs - a.timestampMs);
}
