import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { freshDb } from './helpers.js';
import { all, closeDb, get, openDb } from '../src/db/db.js';
import { notify, markRead, notificationCenter, criticalSummary, ackNotificationGroup, ROOT_CAUSE, CENTER_WINDOW_MS, type NotificationGroup } from '../src/notify/notify.js';
import { buildApp } from '../src/index.js';

/** S6 severity notification center: read-time grouping, sticky CRITICAL, rowid-anchored acknowledgement, audited acks. */
const T = Date.UTC(2026, 10, 10, 12, 0, 0);
const BTC = 'Protection unverified: crypto:binance:BTCUSDT';
const find = (title: string, severity = 'CRITICAL') => notificationCenter().groups.find((g) => g.title === title && g.severity === severity) as NotificationGroup;
const ack = (g: NotificationGroup) => ackNotificationGroup('owner', { source: g.source, title: g.title, severity: g.severity, throughId: g.ackThroughId });

describe('notification center', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(T); freshDb(); });
  afterEach(() => vi.useRealTimers());

  it('groups repeats by source + title + severity and pins unread CRITICAL first with a root-cause link', () => {
    notify('INFO', 'Paper entry: ETH', 'x', 'oms');
    for (let i = 0; i < 3; i++) notify('CRITICAL', BTC, 'stale book ' + i, 'risk');
    notify('CRITICAL', BTC, 'other source', 'watchdog');
    const c = notificationCenter();
    expect(c.groups).toHaveLength(3);
    expect(c.groups[0]).toMatchObject({ source: 'risk', title: BTC, severity: 'CRITICAL', count: 3, unread: 3, sticky: true, href: '/risk', lastBody: 'stale book 2' });
    expect(c.groups.find((g) => g.source === 'watchdog')).toMatchObject({ count: 1, href: null });
    expect(c.groups.at(-1)).toMatchObject({ severity: 'INFO', href: '/bot', sticky: false });
  });

  it('keeps severity in the key, so an escalation never hides inside a quieter group', () => {
    notify('WARNING', 'Backup failed', 'a', 'backup'); notify('CRITICAL', 'Backup failed', 'b', 'backup');
    expect(notificationCenter().groups.map((g) => g.severity)).toEqual(['CRITICAL', 'WARNING']);
    expect(find('Backup failed').href).toBe('/security');
  });

  it('maps root causes for risk, oms, strategy-health and backups', () => {
    expect(ROOT_CAUSE).toMatchObject({ risk: '/risk', oms: '/bot', 'strategy-health': '/lab', backups: '/security', backup: '/security' });
  });

  it('acknowledges through a rowid anchor: a same-millisecond repeat stays unread and sticky', () => {
    notify('CRITICAL', BTC, '1', 'risk'); notify('CRITICAL', BTC, '2', 'risk');
    const seen = find(BTC);
    notify('CRITICAL', BTC, '3', 'risk'); // same Date.now(): only the rowid tells it apart
    expect(ack(seen)).toEqual({ ok: true, changed: 2 });
    expect(find(BTC)).toMatchObject({ count: 3, unread: 1, sticky: true });
    expect(criticalSummary()).toMatchObject({ groups: 1, unread: 1 });
  });

  it('INFO after an acknowledged CRITICAL does not resurrect it; acknowledging is audited', () => {
    notify('CRITICAL', BTC, '1', 'risk'); ack(find(BTC));
    notify('INFO', BTC, 'later', 'risk');
    expect(criticalSummary().groups).toBe(0);
    const audit = all<{ actor: string; detail: string }>("SELECT actor, detail FROM audit_log WHERE action='notification.ack'");
    expect(audit).toHaveLength(1); expect(audit[0].actor).toBe('owner');
    expect(JSON.parse(audit[0].detail)).toMatchObject({ source: 'risk', title: BTC, severity: 'CRITICAL', changed: 1 });
  });

  it('rejects an anchor that does not belong to the named group', () => {
    notify('CRITICAL', BTC, '1', 'risk'); const info = (notify('INFO', 'other', '', 'oms'), find('other', 'INFO'));
    expect(() => ackNotificationGroup('owner', { source: 'risk', title: BTC, severity: 'CRITICAL', throughId: info.ackThroughId })).toThrow(/not found/);
    expect(() => ackNotificationGroup('owner', { source: 'risk', title: BTC, severity: 'WARNING', throughId: find(BTC).ackThroughId })).toThrow(/not found/);
    expect(find(BTC).unread).toBe(1);
    expect(get<{ n: number }>("SELECT COUNT(*) n FROM audit_log WHERE action='notification.ack'")!.n).toBe(0);
  });

  it('legacy mark-all-read no longer clears CRITICAL; a single CRITICAL read is refused (409)', () => {
    const crit = notify('CRITICAL', BTC, '', 'risk'); notify('WARNING', 'w', '', 'oms'); const info = notify('INFO', 'i', '', 'oms');
    markRead();
    expect(all<{ severity: string; read: number }>('SELECT severity, read FROM notifications ORDER BY rowid')).toEqual([
      { severity: 'CRITICAL', read: 0 }, { severity: 'WARNING', read: 1 }, { severity: 'INFO', read: 1 }]);
    expect(() => markRead(crit)).toThrow(expect.objectContaining({ statusCode: 409 }));
    expect(get<{ read: number }>('SELECT read FROM notifications WHERE id=?', crit)!.read).toBe(0);
    expect(() => markRead(info)).not.toThrow();
  });

  it('an unread CRITICAL never ages out; read rows outside the window do', () => {
    notify('CRITICAL', BTC, 'old', 'risk'); notify('INFO', 'old info', '', 'oms'); markRead();
    vi.setSystemTime(T + CENTER_WINDOW_MS + 86_400_000);
    expect(notificationCenter().groups.map((g) => g.title)).toEqual([BTC]);
  });

  it('hiding INFO cannot hide CRITICAL or WARNING', () => {
    notify('CRITICAL', BTC, '', 'risk'); notify('WARNING', 'w', '', 'oms'); notify('INFO', 'i', '', 'oms');
    const c = notificationCenter({ hideInfo: true });
    expect(c.hideInfo).toBe(true); expect(c.groups.map((g) => g.severity)).toEqual(['CRITICAL', 'WARNING']);
  });

  it('101 newer INFO groups cannot evict an unread CRITICAL; truncation is disclosed', () => {
    notify('CRITICAL', BTC, '', 'risk');
    for (let i = 0; i < 101; i++) { vi.setSystemTime(T + 1000 + i); notify('INFO', 'info ' + i, '', 'oms'); }
    const c = notificationCenter();
    expect(c.groups[0].title).toBe(BTC); expect(c.groups).toHaveLength(101); expect(c.hasMore).toBe(true);
  });
});

