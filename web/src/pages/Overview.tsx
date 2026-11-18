import { useEffect, useState } from 'react';
import { usePresentation } from '../presentation';
import { Link } from 'react-router-dom';
import { fmt, useApi } from '../api';
import { Badge, Card, Chg, Empty, ErrorLine, Page, Stat, Freshness, Meter } from '../ui';
import { DecisionTable } from './Intel';

/**
 * Overview dashboard. Every figure comes from /api/overview, which composes authoritative backend state (ledger,
 * risk policy, control state, scanner, worker stats, provider health). Missing or stale data is shown as such —
 * nothing is calculated or filled in here.
 */
const STALE_SCAN_MS = 5 * 60_000;
const TONE: Record<string, string> = { good: 'up', bad: 'down', warn: 'warn', info: '' };
const KIND_BADGE: Record<string, string> = { DECISION: 'b-info', FILL: 'b-violet', REJECTION: 'b-warn', ALERT: 'b-bad', INCIDENT: 'b-bad' };
const pnlTone = (x: number | null | undefined) => (x == null || x === 0 ? undefined : x > 0 ? 'up' as const : 'down' as const);
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function Overview() {
  const { data, error, loading, reload, updatedAt } = useApi('/api/overview', { topics: ['scan', 'decision', 'order', 'position', 'notification', 'risk', 'mode'], every: 30_000 });
  const { mode } = usePresentation();
  const a = data?.account; const b = data?.breadth; const r = data?.risk; const p = data?.pipeline; const perf = data?.performance;
  // The server reports the scanner age at response time; keep ageing it while this snapshot is shown (CodeRabbit PR #18),
  // so a retained response can never keep claiming a current heartbeat.
  const [clock, setClock] = useState(Date.now());
  useEffect(() => { const t = window.setInterval(() => setClock(Date.now()), 15_000); return () => clearInterval(t); }, []);
  const scanAgeMs = p?.scanner?.ageMs == null || updatedAt == null ? null : p.scanner.ageMs + Math.max(0, clock - updatedAt);
  const funded = !!a?.deposits;
  return <Page title="Overview" sub="Paper account, market intelligence, risk state and live activity — all from MIA's authoritative backend state."
    right={<><Freshness at={data?.asOf} />{r && <Badge v={r.mode} tone={r.emergency ? 'b-bad' : r.pausedNewOrders ? 'b-warn' : 'b-violet'} />}<button className="sm" onClick={reload} disabled={loading}>Refresh</button></>}>
    <ErrorLine e={error} />
    {r?.emergency && <div className="alertbar bad" role="alert">Emergency stop is active — no new orders. <Link to="/risk">Risk Center →</Link></div>}
    {r?.incidents.open > 0 && <div className="alertbar bad" role="status">{r.incidents.open} position(s) cannot currently be protected (no fresh executable order book). They stay open — no synthetic fill. <Link to="/risk">Review →</Link></div>}
    {!data && !error && <Empty>Loading dashboard…</Empty>}

    <Card title="Paper cockpit" className="compact-overview">
      <div className="row between"><strong>{r?.mode ?? 'UNKNOWN'}</strong><Badge v="PAPER ACCOUNT — SIMULATED" tone="b-warn" /></div>
      <div className="grid g3" style={{ marginTop: 12 }}>
        <Stat k="Paper equity" v={fmt.usd(a?.equity)} s="Not withdrawable real funds" />
        <Stat k="Daily paper P&L" v={fmt.pct(a?.dailyPnlPct)} tone={pnlTone(a?.dailyPnlPct)} />
        <Stat k="Open positions" v={a?.openCount ?? '—'} s={a ? `Open risk ${fmt.num(a.openRiskPct, 2)}%` : 'UNKNOWN'} />
      </div>
      <p role="status">{!data ? 'Waiting for verified backend state.' : error ? 'LAST KNOWN — request failed; refresh before relying on these values.' : r?.emergency ? 'Emergency stop active. Review the Risk Center.' : r?.incidents.open ? 'An open position has a protection incident. Review it in the Risk Center.' : !r?.policy ? 'Waiting for your risk-policy review.' : r?.pausedNewOrders ? 'New entries are paused.' : !p?.scanner.lastScanAt || scanAgeMs == null || scanAgeMs > STALE_SCAN_MS ? 'Waiting for a current scanner heartbeat.' : 'Monitoring. A candidate still needs strategy validation, consensus, risk approval and an authorized paper mode.'}</p>
      <p className="hint">Paper only: live execution, signing and withdrawals remain locked.</p>
      <div className="row"><Link to="/risk">Review risk and safety →</Link><Link to="/bot">Paper bot state →</Link><Link to="/scanner">Why trades were selected or rejected →</Link></div>
    </Card>
    <CriticalAlerts items={data?.alerts} />
    <details className="overview-details" key={mode} open={mode !== 'simple'}>
      <summary>Account, market and analysis details</summary>
    <div className="sec-title">Paper account</div>
    <div className="grid g6">
      <Stat k="Equity" v={fmt.usd(a?.equity)} s={funded ? `deposits ${fmt.usd(a.deposits)}` : <Link to="/bot">not funded — Bot Account</Link>} />
      <Stat k="Available cash" v={fmt.usd(a?.cash)} s={a ? `positions ${fmt.usd(a.positionsValue)}` : ''} />
      <Stat k="Open positions" v={a ? `${a.openCount}${r?.limits.positions.limit != null ? ` / ${r.limits.positions.limit}` : ''}` : '—'} s={a ? `open risk ${fmt.num(a.openRiskPct, 2)}%` : ''} />
      <Stat k="Unrealized P&L" v={fmt.usd(a?.unrealizedPnl)} tone={pnlTone(a?.unrealizedPnl)} s={a?.marksMissing?.length ? <span className="warn">marks missing: {a.marksMissing.length}</span> : 'marked to fresh quotes'} />
      <Stat k="Realized P&L" v={fmt.usd(perf?.realizedPnl)} tone={pnlTone(perf?.realizedPnl)} s={perf ? `${perf.closedTrades} closed · today ${fmt.usd(a?.realizedToday)} · fees ${fmt.usd(perf.feesPaid)}` : ''} />
      <Stat k="Today / week" v={fmt.pct(a?.dailyPnlPct)} tone={pnlTone(a?.dailyPnlPct)} s={a ? `week ${fmt.pct(a.weeklyPnlPct)} · drawdown ${fmt.num(a.drawdownPct, 2)}%` : ''} />
    </div>

    <div className="sec-title">Market intelligence</div>
    <div className="grid g4">
      <Stat k="Market breadth" v={b?.universe ? `${b.advancers}↑ ${b.decliners}↓` : '—'} s={b?.universe ? `median ${fmt.pct(b.medianChangePct)} · ${b.universe} liquid pairs` : 'no ticker snapshot yet'} />
      <Stat k="BTC regime (1h)" v={data?.btcRegime ? <Badge v={data.btcRegime.regime} /> : '—'} s={data?.btcRegime?.reasons?.join(' · ')} />
      <Stat k="Scanner" v={p?.scanner.lastScanAt ? fmt.ago(p.scanner.lastScanAt) : 'not run yet'} tone={p?.scanner.ageMs != null && p.scanner.ageMs > STALE_SCAN_MS ? 'warn' : undefined}
        s={p ? `${p.scanner.universe} instruments in deep tier${p.scanner.ageMs != null && p.scanner.ageMs > STALE_SCAN_MS ? ' · STALE' : ''}` : ''} />
      <Stat k="Workers (QCI evidence)" v={p ? (p.workers.notYetEvaluated >= p.workers.registered ? 'standing by' : `${p.workers.productiveDataDriven} / ${p.workers.dataDriven}`) : '—'}
        s={p ? (p.workers.notYetEvaluated >= p.workers.registered
          ? `${p.workers.registered} registered · they run when a strategy produces a candidate · ${p.workers.providerBlocked} awaiting providers`
          : `productive data-driven · ${p.workers.providerBlocked} awaiting providers · ${p.consensus.recent} recent consensus`) : ''} />
    </div>

    <div className="grid g-2-1" style={{ marginTop: 14 }}>
      <div className="col" style={{ gap: 14 }}>
        <Card title="Latest opportunities" right={<Link to="/scanner">AI Scanner →</Link>} flush><DecisionTable rows={(data?.opportunities ?? []).map((d: any) => ({ ...d, score: d.opportunity.score }))} /></Card>
        <ActivityFeed items={data?.activity} />
        <Card title="Top movers (24h, liquid pairs)" flush>
          <div className="grid g2" style={{ gap: 0 }}>{[0, 1].map((side) => <table key={side}><tbody>{(side === 0 ? (data?.movers ?? []).slice(0, 8) : (data?.movers ?? []).slice(-8).reverse()).map((m: any) => <tr key={m.id}><td><Link to={`/terminal/${m.symbol}`}><b>{m.symbol}</b></Link>{m.tags?.map((t: string) => <Badge key={t} v={t.replace(/_/g, ' ')} tone="b-neutral" />)}</td><td className="mono" style={{ textAlign: 'right' }}>{fmt.px(m.price)}</td><td style={{ textAlign: 'right' }}><Chg v={m.changePct} /></td></tr>)}</tbody></table>)}</div>
          {data && !data.movers?.length && <Empty>No market snapshot yet (offline, or the first ticker refresh has not completed).</Empty>}
        </Card>
      </div>
      <div className="col" style={{ gap: 14 }}>
        <RiskCard r={r} />
        <DataHealth p={p} />
        <Card title="Trader Joe daily briefing" right={<Link to="/joe">Ask Joe →</Link>}><pre style={{ fontFamily: 'var(--sans)', fontSize: 13, whiteSpace: 'pre-wrap', margin: 0 }}>{data?.briefing ?? '…'}</pre></Card>

      </div>
    </div>
    </details>
    {mode === 'engineer' && <Card title="Snapshot diagnostics"><div className="kv">
      <span>Backend snapshot time</span><span>{fmt.time(data?.asOf)}</span>
      <span>Scanner snapshot time</span><span>{fmt.time(p?.scanner.lastScanAt)}</span>
      <span>Registered workers</span><span>{p?.workers.registered ?? 'UNKNOWN'}</span>
      <span>Provider-blocked workers</span><span>{p?.workers.providerBlocked ?? 'UNKNOWN'}</span>
    </div><p className="hint">Diagnostics describe current evidence; they do not certify uninterrupted hosting, data correctness, profitability or live readiness.</p></Card>}
  </Page>;
}

