import { Suspense, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, authInfo, fmt, useApi, stepUpBody } from '../api';
import { TwoFactorCard } from '../auth/TwoFactorCard';
import { GuardianCard } from '../components/GuardianCard';
import { Action, Badge, Card, Chg, Empty, ErrorLine, Freshness, Page, Stat, Tabs , rowProps} from '../ui';
import { StepUp } from './Trading';
import { VikeResearchPanel } from './VikeResearch';
import { PrivyAccountCard, type PrivyClientConfig } from '../privy/lazy';
import { SecFilings } from './SecFilings';
import { MarketCoverage } from './MarketCoverage';
import { SolanaWatchlist } from './SolanaWatchlist';

/** Asset Discovery — ranked lists from live feeds only. */
export function Discover() {
  const [minVol, setMinVol] = useState(1e6); const { data, error } = useApi(`/api/discover?minVolume=${minVol}`, { topics: ['ticker', 'scan'] });
  const [tab, setTab] = useState('Volume leaders'); const nav = useNavigate();
  const lists: Record<string, any[]> = { 'Volume leaders': data?.volumeLeaders ?? [], Gainers: data?.gainers ?? [], Losers: data?.losers ?? [], 'Unusual volume': data?.unusualVolume ?? [], 'Large caps': data?.largeCaps ?? [] };
  const rows = lists[tab] ?? [];
  const research = tab === 'Solana watchlist' ? <SolanaWatchlist view={data?.solanaHunter} /> : tab === 'Vike research' ? <VikeResearchPanel /> : tab === 'SEC filings' ? <SecFilings /> : tab === 'Market coverage' ? <MarketCoverage /> : null;
  return <Page title="Asset Discovery" sub={<>Find assets worth a closer look. Every list is computed from live exchange data. {data?.note}</>}
    right={<><Freshness at={data?.asOf} /><select value={minVol} onChange={(e) => setMinVol(Number(e.target.value))} aria-label="Minimum 24h volume"><option value={1e6}>≥ $1M vol</option><option value={1e7}>≥ $10M</option><option value={1e8}>≥ $100M</option></select></>}>
    <ErrorLine e={error} />
    <Tabs tabs={[...Object.keys(lists), 'New DEX tokens', 'Solana watchlist', 'Market coverage', 'SEC filings', 'Vike research']} value={tab} onChange={setTab} />
    {research}
    {research === null && <>
    {tab !== 'New DEX tokens' ? <Card flush title={`${rows.length} of ${data?.universe ?? 0} liquid pairs`}><div className="tablewrap"><table><thead><tr><th>Asset</th><th className="num">Price</th><th className="num">24h</th><th className="num">Volume</th><th className="num">Mkt cap</th><th className="num">Rel. vol 1h</th><th>Regime</th><th>Safety</th><th /></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.instrumentId} {...rowProps(() => nav(`/terminal/${r.symbol}`), `Open ${r.symbol} in the terminal`)}><td><b>{r.base}</b> <span className="faint">{r.name ?? ''}</span>{r.rank && <span className="faint"> #{r.rank}</span>}</td><td className="num">{fmt.px(r.price)}</td><td className="num"><Chg v={r.changePct} /></td><td className="num">{fmt.big(r.quoteVolume)}</td><td className="num">{fmt.big(r.marketCap)}</td><td className="num">{r.relVol1h == null ? '—' : `${fmt.num(r.relVol1h, 2)}×`}</td><td>{r.regime ? <Badge v={r.regime} /> : <span className="faint">not deep-scanned</span>}</td><td>{r.safety ? <Badge v={r.safety} /> : ''}</td><td><Action className="sm" label="Analyze" run={async () => { nav(`/terminal/${r.symbol}`); }} /></td></tr>)}</tbody></table>
      {!rows.length && <Empty>{tab === 'Unusual volume' ? 'Relative volume is available for deep-tier instruments once their candles load.' : 'Waiting for market data…'}</Empty>}</div></Card>
      : <Card flush title="Newest DEX token profiles" right={<Freshness at={data?.dexAsOf} />}><div className="banner info" style={{ margin: 12 }}>DEX tokens are never eligible for automated trading: contract-level honeypot checks need an on-chain provider. Names are untrusted external content.</div>
        <div className="tablewrap"><table><thead><tr><th>Token</th><th>Chain</th><th className="num">Liquidity</th><th className="num">Vol 24h</th><th className="num">24h</th><th>Age</th><th>Safety</th></tr></thead><tbody>{(data?.dexLaunches ?? []).map((p: any) => <tr key={p.pairAddress}><td><a href={p.url} target="_blank" rel="noreferrer noopener"><b>{p.baseSymbol}</b></a> <span className="faint">{p.baseName}</span></td><td>{p.chainId}</td><td className="num">{fmt.usd(p.liquidityUsd, 0)}</td><td className="num">{fmt.big(p.volume24h)}</td><td className="num"><Chg v={p.change24h} /></td><td className="faint">{p.pairCreatedAt ? fmt.ago(p.pairCreatedAt) : '—'}</td><td><Badge v={p.safety.status} title={p.safety.reasons.join('\n')} /></td></tr>)}</tbody></table>{!data?.dexLaunches?.length && <Empty>Loading DEX listings…</Empty>}</div></Card>}
    </>}
  </Page>;
}

