import { useState } from 'react';
import { api, fmt, useApi } from '../api';
import { Action, Badge, Card, Empty, ErrorLine, Page, Stat, Tabs } from '../ui';

/**
 * Prediction-market research (Polymarket, Kalshi): read-only market data, book analytics, arbitrage checks, reward
 * estimates, a conservative book-replay backtest and calculators. Evidence only — MIA places no prediction-market
 * orders, and nothing here reaches the decision engine, risk gate or paper OMS.
 */
type Venue = 'polymarket' | 'kalshi';
type Env<T> = { kind: 'RESEARCH_ONLY'; tradeEligible: false; asOf: number; caveats: string[]; data: T };
type Market = { venue: Venue; id: string; question: string; endDate: string | null; bestBid: number | null; bestAsk: number | null; volume24hUsd: number | null; liquidityUsd: number | null; rewards: { maxSpreadCents: number; minSize: number; dailyRateUsd: number | null } | null; url: string };
type Arb = { kind: string; route: string; sets: number; costPerSet: number; edgePerSet: number; lockedProfit: number; fees: number; caveats: string[] } | null;
type Level = { price: number; size: number };

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}¢`);
const money = (v: number) => `${v < 0 ? '−' : ''}$${Math.abs(v).toFixed(2)}`;
const usd = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `$${fmt.num(v, 0)}`);

function Caveats({ list }: { list: string[] }) {
  return list.length ? <ul className="hint" style={{ margin: '6px 0 0', paddingLeft: 18 }}>{list.map((c) => <li key={c}>{c}</li>)}</ul> : null;
}
function ArbCard({ arb }: { arb: Arb }) {
  if (!arb) return <Empty>No arbitrage after fees at the visible prices (the normal case).</Empty>;
  return <div className="col" style={{ gap: 4 }}>
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}><Badge v={arb.kind.replace(/_/g, ' ')} tone="b-info" /><b>{arb.route}</b></div>
    <div>{fmt.num(arb.sets, 2)} sets · cost {arb.costPerSet.toFixed(4)} per set · edge {(arb.edgePerSet * 100).toFixed(2)}¢ · locked ≈ ${arb.lockedProfit.toFixed(2)} (fees ${arb.fees.toFixed(4)})</div>
    <Caveats list={arb.caveats} />
  </div>;
}
function BookTable({ bids, asks }: { bids: Level[]; asks: Level[] }) {
  const rows = Array.from({ length: Math.max(Math.min(bids.length, 8), Math.min(asks.length, 8)) });
  return <table><thead><tr><th>Bid size</th><th>Bid</th><th>Ask</th><th>Ask size</th></tr></thead><tbody>
    {rows.map((_, i) => <tr key={i}><td className="mono">{bids[i] ? fmt.num(bids[i].size, 0) : ''}</td><td className="mono up">{bids[i] ? pct(bids[i].price) : ''}</td><td className="mono down">{asks[i] ? pct(asks[i].price) : ''}</td><td className="mono">{asks[i] ? fmt.num(asks[i].size, 0) : ''}</td></tr>)}
    {!rows.length && <tr><td colSpan={4}><Empty>Empty book.</Empty></td></tr>}
  </tbody></table>;
}

function Analysis({ venue, id }: { venue: Venue; id: string }) {
  const [feeBps, setFeeBps] = useState('');
  const path = `/api/research/prediction/analyze?venue=${venue}&id=${encodeURIComponent(id)}${feeBps ? `&feeBps=${Number(feeBps)}` : ''}`;
  const a = useApi<Env<any>>(path);
  const d = a.data?.data;
  return <Card title={d ? d.market.question : 'Analysis'} right={d && <a href={d.market.url} target="_blank" rel="noreferrer noopener">open on {venue} ↗</a>}>
    <ErrorLine e={a.error} />
    {!d ? <Empty>{a.loading ? 'Reading the public order book…' : 'No data.'}</Empty> : <div className="col" style={{ gap: 12 }}>
      <div className="grid g3"><Stat k="Bid / ask (YES)" v={`${pct(d.stats.bestBid)} / ${pct(d.stats.bestAsk)}`} s={`spread ${d.stats.spreadTicks ?? '—'} ticks`} /><Stat k="Mid · microprice" v={`${pct(d.stats.mid)} · ${pct(d.stats.microprice)}`} s="the price implied by the book, not a forecast" /><Stat k="Book imbalance (5 levels)" v={d.stats.imbalance === null ? '—' : d.stats.imbalance.toFixed(2)} s="+ more bids · − more asks; displayed size can be faked" /></div>
      <div className="grid g2">
        <Card title="Order book (YES)"><BookTable bids={d.books.yes.bids} asks={d.books.yes.asks} /></Card>
        <div className="col" style={{ gap: 12 }}>
          <Card title="Complete-set arbitrage"><ArbCard arb={d.arbitrage} /></Card>
          <Card title="Liquidity rewards (estimate)">{!d.rewards ? <Empty>This market has no liquidity-reward program.</Empty> : <div className="col" style={{ gap: 4 }}>
            <div>Hypothetical quote {pct(d.rewards.quote.bid)} / {pct(d.rewards.quote.ask)} × {d.rewards.quote.size}: score {d.rewards.mine.qMin} vs book {d.rewards.others.qMin} → share {(d.rewards.share * 100).toFixed(1)}%{d.rewards.estDailyUsd !== null ? `, ≈ $${d.rewards.estDailyUsd}/day` : ''}</div>
            <div className="row" style={{ gap: 8 }}>Fill risk: bid <Badge v={d.rewards.fillRisk.bid.level} tone={d.rewards.fillRisk.bid.level === 'HIGH' ? 'b-bad' : d.rewards.fillRisk.bid.level === 'MEDIUM' ? 'b-warn' : 'b-good'} /> ask <Badge v={d.rewards.fillRisk.ask.level} tone={d.rewards.fillRisk.ask.level === 'HIGH' ? 'b-bad' : d.rewards.fillRisk.ask.level === 'MEDIUM' ? 'b-warn' : 'b-good'} /></div>
            <div className="hint">{d.rewards.note}</div></div>}</Card>
        </div>
      </div>
      {venue === 'polymarket' && <label className="row" style={{ gap: 6 }}>Taker fee (bps, if known) <input value={feeBps} onChange={(e) => setFeeBps(e.target.value.replace(/[^\d.]/g, ''))} style={{ width: 80 }} aria-label="Taker fee in basis points" /></label>}
      <Caveats list={a.data!.caveats} />
    </div>}
  </Card>;
}

function MarketsTab() {
  const [venue, setVenue] = useState<Venue>('polymarket'); const [q, setQ] = useState(''); const [query, setQuery] = useState('');
  const [sel, setSel] = useState<string | null>(null);
  const list = useApi<Env<Market[]>>(`/api/research/prediction/markets?venue=${venue}&limit=40${query ? `&query=${encodeURIComponent(query)}` : ''}`);
  return <div className="col" style={{ gap: 14 }}>
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <select value={venue} onChange={(e) => { setVenue(e.target.value as Venue); setSel(null); }} aria-label="Venue"><option value="polymarket">Polymarket</option><option value="kalshi">Kalshi</option></select>
      <form onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }} className="row" style={{ gap: 6 }}><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search questions…" aria-label="Search markets" /><button type="submit">Search</button></form>
    </div>
    <ErrorLine e={list.error} />
    {sel && <Analysis venue={venue} id={sel} />}
    <Card title={`Most active ${venue === 'kalshi' ? 'Kalshi' : 'Polymarket'} markets`} flush><div className="tablewrap"><table>
      <thead><tr><th>Question</th><th>Bid / ask</th><th>24h volume</th><th>Liquidity</th><th>Rewards</th><th>Ends</th></tr></thead>
      <tbody>{(list.data?.data ?? []).map((m) => <tr key={m.id} style={{ cursor: 'pointer' }} onClick={() => setSel(m.id)} aria-selected={sel === m.id}>
        <td><b>{m.question}</b></td><td className="mono">{pct(m.bestBid)} / {pct(m.bestAsk)}</td><td className="mono">{usd(m.volume24hUsd)}</td><td className="mono">{usd(m.liquidityUsd)}</td>
        <td>{m.rewards ? <Badge v={`±${m.rewards.maxSpreadCents}¢`} tone="b-info" title={`min size ${m.rewards.minSize}`} /> : ''}</td><td className="faint">{m.endDate ? fmt.time(Date.parse(m.endDate)) : '—'}</td></tr>)}</tbody>
    </table>{!list.loading && !list.data?.data.length && <Empty>No markets (the venue may be unreachable, or MIA is in offline mode).</Empty>}</div></Card>
  </div>;
}

function ScanTab() {
  const [res, setRes] = useState<Env<any> | null>(null);
  return <Card title="Complete-set arbitrage scan (Polymarket, top markets)"><div className="col" style={{ gap: 10 }}>
    <div className="hint">Reads the YES and NO books of up to 8 active binary markets and checks whether buying both (or splitting and selling both) clears 0.5¢ per set after fees. Real gaps are rare and close fast.</div>
    <div><Action className="primary" label="Run scan" run={async () => setRes(await api('/api/research/prediction/scan?limit=8'))} /></div>
    {res && <>
      <div><b>{res.data.opportunities}</b> of {res.data.scanned} markets showed a gap.</div>
      <table><tbody>{res.data.rows.map((r: any) => <tr key={r.id}><td>{r.question}</td><td>{r.error ? <span className="hint">{r.error}</span> : r.arbitrage ? <ArbCard arb={r.arbitrage} /> : <span className="faint">no gap</span>}</td></tr>)}</tbody></table>
      <Caveats list={res.caveats} /></>}
  </div></Card>;
}

const SAMPLE = JSON.stringify({ snapshots: [
  { t: 1, bids: [{ price: 0.48, size: 100 }], asks: [{ price: 0.52, size: 100 }] },
  { t: 2, bids: [{ price: 0.46, size: 100 }], asks: [{ price: 0.48, size: 100 }] },
  { t: 3, bids: [{ price: 0.53, size: 100 }], asks: [{ price: 0.56, size: 100 }] },
], resolution: 1, strategy: { type: 'passive_quote', halfSpreadTicks: 1, size: 10, maxInventory: 50 } }, null, 1);

function BacktestTab() {
  const [text, setText] = useState(SAMPLE); const [res, setRes] = useState<Env<any> | null>(null); const [err, setErr] = useState<string | null>(null);
  return <div className="grid g2">
    <Card title="Book replay input (JSON)"><div className="col" style={{ gap: 8 }}>
      <div className="hint">Order-book snapshots for one outcome, oldest first, plus a strategy: <span className="mono">passive_quote</span> (quote around the mid) or <span className="mono">threshold_taker</span> (buy below fair − edge, sell above fair + edge).</div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={16} spellCheck={false} className="mono" aria-label="Backtest input JSON" />
      <div><Action className="primary" label="Run hypothetical replay" run={async () => { setErr(null); let body: unknown; try { body = JSON.parse(text); } catch { setErr('Input is not valid JSON.'); return; } setRes(await api('/api/research/prediction/backtest', { body })); }} /></div>
      <ErrorLine e={err} />
    </div></Card>
    <Card title="Result (hypothetical)">{!res ? <Empty>Run a replay to see fills and P&amp;L.</Empty> : <div className="col" style={{ gap: 8 }}>
      <div className="grid g3"><Stat k="P&L" v={money(res.data.pnl)} tone={res.data.pnl >= 0 ? 'up' : 'down'} s={res.data.settledAt} /><Stat k="Fills" v={res.data.fillCount} s={`turnover $${res.data.turnover}`} /><Stat k="Max drawdown" v={money(res.data.maxDrawdown)} s={`max inventory ${res.data.maxInventory}`} /></div>
      <table><thead><tr><th>t</th><th>Side</th><th>Price</th><th>Shares</th><th>Fee</th><th /></tr></thead><tbody>{res.data.fills.slice(0, 50).map((f: any, i: number) => <tr key={i}><td className="mono">{f.t}</td><td>{f.side}</td><td className="mono">{pct(f.price)}</td><td className="mono">{f.shares}</td><td className="mono">{f.fee}</td><td><Badge v={f.liquidity} tone="b-neutral" /></td></tr>)}</tbody></table>
      <Caveats list={res.data.assumptions} />
    </div>}</Card>
  </div>;
}

function CalcTab() {
  const [k, setK] = useState({ belief: '0.6', price: '0.5', fraction: '0.25' }); const [kr, setKr] = useState<any>(null);
  const [dg, setDg] = useState({ spot: '100000', strike: '100000', volPerRootSec: '0.0002', secsLeft: '300' }); const [dr, setDr] = useState<any>(null);
  const field = (o: Record<string, string>, set: (v: any) => void, key: string, label: string) => <label className="col" style={{ gap: 2 }}>{label}<input value={o[key]} onChange={(e) => set({ ...o, [key]: e.target.value })} aria-label={label} /></label>;
  return <div className="grid g2">
    <Card title="Fractional Kelly stake (hypothetical)"><div className="col" style={{ gap: 8 }}>
      {field(k, setK, 'belief', 'Your probability estimate (0–1)')}{field(k, setK, 'price', 'YES price (0–1)')}{field(k, setK, 'fraction', 'Kelly fraction (e.g. 0.25)')}
      <div><Action label="Calculate" run={async () => setKr(await api('/api/research/prediction/calc', { body: { kind: 'kelly', belief: Number(k.belief), price: Number(k.price), fraction: Number(k.fraction) } }))} /></div>
      {kr && <div>Full Kelly {(kr.data.full * 100).toFixed(1)}% → stake <b>{(kr.data.stake * 100).toFixed(2)}%</b> of bankroll (edge {(kr.data.edge * 100).toFixed(1)}¢). <Caveats list={kr.caveats} /></div>}
    </div></Card>
    <Card title="Up/down round model value"><div className="col" style={{ gap: 8 }}>
      {field(dg, setDg, 'spot', 'Current price')}{field(dg, setDg, 'strike', 'Round start (strike)')}{field(dg, setDg, 'volPerRootSec', 'Volatility per √second')}{field(dg, setDg, 'secsLeft', 'Seconds left')}
      <div><Action label="Calculate" run={async () => setDr(await api('/api/research/prediction/calc', { body: { kind: 'digital', spot: Number(dg.spot), strike: Number(dg.strike), volPerRootSec: Number(dg.volPerRootSec), secsLeft: Number(dg.secsLeft) } }))} /></div>
      {dr && <div>Model probability UP: <b>{(dr.data.probabilityUp * 100).toFixed(2)}%</b> <Caveats list={dr.caveats} /></div>}
    </div></Card>
  </div>;
}

export function Prediction() {
  const [tab, setTab] = useState('Markets');
  return <Page title="Prediction Markets" sub="Polymarket and Kalshi research: live public books, arbitrage checks, liquidity-reward estimates, a conservative backtest and calculators. Evidence only — MIA never trades prediction markets.">
    <div className="banner info">Research only. MIA has no prediction-market order path, holds no wallet key and never signs. Results are not trade signals and never reach the decision engine, risk gate or paper OMS.</div>
    <Tabs tabs={['Markets', 'Arbitrage scan', 'Backtest', 'Calculators']} value={tab} onChange={setTab} />
    <div style={{ marginTop: 14 }}>{tab === 'Markets' ? <MarketsTab /> : tab === 'Arbitrage scan' ? <ScanTab /> : tab === 'Backtest' ? <BacktestTab /> : <CalcTab />}</div>
  </Page>;
}
