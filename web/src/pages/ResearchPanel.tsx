import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fmt, useApi } from '../api';
import { Icon } from '../brand';
import { Badge, Card, Empty, ErrorLine, Freshness } from '../ui';
import { CandleChart, type MarketCandle } from './Markets';

type Candidate = {
  symbol: string;
  chainId: string;
  pairAddress: string;
  ageMs: number | null;
  liquidityUsd: number;
  safetyStatus: string;
  reasons: string[];
};
type FastResult = { sourceAsOf: number; candidates: Candidate[] };
type DexSnapshot = {
  asOf: number;
  note: string;
  pairs: Array<{
    baseSymbol: string; chainId: string; pairAddress: string; pairCreatedAt: number | null; liquidityUsd: number;
    safety: { status: string; reasons: string[] };
  }>;
};
type Timeframe = '15m' | '1h' | '4h';
const timeframes: Timeframe[] = ['15m', '1h', '4h'];
type DeepResult = {
  symbol: string;
  source: string;
  asOf: number;
  state: string;
  reason: string;
  chartEvidence: Record<Timeframe, { status: string; trend: string }>;
  plan: {
    direction: string;
    entryTrigger: string;
    invalidationLevel: number;
    expiresAt: number;
    requiredMissing: readonly string[];
  } | null;
};
type ResearchSnapshot = {
  tradingAuthority: false;
  fast: { stale: boolean; result: FastResult | null };
  deep: { stale: boolean; error: string | null; result: DeepResult | null };
};
const reasonText = (reason: string) => reason.replaceAll('_', ' ').toLowerCase();
const pairKey = (item: Candidate) => item.chainId + ':' + item.pairAddress;

