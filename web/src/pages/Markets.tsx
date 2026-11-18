import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { createChart, CandlestickSeries, HistogramSeries, LineSeries, type IChartApi, type UTCTimestamp } from 'lightweight-charts';
import { hierarchy, pack } from 'd3-hierarchy';
import { api, fmt, useApi } from '../api';
import { Action, Badge, Card, Chg, Empty, ErrorLine, Freshness, Modal, Page, Tabs, useSort } from '../ui';
import { DecisionView, IndicatorGrid } from './Intel';
import { CexActivity } from './CexActivity';
import { AdvancedIndicators } from './AdvancedIndicators';

export function Terminal() {
  const { symbol = 'BTCUSDT' } = useParams(); const [iv, setIv] = useState<'15m' | '1h' | '4h'>('1h'); const nav = useNavigate();
  const { data, error } = useApi(`/api/instrument/${symbol}?interval=${iv}`, { topics: ['scan'], every: 15_000 });
  const watch = useApi('/api/markets', { every: 30_000 });
  const [ana, setAna] = useState<any>(null);
  const t = data?.ticker; const f = data?.features;
  // The API answers 404 (unknown symbol) / 503 (data not loaded) with a reason; with nothing loaded yet, show it as the banner.
  const gone: string | null = data?.unavailable ? data.reason : !data && error ? error : null;
  return <Page title={`Market Terminal · ${data?.instrument?.base ?? symbol}`} sub={data?.instrument ? `${data.instrument.symbol} · Binance spot (public market data) · cross-venue checks: ${Object.keys(data.cross).join(', ') || 'none'}` : ''}
    right={<><Freshness at={t?.receivedAt} label="quote" /><Action className="primary" label="Run full analysis" disabled={!!gone} run={async () => setAna(await api('/api/analyze', { body: { symbol } }))} /></>}>
    <ErrorLine e={gone ? null : error} />
    {gone ? <div className="banner info">No data for {symbol}: {gone}</div> :
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr) 300px' }}>
      <div className="col" style={{ gap: 14 }}>
        <Card title={<span className="row"><span className="mono" style={{ fontSize: 18 }}>{fmt.px(t?.last)}</span><Chg v={t?.changePct} /><span className="hint">H {fmt.px(t?.high)} · L {fmt.px(t?.low)} · Vol {fmt.big(t?.quoteVolume)}</span></span>}
          right={<>{(['15m', '1h', '4h'] as const).map((x) => <button key={x} className={`sm ${x === iv ? 'primary' : ''}`} onClick={() => setIv(x)}>{x}</button>)}</>}>
          {data?.candles?.length ? <CandleChart candles={data.candles} features={f} /> : <Empty>Loading candles…</Empty>}
          <div className="hint" style={{ marginTop: 6 }}>Last candle may be forming (not yet closed); strategies evaluate closed candles only. Lines: EMA20 (blue), EMA50 (violet).</div>
        </Card>
        <div className="grid g3">
          <Card title="Regime & safety"><div className="col"><div className="row"><Badge v={data?.regime?.regime ?? '…'} /><span className="hint">{data?.regime?.reasons?.join(' · ')}</span></div>
            <div className="row"><Badge v={data?.safety?.status ?? '…'} /><Badge v={data?.quality?.status ?? '…'} /></div>
            <ul style={{ margin: 0, paddingLeft: 18 }} className="hint">{data?.safety?.checks?.map((c: any) => <li key={c.name}><span className={c.result === 'FAIL' ? 'down' : c.result === 'WARN' ? 'warn' : ''}>{c.name}</span>: {c.detail}</li>)}</ul>
            {data?.quality?.issues?.length > 0 && <div className="hint warn">{data.quality.issues.join('; ')}</div>}</div></Card>
          <Card title="Key features"><div className="kv mono" style={{ fontSize: 12 }}>
            <span>RSI14</span><span>{fmt.num(f?.rsi14, 1)}</span><span>ATR%</span><span>{fmt.num((f?.atrPct ?? NaN) * 100, 2)}%</span><span>ADX</span><span>{fmt.num(f?.adx14, 1)}</span>
            <span>EMA20/50/200</span><span>{fmt.px(f?.ema20)} / {fmt.px(f?.ema50)} / {fmt.px(f?.ema200)}</span><span>Rel. volume</span><span>{fmt.num(f?.relVol20, 2)}×</span><span>Taker buy</span><span>{fmt.num((f?.takerBuyRatio ?? NaN) * 100, 1)}%</span></div></Card>
          <Card title="Cross-venue prices"><div className="kv mono" style={{ fontSize: 12 }}><span>binance</span><span>{fmt.px(t?.last)}</span>{Object.entries(data?.cross ?? {}).map(([v, q]: any) => <><span key={v}>{v}</span><span key={v + 'p'}>{fmt.px(q.price)} <span className="faint">{t ? fmt.pct((q.price / t.last - 1) * 100, 3) : ''}</span></span></>)}</div>
            {data?.impact && <div className="hint" style={{ marginTop: 8 }}>$10k market buy: spread {fmt.num(data.impact.spreadBps, 2)}bps, impact {fmt.num(data.impact.impactBps, 2)}bps, depth ±1% {fmt.usd(data.impact.depth1pct, 0)}</div>}</Card>
        </div>
        <Card title="Chart intelligence · closed candles">
          {data?.chartIntelligence && <div className="col">
            <div className="row"><Badge v={data.chartIntelligence.status} /><Badge v={data.chartIntelligence.trend} /><Badge v="NO TRADE" /></div>
            <div className="hint">{data.chartIntelligence.note}</div>
            {data.chartIntelligence.issues.length > 0 && <div className="hint warn">{data.chartIntelligence.issues.join('; ')}</div>}
            {data.timeframeAgreement && <div className="tablewrap">
              <table>
                <caption>Timeframe agreement · {data.timeframeAgreement.state.replaceAll('_', ' ')}</caption>
                <thead><tr><th>Timeframe</th><th>Structure</th><th>Candle closed</th></tr></thead>
                <tbody>{data.timeframeAgreement.readings.map((r: { timeframe: string; trend: string; status: string; closedAt: number | null; issues: string[] }) => (
                  <tr key={r.timeframe}><td>{r.timeframe}</td>
                    <td><Badge v={r.status === 'VALID' ? r.trend : r.status} />{r.issues.map(issue => <div className="hint" key={issue}>{issue}</div>)}</td>
                    <td>{fmt.time(r.closedAt)}</td></tr>
                ))}</tbody>
              </table>
            </div>}
            {!!data.chartIntelligence.anchoredVwap?.length && <div className="tablewrap">
              <table><thead><tr><th>VWAP anchor</th><th>Anchor time (UTC)</th><th>Estimated VWAP</th><th>Close vs. VWAP</th></tr></thead>
                <tbody>{data.chartIntelligence.anchoredVwap.map((v: { anchor: string; anchorAt: number; price: number | null; deviationPct: number | null }) => (
                  <tr key={v.anchor}><td>{v.anchor.replaceAll('_', ' ')}</td><td>{new Date(v.anchorAt).toISOString()}</td>
                    <td>{v.price === null ? 'Unavailable' : fmt.px(v.price)}</td><td>{v.deviationPct === null ? '—' : fmt.pct(v.deviationPct, 2)}</td></tr>
                ))}</tbody>
              </table>
            </div>}
            <div className="tablewrap"><table><thead><tr><th>Detection</th><th>Boundaries</th><th>Evidence</th><th>Invalidation</th></tr></thead><tbody>
              {data.chartIntelligence.detections.map((d: any) => <tr key={d.kind}><td>{d.kind}<div className="hint">{Math.round(d.confidence * 100)}% rule strength · {d.calibration}</div></td><td>{fmt.px(d.boundaries.low)}–{fmt.px(d.boundaries.high)}</td><td>{d.evidence.join('; ')}<div className="hint">{d.method}</div></td><td>{d.invalidation}<div className="hint">Expires {fmt.time(d.expiresAt)}</div></td></tr>)}
            </tbody></table></div>
          </div>}
        </Card>
        <CexActivity report={data?.cexActivity} />
        <AdvancedIndicators snapshot={data?.featuresResearch} />
        <Card title="50 indicator specialists"><IndicatorGrid list={data?.indicators ?? []} /></Card>
      </div>
      <div className="col" style={{ gap: 14 }}>
        <Card title="Order book (top 20)" right={<Freshness at={data?.book?.ts} />} flush>{data?.book ? <Book book={data.book} /> : <Empty>No book</Empty>}</Card>
        <Card title="Large prints" flush><div className="tablewrap" style={{ maxHeight: 220 }}><table><tbody>{(data?.prints ?? []).map((p: any, i: number) => <tr key={i}><td className="faint">{fmt.ago(p.ts)}</td><td><Badge v={p.side} /></td><td className="num">{fmt.usd(p.notional, 0)}</td></tr>)}</tbody></table>{!data?.prints?.length && <Empty>No prints above threshold recently.</Empty>}</div></Card>
        <Card title="Watchlist" flush><div className="tablewrap" style={{ maxHeight: 360 }}><table><tbody>{(watch.data?.tickers ?? []).slice(0, 40).map((w: any) => <tr key={w.symbol} className="click" onClick={() => nav(`/terminal/${w.symbol}`)}><td><b>{w.base}</b></td><td className="num">{fmt.px(w.last)}</td><td className="num"><Chg v={w.changePct} /></td></tr>)}</tbody></table></div></Card>
      </div>
    </div>}
    {ana && <Modal title="Full pipeline analysis" onClose={() => setAna(null)}>{ana.decision ? <DecisionView report={ana} /> : <div className="banner info">{ana.reason}</div>}</Modal>}
  </Page>;
}
function CandleChart({ candles, features }: { candles: any[]; features: any }) {
  const ref = useRef<HTMLDivElement>(null); const chart = useRef<IChartApi | null>(null); const series = useRef<any>({});
  useEffect(() => {
    if (!ref.current) return;
    const css = getComputedStyle(document.documentElement);
    const c = createChart(ref.current, { autoSize: true, layout: { background: { color: 'transparent' }, textColor: css.getPropertyValue('--muted').trim(), fontFamily: 'IBM Plex Mono' }, grid: { vertLines: { color: css.getPropertyValue('--line').trim() }, horzLines: { color: css.getPropertyValue('--line').trim() } }, timeScale: { timeVisible: true }, rightPriceScale: { borderVisible: false } });
    series.current.c = c.addSeries(CandlestickSeries, { upColor: '#22c38e', downColor: '#f0505a', borderVisible: false, wickUpColor: '#22c38e', wickDownColor: '#f0505a' });
    series.current.v = c.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, color: 'rgba(139,150,168,.35)' });
    c.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    series.current.e20 = c.addSeries(LineSeries, { color: '#4f8cff', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    series.current.e50 = c.addSeries(LineSeries, { color: '#a78bfa', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    chart.current = c; return () => { c.remove(); chart.current = null; };
  }, []);
  useEffect(() => {
    const s = series.current; if (!s.c) return;
    const t = (x: any) => Math.floor(x.t / 1000) as UTCTimestamp;
    s.c.setData(candles.map((x) => ({ time: t(x), open: x.o, high: x.h, low: x.l, close: x.c })));
    s.v.setData(candles.map((x) => ({ time: t(x), value: x.v, color: x.c >= x.o ? 'rgba(34,195,142,.35)' : 'rgba(240,80,90,.35)' })));
    const ema = (p: number) => { const k = 2 / (p + 1); let e: number | null = null; return candles.map((x, i) => { e = e == null ? x.c : x.c * k + e * (1 - k); return { time: t(x), value: e, i }; }).filter((x) => x.i >= p).map(({ time, value }) => ({ time, value })); };
    s.e20.setData(ema(20)); s.e50.setData(ema(50));
  }, [candles, features]);
  return <div ref={ref} className="chart" role="img" aria-label="Candlestick price chart" />;
}
function Book({ book }: { book: any }) {
  const max = Math.max(...[...book.bids, ...book.asks].map((x: any) => x[0] * x[1]));
  const row = (x: any, side: 'b' | 'a') => <tr key={side + x[0]}><td className={`num ${side === 'b' ? 'up' : 'down'}`} style={{ background: `linear-gradient(to left, ${side === 'b' ? 'rgba(34,195,142,.12)' : 'rgba(240,80,90,.12)'} ${(x[0] * x[1] / max) * 100}%, transparent 0)` }}>{fmt.px(x[0])}</td><td className="num">{fmt.num(x[1], 4)}</td></tr>;
  return <div className="tablewrap" style={{ maxHeight: 420 }}><table><tbody>{[...book.asks.slice(0, 12)].reverse().map((x: any) => row(x, 'a'))}<tr><td colSpan={2} className="hint" style={{ textAlign: 'center' }}>spread {fmt.num(((book.asks[0][0] - book.bids[0][0]) / book.bids[0][0]) * 1e4, 2)} bps</td></tr>{book.bids.slice(0, 12).map((x: any) => row(x, 'b'))}</tbody></table></div>;
}

export function Bubbles() {
  const [minVol, setMinVol] = useState(5e6); const [view, setView] = useState('Bubbles');
  const { data, error } = useApi(`/api/bubbles?limit=150&minVolume=${minVol}`, { topics: ['ticker'] }); const nav = useNavigate();
  const nodes = useMemo(() => {
    if (!data?.crypto?.length) return [];
    const root = hierarchy({ children: data.crypto } as any).sum((d: any) => (d.quoteVolume ? Math.sqrt(d.quoteVolume) : 0));
    return pack().size([1000, 620]).padding(3)(root as any).leaves();
  }, [data]);
  const color = (c: number) => { const a = Math.min(1, Math.abs(c) / 10) * 0.75 + 0.15; return c >= 0 ? `rgba(34,195,142,${a})` : `rgba(240,80,90,${a})`; };
  const { sorted, th } = useSort<any>(data?.crypto ?? [], 'changePct');
  return <Page title="Market Bubble Map" sub="Size = √(24h quote volume); color = 24h change. Liquid Binance spot pairs only. AI tags flag thin moves, volume-backed moves, fades and recoveries. Stocks & commodities pending licensed feeds."
    right={<><Freshness at={data?.asOf} /><select value={minVol} onChange={(e) => setMinVol(Number(e.target.value))} aria-label="Minimum volume"><option value={1e6}>≥ $1M vol</option><option value={5e6}>≥ $5M</option><option value={25e6}>≥ $25M</option><option value={100e6}>≥ $100M</option></select></>}>
    <ErrorLine e={error} />
    {data && <div className="row" style={{ marginBottom: 12 }}><Badge v={`${data.breadth.advancers} advancing`} tone="b-good" /><Badge v={`${data.breadth.decliners} declining`} tone="b-bad" /><Badge v={`median ${fmt.pct(data.breadth.medianChangePct)}`} /><Badge v={`${data.breadth.up10} ≥ +10%`} tone="b-good" /><Badge v={`${data.breadth.down10} ≤ −10%`} tone="b-bad" />{data.unavailable.map((u: any) => <Badge key={u.market} v={`${u.market}: pending`} title={u.reason} />)}</div>}
    <Tabs tabs={['Bubbles', 'Table', 'Forex (ECB reference)']} value={view} onChange={setView} />
    {view === 'Bubbles' && <Card flush>{nodes.length ? <svg viewBox="0 0 1000 620" width="100%" role="img" aria-label="Bubble map of 24h changes; table view available">
      {nodes.map((n: any) => <g key={n.data.id} transform={`translate(${n.x},${n.y})`} style={{ cursor: 'pointer' }} onClick={() => nav(`/terminal/${n.data.symbol}USDT`)}>
        <title>{`${n.data.symbol} ${fmt.pct(n.data.changePct)} · vol ${fmt.big(n.data.quoteVolume)} · ${n.data.tags.join(', ')}`}</title>
        <circle r={n.r} fill={color(n.data.changePct)} stroke="var(--line2)" />
        {n.r > 16 && <><text textAnchor="middle" dy="-0.1em" fontSize={Math.min(16, n.r / 2.6)} fill="var(--text)" fontWeight={600}>{n.data.symbol}</text><text textAnchor="middle" dy="1.1em" fontSize={Math.min(12, n.r / 3.4)} fill="var(--text)" fontFamily="var(--mono)">{fmt.pct(n.data.changePct, 1)}</text></>}
      </g>)}</svg> : <Empty>Loading…</Empty>}</Card>}
    {view === 'Table' && <Card flush><div className="tablewrap"><table><thead><tr>{th('symbol', 'Asset')}{th('price', 'Price', true)}{th('changePct', '24h', true)}{th('quoteVolume', 'Volume', true)}{th('marketCap', 'Mkt cap', true)}<th>Tags</th><th>Safety</th></tr></thead><tbody>{sorted.map((r: any) => <tr key={r.id} className="click" onClick={() => nav(`/terminal/${r.symbol}USDT`)}><td><b>{r.symbol}</b></td><td className="num">{fmt.px(r.price)}</td><td className="num"><Chg v={r.changePct} /></td><td className="num">{fmt.big(r.quoteVolume)}</td><td className="num">{fmt.big(r.marketCap)}</td><td>{r.tags.map((t: string) => <Badge key={t} v={t} />)}</td><td>{r.safety ? <Badge v={r.safety} /> : <span className="faint">not deep-scanned</span>}</td></tr>)}</tbody></table></div></Card>}
    {view.startsWith('Forex') && <Card flush title={`ECB reference fixing ${data?.fxAsOf ?? ''} — daily, not tradeable`}><table><thead><tr><th>Pair</th><th className="num">Rate</th><th className="num">Δ vs prior fixing</th></tr></thead><tbody>{(data?.forex ?? []).map((f: any) => <tr key={f.id}><td><b>{f.symbol}</b></td><td className="num">{f.price.toFixed(5)}</td><td className="num"><Chg v={f.changePct} dp={3} /></td></tr>)}</tbody></table></Card>}
  </Page>;
}

export function Whales() {
  const w = useApi('/api/whales', { topics: ['whale'], every: 60_000 }); const d = useApi('/api/dex', { every: 120_000 });
  const [tab, setTab] = useState('CEX large prints'); const [sel, setSel] = useState<any>(null);
  return <Page title="Whale & Launch Monitor" sub="Large exchange prints (public aggregated trades above a liquidity-scaled threshold) and newly profiled DEX tokens with heuristic safety screening. Wallet-level tracking, copy trading and Telegram launch sources require credentials (see Connections Hub).">
    <ErrorLine e={w.error || d.error} />
    <div className="banner info">{w.data?.walletTracking}</div>
    <Tabs tabs={['CEX large prints', 'DEX launches', 'Copy trading']} value={tab} onChange={setTab} />
    {tab === 'CEX large prints' && <div className="grid g-2-1"><Card flush title={`${w.data?.prints.length ?? 0} prints (6h window)`}><div className="tablewrap"><table><thead><tr><th>When</th><th>Pair</th><th>Side</th><th className="num">Price</th><th className="num">Notional</th></tr></thead><tbody>{(w.data?.prints ?? []).map((p: any, i: number) => <tr key={i}><td className="faint">{fmt.ago(p.ts)}</td><td><Link to={`/terminal/${p.symbol}`}>{p.symbol}</Link></td><td><Badge v={p.side} /></td><td className="num">{fmt.px(p.price)}</td><td className="num">{fmt.usd(p.notional, 0)}</td></tr>)}</tbody></table>{!w.data?.prints.length && <Empty>No prints above threshold yet.</Empty>}</div></Card>
      <Card title="Thresholds" flush><table><tbody>{(w.data?.thresholds ?? []).map((t: any) => <tr key={t.symbol}><td>{t.symbol}</td><td className="num">{fmt.usd(t.threshold, 0)}</td></tr>)}</tbody></table></Card></div>}
    {tab === 'DEX launches' && <Card flush title="Latest DEX token profiles" right={<Freshness at={d.data?.asOf} />}><div className="banner info" style={{ margin: 12 }}>{d.data?.note}</div><div className="tablewrap"><table><thead><tr><th>Token</th><th>Chain / DEX</th><th className="num">Liquidity</th><th className="num">Vol 24h</th><th className="num">24h</th><th className="num">Buys/Sells</th><th>Safety</th></tr></thead>
      <tbody>{(d.data?.pairs ?? []).map((p: any) => <tr key={p.pairAddress} className="click" onClick={() => setSel(p)}><td><b>{p.baseSymbol}</b> <span className="faint">{p.baseName}</span></td><td>{p.chainId} · {p.dexId}</td><td className="num">{fmt.usd(p.liquidityUsd, 0)}</td><td className="num">{fmt.big(p.volume24h)}</td><td className="num"><Chg v={p.change24h} /></td><td className="num">{p.buys24h}/{p.sells24h}</td><td><Badge v={p.safety.status} /></td></tr>)}</tbody></table>{!d.data?.pairs?.length && <Empty>Loading DEX listings…</Empty>}</div></Card>}
    {tab === 'Copy trading' && <Card title="Copy trading (Part 4.4)"><div className="col"><Badge v="PENDING_CREDENTIALS" /><p className="muted">Copy trading mirrors identified wallets. It needs an on-chain indexer (EVM/Solana RPC + explorer API) to discover, rank and validate whale wallets. No wallet data is simulated. When configured, copied trades will still pass the full QCI → decision → risk pipeline and never bypass your limits.</p><Link to="/connections">Configure providers in the Connections Hub →</Link></div></Card>}
    {sel && <Modal title={`${sel.baseSymbol} · ${sel.chainId}`} onClose={() => setSel(null)}><div className="col"><div className="row"><Badge v={sel.safety.status} /><span className="muted">Automation-eligible: no</span><a href={sel.url} target="_blank" rel="noreferrer noopener">DEX Screener ↗</a></div><table><tbody>{sel.safety.checks.map((c: any) => <tr key={c.name}><td>{c.name}</td><td><Badge v={c.result} /></td><td className="muted">{c.detail}</td></tr>)}</tbody></table><div className="hint">Token names and descriptions are untrusted external content.</div></div></Modal>}
  </Page>;
}

export function Holders() {
  return <Page title="Holder Map" sub="On-chain holder distribution and evidence-qualified wallet clusters (Part 25.3).">
    <Card title="Not connected"><div className="col"><Badge v="PENDING_CREDENTIALS" /><p className="muted">Holder maps require token-holder balances and transfer graphs from an on-chain provider (e.g. an EVM explorer API or Solana RPC with indexing). MIA does not fabricate holder data or wallet labels. Once a provider is configured, this view will show holder concentration, top-holder share, and clusters only where shared-funding or transfer evidence supports them — with label provenance.</p><Link to="/connections">Open Connections Hub →</Link></div></Card>
  </Page>;
}

export function News() {
  const { data, error, reload } = useApi('/api/news', { topics: ['news'] }); const [f, setF] = useState('ALL'); const [q, setQ] = useState('');
  const items = (data?.items ?? []).filter((n: any) => (f === 'ALL' || n.impact === f || (f === 'MACRO' && n.macro)) && (!q || n.title.toLowerCase().includes(q.toLowerCase()) || n.assets.includes(q.toUpperCase())));
  return <Page title="News & Events" sub={<>Headlines are untrusted external text, classified by a deterministic lexicon (impact, sentiment, macro, outlet credibility). High-impact items raise a heads-up notification. <span className="warn">{data?.license}</span></>}
    right={<Action label="Refresh now" run={async () => { await api('/api/news/refresh', { body: {} }); reload(); }} />}>
    <ErrorLine e={error} />
    <div className="row" style={{ marginBottom: 12 }}>{['ALL', 'HIGH', 'MEDIUM', 'LOW', 'MACRO'].map((x) => <button key={x} className={`sm ${f === x ? 'primary' : ''}`} onClick={() => setF(x)}>{x}</button>)}<input placeholder="Search or asset (BTC)…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
    <Card flush><div className="tablewrap" style={{ maxHeight: 700 }}><table><thead><tr><th>Published</th><th>Headline</th><th>Impact</th><th>Sentiment</th><th>Assets</th><th>Source</th></tr></thead><tbody>{items.map((n: any) => <tr key={n.id}><td className="faint" style={{ whiteSpace: 'nowrap' }}>{fmt.ago(n.ts)}</td><td><a href={n.url} target="_blank" rel="noreferrer noopener">{n.title}</a>{n.macro && <> <Badge v="MACRO" tone="b-violet" /></>}</td><td><Badge v={n.impact} /></td><td><Badge v={n.sentiment} /></td><td>{n.assets.join(', ')}</td><td><span className="muted">{n.source}</span> {n.credibility === 'ESTABLISHED_OUTLET' && <Badge v="established" tone="b-info" />}</td></tr>)}</tbody></table>{!items.length && <Empty>No headlines match.</Empty>}</div></Card>
    <Card title="Economic calendar"><span className="muted">A licensed economic-calendar feed is not configured (PENDING_CREDENTIALS). Macro headlines above (Fed/CPI/jobs/tariffs) are detected from news and feed the "Macro event risk" worker.</span></Card>
  </Page>;
}
