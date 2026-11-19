/**
 * MIA NEXUS fabric — transactional outbox (N2).
 *
 * An event is appended in the SAME SQLite transaction as the business row it describes (V3-05 "core transactional
 * sequence", steps 1–2): if the business write rolls back, no event exists; if it commits, the event is durable and
 * the relay delivers it later (at-least-once). Writing outside a transaction is refused, so an event can never exist
 * for state that was not committed. The envelope is validated against the catalog before it is stored.
 */
import { inTransaction, run, get } from '../db/db.js';
import { validateEvent, type FabricEvent } from './contracts.js';
import { topicSpec } from './catalog.js';

export class OutboxError extends Error {}

export function appendEvent(event: FabricEvent, nowMs = Date.now()) {
  if (!inTransaction()) throw new OutboxError('fabric events must be appended inside the business transaction they describe');
  const v = validateEvent(event);
  if (!v.ok) throw new OutboxError(`invalid fabric event: ${v.errors.join('; ')}`);
  const spec = topicSpec(event.eventType)!;
  if (spec.status !== 'OUTBOX_DURABLE') throw new OutboxError(`${event.eventType} is not enabled for durable delivery yet (status ${spec.status})`);
  run('INSERT INTO fabric_outbox(event_id,event_type,producer,trace_id,envelope,payload_hash,recorded_at,status,deliver_after) VALUES (?,?,?,?,?,?,?,?,?)',
    event.eventId, event.eventType, event.source, event.traceId, JSON.stringify(event), event.payloadHash, Date.parse(event.recordedAt), 'PENDING', nowMs);
  return { eventId: event.eventId, seq: get<{ seq: number }>('SELECT seq FROM fabric_outbox WHERE event_id=?', event.eventId)!.seq };
}
