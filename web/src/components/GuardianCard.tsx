import { useState } from 'react';
import { api, fmt, useApi, stepUpBody } from '../api';
import { Action, Badge, Card, Empty, ErrorLine } from '../ui';
import { StepUp } from '../pages/Trading';

/**
 * Guardian Shield: seven-layer posture and security events from the audit log. Read-only. The only control offered is
 * the existing risk-reducing "Pause new orders"; Guardian itself can never trade, sign, withdraw or resume.
 */
type Item = { id: string; name: string; status: string; detail: string };
type Report = {
  counts: Record<'P0' | 'P1' | 'P2' | 'P3', number>; autoPause: boolean;
  /** Opt-in alerts; absent on older servers. */
  alerts?: { telegram: boolean; enabledAt: number | null; telegramConfigured: boolean };
  containment: { action: string; evidenceId?: string };
  events: { event: { kind: string; timestampMs: number; evidenceId: string; sanitizedSummary: string }; assessment: { severity: string; suggestions: string[] } }[];
  layers: { id: number; name: string; items: Item[] }[];
};
const tone = (s: string) => (s === 'PASS' ? 'b-good' : s === 'FAIL' || s === 'P0' ? 'b-bad' : s === 'WARN' || s === 'P1' ? 'b-warn' : s === 'NOT_VERIFIED' || s === 'NOT_CONFIGURED' ? 'b-neutral' : 'b-info');
const label = (s: string) => s.replace(/_/g, ' ');

/** Opt-in alerts for P0/P1 events. Turning them on is free; turning them off needs step-up (it lowers visibility). */
function GuardianAlerts({ a, reload }: { a: NonNullable<Report['alerts']>; reload: () => void }) {
  const [proof, setProof] = useState('');
  return <div className="col" style={{ gap: 6 }} aria-label="Guardian alerts">
    <b>Alerts for serious events</b>
    <div className="hint">When on, each new P0 or P1 Guardian event sends one notification (at most 5 an hour): in the app, and on Telegram {a.telegramConfigured ? 'as well' : 'once Telegram is connected (it is not configured on this server)'}. Alerts contain the event and its evidence id only.</div>
    {a.telegram
      ? <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><Badge v="ON" tone="b-good" /><span className="hint">since {a.enabledAt ? fmt.ago(a.enabledAt) : '—'}</span>
          <StepUp value={proof} onChange={setProof} />
          <Action className="sm" label="Turn alerts off" run={async () => { try { await api('/api/security/guardian/alerts', { body: { telegram: false, ...stepUpBody(proof) } }); reload(); } finally { setProof(''); } }} /></div>
      : <div className="row" style={{ gap: 8 }}><Badge v="OFF" tone="b-neutral" />
          <Action className="primary sm" label="Turn alerts on" run={async () => { await api('/api/security/guardian/alerts', { body: { telegram: true } }); reload(); }} /></div>}
  </div>;
}

export function GuardianCard() {
  const r = useApi<Report>('/api/security/guardian', { every: 60_000 });
  const d = r.data;
  return <Card title="Guardian Shield" right={d && <span className="row" style={{ gap: 6 }}>{(['P0', 'P1', 'P2', 'P3'] as const).map((p) => <Badge key={p} v={`${p} ${d.counts[p]}`} tone={d.counts[p] ? tone(p) : 'b-neutral'} />)}</span>}>
    <div className="col" style={{ gap: 12 }}>
      <div className="hint">Seven defence layers and security events from MIA's tamper-evident audit log. Guardian can only suggest or pause new orders: it never trades, signs, withdraws, changes limits or resumes. Grey means MIA cannot measure it from inside the app, which is not the same as safe.</div>
      <ErrorLine e={r.error} />
      {!d ? <Empty>{r.loading ? 'Assessing…' : 'No data.'}</Empty> : <>
        {d.counts.P0 > 0 && <div className="banner stale" role="alert" style={{ margin: 0 }}>Critical security event. Review below.
          {d.containment.action === 'PAUSED' ? ' Guardian paused new orders (existing positions stay protected; only you can resume).' : ''}
          {d.containment.action === 'DISABLED' ? ' Automatic pause is off — pause manually if you agree:' : ''}
          {d.containment.action === 'DISABLED' && <span style={{ marginLeft: 8 }}><Action className="danger sm" label="Pause new orders" run={async () => { await api('/api/emergency/pause', { body: {} }); r.reload(); }} /></span>}
        </div>}
        <table><thead><tr><th>Severity</th><th>Event</th><th>When</th><th>Suggested</th></tr></thead><tbody>
          {d.events.slice(0, 15).map((e, i) => <tr key={i}><td><Badge v={e.assessment.severity} tone={tone(e.assessment.severity)} /></td><td><b>{label(e.event.kind)}</b><div className="hint">{e.event.sanitizedSummary}</div><div className="faint mono">{e.event.evidenceId}</div></td><td className="faint">{fmt.ago(e.event.timestampMs)}</td><td className="hint">{e.assessment.suggestions.map(label).join(', ')}</td></tr>)}
          {!d.events.length && <tr><td colSpan={4}><Empty>No security events in the last 24 hours.</Empty></td></tr>}
        </tbody></table>
        {d.alerts && <GuardianAlerts a={d.alerts} reload={r.reload} />}
        <div className="grid g2">{d.layers.map((l) => <div key={l.id} className="col" style={{ gap: 4 }}>
          <b>{l.id}. {l.name}</b>
          {l.items.map((i) => <div key={i.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}><span style={{ flex: 'none' }}><Badge v={label(i.status)} tone={tone(i.status)} /></span><div style={{ flex: 1, minWidth: 0 }}><div>{i.name}</div><div className="hint">{i.detail}</div></div></div>)}
        </div>)}</div>
      </>}
    </div>
  </Card>;
}
