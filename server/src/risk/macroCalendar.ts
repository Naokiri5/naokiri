/**
 * Optional owner-enforced scheduled-event veto for the canonical PAPER risk gate.
 * This is NOT a macro calendar provider, feed verifier, order manager or exit trigger.
 * Disabling is explicit: lack of configured macro coverage is NOT a safety certificate.
 */
import { z } from 'zod';
import { getSetting, setSetting } from '../core/settings.js';
import { audit } from '../core/audit.js';

const EVENT = z.object({
  id: z.string().min(1).max(128),
  title: z.string().min(1).max(240),
  currency: z.string().regex(/^[A-Z0-9]{2,12}$/),
  impact: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  timestampMs: z.number().int().nonnegative().safe(),
}).strict();
export const MacroCalendarSnapshotSchema = z.object({
  mode: z.enum(['OFF', 'ENFORCE']),
  source: z.string().min(3).max(180),
  fetchedAtMs: z.number().int().nonnegative().safe(),
  validUntilMs: z.number().int().nonnegative().safe(),
  coverageCurrencies: z.array(z.string().regex(/^[A-Z0-9]{2,12}$/)).min(1).max(60),
  preEventBufferMinutes: z.number().int().min(0).max(180),
  postEventBufferMinutes: z.number().int().min(0).max(180),
  events: z.array(EVENT).max(2000),
}).strict();
export type MacroCalendarSnapshot = z.infer<typeof MacroCalendarSnapshotSchema>;
export interface MacroGuardAssessment {
  status: 'NOT_CONFIGURED' | 'CLEAR' | 'BLOCKED' | 'UNAVAILABLE';
  blocked: boolean;
  reasonCode: string;
  activeEventId: string | null;
  minutesToEvent: number | null;
  source: string | null;
  fetchedAtMs: number | null;
  /** Does not certify the source's release-time correctness. */
  authority: 'RISK_REDUCING_ONLY';
}
export const MACRO_CALENDAR_SETTING = 'risk.macroCalendar.v1';
const ms = 60_000;
const MAX_SNAPSHOT_AGE_MS = 30 * ms;
const horizon = 48 * 60 * ms;
const unavailable = (code: string, source: string | null = null, at: number | null = null): MacroGuardAssessment =>
  ({ status: 'UNAVAILABLE', blocked: true, reasonCode: code, activeEventId: null, minutesToEvent: null,
    source, fetchedAtMs: at, authority: 'RISK_REDUCING_ONLY' });

/**
 * The owner or future authorized calendar-ingestion service must validate external source
 * provenance separately. This function validates structure/freshness, not correctness of news.
 * Never accept a feed-delivered "mode" change or a news headline as owner authorization.
 */
export function publishMacroCalendarSnapshot(actor: string, input: unknown, nowMs = Date.now()) {
  if (actor !== 'owner') throw new Error('only owner may publish or configure macro schedule');
  const snap = MacroCalendarSnapshotSchema.parse(input);
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 || snap.fetchedAtMs > nowMs ||
      snap.validUntilMs <= snap.fetchedAtMs ||
      snap.validUntilMs - snap.fetchedAtMs > MAX_SNAPSHOT_AGE_MS ||
      snap.events.some(ev => ev.timestampMs < snap.fetchedAtMs - 4 * 60 * ms ||
                             ev.timestampMs > snap.fetchedAtMs + horizon))
    throw new Error('MACRO_SNAPSHOT_TIME_INVALID');
  if (new Set(snap.events.map(ev => ev.id)).size !== snap.events.length)
    throw new Error('MACRO_EVENT_ID_DUPLICATE');
  if (new Set(snap.coverageCurrencies).size !== snap.coverageCurrencies.length)
    throw new Error('MACRO_COVERAGE_DUPLICATE');
  setSetting(MACRO_CALENDAR_SETTING, snap);
  audit(actor, 'risk.macroCalendar.publish', { mode: snap.mode, source: snap.source,
    fetchedAtMs: snap.fetchedAtMs, validUntilMs: snap.validUntilMs, count: snap.events.length });
  return snap;
}
/**
 * Pure and deterministic. ENFORCE + invalid/stale/partial coverage => deny *new* entry.
 * If not configured, report NOT_CONFIGURED rather than pretending the calendar is clear.
 */
