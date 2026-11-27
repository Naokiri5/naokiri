import { describe, expect, it } from 'vitest';
import type { ShellDto } from '../../status';
import { EVENT_WINDOW_MS, joeEventFrom, mapJoeState, type JoeSignals } from './JoeStateMapper';

const NOW = 1_800_000_000_000;
function shell(over: Partial<ShellDto> = {}): ShellDto {
  return {
    mode: 'PAPER', display: 'PAPER', control: { emergency: false, pausedNewOrders: false },
    bot: { running: true, cycles: 12, lastScanAt: NOW - 30_000, lastTickerAt: NOW - 5_000, lastError: null },
    account: { equity: 10_000, dailyPnlPct: 0, weeklyPnlPct: 0, drawdownPct: 0, openRiskPct: 0, openCount: 0, deposits: 10_000, consecutiveLosses: 0, marksMissing: 0 },
    policyAccepted: true, riskLimits: null,
    dataHealth: { stale: false, tickersAt: NOW - 10_000, scanAt: NOW - 30_000, live: 7, degraded: 0 },
    unread: 0, gates: 'locked', liveAllowed: false, offline: false, scanIntervalMs: 60_000, tickerIntervalMs: 15_000, serverTime: NOW,
    ...over,
  };
}
const base: JoeSignals = { shell: shell(), shellUnavailable: false, streamConnected: true, sessionState: 'CLOSED', chat: 'idle', lastEvent: null, now: NOW };
const state = (over: Partial<JoeSignals>) => mapJoeState({ ...base, ...over }).state;

describe('Trader Joe state mapping', () => {
  it('is on standby with no session and no recent event', () => {
    expect(mapJoeState(base)).toEqual({ state: 'STANDBY', caption: expect.stringContaining('No paper session') });
  });
  it('never looks busy when the status is missing, malformed or unreachable', () => {
    for (const over of [{ shell: null }, { shell: { mode: 'PAPER' } }, { shellUnavailable: true }] as Partial<JoeSignals>[]) {
      expect(state({ ...over, sessionState: 'RUNNING', lastEvent: { kind: 'scan', at: NOW } })).toBe('SYSTEM_ERROR');
    }
  });
  it('follows the chat request', () => {
    expect(state({ chat: 'composing' })).toBe('LISTENING');
    expect(state({ chat: 'waiting' })).toBe('TYPING');
  });
  it('puts safety states ahead of decoration', () => {
    expect(state({ shell: shell({ control: { emergency: true, pausedNewOrders: true } }), sessionState: 'RUNNING' })).toBe('RISK_ALERT');
    expect(state({ sessionState: 'EMERGENCY_KILL_SWITCH' })).toBe('RISK_ALERT');
    expect(state({ streamConnected: false, sessionState: 'RUNNING' })).toBe('DISCONNECTED');
    expect(state({ shell: shell({ dataHealth: { stale: true, tickersAt: 0, scanAt: 0, live: 0, degraded: 1 } }) })).toBe('DISCONNECTED');
    expect(state({ sessionState: 'CLOSING_DRAINING_ENTRIES', lastEvent: { kind: 'scan', at: NOW } })).toBe('SESSION_CLOSING');
  });
  it('reacts to recent recorded events only, then returns to the session state', () => {
    const scan = { kind: 'scan', at: NOW - 1000 } as const;
    expect(state({ lastEvent: scan, sessionState: 'RUNNING' })).toBe('SCANNING');
    expect(state({ lastEvent: { ...scan, at: NOW - EVENT_WINDOW_MS - 1 }, sessionState: 'RUNNING' })).toBe('MONITORING');
    expect(state({ lastEvent: { ...scan, at: NOW + 5000 } })).toBe('STANDBY'); // future-dated events are ignored
    expect(state({ lastEvent: { kind: 'decision', at: NOW, rejected: true } })).toBe('RISK_ALERT');
    expect(state({ lastEvent: { kind: 'decision', at: NOW, rejected: false, asset: 'BTC' } })).toBe('RESEARCHING');
    expect(state({ lastEvent: { kind: 'protection', at: NOW } })).toBe('RISK_ALERT');
    expect(state({ lastEvent: { kind: 'position-closed', at: NOW } })).toBe('POSITION_REVIEW');
  });
  it('shows a running session as monitoring, and a risk halt as an alert', () => {
    expect(state({ sessionState: 'RUNNING' })).toBe('MONITORING');
    expect(state({ sessionState: 'ENTRY_SUSPENDED_RISK_HALT' })).toBe('RISK_ALERT');
  });
});

describe('stream event mapping', () => {
  it('maps the server payloads Joe reacts to and ignores the rest', () => {
    expect(joeEventFrom('scan', { at: 1, universe: 10, candidates: 2 }, NOW)).toEqual({ kind: 'scan', at: NOW });
    expect(joeEventFrom('decision', { decision: 'REJECTED', asset: 'ETH' }, NOW)).toEqual({ kind: 'decision', at: NOW, rejected: true, asset: 'ETH' });
    expect(joeEventFrom('risk', { incident: 'i1', status: 'OPEN' }, NOW)).toEqual({ kind: 'protection', at: NOW });
    expect(joeEventFrom('risk', { positionId: 'p', status: 'RECOVERED' }, NOW)).toBeNull();
    expect(joeEventFrom('position', { positionId: 'p', closed: true }, NOW)).toEqual({ kind: 'position-closed', at: NOW });
    expect(joeEventFrom('position', { positionId: 'p' }, NOW)).toBeNull();
    expect(joeEventFrom('scan', null, NOW)).toBeNull(); // a resync carries no payload and is not a scan
    expect(joeEventFrom('decision', { decision: 5 }, NOW)).toBeNull();
    expect(joeEventFrom('ticker', { last: 1 }, NOW)).toBeNull();
  });
});
