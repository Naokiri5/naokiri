import { Link } from 'react-router-dom';
import { fmt, useApi } from '../api';
import { Badge, Card, Chg, Empty, ErrorLine, Page, Stat, Freshness } from '../ui';
import { DecisionTable } from './Intel';

export function Overview() {
  const { data, error } = useApi('/api/overview', { topics: ['scan', 'decision', 'position', 'notification'], every: 30_000 });
  const a = data?.account; const b = data?.breadth;
  return <Page title="Overview" sub="Account health, market regime, briefing, alerts and the latest opportunities." right={<Freshness at={data?.asOf} />}>
    <ErrorLine e={error} />
    <div className="grid g4" style={{ marginBottom: 14 }}>
      <Stat k="Paper equity" v={fmt.usd(a?.equity)} s={a?.deposits ? `cash ${fmt.usd(a.cash)} · ${a.openCount} open` : 'not funded — Bot Account'} />
      <Stat k="Today" v={fmt.pct(a?.dailyPnlPct)} tone={a && a.dailyPnlPct < 0 ? 'down' : 'up'} s={`week ${fmt.pct(a?.weeklyPnlPct)} · DD ${fmt.num(a?.drawdownPct, 2)}%`} />
      <Stat k="Market breadth" v={b ? `${b.advancers}↑ ${b.decliners}↓` : '—'} s={b ? `median ${fmt.pct(b.medianChangePct)} · ${b.universe} liquid pairs` : ''} />
      <Stat k="BTC regime (1h)" v={data ? <Badge v={data.btcRegime.regime} /> : '—'} s={data?.btcRegime.reasons.join(' · ')} />
    </div>
    <div className="grid g-2-1">
      <div className="col" style={{ gap: 14 }}>
        <Card title="Latest opportunities" right={<Link to="/scanner">AI Scanner →</Link>} flush><DecisionTable rows={(data?.opportunities ?? []).map((d: any) => ({ ...d, score: d.opportunity.score }))} /></Card>
        <Card title="Top movers (24h, liquid pairs)" flush>
          <div className="grid g2" style={{ gap: 0 }}>{[0, 1].map((side) => <table key={side}><tbody>{(side === 0 ? (data?.movers ?? []).slice(0, 8) : (data?.movers ?? []).slice(-8).reverse()).map((m: any) => <tr key={m.id}><td><Link to={`/terminal/${m.symbol}USDT`}><b>{m.symbol}</b></Link> {m.tags.map((t: string) => <Badge key={t} v={t} tone="b-neutral" />)}</td><td className="num">{fmt.px(m.price)}</td><td className="num"><Chg v={m.changePct} /></td></tr>)}</tbody></table>)}</div>
          {!data?.movers?.length && <Empty>Loading market data…</Empty>}
        </Card>
      </div>
      <div className="col" style={{ gap: 14 }}>
        <Card title="Trader Joe daily briefing"><pre style={{ fontFamily: 'var(--sans)', fontSize: 13 }}>{data?.briefing ?? '…'}</pre></Card>
        <Card title="Critical alerts" right={<Link to="/notifications">All →</Link>} flush>
          {(data?.alerts ?? []).map((n: any) => <div key={n.id} style={{ padding: '8px 14px', borderBottom: '1px solid var(--line)' }}><div className="row"><Badge v={n.severity} /><b style={{ fontSize: 13 }}>{n.title}</b></div><div className="hint">{n.body} · {fmt.ago(n.ts)}</div></div>)}
          {!data?.alerts?.length && <Empty>No alerts.</Empty>}
        </Card>
      </div>
    </div>
  </Page>;
}