export function assessMacroEntry(
  rawSnapshot: unknown, instrument: { base: string; quote: string },
  nowMs: number,
): MacroGuardAssessment {
  if (rawSnapshot == null) return { status: 'NOT_CONFIGURED', blocked: false,
    reasonCode: 'MACRO_CALENDAR_NOT_CONFIGURED', activeEventId: null, minutesToEvent: null,
    source: null, fetchedAtMs: null, authority: 'RISK_REDUCING_ONLY' };
  const parsed = MacroCalendarSnapshotSchema.safeParse(rawSnapshot);
  if (!parsed.success) return unavailable('MACRO_CALENDAR_INVALID');
  const s = parsed.data;
  if (s.mode === 'OFF') return { status: 'NOT_CONFIGURED', blocked: false,
    reasonCode: 'MACRO_CALENDAR_OFF', activeEventId: null, minutesToEvent: null,
    source: s.source, fetchedAtMs: s.fetchedAtMs, authority: 'RISK_REDUCING_ONLY' };
  if (!Number.isSafeInteger(nowMs) || nowMs < 0 ||
      s.fetchedAtMs > nowMs || s.validUntilMs <= nowMs ||
      s.validUntilMs <= s.fetchedAtMs ||
      nowMs - s.fetchedAtMs > MAX_SNAPSHOT_AGE_MS ||
      s.validUntilMs - s.fetchedAtMs > MAX_SNAPSHOT_AGE_MS)
    return unavailable('MACRO_CALENDAR_STALE_OR_INVALID_TIME', s.source, s.fetchedAtMs);
  if (new Set(s.events.map(e => e.id)).size !== s.events.length ||
      new Set(s.coverageCurrencies).size !== s.coverageCurrencies.length ||
      s.events.some(e => e.timestampMs < s.fetchedAtMs - 4 * 60 * ms ||
                         e.timestampMs > s.fetchedAtMs + horizon))
    return unavailable('MACRO_CALENDAR_INVALID_EVENTS', s.source, s.fetchedAtMs);
  const base = instrument.base.toUpperCase(), quote = instrument.quote.toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(base) || !/^[A-Z0-9]{2,12}$/.test(quote))
    return unavailable('MACRO_CALENDAR_INSTRUMENT_INVALID', s.source, s.fetchedAtMs);
  // USD is a global macro input for crypto instruments. Asset events only apply to their
  // corresponding base/quote symbols; this is not a guarantee of complete token-unlock coverage.
  if (!s.coverageCurrencies.includes('USD') &&
      !s.coverageCurrencies.includes(base) &&
      !s.coverageCurrencies.includes(quote))
    return unavailable('MACRO_CALENDAR_COVERAGE_MISSING', s.source, s.fetchedAtMs);
  const relevant = s.events.filter(e => e.impact === 'HIGH' &&
    (e.currency === 'USD' || e.currency === base || e.currency === quote));
  const active = relevant.filter(e =>
    nowMs >= e.timestampMs - s.preEventBufferMinutes * ms &&
    nowMs <= e.timestampMs + s.postEventBufferMinutes * ms
  ).sort((a, b) => a.timestampMs - b.timestampMs || a.id.localeCompare(b.id))[0];
  if (active) return { status: 'BLOCKED', blocked: true,
    reasonCode: 'HIGH_IMPACT_MACRO_WINDOW', activeEventId: active.id,
    minutesToEvent: (active.timestampMs - nowMs) / ms, source: s.source,
    fetchedAtMs: s.fetchedAtMs, authority: 'RISK_REDUCING_ONLY' };
  return { status: 'CLEAR', blocked: false, reasonCode: 'NO_MATCHING_EVENT_IN_WINDOW',
    activeEventId: null, minutesToEvent: null, source: s.source,
    fetchedAtMs: s.fetchedAtMs, authority: 'RISK_REDUCING_ONLY' };
}
export const assessStoredMacroEntry = (instrument: { base: string; quote: string }, nowMs: number) =>
  assessMacroEntry(getSetting<unknown>(MACRO_CALENDAR_SETTING, null), instrument, nowMs);
