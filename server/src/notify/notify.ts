import { run, all, get, tx } from '../db/db.js';
import { audit } from '../core/audit.js';
import { uid } from '../core/util.js';
import { bus } from '../core/bus.js';
import { config } from '../config.js';
import { fetchProvider, provider } from '../providers/http.js';
import { getSetting } from '../core/settings.js';

/** Part 6.5 / 13.3 notifications: in-app always; Telegram if configured. Never includes secrets. */
export type Severity = 'INFO' | 'WARNING' | 'CRITICAL';
export function notify(severity: Severity, title: string, body = '', source = 'system') {
  const prefs = getSetting('notifyPrefs', { telegramMinSeverity: 'WARNING', quietHoursUtc: null as null | [number, number] });
  const id = uid('ntf'); const ts = Date.now();
  const wantsTg = !!(config.telegramBotToken && config.telegramChatId) && rank(severity) >= rank(prefs.telegramMinSeverity as Severity) && !inQuiet(prefs.quietHoursUtc, severity);
  const delivery = { inApp: 'DELIVERED', telegram: wantsTg ? 'PENDING' : config.telegramBotToken ? 'SKIPPED' : 'NOT_CONFIGURED' };
  run('INSERT INTO notifications(id,ts,severity,title,body,source,delivery) VALUES (?,?,?,?,?,?,?)', id, ts, severity, title.slice(0, 200), body.slice(0, 1000), source, JSON.stringify(delivery));
  bus.publish('notification', { id, ts, severity, title, body, source });
  if (wantsTg) sendTelegram(id, `[MIA ${severity}] ${title}\n${body}`).catch(() => {});
  return id;
}
async function sendTelegram(id: string, text: string) {
  let status = 'FAILED';
  try {
    if (provider('telegram')) {
      const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage?chat_id=${encodeURIComponent(config.telegramChatId)}&text=${encodeURIComponent(text.slice(0, 3500))}`;
      await fetchProvider('telegram', url); status = 'DELIVERED';
    }
  } catch { status = 'FAILED'; }
  run("UPDATE notifications SET delivery=json_set(delivery,'$.telegram',?) WHERE id=?", status, id);
}
const rank = (s: Severity) => ({ INFO: 0, WARNING: 1, CRITICAL: 2 })[s];
function inQuiet(q: [number, number] | null, s: Severity) { if (!q || s === 'CRITICAL') return false; const h = new Date().getUTCHours(); return q[0] <= q[1] ? h >= q[0] && h < q[1] : h >= q[0] || h < q[1]; }
export const listNotifications = (limit = 200) => all('SELECT * FROM notifications ORDER BY ts DESC LIMIT ?', limit);
const httpError = (statusCode: number, msg: string) => Object.assign(new Error(msg), { statusCode });
/**
 * Mark one notification read, or every non-CRITICAL one when `id` is exactly undefined. A falsy-but-present id no
 * longer marks everything. CRITICAL rows are never cleared here: they need an explicit, audited group acknowledgement.
 */
export function markRead(id?: string) {
  if (id === undefined) return run("UPDATE notifications SET read=1 WHERE read=0 AND severity<>'CRITICAL'");
  if (get<{ severity: string }>('SELECT severity FROM notifications WHERE id=?', id)?.severity === 'CRITICAL') throw httpError(409, 'CRITICAL notifications stay until acknowledged from the notification center');
  return run('UPDATE notifications SET read=1 WHERE id=?', id);
}

/**
 * Severity notification center (read-time grouping; raw rows stay as the history). Severity is part of the group key,
 * so an escalation never hides inside a quieter group. An unread CRITICAL never ages out of the window, and hiding INFO
 * adds only the literal predicate severity<>'INFO', so it can never hide CRITICAL or WARNING.
 */
export const CENTER_WINDOW_MS = 14 * 86_400_000;
export const CENTER_GROUP_LIMIT = 100;
/** Root-cause pages by notification source. 'backup' is the source main's bot.ts emits today; 'backups' is the planned name. */
export const ROOT_CAUSE: Record<string, string> = { risk: '/risk', oms: '/bot', 'strategy-health': '/lab', backups: '/security', backup: '/security' };
export interface NotificationGroup {
  source: string; title: string; severity: Severity; count: number; unread: number; firstTs: number; lastTs: number;
  lastBody: string; ackThroughId: string; href: string | null; sticky: boolean;
}
interface GroupRow { source: string; title: string; severity: Severity; count: number; unread: number; firstTs: number; lastTs: number; anchor: number; lastBody: string | null }
function groupRows(where: string, ...params: unknown[]): NotificationGroup[] {
  const rows = all<GroupRow>(`SELECT g.*, n.body lastBody FROM (
      SELECT COALESCE(source,'system') source, title, severity, COUNT(*) count, SUM(read=0) unread, MIN(ts) firstTs, MAX(ts) lastTs, MAX(rowid) anchor
      FROM notifications WHERE ${where} GROUP BY 1, 2, 3) g JOIN notifications n ON n.rowid = g.anchor`, ...params);
  return rows.map((r) => ({ source: r.source, title: r.title, severity: r.severity, count: r.count, unread: r.unread, firstTs: r.firstTs, lastTs: r.lastTs,
    lastBody: r.lastBody ?? '', ackThroughId: String(r.anchor), href: ROOT_CAUSE[r.source] ?? null, sticky: r.severity === 'CRITICAL' && r.unread > 0 }))
    .sort((a, b) => Number(b.sticky) - Number(a.sticky) || rank(b.severity) - rank(a.severity) || b.lastTs - a.lastTs);
}
export function notificationCenter(opts: { hideInfo?: boolean } = {}, nowTs = Date.now()) {
  const groups = groupRows(`(ts >= ? OR (severity='CRITICAL' AND read=0))${opts.hideInfo ? " AND severity<>'INFO'" : ''}`, nowTs - CENTER_WINDOW_MS);
  const sticky = groups.filter((g) => g.sticky); const rest = groups.filter((g) => !g.sticky);
  return { asOf: nowTs, windowMs: CENTER_WINDOW_MS, hideInfo: !!opts.hideInfo, groups: [...sticky, ...rest.slice(0, CENTER_GROUP_LIMIT)], hasMore: rest.length > CENTER_GROUP_LIMIT };
}
/** Unread CRITICAL groups only, for the shell strip. */
export function criticalSummary() {
  const groups = groupRows("severity='CRITICAL' AND read=0");
  return { groups: groups.length, unread: groups.reduce((n, g) => n + g.unread, 0), top: groups.slice(0, 5) };
}
/**
 * Acknowledge one group up to and including the rowid anchor the client saw, so a repeat inserted afterwards (even in
 * the same millisecond) stays unread. The anchor must belong to the named group. Every acknowledgement is audited in the
 * same transaction. Acknowledging never resolves an incident, resumes trading or changes any control state.
 */
export function ackNotificationGroup(actor: string, g: { source: string; title: string; severity: Severity; throughId: string }) {
  const anchor = Number(g.throughId);
  const row = get<{ source: string; title: string; severity: string }>("SELECT COALESCE(source,'system') source, title, severity FROM notifications WHERE rowid=?", anchor);
  if (!row || row.source !== g.source || row.title !== g.title || row.severity !== g.severity) throw httpError(404, 'notification group not found');
  const changed = tx(() => {
    const r = run("UPDATE notifications SET read=1 WHERE read=0 AND COALESCE(source,'system')=? AND title=? AND severity=? AND rowid<=?", g.source, g.title, g.severity, anchor);
    audit(actor, 'notification.ack', { source: g.source, title: g.title, severity: g.severity, throughId: g.throughId, changed: Number(r.changes) });
    return Number(r.changes);
  });
  bus.publish('notification', { ack: true, source: g.source, title: g.title, severity: g.severity, changed });
  return { ok: true, changed };
}
