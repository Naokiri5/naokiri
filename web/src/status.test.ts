import { describe, it, expect } from 'vitest';
import { deriveStatus, SHELL_STALE_MS, type ShellDto, type Segment } from './status';

const NOW = 1_800_000_000_000;
function shell(over: Partial<ShellDto> = {}): ShellDto {
  return {
    mode: 'PAPER', display: 'PAPER', control: { emergency: false, pausedNewOrders: false },
    bot: { running: true, cycles: 12, lastScanAt: NOW - 30_000, lastTickerAt: NOW - 5_000, lastError: null },
    account: { equity: 10_000, dailyPnlPct: 0.2, drawdownPct: 0.5, openRiskPct: 0.4, openCount: 1, deposits: 10_000 },
    policyAccepted: true, riskLimits: { dailyLossPct: 2, drawdownWarnPct: 5, drawdownHaltPct: 8, maxOpenRiskPct: 2 },
    dataHealth: { stale: false, tickersAt: NOW - 10_000, scanAt: NOW - 30_000, live: 7, degraded: 0 },
    unread: 0, gates: '6/14 gates passed — live execution LOCKED', liveAllowed: false, offline: false, scanIntervalMs: 60_000, serverTime: NOW,
    ...over,
  };
}
const base = { fetchedAt: NOW, error: null, streamConnected: true, now: NOW };
const seg = (segs: Segment[], id: Segment['id']) => segs.find((s) => s.id === id)!;

