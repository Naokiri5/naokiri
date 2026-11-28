import { randomBytes } from 'node:crypto';
import { bus, BUS_TOPICS, type BusTopic } from './bus.js';

/**
 * Read-only telemetry journal for the live stream (OMNI VISION telemetry foundation).
 *
 * Every bus event gets a process-scoped id `<bootId>:<sequence>` and is kept in a bounded ring. A reconnecting client
 * sends its last id and receives exactly the events it missed, in order. When that is impossible (another process
 * booted, the gap is older than the ring, or the id is malformed) it is told to RESYNC: refetch authoritative state
 * from the REST API. Telemetry never carries authority: it only says what changed; state is always reread from the
 * owning service, so a lost or reordered telemetry event can never alter orders, positions or balances.
 */
export const TELEMETRY_SCHEMA_VERSION = 1;
export const TELEMETRY_RING_SIZE = 512;

export interface TelemetryEvent { id: string; sequence: number; topic: BusTopic; emittedAtMs: number; payload: unknown }
export type TelemetryReplay = { resync: false; events: TelemetryEvent[] } | { resync: true; reason: string };
type Listener = (event: TelemetryEvent) => void;
type SubscriberErrorHandler = (error: unknown, event: TelemetryEvent) => void;

const TOPICS = new Set<string>(BUS_TOPICS);
export const isBusTopic = (topic: string): topic is BusTopic => TOPICS.has(topic);

export class TelemetryJournal {
  readonly bootId = randomBytes(4).toString('hex');
  private sequence = 0;
  private readonly ring: TelemetryEvent[] = [];
  private readonly listeners = new Set<Listener>();
  constructor(
    private readonly capacity = TELEMETRY_RING_SIZE,
    // A failing subscriber must never affect the publisher or other subscribers,
    // but its exception must not disappear either: report it through this
    // injected handler (default: console.error, the logging already used in
    // server/src/main.ts) instead of silently swallowing it.
    private readonly onSubscriberError: SubscriberErrorHandler = (error) => { console.error('telemetry subscriber failed', error); },
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error('TELEMETRY_CAPACITY_INVALID');
  }
  get lastId() { return `${this.bootId}:${this.sequence}`; }

  record(topic: BusTopic, payload: unknown, at = Date.now()): TelemetryEvent {
    // Snapshot the payload, not just the envelope: Object.freeze on the event
    // does not stop a publisher mutating the payload object afterwards, which
    // would corrupt replayed events. Non-cloneable payloads keep the original.
    let snapshot: unknown = payload;
    try { snapshot = structuredClone(payload); } catch { /* keep the original payload */ }
    const event = Object.freeze({ id: `${this.bootId}:${++this.sequence}`, sequence: this.sequence, topic, emittedAtMs: at, payload: snapshot });
    this.ring.push(event);
    if (this.ring.length > this.capacity) this.ring.shift();
    for (const listener of this.listeners) {
      try { listener(event); } catch (error) { this.onSubscriberError(error, event); }
    }
    return event;
  }

  subscribe(listener: Listener) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }

  /** Events after `lastEventId`, oldest first, or a resync instruction when the gap cannot be filled exactly. */
  since(lastEventId: string): TelemetryReplay {
    const match = /^([0-9a-f]{8}):(0|[1-9][0-9]{0,15})$/.exec(lastEventId);
    if (!match) return { resync: true, reason: 'MALFORMED_EVENT_ID' };
    if (match[1] !== this.bootId) return { resync: true, reason: 'SERVER_RESTARTED' };
    const seen = Number(match[2]);
    if (seen > this.sequence) return { resync: true, reason: 'EVENT_ID_IN_FUTURE' };
    const oldest = this.ring[0]?.sequence ?? this.sequence + 1;
    if (seen < oldest - 1) return { resync: true, reason: 'GAP_OLDER_THAN_JOURNAL' };
    return { resync: false, events: this.ring.filter((event) => event.sequence > seen) };
  }
}

export const telemetry = new TelemetryJournal();
bus.on('*', (e: { topic: BusTopic; payload: unknown }) => { telemetry.record(e.topic, e.payload); });