function RiskCard({ r }: { r: any }) {
  if (!r) return <Card title="Risk monitor"><Empty>Loading…</Empty></Card>;
  const l = r.limits;
  return <Card title="Risk monitor" right={<Link to="/risk">Risk Center →</Link>}>
    <div className="kv" style={{ marginBottom: 10 }}>
      <span>Operating mode</span><span><Badge v={r.mode} tone={r.emergency ? 'b-bad' : r.pausedNewOrders ? 'b-warn' : 'b-violet'} /></span>
      <span>Risk policy</span><span>{r.policy ? `v${r.policy.version} · accepted ${fmt.ago(r.policy.acceptedAt)}` : <span className="warn">not accepted — paper execution disabled</span>}</span>
      <span>Emergency stop</span><span className={r.emergency ? 'down' : 'up'}>{r.emergency ? 'ACTIVE' : 'off'}{r.pausedNewOrders && !r.emergency ? ' · new orders paused' : ''}</span>
      <span>Protection</span><span className={r.incidents.open ? 'down' : r.incidents.awaitingAck ? 'warn' : 'up'}>{r.incidents.open ? `${r.incidents.open} open incident(s)` : r.incidents.awaitingAck ? `${r.incidents.awaitingAck} recovered, awaiting acknowledgement` : 'no incidents'}</span>
      <span>Live execution</span><span className="muted">{r.gates}</span>
    </div>
    {r.policy ? <div className="col" style={{ gap: 8 }}>
      <Meter label="Daily loss" value={l.dailyLossPct.used} limit={l.dailyLossPct.limit} />
      <Meter label="Weekly loss" value={l.weeklyLossPct.used} limit={l.weeklyLossPct.limit} />
      <Meter label="Drawdown (halt)" value={l.drawdownPct.used} limit={l.drawdownPct.limit} />
      <Meter label="Open risk" value={l.openRiskPct.used} limit={l.openRiskPct.limit} />
      <Meter label="Positions" value={l.positions.used} limit={l.positions.limit} unit="" dp={0} />
    </div> : <div className="hint">Limits appear once a risk policy is accepted.</div>}
  </Card>;
}