describe('status ribbon model', () => {
  it('healthy PAPER state: data, engine, risk and link are ok; live is LOCKED (never green)', () => {
    const m = deriveStatus({ ...base, shell: shell() });
    expect(m.stale).toBe(false);
    expect(seg(m.segments, 'mode')).toMatchObject({ value: 'PAPER', tone: 'locked' });
    expect(seg(m.segments, 'live')).toMatchObject({ value: 'LOCKED', tone: 'locked' });
    expect(seg(m.segments, 'data')).toMatchObject({ value: 'LIVE · 10s', tone: 'ok' });
    expect(seg(m.segments, 'engine')).toMatchObject({ value: 'SCANNING · 30s', tone: 'ok' });
    expect(seg(m.segments, 'risk').tone).toBe('ok');
    expect(seg(m.segments, 'link')).toMatchObject({ value: 'LIVE', tone: 'ok' });
    expect(m.segments.map((s) => s.id)).toEqual(['mode', 'live', 'data', 'engine', 'risk', 'link']);
  });

  it('no response yet: everything UNKNOWN/CHECKING, nothing ok', () => {
    const m = deriveStatus({ ...base, shell: null, fetchedAt: null });
    expect(m.segments.every((s) => s.tone === 'unknown')).toBe(true);
    expect(seg(m.segments, 'mode').value).toBe('CHECKING');
  });

  it('server unreachable before first response: UNKNOWN and link OFFLINE', () => {
    const m = deriveStatus({ ...base, shell: null, fetchedAt: null, error: 'HTTP 502' });
    expect(m.stale).toBe(true);
    expect(seg(m.segments, 'data')).toMatchObject({ value: 'UNKNOWN', tone: 'unknown' });
    expect(seg(m.segments, 'link')).toMatchObject({ value: 'OFFLINE', tone: 'bad' });
    expect(m.segments.some((s) => s.tone === 'ok')).toBe(false);
  });

  it('last good response older than the stale window: every segment STALE, never green', () => {
    const m = deriveStatus({ ...base, shell: shell(), now: NOW + SHELL_STALE_MS + 1, error: 'Failed to fetch' });
    expect(m.stale).toBe(true);
    expect(m.segments.some((s) => s.tone === 'ok')).toBe(false);
    expect(seg(m.segments, 'mode')).toMatchObject({ value: 'PAPER · STALE', tone: 'unknown' });
    expect(seg(m.segments, 'data').value).toBe('STALE');
    expect(seg(m.segments, 'link')).toMatchObject({ value: 'LOST · 45s', tone: 'bad' });
  });

  it('a failed poll inside the window keeps values but marks the link RETRYING', () => {
    const m = deriveStatus({ ...base, shell: shell(), now: NOW + 20_000, error: 'HTTP 500' });
    expect(m.stale).toBe(false);
    expect(seg(m.segments, 'link')).toMatchObject({ value: 'RETRYING', tone: 'warn' });
  });

  it('SSE disconnected but polling works: link POLLING (warn)', () => {
    expect(seg(deriveStatus({ ...base, shell: shell(), streamConnected: false }).segments, 'link')).toMatchObject({ value: 'POLLING', tone: 'warn' });
  });

  it('offline server: data OFFLINE and engine OFF, risk unconfirmed', () => {
    const m = deriveStatus({ ...base, shell: shell({ offline: true, bot: { running: false, cycles: 0, lastScanAt: 0, lastTickerAt: 0, lastError: null }, dataHealth: { stale: true, tickersAt: 0, scanAt: 0, live: 0, degraded: 0 } }) });
    expect(seg(m.segments, 'data')).toMatchObject({ value: 'OFFLINE', tone: 'bad' });
    expect(seg(m.segments, 'engine')).toMatchObject({ value: 'OFF (OFFLINE)', tone: 'bad' });
    expect(seg(m.segments, 'risk').tone).toBe('unknown');
  });

  it('stale market data uses server time, not the browser clock', () => {
    const m = deriveStatus({ ...base, shell: shell({ serverTime: NOW - 3_600_000, dataHealth: { stale: true, tickersAt: NOW - 3_900_000, scanAt: 0, live: 0, degraded: 2 } }) });
    expect(seg(m.segments, 'data')).toMatchObject({ value: 'STALE · 5m', tone: 'bad' });
  });

  it('degraded providers warn; missing tickers are UNKNOWN', () => {
    expect(seg(deriveStatus({ ...base, shell: shell({ dataHealth: { stale: false, tickersAt: NOW - 1000, scanAt: 0, live: 5, degraded: 2 } }) }).segments, 'data').tone).toBe('warn');
    expect(seg(deriveStatus({ ...base, shell: shell({ dataHealth: { stale: true, tickersAt: 0, scanAt: 0, live: 0, degraded: 0 } }) }).segments, 'data')).toMatchObject({ value: 'NO DATA', tone: 'unknown' });
  });

  it('engine: stopped is bad, no scan yet is unknown, three missed scans is STALLED', () => {
    const b = shell().bot;
    expect(seg(deriveStatus({ ...base, shell: shell({ bot: { ...b, running: false } }) }).segments, 'engine')).toMatchObject({ value: 'STOPPED', tone: 'bad' });
    expect(seg(deriveStatus({ ...base, shell: shell({ bot: { ...b, lastScanAt: 0 } }) }).segments, 'engine')).toMatchObject({ value: 'STARTING', tone: 'unknown' });
    expect(seg(deriveStatus({ ...base, shell: shell({ bot: { ...b, lastScanAt: NOW - 181_000 } }) }).segments, 'engine')).toMatchObject({ value: 'STALLED · 3m', tone: 'bad' });
    expect(seg(deriveStatus({ ...base, shell: shell({ bot: { ...b, lastError: 'scan: boom' } }) }).segments, 'engine').detail).toMatch(/scan: boom/);
  });

  it('risk: emergency, missing policy, tripped breaker, near limit', () => {
    expect(seg(deriveStatus({ ...base, shell: shell({ control: { emergency: true, pausedNewOrders: true }, display: 'EMERGENCY' }) }).segments, 'risk')).toMatchObject({ value: 'EMERGENCY STOP', tone: 'bad' });
    expect(seg(deriveStatus({ ...base, shell: shell({ policyAccepted: false, riskLimits: null }) }).segments, 'risk')).toMatchObject({ value: 'NO POLICY', tone: 'warn' });
    const a = shell().account;
    expect(seg(deriveStatus({ ...base, shell: shell({ account: { ...a, dailyPnlPct: -2.1 } }) }).segments, 'risk').tone).toBe('bad');
    expect(seg(deriveStatus({ ...base, shell: shell({ account: { ...a, drawdownPct: 8 } }) }).segments, 'risk').value).toMatch(/^BREAKER/);
    expect(seg(deriveStatus({ ...base, shell: shell({ account: { ...a, drawdownPct: 5.5 } }) }).segments, 'risk').tone).toBe('warn');
    expect(seg(deriveStatus({ ...base, shell: shell({ control: { emergency: false, pausedNewOrders: true }, display: 'PAUSED' }) }).segments, 'risk').tone).toBe('warn');
  });

  it('if release gates ever report live eligible, the ribbon warns instead of going green', () => {
    expect(seg(deriveStatus({ ...base, shell: shell({ liveAllowed: true }) }).segments, 'live')).toMatchObject({ value: 'GATES PASSED', tone: 'warn' });
  });

  it('READ-ONLY and EMERGENCY mode labels', () => {
    expect(seg(deriveStatus({ ...base, shell: shell({ mode: 'OBSERVE', display: 'READ-ONLY' }) }).segments, 'mode').detail).toMatch(/no orders are placed/);
    expect(seg(deriveStatus({ ...base, shell: shell({ control: { emergency: true, pausedNewOrders: true }, display: 'EMERGENCY' }) }).segments, 'mode').tone).toBe('bad');
  });
});
