/**
 * Evidence integrity guard (owner-approved, 26 Nov 2026): new paper entries pause while the closed-trade evidence the
 * learning loop depends on is broken. Exits, protection and monitoring never pass through the risk gate and are never
 * affected.
 *
 * Broken means any of:
 *  - a ledger settlement that disagrees with its fills or recorded PnL (outcome settlement MISMATCH);
 *  - a closed paper position still unlinked to an outcome record after LINK_GRACE_MS, or closed without a close time;
 *  - an outcome record whose content no longer matches its stored hash (tampering or corruption);
 *  - the background hash check failing on its last attempt (a check that cannot run is not a clean result).
 *
 * Settlement and linking are cheap and computed inline on every gate evaluation, so they cannot be stale. The full hash
 * check reads every record, so the background lane runs it and stores the result; flagged records are re-hashed inline.
 * A missing result does not deny (nothing has been checked yet); a malformed or failed one does. Anyone able to alter
 * outcome rows can also alter the stored result, so this detects corruption; it does not defend against an attacker
 * with database write access.
 *
 * The owner clears an investigated finding by acknowledging the exact version reviewed: position id, finding kind,
 * stored hash and content hash (step-up at the route). An acknowledgement stops applying when either hash changes, and
 * a settlement acknowledgement never clears a tamper finding. Unlinked positions cannot be acknowledged.
 */
import { all, get, tx } from '../db/db.js';
import { audit } from '../core/audit.js';
import { getSetting, setSetting } from '../core/settings.js';
import { assertWriteFence, type LeaseFence } from '../ops/lease.js';
import { PAPER_ACCOUNT } from '../portfolio/ledger.js';
import { storedContentHash, verifyTradeOutcomes } from './tradeOutcomes.js';

export const HASH_CHECK_KEY = 'evidence.integrity.hashCheck';
export const ACK_KEY = 'evidence.integrity.acknowledged';
/** A closed position must be linked within this window; the linker runs on every background pass. */
export const LINK_GRACE_MS = 30 * 60_000;
export const MAX_ACKNOWLEDGE = 100;

export type FindingKind = 'MISMATCH' | 'TAMPERED';
/** One record as the owner reviews it; an acknowledgement must name exactly this. */
export interface Finding { positionId: string; kind: FindingKind; storedHash: string; contentHash: string | null }
export interface Acknowledgement extends Finding { acknowledgedAt: number }
export interface HashCheck { checkedAt: number | null; checked: number; tampered: string[]; lastAttemptAt: number; lastError: string | null }
export interface EvidenceIntegrity {
  ok: boolean;
  reasons: string[];
  findings: { mismatched: Finding[]; tampered: Finding[]; unlinked: string[] };
  hashCheck: { checkedAt: number | null; lastAttemptAt: number | null; lastError: string | null };
  evaluatedAt: number;
}

const str = (v: unknown) => typeof v === 'string';
const time = (v: unknown) => Number.isSafeInteger(v);
const isAck = (v: any): v is Acknowledgement => !!v && typeof v === 'object' && str(v.positionId) && (v.kind === 'MISMATCH' || v.kind === 'TAMPERED')
  && str(v.storedHash) && (v.contentHash === null || str(v.contentHash)) && time(v.acknowledgedAt);
const isHashCheck = (v: any): v is HashCheck => !!v && typeof v === 'object' && (v.checkedAt === null || time(v.checkedAt)) && time(v.checked)
  && Array.isArray(v.tampered) && v.tampered.every(str) && time(v.lastAttemptAt) && (v.lastError === null || str(v.lastError));

/** getSetting throws on malformed JSON; both that and a wrong shape are reported as invalid, never as "no finding". */
function readSetting<T>(key: string, valid: (v: unknown) => v is T): { value: T | null; invalid: boolean } {
  let raw: unknown;
  try { raw = getSetting<unknown>(key, null); } catch { return { value: null, invalid: true }; }
  if (raw === null) return { value: null, invalid: false };
  return valid(raw) ? { value: raw, invalid: false } : { value: null, invalid: true };
}

/** The finding for one stored outcome row, re-hashed now. A row that cannot be hashed has no content hash. */
function finding(positionId: string, kind: FindingKind): Finding | null {
  const row = get<any>('SELECT * FROM ditas_trade_outcomes WHERE position_id=?', positionId);
  if (!row) return null;
  let contentHash: string | null = null;
  try { contentHash = storedContentHash(row); } catch { contentHash = null; }
  return { positionId, kind, storedHash: row.hash, contentHash };
}
const sameVersion = (a: Finding, b: Finding) => a.positionId === b.positionId && a.kind === b.kind && a.storedHash === b.storedHash && a.contentHash === b.contentHash;