function DataHealth({ p }: { p: any }) {
  const rows = (p?.providers ?? []) as any[];
  const dot = (s: string) => (s === 'LIVE' ? '' : s === 'DEGRADED' ? 'warn' : s === 'DOWN' ? 'bad' : 'warn');
  return <Card title="Data sources" right={<Link to="/connections">Connections →</Link>} flush>
    <div className="health" style={{ padding: '10px 14px' }}>
      {rows.map((x) => <div key={x.id} style={{ display: 'contents' }}>
        <span className={`dot ${dot(x.status)}`} aria-hidden={true} style={x.status === 'LIVE' ? undefined : { background: ['DISABLED', 'IDLE', 'PENDING_CREDENTIALS'].includes(x.status) ? 'var(--faint)' : undefined }} />
        <span title={x.lastError ?? undefined}><b>{x.name}</b> <span className="hint">{x.realtime === 'DAILY_REFERENCE' ? 'daily reference (not executable)' : x.realtime.toLowerCase().replace('_', '-')}</span></span>
        <span className="hint" style={{ textAlign: 'right' }}>{x.status === 'LIVE' ? `${fmt.ago(x.lastOkAt)}${x.lastLatencyMs != null ? ` · ${x.lastLatencyMs}ms` : ''}` : x.status.replace(/_/g, ' ').toLowerCase()}</span>
      </div>)}
    </div>
    {p && !rows.length && <Empty>No providers registered.</Empty>}
  </Card>;
}