/** QHEF performance dashboard — measured latency vs budgets (Part 33.18/33.21). */
export function Qhef() {
  const { data, error } = useApi('/api/qhef', { every: 10_000 });
  const tone = (s: string) => (s === 'WITHIN_BUDGET' ? 'b-good' : s === 'OVER_BUDGET' ? 'b-bad' : 'b-neutral');
  return <Page title="QHEF Performance" sub={<>Quantum HyperSpeed Execution Fabric: measured speed of MIA's own processing against engineering budgets. "Quantum" is a name for parallel analysis; no quantum hardware is used. {data?.note}</>}>
    <ErrorLine e={error} />
    <div className="grid g4" style={{ marginBottom: 14 }}>
      <Stat k="Budgets met" v={data ? `${data.budgets.filter((b: any) => b.status === 'WITHIN_BUDGET').length}/${data.budgets.filter((b: any) => b.status !== 'NO_DATA').length}` : '—'} s={data ? `${data.budgets.filter((b: any) => b.status === 'NO_DATA').length} stage(s) without samples yet` : ''} />
      <Stat k="Event-loop delay p99" v={data ? `${data.eventLoop.p99} ms` : '—'} s={data ? `blocking time beyond the ${data.eventLoop.samplingMs} ms sampler · mean ${data.eventLoop.mean} · max ${data.eventLoop.max} ms` : ''} tone={data && data.eventLoop.p99 > 100 ? 'warn' : undefined} />
      <Stat k="Process" v={data ? `${data.process.rssMb} MB` : '—'} s={data ? `heap ${data.process.heapUsedMb} MB · up ${Math.round(data.process.uptimeSec / 60)} min · Node ${data.process.node}` : ''} />
      <Stat k="Scan tiers" v={data ? `${data.tiers.t2Deep} deep` : '—'} s={data ? `${data.tiers.t1Broad} pairs in broad tier · ${data.scheduler.cycles} scan cycles` : ''} />
    </div>
    <Card title="Hot-path latency budgets (MIA-controlled stages)" flush><table><thead><tr><th>Stage</th><th>Lane</th><th>What it measures</th><th className="num">Samples</th><th className="num">p50</th><th className="num">p95</th><th className="num">p99</th><th className="num">Budget</th><th>Status</th></tr></thead>
      <tbody>{(data?.budgets ?? []).map((b: any) => <tr key={b.stage}><td className="mono">{b.stage}</td><td>{b.lane}</td><td className="muted">{b.description}</td><td className="num">{b.samples}</td><td className="num">{b.p50 ?? '—'}</td><td className="num">{b.p95 ?? '—'}</td><td className="num">{b.p99 ?? '—'}</td><td className="num">{b.metric} ≤ {b.budgetMs} ms</td><td><Badge v={b.status} tone={tone(b.status)} /></td></tr>)}</tbody></table></Card>
    <div className="grid g2" style={{ marginTop: 14 }}>
      <Card title="Provider round trips (outside MIA's control)" flush><table><thead><tr><th>Stage</th><th className="num">n</th><th className="num">p50</th><th className="num">p95</th><th className="num">p99</th></tr></thead><tbody>{(data?.providers ?? []).map((p: any) => <tr key={p.stage}><td className="mono">{p.stage}</td><td className="num">{p.samples}</td><td className="num">{p.p50}</td><td className="num">{p.p95}</td><td className="num">{p.p99}</td></tr>)}</tbody></table>{!data?.providers?.length && <Empty>No provider samples yet (offline or just started).</Empty>}</Card>
      <Card title="Fabric configuration"><div className="kv">
        <span>Market data</span><span>{data?.transport.marketData}</span><span>Event bus</span><span>{data?.transport.eventBus}</span>
        <span>Hot lane</span><span>tickers + position monitoring every {fmt.num((data?.scheduler.tickerIntervalMs ?? 0) / 1000, 0)} s · last {fmt.ago(data?.scheduler.lastTickerAt)}</span>
        <span>Scan lane</span><span>every {fmt.num((data?.scheduler.scanIntervalMs ?? 0) / 1000, 0)} s · last {fmt.ago(data?.scheduler.lastScanAt)}</span>
        <span>Background lane</span><span>news, DEX, FX, large prints every {fmt.num((data?.scheduler.backgroundIntervalMs ?? 0) / 1000, 0)} s</span>
        <span>Worker pool</span><span>{data?.workers.concurrency} concurrent · {data?.workers.deadlineMs} ms deadline (timeout = abstain) · {data?.workers.quarantined} quarantined</span>
        <span>Quorum</span><span>support ≥ {data?.workers.quorum.supportThreshold}, opposition ≤ {data?.workers.quorum.maxOpposition}, response ≥ {((data?.workers.quorum.minResponseRatio ?? 0) * 100).toFixed(0)}% · not calibrated</span>
      </div></Card>
    </div>
  </Page>;
}

/** Security Center — live checks, sessions, auth events. Never shows secret values. */
export function SecurityCenter() {
  const { data, error, reload } = useApi('/api/security'); const [pw, setPw] = useState(''); const [area, setArea] = useState('All');
  const areas = ['All', ...new Set<string>((data?.checks ?? []).map((c: any) => c.area))];
  const checks = (data?.checks ?? []).filter((c: any) => area === 'All' || c.area === area);
  const privy = useApi<PrivyClientConfig>('/api/auth/privy/config');
  return <Page title="Security Center" sub="Live security checks, sessions and sign-in activity. Secrets are reported as configured or not, never shown.">
    <ErrorLine e={error} />
    <div className="grid g3" style={{ marginBottom: 14 }}><Stat k="Passing" v={data?.summary.pass ?? '—'} tone="up" /><Stat k="Warnings" v={data?.summary.warn ?? '—'} tone={data?.summary.warn ? 'warn' : undefined} /><Stat k="Failing" v={data?.summary.fail ?? '—'} tone={data?.summary.fail ? 'down' : undefined} /></div>
    <Card title="Security checks" flush right={<select value={area} onChange={(e) => setArea(e.target.value)} aria-label="Area">{areas.map((a) => <option key={a}>{a}</option>)}</select>}>
      <table><tbody>{checks.map((c: any) => <tr key={c.id}><td className="mono faint">{c.id}</td><td>{c.area}</td><td><b>{c.name}</b><div className="hint">{c.detail}</div></td><td><Badge v={c.status} tone={c.status === 'PASS' ? 'b-good' : c.status === 'FAIL' ? 'b-bad' : c.status === 'WARN' ? 'b-warn' : 'b-neutral'} /></td></tr>)}</tbody></table></Card>
    <div style={{ marginTop: 14 }}><GuardianCard /></div>
    <div style={{ marginTop: 14 }}><TwoFactorCard /></div>
    {privy.data?.enabled && <div style={{ marginTop: 14 }}><Suspense fallback={<Card title="Privy account"><Empty>Loading Privy…</Empty></Card>}><PrivyAccountCard config={privy.data} onChange={privy.reload} /></Suspense></div>}
    <div className="grid g2" style={{ marginTop: 14 }}>
      <Card title={`Active sessions (${data?.sessions.length ?? 0})`}><div className="col">
        <table><tbody>{(data?.sessions ?? []).map((s: any) => <tr key={s.id}><td className="mono faint">{s.id}…</td><td>signed in {fmt.ago(s.createdAt)}</td><td className="faint">expires {fmt.time(s.expiresAt)}</td><td>{s.current && <Badge v="THIS DEVICE" tone="b-info" />}</td></tr>)}</tbody></table>
        <div className="row"><StepUp value={pw} onChange={setPw} /><Action className="danger" label="Sign out all other sessions" run={async () => { await api('/api/security/sessions/revoke-others', { body: { ...stepUpBody(pw) } }); setPw(''); reload(); }} /></div>
        {authInfo.mode === 'passphrase' && <div className="hint">Change your passphrase in <Link to="/settings">Settings</Link>; that signs out every session.</div>}</div></Card>
      <Card title="Sign-in & security events" flush><div className="tablewrap" style={{ maxHeight: 320 }}><table><tbody>{(data?.authEvents ?? []).map((e: any, i: number) => <tr key={i}><td className="faint" style={{ whiteSpace: 'nowrap' }}>{fmt.time(e.ts)}</td><td><Badge v={e.action} tone={e.action.includes('failed') ? 'b-bad' : 'b-neutral'} /></td><td className="hint">{e.detail?.slice(0, 120)}</td></tr>)}</tbody></table>{!data?.authEvents?.length && <Empty>No events.</Empty>}</div></Card>
    </div>
    <Card title="More" className="" ><div className="row"><Link to="/qa">Release gates & audit log →</Link><Link to="/wallet">Withdrawal freeze →</Link><Link to="/risk">Emergency controls →</Link></div></Card>
  </Page>;
}

/** Copy Trading — honest dependency state; no simulated wallets. */
export function CopyTrading() {
  const { data, error } = useApi('/api/copy');
  return <Page title="Copy Trading" sub="Follow verified whale wallets — every copied trade still goes through safety, QCI, the decision engine and your risk limits.">
    <ErrorLine e={error} />
    <div className="banner stale">Not available yet: copy trading needs an on-chain data provider to see wallet activity. Nothing on this page is simulated.</div>
    <div className="grid g2">
      <Card title="What it needs"><table><tbody>{(data?.requirements ?? []).map((r: any) => <tr key={r.providerId}><td>{r.name}</td><td><Badge v={r.status} /></td></tr>)}</tbody></table><div className="hint" style={{ marginTop: 8 }}>When you are ready, Claude will ask for the provider key through a secure form — never paste keys into chat. <Link to="/connections">Connections Hub →</Link></div></Card>
      <Card title="How it will work (safety pipeline)"><ol style={{ margin: 0, paddingLeft: 18 }}>{(data?.pipeline ?? []).map((p: string) => <li key={p} className="muted">{p}</li>)}</ol></Card>
    </div>
    <div className="grid g2" style={{ marginTop: 14 }}>
      <Card title="Followed wallets"><Empty>No wallets — wallet tracking is not connected.</Empty></Card>
      <Card title="Copy rules"><Empty>Rules (max size per copy, allowed assets, delay limits) become available once wallet data is connected.</Empty></Card>
    </div>
    <div className="hint" style={{ marginTop: 12 }}>Meanwhile, large exchange trades are tracked on the <Link to="/whales">Whale & Launch Monitor</Link>.</div>
  </Page>;
}

/** Trading history — orders and closed trades with filters + CSV export. */
export function History() {
  const [f, setF] = useState({ instrument: '', status: '', purpose: '', days: '30' });
  // MIA-WEB-030: `from` used Date.now() on every render, so the request path changed every render and the page refetched
  // in a loop (753 requests in 3 s, measured). The window start is fixed per period choice; Refresh-on-events still works.
  const from = useMemo(() => (f.days ? String(Date.now() - Number(f.days) * 86400_000) : ''), [f.days]);
  const qs = new URLSearchParams(Object.entries({ instrument: f.instrument, status: f.status, purpose: f.purpose, from }).filter(([, v]) => v)).toString();
  const { data, error } = useApi(`/api/history?${qs}`, { topics: ['order', 'position'] }); const [tab, setTab] = useState('Closed trades');
  const s = data?.summary;
  return <Page title="Trading History" sub="Every paper order and closed trade, filterable and exportable. All entries are simulated (paper)."
    right={<><a href={`/api/history.csv?${qs}&kind=trades`}><button>Export trades CSV</button></a><a href={`/api/history.csv?${qs}`}><button>Export orders CSV</button></a></>}>
    <ErrorLine e={error} />
    <Card><div className="row">
      <input placeholder="Symbol (e.g. BTC)" value={f.instrument} onChange={(e) => setF({ ...f, instrument: e.target.value.replace(/[^A-Za-z0-9]/g, '') })} style={{ width: 150 }} aria-label="Symbol" />
      <select value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} aria-label="Period"><option value="1">24 hours</option><option value="7">7 days</option><option value="30">30 days</option><option value="365">1 year</option><option value="">All time</option></select>
      <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Order status"><option value="">Any status</option>{['FILLED', 'REJECTED', 'CANCELLED', 'EXPIRED', 'ACTIVE', 'PENDING_APPROVAL'].map((x) => <option key={x}>{x}</option>)}</select>
      <select value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} aria-label="Order purpose"><option value="">Any purpose</option><option>ENTRY</option><option>EXIT</option><option>PROTECTIVE_STOP</option></select>
    </div></Card>
    <div className="grid g4" style={{ margin: '14px 0' }}><Stat k="Closed trades" v={s?.closedTrades ?? '—'} /><Stat k="Net PnL (paper)" v={fmt.usd(s?.netPnl)} tone={s && s.netPnl < 0 ? 'down' : 'up'} /><Stat k="Orders" v={s?.orders ?? '—'} s={s ? `${s.filled} filled · ${s.rejected} rejected` : ''} /><Stat k="Fees paid" v={fmt.usd(s?.fees)} /></div>
    <Tabs tabs={['Closed trades', 'Orders']} value={tab} onChange={setTab} />
    {tab === 'Closed trades' ? <Card flush><div className="tablewrap"><table><thead><tr><th>Closed</th><th>Instrument</th><th>Strategy</th><th className="num">Entry</th><th className="num">Exit</th><th>Reason</th><th className="num">Fees</th><th className="num">Net</th><th className="num">R</th></tr></thead><tbody>{(data?.trades ?? []).map((t: any) => <tr key={t.id}><td className="faint">{fmt.time(t.closed_at)}</td><td>{t.instrument.split(':')[2]}</td><td>{t.strategy}</td><td className="num">{fmt.px(t.entry_price)}</td><td className="num">{fmt.px(t.exit_price)}</td><td><Badge v={t.exit_reason} /></td><td className="num">{fmt.usd(t.fees)}</td><td className={`num ${t.realized_pnl < 0 ? 'down' : 'up'}`}>{fmt.usd(t.realized_pnl)}</td><td className="num">{t.planned_risk ? (t.realized_pnl / t.planned_risk).toFixed(2) : '—'}</td></tr>)}</tbody></table>{!data?.trades?.length && <Empty>No closed trades in this period.</Empty>}</div></Card>
      : <Card flush><div className="tablewrap"><table><thead><tr><th>Created</th><th>Instrument</th><th>Side</th><th>Purpose</th><th className="num">Qty</th><th className="num">Avg price</th><th className="num">Fees</th><th>Status</th></tr></thead><tbody>{(data?.orders ?? []).map((o: any) => <tr key={o.id}><td className="faint">{fmt.time(o.created_at)}</td><td>{o.instrument.split(':')[2]}</td><td><Badge v={o.side} /></td><td>{o.purpose}</td><td className="num">{o.qty}</td><td className="num">{fmt.px(o.avg_price)}</td><td className="num">{fmt.usd(o.fees, 4)}</td><td><Badge v={o.status} title={o.reject_reason ?? ''} /></td></tr>)}</tbody></table>{!data?.orders?.length && <Empty>No orders match.</Empty>}</div></Card>}
  </Page>;
}
