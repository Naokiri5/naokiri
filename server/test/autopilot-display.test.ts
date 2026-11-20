import { describe, expect, it } from 'vitest';
import { monitorState, sourceState, type CockpitSnapshot } from '../../web/src/cockpit.js';

const now = 1_800_000_000_000;
const snapshot: CockpitSnapshot = { mode: 'PAPER', display: 'PAPER', policyAccepted: true, offline: false, control: { emergency: false, pausedNewOrders: false }, account: { equity: 100, dailyPnlPct: -1 }, dataHealth: { stale: false, tickersAt: now, scanAt: now } };
describe('read-only cockpit freshness and safety explanation', () => {
  it.each([undefined, null, 0, -1, NaN, Infinity, now + 1])('marks invalid or future source time %s UNKNOWN', timestamp => {
    expect(sourceState(timestamp, now, 60000)).toBe('UNKNOWN');
  });
  it('advances source staleness even without a new HTTP response', () => {
    expect(sourceState(now - 60000, now, 60000)).toBe('CURRENT');
    expect(sourceState(now - 60001, now, 60000)).toBe('STALE');
    expect(monitorState(snapshot, now + 60001, now + 60001, null).market).toBe('STALE');
  });
  it('does not use a fresh browser receipt as market/scanner health', () => {
    const r = monitorState({ ...snapshot, dataHealth: {} }, now, now, null);
    expect(r).toMatchObject({ market: 'UNKNOWN', scanner: 'UNKNOWN', lastKnown: false });
    expect(r.message).toContain('current market data');
  });
  it('prioritizes emergency over errors or stale receipts', () => {
    expect(monitorState({ ...snapshot, control: { emergency: true } }, now, null, 'offline').message).toContain('EMERGENCY');
  });
  it('labels retained account values last known after errors or receipt expiry', () => {
    expect(monitorState(snapshot, now, now, 'request failed').lastKnown).toBe(true);
    expect(monitorState(snapshot, now + 45001, now, null).lastKnown).toBe(true);
    expect(monitorState(snapshot, now, now, null).lastKnown).toBe(false);
    expect(snapshot.account?.equity).toBe(100);
  });
  it('does not claim an absent mode or account snapshot is verified', () => {
    expect(monitorState(null, now, null, null)).toMatchObject({ mode: 'UNKNOWN', market: 'UNKNOWN' });
    expect(monitorState({}, now, now, null).mode).toBe('UNKNOWN');
  });
  it('keeps backend stale flag and missing policy conservative', () => {
    expect(monitorState({ ...snapshot, dataHealth: { ...snapshot.dataHealth, stale: true } }, now, now, null).market).toBe('STALE');
    expect(monitorState({ ...snapshot, policyAccepted: undefined }, now, now, null).message).toContain('risk policy');
    expect(monitorState(snapshot, now, now, null).message).toContain('independent');
  });
});
