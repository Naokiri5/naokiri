import { Link } from 'react-router-dom';
import { api, useApi } from './api';
import { Action } from './ui';

interface CriticalGroup { source: string; title: string; severity: 'CRITICAL'; count: number; unread: number; ackThroughId: string; href: string | null }
interface CriticalSummary { groups: number; unread: number; top: CriticalGroup[] }

export const ackGroup = (g: { source: string; title: string; severity: string; ackThroughId: string }) =>
  api('/api/notifications/ack', { body: { source: g.source, title: g.title, severity: g.severity, throughId: g.ackThroughId } });

/**
 * Sticky shell strip for unread CRITICAL notifications. It has no local dismiss: it clears only when the server records
 * an acknowledgement, so a failed acknowledgement leaves it in place. Unknown status is shown as unknown, never as zero.
 */
export function CriticalStrip() {
  const { data, error, reload } = useApi<CriticalSummary>('/api/notifications/critical', { topics: ['notification', 'risk'], every: 15_000 });
  const top = data?.top?.[0];
  // A failed refresh never leaves an older "no criticals" answer standing: without a confirmed summary the status is unknown.
  if (!data || !top) return error ? <div className="alertbar warn crit-strip" role="status">Critical notification status unknown ({error}). <Link to="/notifications">Open notifications</Link></div> : null;
  return <div className="alertbar bad crit-strip" role="alert" aria-label="Unacknowledged critical notifications">
    <b>⛔ {top.title}</b><span>×{top.unread} unacknowledged</span>
    {data.groups > 1 && <span>+{data.groups - 1} more critical</span>}
    {error && <span className="warn">(status may be outdated)</span>}
    {top.href && <Link to={top.href}>Root cause →</Link>}
    <Action className="sm" label="Acknowledge" run={async () => { await ackGroup(top); reload(); }} />
    <Link to="/notifications">All critical →</Link>
  </div>;
}