function ActivityFeed({ items }: { items?: any[] }) {
  return <Card title="Activity" right={<span className="hint">decisions · paper fills · rejections · alerts · incidents</span>} flush>
    {items?.length ? <ul className="feed">{items.slice(0, 14).map((x, i) => {
      const body = <><div className="when">{clock(x.at)}</div><div className="what"><div className="row" style={{ gap: 6 }}><Badge v={x.kind} tone={KIND_BADGE[x.kind]} /><b className={TONE[x.tone]}>{x.title}</b>{x.count > 1 && <span className="hint" title={`first ${fmt.time(x.firstAt)}`}>×{x.count} since {clock(x.firstAt)}</span>}</div><div className="hint">{x.detail}</div></div></>;
      return <li key={`${x.kind}-${x.at}-${i}`}>{x.link ? <Link to={x.link} style={{ display: 'contents' }}>{body}</Link> : body}</li>;
    })}</ul> : <Empty>{items ? 'No activity yet. The scanner records decisions and rejections as it evaluates closed candles.' : 'Loading…'}</Empty>}
  </Card>;
}

function CriticalAlerts({ items }: { items?: { id: string; severity: string; title: string; body: string; ts: number }[] }) {
  return <Card title="Critical alerts" right={<Link to="/notifications">All →</Link>} flush>
    {items?.map(n => <div key={n.id} role={n.severity === 'CRITICAL' ? 'alert' : undefined} style={{ padding: '8px 14px', borderBottom: '1px solid var(--line)' }}><div className="row"><Badge v={n.severity} /><b style={{ fontSize: 13 }}>{n.title}</b></div><div className="hint">{n.body} · {fmt.ago(n.ts)}</div></div>)}
    {items ? !items.length && <Empty>No alerts in the current response.</Empty> : <Empty>Checking alerts…</Empty>}
  </Card>;
}