export function evaluateEvidenceIntegrity(nowTs = Date.now()): EvidenceIntegrity {
  if (!Number.isSafeInteger(nowTs) || nowTs <= 0) throw new Error('INVALID_INTEGRITY_TIME');
  const reasons: string[] = [];
  const acks = readSetting(ACK_KEY, (v): v is Acknowledgement[] => Array.isArray(v) && v.every(isAck));
  const check = readSetting(HASH_CHECK_KEY, isHashCheck);
  if (acks.invalid) reasons.push('EVIDENCE_INTEGRITY_INVALID: stored acknowledgements are malformed');
  if (check.invalid) reasons.push('EVIDENCE_INTEGRITY_INVALID: stored hash check is malformed');
  const acknowledged = (f: Finding) => (acks.value ?? []).some((a) => sameVersion(a, f));
  const open = (ids: string[], kind: FindingKind) => ids.map((id) => finding(id, kind)).filter((f): f is Finding => !!f && !acknowledged(f));

  const mismatched = open(all<{ position_id: string }>("SELECT position_id FROM ditas_trade_outcomes WHERE settlement='MISMATCH' ORDER BY closed_at, position_id").map((r) => r.position_id), 'MISMATCH');
  if (mismatched.length) reasons.push(`SETTLEMENT_MISMATCH: ${mismatched.length} unacknowledged trade settlement(s) disagree with the ledger`);
  const unlinked = all<{ id: string }>(`SELECT p.id FROM positions p LEFT JOIN ditas_trade_outcomes t ON t.position_id=p.id
    WHERE p.account=? AND p.status='CLOSED' AND (p.closed_at IS NULL OR p.closed_at<?) AND t.position_id IS NULL ORDER BY p.closed_at, p.id LIMIT 100`,
  PAPER_ACCOUNT, nowTs - LINK_GRACE_MS).map((r) => r.id);
  if (unlinked.length) reasons.push(`OUTCOMES_NOT_LINKED: ${unlinked.length}${unlinked.length === 100 ? '+' : ''} closed trade(s) unlinked for more than ${LINK_GRACE_MS / 60_000} minutes or without a close time`);
  const tampered = open(check.value?.tampered ?? [], 'TAMPERED');
  // A flagged record that has since disappeared stays a finding; it cannot be acknowledged.
  const vanished = (check.value?.tampered ?? []).filter((id) => !get('SELECT 1 FROM ditas_trade_outcomes WHERE position_id=?', id));
  if (vanished.length) reasons.push(`TAMPERED_RECORD_MISSING: ${vanished.length} flagged outcome record(s) no longer exist`);
  if (tampered.length) reasons.push(`OUTCOME_RECORDS_ALTERED: ${tampered.length} unacknowledged outcome record(s) fail hash verification`);
  if (check.value?.lastError) reasons.push(`HASH_CHECK_FAILED: the last outcome hash check could not run (${check.value.lastError})`);
  return { ok: reasons.length === 0, reasons, findings: { mismatched, tampered, unlinked },
    hashCheck: { checkedAt: check.value?.checkedAt ?? null, lastAttemptAt: check.value?.lastAttemptAt ?? null, lastError: check.value?.lastError ?? null }, evaluatedAt: nowTs };
}

/**
 * Background lane: verify every outcome hash and store the result under the engine write fence. A failed attempt is
 * stored too (keeping the last completed result), so the gate denies instead of trusting an old clean result.
 */
export function refreshOutcomeHashCheck(nowTs = Date.now(), fence?: LeaseFence): HashCheck {
  let result: HashCheck;
  try {
    const v = verifyTradeOutcomes();
    result = { checkedAt: nowTs, checked: v.checked, tampered: v.tampered, lastAttemptAt: nowTs, lastError: null };
  } catch (error) {
    const previous = readSetting(HASH_CHECK_KEY, isHashCheck).value;
    result = { checkedAt: previous?.checkedAt ?? null, checked: previous?.checked ?? 0, tampered: previous?.tampered ?? [], lastAttemptAt: nowTs,
      lastError: String((error as Error)?.message ?? error).slice(0, 200) || 'unknown error' };
  }
  tx(() => { assertWriteFence(fence); setSetting(HASH_CHECK_KEY, result); });
  return result;
}

/**
 * Owner acknowledgement of investigated findings (the route enforces step-up). Each entry must equal a current open
 * finding exactly, including both hashes, so the owner acknowledges only the version they reviewed. Re-evaluates at once.
 */
export function acknowledgeEvidenceFindings(actor: string, reviewed: Finding[], nowTs = Date.now()): EvidenceIntegrity {
  if (actor !== 'owner') throw new Error('only the owner may acknowledge evidence integrity findings');
  if (!reviewed.length || reviewed.length > MAX_ACKNOWLEDGE) throw new Error(`acknowledge between 1 and ${MAX_ACKNOWLEDGE} records`);
  // A record that cannot be hashed cannot be bound to a reviewed version, so it can only be repaired, not acknowledged.
  if (reviewed.some((f) => f.contentHash === null)) throw new Error('a record without a content hash cannot be acknowledged; repair it first');
  return tx(() => {
    const current = evaluateEvidenceIntegrity(nowTs);
    if (current.reasons.some((r) => r.startsWith('EVIDENCE_INTEGRITY_INVALID'))) throw new Error('stored integrity settings are malformed; repair them before acknowledging');
    const openFindings = [...current.findings.mismatched, ...current.findings.tampered];
    const stale = reviewed.filter((f) => !openFindings.some((o) => sameVersion(o, f)));
    if (stale.length) throw new Error(`not an open finding in the reviewed version (it may have changed): ${stale.slice(0, 10).map((f) => `${f.positionId}/${f.kind}`).join(', ')}`);
    const existing = getSetting<Acknowledgement[]>(ACK_KEY, []);
    const replaced = (a: Acknowledgement) => reviewed.some((f) => f.positionId === a.positionId && f.kind === a.kind);
    setSetting(ACK_KEY, [...existing.filter((a) => !replaced(a)), ...reviewed.map((f) => ({ ...f, acknowledgedAt: nowTs }))]);
    const issues = (id: string) => { try { return (JSON.parse(get<{ payload: string }>('SELECT payload FROM ditas_trade_outcomes WHERE position_id=?', id)?.payload ?? 'null')?.settlement?.issues ?? []) as string[]; } catch { return ['PAYLOAD_UNREADABLE']; } };
    audit(actor, 'evidence.integrity.acknowledge', { records: reviewed.map((f) => ({ ...f, settlementIssues: f.kind === 'MISMATCH' ? issues(f.positionId) : undefined })) });
    return evaluateEvidenceIntegrity(nowTs);
  });
}