describe('notification center HTTP API', () => {
  let app: Awaited<ReturnType<typeof buildApp>>; let cookie = '';
  const H = () => ({ cookie, 'x-mia-csrf': '1' });
  beforeAll(async () => {
    closeDb(); openDb(':memory:'); app = await buildApp();
    const r = await app.inject({ method: 'POST', url: '/api/auth/setup', payload: { password: 'correct horse battery' } });
    cookie = String(r.headers['set-cookie']).split(';')[0];
  });
  it('requires a session and the CSRF header, validates strictly and audits the acknowledgement', async () => {
    notify('CRITICAL', BTC, '', 'risk');
    const g = (await app.inject({ url: '/api/notifications/critical', headers: { cookie } })).json().top[0];
    const body = { source: g.source, title: g.title, severity: g.severity, throughId: g.ackThroughId };
    expect((await app.inject({ url: '/api/notifications/center' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/notifications/ack', payload: body })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/notifications/ack', headers: { cookie }, payload: body })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/notifications/ack', headers: H(), payload: { ...body, throughId: '1; DROP' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/notifications/ack', headers: H(), payload: { ...body, extra: 1 } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/notifications/ack', headers: H(), payload: { ...body, title: 'nope' } })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/notifications/center?hideInfo=yes', headers: { cookie } })).statusCode).toBe(400);
    const id = (await app.inject({ url: '/api/notifications', headers: { cookie } })).json()[0].id;
    expect((await app.inject({ method: 'POST', url: '/api/notifications/read', headers: H(), payload: { id } })).statusCode).toBe(409);
    expect((await app.inject({ url: '/api/notifications/critical', headers: { cookie } })).json().groups).toBe(1);
    const ok = await app.inject({ method: 'POST', url: '/api/notifications/ack', headers: H(), payload: body });
    expect(ok.statusCode).toBe(200); expect(ok.json()).toEqual({ ok: true, changed: 1 });
    expect((await app.inject({ url: '/api/notifications/critical', headers: { cookie } })).json().groups).toBe(0);
    expect((await app.inject({ url: '/api/audit', headers: { cookie } })).json().some((a: any) => a.action === 'notification.ack')).toBe(true);
  });
});
