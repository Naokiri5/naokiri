import { run, all } from '../db/db.js';
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
export const markRead = (id?: string) => (id ? run('UPDATE notifications SET read=1 WHERE id=?', id) : run('UPDATE notifications SET read=1'));
