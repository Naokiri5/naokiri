import { describe, it, expect } from 'vitest';
import { deriveStatus, SHELL_STALE_MS, type ShellDto, type Segment } from './status';

const NOW = 1_800_000_000_000;
function shell(over: Partial<ShellDto> = {}): ShellDto {
  return {
    mode: 'PAPER', display: 'PAPER', control: { emergency: false, pausedNewOrders: false },
    bot: { running: true, cycles: 12, lastScanAt: NOW - 30_000, lastTickerAt: NOW - 5_000, lastError: null },
    account: { equity: 10_000, dailyPnlPct: 0.2, weeklyPnlPct: 0.4, drawdownPct: 0.5, openRiskPct: 0.4, openCount: 1, deposits: 10_000, consecutiveLosses: 0, marksMissing: 0 },
    policyAccepted: true, riskLimits: { dailyLossPct: 2, weeklyLossPct: 4, drawdownWarnPct: 5, drawdownHaltPct: 8, maxOpenRiskPct: 2, maxConsecutiveLosses: 3 },
    dataHealth: { stale: false, tickersAt: NOW - 10_000, scanAt: NOW - 30_000, live: 7, degraded: 0 },
    unread: 0, gates: '6/14 gates passed — live execution LOCKED', liveAllowed: false, offline: false, scanIntervalMs: 60_000, tickerIntervalMs: 15_000, serverTime: NOW,
    ...over,
  };
}
const MONO = 5_000; // monotonic clock origin, unrelated to wall time
const base = { requestedAt: MONO, error: null, streamConnected: true, now: MONO };
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

  it('no response yet: CHECKING/UNKNOWN, nothing ok; the build-level LIVE LOCKED label stays', () => {
    const m = deriveStatus({ ...base, shell: null, requestedAt: null });
    expect(m.segments.filter((s) => s.id !== 'live').every((s) => s.tone === 'unknown')).toBe(true);
    expect(seg(m.segments, 'mode').value).toBe('CHECKING');
    expect(seg(m.segments, 'live')).toMatchObject({ value: 'LOCKED', tone: 'locked' });
  });

  it('malformed or partial payloads are UNKNOWN and never throw or go green', () => {
    const bad: unknown[] = [{}, { ...shell(), serverTime: undefined }, { ...shell(), scanIntervalMs: 0 }, { ...shell(), account: { ...shell().account, openRiskPct: null } },
      { ...shell(), account: { ...shell().account, dailyPnlPct: undefined } }, { ...shell(), dataHealth: { ...shell().dataHealth, tickersAt: 'x' } }, 'nope'];
    for (const b of bad) {
      const m = deriveStatus({ ...base, shell: b });
      expect(m.segments.some((s) => s.tone === 'ok'), JSON.stringify(b).slice(0, 80)).toBe(false);
      expect(seg(m.segments, 'data').value).toBe('UNKNOWN');
    }
  });

  it('ticker age keeps advancing between responses and expires on its own', () => {
    const s = shell({ dataHealth: { stale: false, tickersAt: NOW - 59_000, scanAt: 0, live: 7, degraded: 0 } });
    expect(seg(deriveStatus({ ...base, shell: s }).segments, 'data').tone).toBe('ok');
    const later = deriveStatus({ ...base, shell: s, now: MONO + 2_000 });
    expect(seg(later.segments, 'data')).toMatchObject({ value: 'STALE · 1m', tone: 'bad' });
    expect(seg(later.segments, 'risk').tone).toBe('unknown');
  });

  it('future ticker timestamps and zero live feeds are not healthy', () => {
    expect(seg(deriveStatus({ ...base, shell: shell({ dataHealth: { stale: false, tickersAt: NOW + 60_000, scanAt: 0, live: 7, degraded: 0 } }) }).segments, 'data')).toMatchObject({ value: 'CLOCK?', tone: 'unknown' });
    expect(seg(deriveStatus({ ...base, shell: shell({ dataHealth: { stale: false, tickersAt: NOW - 1_000, scanAt: 0, live: 0, degraded: 0 } }) }).segments, 'data').tone).toBe('unknown');
  });

  it('freshness uses the monotonic clock: a snapshot older than the window is stale whatever the wall clock says', () => {
    expect(deriveStatus({ ...base, shell: shell(), requestedAt: 1_000, now: 1_000 + SHELL_STALE_MS + 1 }).stale).toBe(true);
    expect(deriveStatus({ ...base, shell: shell(), requestedAt: 1_000, now: 0 }).stale).toBe(false); // clock never runs backwards, but never negative either
  });

  it('server unreachable before first response: UNKNOWN and link OFFLINE', () => {
    const m = deriveStatus({ ...base, shell: null, requestedAt: null, error: 'HTTP 502' });
    expect(m.stale).toBe(true);
    expect(seg(m.segments, 'data')).toMatchObject({ value: 'UNKNOWN', tone: 'unknown' });
    expect(seg(m.segments, 'link')).toMatchObject({ value: 'OFFLINE', tone: 'bad' });
    expect(m.segments.some((s) => s.tone === 'ok')).toBe(false);
  });

  it('last good response older than the stale window: every segment STALE, never green', () => {
    const m = deriveStatus({ ...base, shell: shell(), now: MONO + SHELL_STALE_MS + 1, error: 'Failed to fetch' });
    expect(m.stale).toBe(true);
    expect(m.segments.some((s) => s.tone === 'ok')).toBe(false);
    expect(seg(m.segments, 'mode')).toMatchObject({ value: 'PAPER · STALE', tone: 'unknown' });
    expect(seg(m.segments, 'data').value).toBe('STALE');
    expect(seg(m.segments, 'link')).toMatchObject({ value: 'LOST · 45s', tone: 'bad' });
  });

  it('a failed poll inside the window keeps values but marks the link RETRYING', () => {
    const m = deriveStatus({ ...base, shell: shell(), now: MONO + 20_000, error: 'HTTP 500' });
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
    expect(seg(deriveStatus({ ...base, shell: shell({ bot: { ...b, lastScanAt: NOW - 181_000 } }) }).segments, 'engine')).toMatchObject({ value: 'SCAN STALLED · 3m', tone: 'bad' });
    expect(seg(deriveStatus({ ...base, shell: shell({ bot: { ...b, lastTickerAt: NOW - 181_000 } }) }).segments, 'engine')).toMatchObject({ value: 'MONITOR STALLED · 3m', tone: 'bad' });
    expect(seg(deriveStatus({ ...base, shell: shell({ bot: { ...b, lastError: 'scan: boom' } }) }).segments, 'engine').detail).toMatch(/scan: boom/);
  });

  it('engine: startup failure is bad and names the checks; a standby process says so instead of STOPPED', () => {
    const b = shell().bot;
    const failed = seg(deriveStatus({ ...base, shell: shell({ bot: { ...b, running: false, startup: { ok: false, failed: ['audit_chain', 'schema'] } } }) }).segments, 'engine');
    expect(failed).toMatchObject({ value: 'STARTUP FAILED', tone: 'bad' }); expect(failed.detail).toMatch(/audit_chain, schema/);
    const standby = seg(deriveStatus({ ...base, shell: shell({ bot: { ...b, running: false, lease: { state: 'STANDBY', epoch: 4, heartbeatAgeMs: 2_000, ttlMs: 15_000 }, startup: { ok: true, failed: [] } } }) }).segments, 'engine');
    expect(standby).toMatchObject({ value: 'STANDBY', tone: 'warn' }); expect(standby.detail).toMatch(/another MIA process owns the scheduler/i);
    expect(seg(deriveStatus({ ...base, shell: shell({ bot: { ...b, running: false, lease: { state: 'VACANT', epoch: 4, heartbeatAgeMs: null, ttlMs: 15_000 } } }) }).segments, 'engine').value).toBe('STOPPED');
    expect(seg(deriveStatus({ ...base, shell: shell({ bot: { ...b, lease: { state: 'OWNER', epoch: 1, heartbeatAgeMs: 0, ttlMs: 15_000 }, startup: { ok: true, failed: [] } } }) }).segments, 'engine').tone).toBe('ok');
  });

  it('monitor stall uses the last committed monitor pass, not the last ticker refresh', () => {
    const b = shell().bot;
    expect(seg(deriveStatus({ ...base, shell: shell({ bot: { ...b, lastTickerAt: NOW - 1_000, lastMonitorAt: NOW - 181_000 } }) }).segments, 'engine')).toMatchObject({ value: 'MONITOR STALLED · 3m', tone: 'bad' });
    expect(seg(deriveStatus({ ...base, shell: shell({ bot: { ...b, lastMonitorAt: 0, lastError: 'monitor: MONITOR_FAILED' } }) }).segments, 'engine')).toMatchObject({ value: 'STARTING', tone: 'unknown', detail: expect.stringMatching(/MONITOR_FAILED/) });
    expect(seg(deriveStatus({ ...base, shell: { ...shell(), bot: { ...b, lastMonitorAt: 'x' } } }).segments, 'engine').value).toBe('UNKNOWN');
  });

  it('lease and startup are optional, but malformed when present makes the payload invalid', () => {
    const b = shell().bot;
    const bad: unknown[] = [{ ...b, lease: null }, { ...b, lease: { state: 'BOSS', epoch: 1, heartbeatAgeMs: 0, ttlMs: 1 } }, { ...b, lease: { state: 'OWNER', epoch: '1', heartbeatAgeMs: 0, ttlMs: 1 } },
      { ...b, lease: { state: 'OWNER', epoch: 1, heartbeatAgeMs: undefined, ttlMs: 1 } }, { ...b, startup: { ok: 'yes', failed: [] } }, { ...b, startup: { ok: false, failed: [1] } }, { ...b, startup: { ok: false } }];
    for (const bot of bad) expect(seg(deriveStatus({ ...base, shell: { ...shell(), bot } }).segments, 'engine').value, JSON.stringify(bot).slice(60)).toBe('UNKNOWN');
    expect(seg(deriveStatus({ ...base, shell: shell() }).segments, 'engine').tone).toBe('ok');
  });

  it('risk: emergency, missing policy, tripped breaker, near limit', () => {
    expect(seg(deriveStatus({ ...base, shell: shell({ control: { emergency: true, pausedNewOrders: true }, display: 'EMERGENCY' }) }).segments, 'risk')).toMatchObject({ value: 'EMERGENCY STOP', tone: 'bad' });
    expect(seg(deriveStatus({ ...base, shell: shell({ policyAccepted: false, riskLimits: null }) }).segments, 'risk')).toMatchObject({ value: 'NO POLICY', tone: 'warn' });
    const a = shell().account;
    expect(seg(deriveStatus({ ...base, shell: shell({ account: { ...a, dailyPnlPct: -2.1 } }) }).segments, 'risk').tone).toBe('bad');
    expect(seg(deriveStatus({ ...base, shell: shell({ account: { ...a, drawdownPct: 8 } }) }).segments, 'risk').value).toMatch(/^BREAKER/);
    expect(seg(deriveStatus({ ...base, shell: shell({ account: { ...a, weeklyPnlPct: -4 } }) }).segments, 'risk').value).toMatch(/^BREAKER/);
    expect(seg(deriveStatus({ ...base, shell: shell({ account: { ...a, marksMissing: 1 } }) }).segments, 'risk')).toMatchObject({ value: 'MARKS MISSING · 1', tone: 'unknown' });
    expect(seg(deriveStatus({ ...base, shell: shell({ account: { ...a, consecutiveLosses: 3 } }) }).segments, 'risk')).toMatchObject({ value: 'LOSS STREAK · 3', tone: 'warn' });
    expect(seg(deriveStatus({ ...base, shell: shell({ account: { ...a, drawdownPct: 5.5 } }) }).segments, 'risk').tone).toBe('warn');
    expect(seg(deriveStatus({ ...base, shell: shell({ control: { emergency: false, pausedNewOrders: true }, display: 'PAUSED' }) }).segments, 'risk').tone).toBe('warn');
  });

  it('if release gates ever report live eligible, the ribbon warns instead of going green', () => {
    expect(seg(deriveStatus({ ...base, shell: shell({ liveAllowed: true }) }).segments, 'live')).toMatchObject({ value: 'GATES PASSED', tone: 'warn' });
  });

  it('paused or emergency keeps the PAPER / READ-ONLY identity visible', () => {
    expect(seg(deriveStatus({ ...base, shell: shell({ mode: 'OBSERVE', display: 'PAUSED', control: { emergency: false, pausedNewOrders: true } }) }).segments, 'mode').value).toBe('PAUSED · READ-ONLY');
    expect(seg(deriveStatus({ ...base, shell: shell({ display: 'EMERGENCY', control: { emergency: true, pausedNewOrders: true } }) }).segments, 'mode').value).toBe('EMERGENCY · PAPER');
  });

  it('READ-ONLY and EMERGENCY mode labels', () => {
    expect(seg(deriveStatus({ ...base, shell: shell({ mode: 'OBSERVE', display: 'READ-ONLY' }) }).segments, 'mode').detail).toMatch(/no orders are placed/);
    expect(seg(deriveStatus({ ...base, shell: shell({ control: { emergency: true, pausedNewOrders: true }, display: 'EMERGENCY' }) }).segments, 'mode').tone).toBe('bad');
  });
});