function FastEvidence({ result }: { result: FastResult }) {
  const [selected, setSelected] = useState<string | null>(null);
  if (!result.candidates.length) return <Empty>No recent DEX pairs matched the scanner’s research window.</Empty>;
  const candidate = result.candidates.find((item) => pairKey(item) === selected) ?? result.candidates[0];
  return <>
    <div className="tablewrap mia-candidate-table">
      <table>
        <thead><tr><th>Pair</th><th>Chain</th><th className="num">Liquidity</th></tr></thead>
        <tbody>{result.candidates.map((item) => <tr key={pairKey(item)}>
          <td><button type="button" className="sm" aria-pressed={item === candidate} onClick={() => setSelected(pairKey(item))}>{item.symbol}</button></td>
          <td>{item.chainId}</td><td className="num">{fmt.usd(item.liquidityUsd, 0)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="mia-research-detail" aria-live="polite">
      <div className="row between"><strong>{candidate.symbol} safety</strong><Badge v={candidate.safetyStatus} /></div>
      {candidate.ageMs !== null && <span className="hint">Age at scan {Math.floor(candidate.ageMs / 60_000)} min</span>}
      <ul>{candidate.reasons.map((reason, index) => <li key={index}>{reasonText(reason)}</li>)}</ul>
      <Freshness at={result.sourceAsOf} label="DEX snapshot" />
    </div>
  </>;
}

function DeepEvidence({ result }: { result: DeepResult }) {
  const plan = result.plan;
  return <div className="col mia-research-detail">
    <div className="row between"><strong>{result.symbol} perpetual</strong><Badge v={result.state} /></div>
    <div className="row">{timeframes.map((interval) => <Badge key={interval} v={interval + ' ' + result.chartEvidence[interval].trend} />)}</div>
    {plan ? <>
      <dl className="mia-facts">
        <dt>Hypothesis</dt><dd>{plan.direction}</dd>
        <dt>Trigger</dt><dd>{reasonText(plan.entryTrigger)}</dd>
        <dt>Invalidation level</dt><dd>{fmt.px(plan.invalidationLevel)}</dd>
        <dt>Expiry</dt><dd>{fmt.time(plan.expiresAt)}</dd>
      </dl>
      <details><summary>Evidence still required</summary><ul>{plan.requiredMissing.map((reason) => <li key={reason}>{reasonText(reason)}</li>)}</ul></details>
    </> : <p className="muted">{reasonText(result.reason)}</p>}
    <div className="hint">{result.source} · <Freshness at={result.asOf} /></div>
  </div>;
}

function DexEvidence({ snapshot }: { snapshot: DexSnapshot | null }) {
  if (!snapshot?.asOf) return <Empty>Awaiting a DEX market snapshot.</Empty>;
  if (Date.now() - snapshot.asOf > 4 * 60_000) return <Empty>DEX market data is stale.</Empty>;
  return <>
    <FastEvidence result={{ sourceAsOf: snapshot.asOf, candidates: snapshot.pairs.slice(0, 20).map((pair) => ({
      symbol: pair.baseSymbol, chainId: pair.chainId, pairAddress: pair.pairAddress, liquidityUsd: pair.liquidityUsd,
      ageMs: pair.pairCreatedAt === null ? null : Math.max(0, snapshot.asOf - pair.pairCreatedAt),
      safetyStatus: pair.safety.status, reasons: pair.safety.reasons,
    })) }} />
    <p className="hint">{snapshot.note}</p>
  </>;
}

function SpotEvidence({ snapshot }: { snapshot: InstrumentSnapshot | null }) {
  const report = snapshot?.chartIntelligence;
  if (!report) return <Empty>{snapshot?.reason ?? 'Awaiting closed spot candles.'}</Empty>;
  return <div className="col mia-research-detail">
    <div className="row between"><strong>BTC / USDT · 1h spot</strong><Badge v={report.status} /></div>
    {report.status === 'VALID' ? <dl className="mia-facts">
      <dt>Structure</dt><dd>{report.trend}</dd>
      <dt>Support</dt><dd>{fmt.px(report.support)}</dd>
      <dt>Resistance</dt><dd>{fmt.px(report.resistance)}</dd>
    </dl> : <p className="muted">{report.issues.join('. ') || 'Closed candles are insufficient for a read.'}</p>}
    <Freshness at={report.asOf} label="Chart analysis" />
  </div>;
}

export function ResearchPanel({ source }: { source?: 'command' | 'market' }) {
  const [mode, setMode] = useState<'fast' | 'deep'>('fast');
  const command = useApi<ResearchSnapshot>(source === 'command' ? '/api/choice/dual/status' : null, { topics: ['bot', 'health'], every: 30_000 });
  const dex = useApi<DexSnapshot>(source === 'market' && mode === 'fast' ? '/api/dex' : null, { every: 45_000 });
  const spot = useApi<InstrumentSnapshot>(source === 'market' && mode === 'deep' ? '/api/instrument/BTCUSDT?interval=1h' : null, { topics: ['scan'], every: 45_000 });
  const active = source === 'command' ? command : mode === 'fast' ? dex : spot;
  const { error, loading, reload } = active;
  const data = command.data;
  const usable = data?.tradingAuthority === false;
  const title = mode === 'fast' ? 'Deployment radar' : source === 'market' ? 'Spot market structure' : 'Strategy architect';
  let evidence = <Empty>{!source ? 'Awaiting engine status.' : loading ? 'Loading research…' : 'Research snapshot unavailable.'}</Empty>;
  if (source === 'market' && !error) {
    evidence = mode === 'fast' ? <DexEvidence snapshot={dex.data} /> : <SpotEvidence snapshot={spot.data} />;
  } else if (source === 'command' && usable && !error) {
    if (mode === 'fast') {
      const { stale, result } = data.fast;
      evidence = result && !stale
        ? <FastEvidence result={result} />
        : <Empty>{result ? 'DEX evidence is stale or missing.' : 'Awaiting a DEX research snapshot.'}</Empty>;
    } else {
      const { stale, result, error: sourceError } = data.deep;
      evidence = result && !stale && !sourceError
        ? <DeepEvidence result={result} />
        : <Empty>{sourceError ? 'Futures source unavailable.' : result ? 'Futures evidence is stale or expired.' : 'Awaiting a futures research snapshot.'}</Empty>;
    }
  }
  return <Card title="Intelligence" className="mia-research" right={
    <button type="button" className="ghost mia-top-icon" aria-label="Refresh research" onClick={reload} disabled={!source || loading}><Icon name="refresh" size={15} /></button>
  }>
    <div className="mia-segment" role="group" aria-label="Intelligence view">
      <button type="button" data-mode="fast" aria-pressed={mode === 'fast'} onClick={() => setMode('fast')}><Icon name="bolt" size={15} /> FAST</button>
      <button type="button" data-mode="deep" aria-pressed={mode === 'deep'} onClick={() => setMode('deep')}><Icon name="layers" size={15} /> DEEP</button>
    </div>
    <div className="mia-research-heading"><h3>{title}</h3><Badge v="Research only" /></div>
    <ErrorLine e={error} />
    <div role="region" aria-label={title}>{evidence}</div>
    <Link className="mia-panel-link" to={mode === 'fast' ? '/scanner' : '/ditas'}>{mode === 'fast' ? 'Market scanner' : 'Decision intelligence'} <Icon name="arrow" size={15} /></Link>
  </Card>;
}

type InstrumentSnapshot = {
  candles?: MarketCandle[];
  ticker?: { last: number; receivedAt: number };
  unavailable?: boolean;
  reason?: string;
  chartIntelligence?: { status: string; trend: string; asOf: number; support: number | null; resistance: number | null; issues: string[] };
};

function MarketWindow({ interval }: { interval: Timeframe }) {
  const { data, error, loading } = useApi<InstrumentSnapshot>('/api/instrument/BTCUSDT?interval=' + interval, { topics: ['scan'], every: 30_000 });
  if (error) return <ErrorLine e={error} />;
  if (!data?.candles?.length) return <div className="mia-chart-empty">
    <Icon name="chart" size={27} />
    <strong>{loading ? 'Loading candles…' : 'Market candles unavailable'}</strong>
    <span>{data?.reason ?? 'Candles appear once market data is available.'}</span>
  </div>;
  return <>
    <div className="row between mia-chart-quote"><strong>BTC / USDT</strong><span className="mono">{fmt.px(data.ticker?.last)}</span><Freshness at={data.ticker?.receivedAt} label="Quote" /></div>
    <CandleChart candles={data.candles} />
    <div className="hint">The most recent candle may still be forming.</div>
  </>;
}

export function AutopilotChart() {
  const [interval, setInterval] = useState<Timeframe>('1h');
  return <Card title="BTC / USDT spot" className="mia-market-chart" right={
    <div className="mia-segment mia-timeframes" role="group" aria-label="Chart timeframe">
      {timeframes.map((value) => <button type="button" key={value} aria-pressed={value === interval} onClick={() => setInterval(value)}>{value}</button>)}
    </div>
  }>
    <MarketWindow key={interval} interval={interval} />
    <Link className="mia-panel-link" to="/terminal/BTCUSDT">Market Terminal <Icon name="arrow" size={15} /></Link>
  </Card>;
}
