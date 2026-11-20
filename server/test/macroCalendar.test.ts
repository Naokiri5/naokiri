import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { freshDb, seedInstrument } from './helpers.js';
import { closeDb } from '../src/db/db.js';
import { market } from '../src/market/store.js';
import { evaluateRisk } from '../src/risk/gate.js';
import { acceptPolicy, DEFAULT_POLICY } from '../src/risk/policy.js';
import { PAPER_ACCOUNT, ledger } from '../src/portfolio/ledger.js';
import { updateControl } from '../src/core/mode.js';
import { modeGate } from '../src/qa/gates.js';
import { setSetting } from '../src/core/settings.js';
import { assessMacroEntry, publishMacroCalendarSnapshot, MACRO_CALENDAR_SETTING,
  type MacroCalendarSnapshot } from '../src/risk/macroCalendar.js';

const now = Date.parse('2026-11-20T11:00:00Z');
const macro = (overrides: Partial<MacroCalendarSnapshot> = {}): MacroCalendarSnapshot => ({
  mode: 'ENFORCE', source: 'fixture-calendar', fetchedAtMs: now - 1000,
  validUntilMs: now + 15 * 60_000, coverageCurrencies: ['USD', 'BTC'],
  preEventBufferMinutes: 20, postEventBufferMinutes: 15,
  events: [{ id: 'us-cpi', title: 'US CPI', currency: 'USD', impact: 'HIGH',
    timestampMs: now + 5 * 60_000 }],
  ...overrides,
});
describe('macro calendar veto as a risk-reducing, optional paper gate', () => {
  beforeEach(() => { freshDb(); market.reset(); });
  afterEach(() => { closeDb(); market.reset(); });

  it('never says CLEAR without an owner-configured schedule', () => {
    expect(assessMacroEntry(null, { base: 'BTC', quote: 'USDT' }, now)).toMatchObject({
      status: 'NOT_CONFIGURED', blocked: false, reasonCode: 'MACRO_CALENDAR_NOT_CONFIGURED',
    });
  });
  it('vetoes a relevant high-impact event in the configured window', () => {
    const out = assessMacroEntry(macro(), { base: 'ETH', quote: 'USDT' }, now);
    expect(out).toMatchObject({ status: 'BLOCKED', blocked: true,
      activeEventId: 'us-cpi', reasonCode: 'HIGH_IMPACT_MACRO_WINDOW' });
  });
  it('treats low-impact events as non-blocking while preserving coverage status', () => {
    const out = assessMacroEntry(macro({ events: [{ id: 'low', title: 'Low release',
      currency: 'USD', impact: 'LOW', timestampMs: now }] }), { base: 'ETH', quote: 'USDT' }, now);
    expect(out).toMatchObject({ status: 'CLEAR', blocked: false });
  });
  it('denies stale, incomplete or future-dated enforcing snapshots', () => {
    expect(assessMacroEntry(macro({ validUntilMs: now - 1 }), { base: 'ETH', quote: 'USDT' }, now).blocked).toBe(true);
    expect(assessMacroEntry(macro({ fetchedAtMs: now + 1 }), { base: 'ETH', quote: 'USDT' }, now).blocked).toBe(true);
    expect(assessMacroEntry(macro({ coverageCurrencies: ['SOL'], events: [] }),
      { base: 'BTC', quote: 'USDT' }, now).reasonCode).toBe('MACRO_CALENDAR_COVERAGE_MISSING');
  });
  it('rejects corrupt schedules instead of silently deactivating enforcement', () => {
    expect(assessMacroEntry({ mode: 'ENFORCE', events: 'not an array' },
      { base: 'ETH', quote: 'USDT' }, now)).toMatchObject({ status: 'UNAVAILABLE', blocked: true });
  });
  it('requires owner authority to configure the schedule', () => {
    expect(() => publishMacroCalendarSnapshot('bot', macro(), now)).toThrow(/only owner/);
    expect(() => publishMacroCalendarSnapshot('owner', macro(), now)).not.toThrow();
  });
  it('rejects duplicate IDs and impossible cache expiration', () => {
    const event = macro().events[0];
    expect(() => publishMacroCalendarSnapshot('owner', macro({ events: [event, event] }), now)).toThrow(/DUPLICATE/);
    expect(() => publishMacroCalendarSnapshot('owner', macro({ validUntilMs: now + 31 * 60_000 }), now)).toThrow(/TIME_INVALID/);
  });
  it('keeps OFF explicit but never calls an off schedule verified', () => {
    expect(assessMacroEntry(macro({ mode: 'OFF' }), { base: 'BTC', quote: 'USDT' }, now))
      .toMatchObject({ status: 'NOT_CONFIGURED', blocked: false, reasonCode: 'MACRO_CALENDAR_OFF' });
  });
  it('integrates with the existing evaluateRisk authority, no second governor', () => {
    // Use a current time so canonical market fixture timestamps remain fresh.
    const at = Date.now();
    const { inst, last } = seedInstrument('ETHUSDT', { nowTs: at });
    acceptPolicy('owner', DEFAULT_POLICY);
    updateControl('owner', { mode: 'PAPER' }, modeGate);
    ledger(PAPER_ACCOUNT, 'DEPOSIT', 10_000);
    const intent = { instrumentId: inst.id, strategyId: 'trend_pullback',
      side: 'buy' as const, entryPrice: last, stopPrice: last * 0.97,
      idempotencyKey: 'macro-fixture', traceId: 'macro-test' };
    const baseline = evaluateRisk(intent, at);
    expect(baseline.evaluated.macroCalendar).toBe('NOT_CONFIGURED');
    publishMacroCalendarSnapshot('owner', {
      ...macro(), fetchedAtMs: at - 1000, validUntilMs: at + 10 * 60_000,
      events: [{ id: 'cpi', title: 'CPI', currency: 'USD', impact: 'HIGH',
        timestampMs: at + 5 * 60_000 }],
    }, at);
    const blocked = evaluateRisk(intent, at);
    expect(blocked.decision).toBe('DENY');
    expect(blocked.reasonCodes).toContain('MACRO_CALENDAR:HIGH_IMPACT_MACRO_WINDOW');
    // A corrupt enforced snapshot must fail closed, never silently become disabled.
    setSetting(MACRO_CALENDAR_SETTING, { mode: 'ENFORCE', events: null });
    expect(evaluateRisk(intent, at).reasonCodes).toContain('MACRO_CALENDAR:MACRO_CALENDAR_INVALID');
  });
});
