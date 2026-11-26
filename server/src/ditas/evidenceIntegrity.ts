/**
 * Evidence integrity guard (owner-approved, 26 Nov 2026): new paper entries pause while the closed-trade evidence the
 * learning loop depends on is broken. Exits, protection and monitoring are never affected.
 *
 * Broken means any of:
 *  - a ledger settlement that does not match its fills or recorded PnL (outcome settlement MISMATCH) and has not been
 *    acknowledged by the owner;
 *  - a closed paper position that has stayed unlinked to an outcome record longer than LINK_GRACE_MS (linker failing);
 *  - an outcome record whose hash no longer matches its content (tampering or corruption).
 *
 * The background lane evaluates this after the closed-trade linker and stores the result; the risk gate reads it. The
 * owner clears an investigated mismatch with a step-up acknowledgement, which re-evaluates immediately. Altered records
 * and linker failures cannot be acknowledged away: they clear only when the evidence itself is fixed.
 */
import { get } from '../db/db.js';
import { audit } from '../core/audit.js';
import { getSetting, setSetting } from '../core/settings.js';
import { PAPER_ACCOUNT } from '../portfolio/ledger.js';
import { verifyTradeOutcomes } from './tradeOutcomes.js';

export const EVIDENCE_INTEGRITY_KEY = 'evidence.integrity';
const ACK_KEY = 'evidence.integrity.acknowledgedThrough';
/** A closed position must be linked within this window; the linker runs on every background pass. */
export const LINK_GRACE_MS = 30 * 60_000;

export interface EvidenceIntegrity { ok: boolean; reasons: string[]; evaluatedAt: number }

export function evaluateEvidenceIntegrity(nowTs = Date.now()): EvidenceIntegrity {
  if (!Number.isSafeInteger(nowTs) || nowTs <= 0) throw new Error('INVALID_INTEGRITY_TIME');
  const reasons: string[] = [];
  const acknowledgedThrough = getSetting<number>(ACK_KEY, 0);
  const mismatched = get<{ n: number }>("SELECT COUNT(*) n FROM ditas_trade_outcomes WHERE settlement='MISMATCH' AND linked_at>?", acknowledgedThrough)!.n;
  if (mismatched) reasons.push(`SETTLEMENT_MISMATCH: ${mismatched} unacknowledged trade settlement(s) disagree with the ledger`);
  const unlinked = get<{ n: number }>(`SELECT COUNT(*) n FROM positions p LEFT JOIN ditas_trade_outcomes t ON t.position_id=p.id
    WHERE p.account=? AND p.status='CLOSED' AND p.closed_at IS NOT NULL AND p.closed_at<? AND t.position_id IS NULL`, PAPER_ACCOUNT, nowTs - LINK_GRACE_MS)!.n;
  if (unlinked) reasons.push(`OUTCOMES_NOT_LINKED: ${unlinked} closed trade(s) unlinked for more than ${LINK_GRACE_MS / 60_000} minutes`);
  const tampered = verifyTradeOutcomes().tampered.length;
  if (tampered) reasons.push(`OUTCOME_RECORDS_ALTERED: ${tampered} outcome record(s) fail hash verification`);
  return { ok: reasons.length === 0, reasons, evaluatedAt: nowTs };
}

/** Evaluate and store the status the risk gate reads. Call inside the leader-fenced background lane. */
export function refreshEvidenceIntegrity(nowTs = Date.now()): EvidenceIntegrity {
  const status = evaluateEvidenceIntegrity(nowTs);
  setSetting(EVIDENCE_INTEGRITY_KEY, status);
  return status;
}

export function storedEvidenceIntegrity(): EvidenceIntegrity | null {
  return getSetting<EvidenceIntegrity | null>(EVIDENCE_INTEGRITY_KEY, null);
}

/** Owner acknowledgement of investigated settlement mismatches (callers enforce step-up). Re-evaluates at once. */
export function acknowledgeSettlementMismatches(actor: string, nowTs = Date.now()): EvidenceIntegrity {
  if (actor !== 'owner') throw new Error('only the owner may acknowledge evidence integrity findings');
  setSetting(ACK_KEY, nowTs);
  audit(actor, 'evidence.integrity.acknowledge', { acknowledgedThrough: nowTs });
  return refreshEvidenceIntegrity(nowTs);
}
