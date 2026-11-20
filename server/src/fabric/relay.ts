/**
 * MIA NEXUS fabric — relay and consumer inbox (N2). At-least-once delivery with idempotent consumers:
 *  - events are delivered in outbox order (seq): while an earlier event of the SAME topic is still PENDING for a consumer
 *    (e.g. waiting out a retry backoff), later events of that topic wait too, across passes (no overtaking). A DEAD
 *    event releases the queue: it is audited and the owner is notified, so the gap is recorded, never silent;
 *  - an event with no subscribed consumer is marked NO_CONSUMER (not DELIVERED): nobody received it;
 *  - each consumer's handler and its inbox row commit in ONE transaction, so a crash after handling but before the
 *    status update leads to redelivery that the inbox ignores — the handler's effect happens exactly once;
 *  - failures back off exponentially; after `maxAttempts` the event is DEAD (dead-letter), audited and the owner is
 *    notified. Nothing is ever silently dropped or deleted.
 * The relay runs only in the engine LEADER's background lane (bot/bot.ts). It has no financial authority: it imports
 * nothing from risk, OMS, ledger, wallet, decision or QCI, and consumers registered here must be read-model builders.
 */
import { all, get, run, tx } from '../db/db.js';
import { audit } from '../core/audit.js';
import { notify } from '../notify/notify.js';
import { validateEvent, type FabricEvent } from './contracts.js';

export type Consumer = { id: string; topics: string[]; handle: (event: FabricEvent) => void };
const consumers = new Map<string, Consumer>();
export function registerConsumer(c: Consumer) {
  if (!/^[a-z0-9:_\-]{3,60}$/.test(c.id)) throw new Error('invalid consumer id');
  consumers.set(c.id, c);
}
export function _resetConsumersForTests() { consumers.clear(); }
export const registeredConsumers = () => [...consumers.values()].map((c) => ({ id: c.id, topics: c.topics }));

const backoffMs = (attempts: number) => Math.min(5 * 60_000, 1000 * 2 ** Math.max(0, attempts - 1));

interface Row { seq: number; event_id: string; event_type: string; envelope: string; attempts: number }
export function relayOnce(opts: { nowMs?: number; batch?: number; maxAttempts?: number } = {}) {
  const now = opts.nowMs ?? Date.now(); const batch = opts.batch ?? 100; const maxAttempts = opts.maxAttempts ?? 8;
  const rows = all<Row>("SELECT seq, event_id, event_type, envelope, attempts FROM fabric_outbox WHERE status='PENDING' AND deliver_after <= ? ORDER BY seq LIMIT ?", now, batch);
  const result = { delivered: 0, retried: 0, dead: 0, skippedBehindFailure: 0, noConsumer: 0 };
  for (const r of rows) {
    const event = storedEvent(r);
    if (typeof event === 'string') { kill(r, event); result.dead++; continue; } // never deliver a malformed or tampered event
    const targets = [...consumers.values()].filter((c) => c.topics.includes(r.event_type));
    if (targets.length === 0) { run("UPDATE fabric_outbox SET status='NO_CONSUMER', last_error=NULL WHERE seq=?", r.seq); result.noConsumer++; continue; }
    let failed: string | null = null; let waiting = false;
    for (const c of targets) {
      if (get('SELECT 1 FROM fabric_inbox WHERE consumer_id=? AND event_id=?', c.id, r.event_id)) continue; // already handled (redelivery)
      if (earlierPending(c.id, r)) { waiting = true; continue; }
      try {
        tx(() => { c.handle(event); run('INSERT INTO fabric_inbox(consumer_id,event_id,handled_at) VALUES (?,?,?)', c.id, r.event_id, now); });
      } catch (e: any) {
        failed = `${c.id}: ${String(e?.message ?? e).slice(0, 200)}`;
      }
    }
    if (failed) {
      const attempts = r.attempts + 1;
      if (attempts >= maxAttempts) { kill(r, failed, attempts); result.dead++; }
      else { run('UPDATE fabric_outbox SET attempts=?, deliver_after=?, last_error=? WHERE seq=?', attempts, now + backoffMs(attempts), failed, r.seq); result.retried++; }
    } else if (waiting) { result.skippedBehindFailure++; }
    else { run("UPDATE fabric_outbox SET status='DELIVERED', delivered_at=?, last_error=NULL WHERE seq=?", now, r.seq); result.delivered++; }
  }
  return result;
}

/** Re-parses AND re-validates (schema, owner, payload hash) the stored envelope; returns the reason when it fails. */
function storedEvent(r: Row): FabricEvent | string {
  let raw: unknown;
  try { raw = JSON.parse(r.envelope); } catch { return 'stored envelope is not valid JSON'; }
  let v: ReturnType<typeof validateEvent>;
  // e.g. a payload number like 1e400 parses to Infinity and canonicalization throws: that row must dead-letter, not
  // stop the relay before `kill` runs and block every later event (CodeRabbit #45).
  try { v = validateEvent(raw); } catch (e: any) { return `stored envelope cannot be validated: ${String(e?.message ?? e).slice(0, 200)}`; }
  if (!v.ok) return `stored envelope no longer validates: ${v.errors.join('; ').slice(0, 200)}`;
  const e = raw as FabricEvent;
  if (e.eventId !== r.event_id || e.eventType !== r.event_type) return 'stored envelope does not match its outbox row';
  return e;
}

/** True while an earlier event of the same topic is still PENDING and not yet handled by this consumer. */
function earlierPending(consumerId: string, r: Row) {
  return !!get(`SELECT 1 FROM fabric_outbox o WHERE o.event_type=? AND o.status='PENDING' AND o.seq<?
    AND NOT EXISTS (SELECT 1 FROM fabric_inbox i WHERE i.consumer_id=? AND i.event_id=o.event_id) LIMIT 1`, r.event_type, r.seq, consumerId);
}

function kill(r: Row, reason: string, attempts = r.attempts + 1) {
  run("UPDATE fabric_outbox SET status='DEAD', attempts=?, last_error=? WHERE seq=?", attempts, reason.slice(0, 300), r.seq);
  audit('system', 'fabric.dead_letter', { eventId: r.event_id, eventType: r.event_type, attempts });
  notify('WARNING', 'Fabric event dead-lettered', `${r.event_type} (${r.event_id}) failed ${attempts} delivery attempts and needs review.`, 'fabric');
}

/** Owner health view: counts, oldest pending age, dead letters. Measured from the table, never estimated. */
export function outboxHealth(nowMs = Date.now()) {
  const counts = Object.fromEntries(all<{ status: string; n: number }>('SELECT status, COUNT(*) n FROM fabric_outbox GROUP BY status').map((r) => [r.status, r.n]));
  const oldest = get<{ recorded_at: number }>("SELECT recorded_at FROM fabric_outbox WHERE status='PENDING' ORDER BY seq LIMIT 1");
  return {
    counts: { PENDING: counts.PENDING ?? 0, DELIVERED: counts.DELIVERED ?? 0, NO_CONSUMER: counts.NO_CONSUMER ?? 0, DEAD: counts.DEAD ?? 0 },
    oldestPendingAgeMs: oldest ? Math.max(0, nowMs - oldest.recorded_at) : null,
    deadLetters: all('SELECT event_id AS eventId, event_type AS eventType, attempts, last_error AS lastError FROM fabric_outbox WHERE status=\'DEAD\' ORDER BY seq DESC LIMIT 50'),
    consumers: registeredConsumers(),
  };
}
