import { all, get, run, tx } from '../db/db.js';
import { uid } from '../core/util.js';
import { notify } from '../notify/notify.js';
import { journal } from '../journal/journal.js';
import { audit } from '../core/audit.js';
import { bus } from '../core/bus.js';

/**
 * Persistent protection incidents (CLAUDE.md invariant #4). When an open paper position cannot be evaluated or exited
 * because market data is stale, missing, future-dated or too thin, MIA never invents a fill: the position stays open
 * and an incident is recorded here. It survives restarts, de-duplicates repeated detections, re-alerts at most every
 * REALERT_MS, moves to RECOVERED when executable data returns, and stays visible until the owner acknowledges it.
 * While an incident is OPEN the risk gate refuses new entries on that instrument.
 */
export type IncidentStatus = 'OPEN' | 'RECOVERED' | 'ACKNOWLEDGED';
export interface Incident { id: string; position_id: string; instrument: string; status: IncidentStatus; reason: string; opened_at: number; last_seen_at: number;
  last_notified_at: number; occurrences: number; recovered_at: number | null; acknowledged_at: number | null; acknowledged_by: string | null; ack_note: string | null }
export const REALERT_MS = 600_000;
export class IncidentError extends Error { constructor(msg: string, public statusCode = 409) { super(msg); } }

const active = (positionId: string) => get<Incident>("SELECT * FROM protection_incidents WHERE position_id=? AND status IN ('OPEN','RECOVERED')", positionId);

/** Record (or refresh) an incident for a position that cannot currently be protected. Idempotent per position. */
export function reportUnprotected(p: { id: string; instrument: string }, reason: string, nowTs = Date.now()) {
  const cur = active(p.id);
  let alert = false; let id: string;
  tx(() => {
    if (!cur) {
      id = uid('inc'); alert = true;
      run(`INSERT INTO protection_incidents(id,position_id,instrument,status,reason,opened_at,last_seen_at,last_notified_at,occurrences) VALUES (?,?,?,?,?,?,?,?,1)`,
        id, p.id, p.instrument, 'OPEN', reason.slice(0, 300), nowTs, nowTs, nowTs);
    } else {
      id = cur.id; alert = cur.status === 'RECOVERED' || nowTs - cur.last_notified_at >= REALERT_MS;
      run(`UPDATE protection_incidents SET status='OPEN', reason=?, last_seen_at=?, occurrences=occurrences+1, recovered_at=NULL, last_notified_at=? WHERE id=?`,
        reason.slice(0, 300), nowTs, alert ? nowTs : cur.last_notified_at, id);
    }
  });
  if (alert) {
    notify('CRITICAL', `Protection unverified: ${p.instrument}`, `${reason}. The paper position stays open (no synthetic fill). New entries on this instrument are blocked until executable data returns; acknowledge the incident in the Risk Center.`, 'risk');
    journal('RISK', `Protection incident for ${p.instrument}: ${reason}`, p.id);
    bus.publish('risk', { incident: id!, status: 'OPEN' });
  }
  return id!;
}
/** Executable data is back (or the position closed): OPEN → RECOVERED. It still awaits owner acknowledgement. */
export function markRecovered(positionId: string, nowTs = Date.now()) {
  const r = run("UPDATE protection_incidents SET status='RECOVERED', recovered_at=? WHERE position_id=? AND status='OPEN'", nowTs, positionId);
  if (Number(r.changes)) { journal('RISK', 'Protection restored: executable market data available again', positionId); bus.publish('risk', { positionId, status: 'RECOVERED' }); }
}
/** Positions that closed (e.g. manually) cannot stay "unprotected". */
export function sweepClosedPositions(nowTs = Date.now()) {
  run("UPDATE protection_incidents SET status='RECOVERED', recovered_at=? WHERE status='OPEN' AND position_id IN (SELECT id FROM positions WHERE status<>'OPEN')", nowTs);
}
/** Global account interlock: a different unprotected OPEN position must block new exposure too. */
export function openIncidentForAccount(account: string) {
  return get<Incident>(`SELECT i.* FROM protection_incidents i
    JOIN positions p ON p.id=i.position_id
    WHERE p.account=? AND p.status='OPEN' AND i.status='OPEN'
    ORDER BY i.opened_at, i.id LIMIT 1`, account) ?? null;
}
export function openIncidentFor(instrumentId: string) { return get<Incident>("SELECT * FROM protection_incidents WHERE instrument=? AND status='OPEN' ORDER BY opened_at LIMIT 1", instrumentId) ?? null; }
export function listIncidents(includeAcknowledged = false, limit = 100) {
  return all<Incident>(`SELECT * FROM protection_incidents ${includeAcknowledged ? '' : "WHERE status IN ('OPEN','RECOVERED')"} ORDER BY opened_at DESC LIMIT ?`, Math.min(500, Math.max(1, limit)));
}
/**
 * Owner acknowledgement. An OPEN incident (problem still present) can be acknowledged only with a note describing
 * the action taken; acknowledging does not remove the entry block, which lifts only when data recovers.
 */
export function acknowledgeIncident(actor: string, id: string, note: string, nowTs = Date.now()) {
  if (actor !== 'owner') throw new IncidentError('only the owner may acknowledge protection incidents', 403);
  const inc = get<Incident>('SELECT * FROM protection_incidents WHERE id=?', id); if (!inc) throw new IncidentError('incident not found', 404);
  if (inc.status === 'ACKNOWLEDGED') return inc;
  if (inc.status === 'OPEN') throw new IncidentError('incident is still OPEN: the position cannot be exited yet. Restore market data or close the position manually once a fresh book is available, then acknowledge.');
  if (!note.trim()) throw new IncidentError('a note describing the operator action is required', 400);
  tx(() => { // acknowledgement and its audit record commit together
    run("UPDATE protection_incidents SET status='ACKNOWLEDGED', acknowledged_at=?, acknowledged_by=?, ack_note=? WHERE id=?", nowTs, actor, note.slice(0, 1000), id);
    audit(actor, 'risk.incident.ack', { id, positionId: inc.position_id, note: note.slice(0, 200) });
  });
  return get<Incident>('SELECT * FROM protection_incidents WHERE id=?', id)!;
}
