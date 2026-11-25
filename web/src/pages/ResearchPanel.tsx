import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { fmt, useApi } from '../api';
import { Icon } from '../brand';
import { Badge, Card, Empty, ErrorLine, Freshness } from '../ui';
import type { Mind } from './AutopilotSession';
import { CandleChart, type MarketCandle, type MarketPriceLevel } from './Markets';

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
    baseSymbol: string; baseName: string; quoteSymbol: string; chainId: string; pairAddress: string;
    pairCreatedAt: number | null; liquidityUsd: number; priceUsd: number; change1h: number;
    safety: { status: string; reasons: string[] };
  }>;
};
type Timeframe = '15m' | '1h' | '4h';
const timeframes: Timeframe[] = ['15m', '1h', '4h'];
const intervalMs: Record<Timeframe, number> = { '15m': 900_000, '1h': 3_600_000, '4h': 14_400_000 };
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
const pairKey = (item: { chainId: string; pairAddress: string }) => item.chainId + ':' + item.pairAddress;

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

function SpotEvidence({ snapshot, symbol, interval }: { snapshot: InstrumentSnapshot | null; symbol: string; interval: Timeframe }) {
  const report = snapshot?.chartIntelligence;
  if (!report) return <Empty>{snapshot?.reason ?? 'Awaiting closed spot candles.'}</Empty>;
  return <div className="col mia-research-detail">
    <div className="row between"><strong>{symbol} · {interval} spot</strong><Badge v={report.status} /></div>
    {report.status === 'VALID' ? <dl className="mia-facts">
      <dt>Structure</dt><dd>{report.trend}</dd>
      <dt>Support</dt><dd>{fmt.px(report.support)}</dd>
      <dt>Resistance</dt><dd>{fmt.px(report.resistance)}</dd>
    </dl> : <p className="muted">{report.issues.join('. ') || 'Closed candles are insufficient for a read.'}</p>}
    <Freshness at={report.asOf} label="Chart analysis" />
  </div>;
}

type InstrumentSnapshot = {
  candles?: (MarketCandle & { forming?: boolean })[];
  instrument?: { id: string; base: string; quote: string };
  ticker?: { last: number; receivedAt: number } | null;
  unavailable?: boolean;
  reason?: string;
  chartIntelligence?: { status: string; trend: string; asOf: number; support: number | null; resistance: number | null; issues: string[] };
};

function MarketWindow({ data, loading, symbol, interval, positionLevels }: {
  data: InstrumentSnapshot | null; loading: boolean; symbol: string; interval: Timeframe; positionLevels: MarketPriceLevel[];
}) {
  if (!data?.candles?.length) return <div className="mia-chart-empty">
    <Icon name="chart" size={27} />
    <strong>{loading ? 'Loading candles…' : 'Market candles unavailable'}</strong>
    <span>{data?.reason ?? 'Candles appear once market data is available.'}</span>
  </div>;
  const lastClosed = data.candles.findLast((candle) => !candle.forming);
  const closeAt = lastClosed ? lastClosed.t + intervalMs[interval] : null;
  const stale = closeAt === null || Date.now() - closeAt > 2 * intervalMs[interval];
  return <>
    <div className="row between mia-chart-quote"><strong>{data.instrument ? data.instrument.base + ' / ' + data.instrument.quote : symbol}</strong><span className="mono">{fmt.px(data.ticker?.last)}</span><Freshness at={data.ticker?.receivedAt} label="Quote" /></div>
    <CandleChart candles={data.candles} priceLevels={positionLevels} />
    <div className="hint">
      {closeAt === null ? 'No closed candle is available.' : `Last closed candle ${fmt.time(closeAt)}`}
      {stale && <span className="warn"> · Candles are stale or unavailable.</span>}
    </div>
    {!!positionLevels.length && <div className="hint">Dashed levels show recorded paper entries, stops and pending targets.</div>}
    <div className="hint">The most recent candle may still be forming.</div>
  </>;
}

type ResearchSource = 'command' | 'market' | undefined;
type SpotPosition = {
  instrument: string; entry_price: number; stop_price: number; targets: { targets: { price: number; done: boolean }[] };
};
type WorkspaceProps = { source: ResearchSource; positions: ReactNode; activity: ReactNode; paperPositions?: readonly SpotPosition[] };
const dexFresh = (asOf: number) => asOf > 0 && asOf <= Date.now() && Date.now() - asOf <= 4 * 60_000;
const positive = (value: number) => Number.isFinite(value) && value > 0 ? value : null;

export function ResearchWorkspace({ mind, ...props }: WorkspaceProps & { mind: Mind }) {
  return <div className="mia-cockpit-grid mia-dashboard-section">
    {mind === 'FAST' ? <FastWorkspace {...props} /> : <DeepWorkspace {...props} />}
  </div>;
}

function FastWorkspace({ source, positions, activity }: WorkspaceProps) {
  const command = useApi<ResearchSnapshot>(source === 'command' ? '/api/choice/dual/status' : null,
    { topics: ['bot', 'health'], every: 30_000 });
  const dex = useApi<DexSnapshot>(source ? '/api/dex' : null, { every: 45_000 });
  const [chain, setChain] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const snapshot = !dex.error && dex.data && dexFresh(dex.data.asOf) ? dex.data : null;
  const fast = !command.error && command.data?.tradingAuthority === false ? command.data.fast : null;
  const fallback = snapshot && source === 'market' ? {
    sourceAsOf: snapshot.asOf,
    candidates: snapshot.pairs
      .filter((pair) => pair.pairCreatedAt !== null && pair.pairCreatedAt <= snapshot.asOf && snapshot.asOf - pair.pairCreatedAt <= 24 * 60 * 60_000)
      .map((pair) => ({
        symbol: pair.baseSymbol, chainId: pair.chainId, pairAddress: pair.pairAddress, liquidityUsd: pair.liquidityUsd,
        ageMs: snapshot.asOf - pair.pairCreatedAt!, safetyStatus: pair.safety.status, reasons: pair.safety.reasons,
      }))
      .sort((a, b) => a.ageMs - b.ageMs).slice(0, 20),
  } : null;
  const result = source === 'command' ? fast && !fast.stale ? fast.result : null : fallback;
  const chains = [...new Set((result?.candidates ?? []).map((item) => item.chainId))].sort();
  const candidates = (result?.candidates ?? []).filter((item) => !chain || item.chainId === chain);
  const candidate = follow ? candidates[0] : candidates.find((item) => pairKey(item) === selected);
  const pair = candidate ? snapshot?.pairs.find((item) => pairKey(item) === pairKey(candidate)) : undefined;
  return <>
    <Card title="FAST market view" className="mia-market-chart" right={<label className="mia-follow">
      <input type="checkbox" checked={follow} onChange={(event) => {
        if (!event.target.checked) setSelected(candidate ? pairKey(candidate) : null);
        setFollow(event.target.checked);
      }} /> Follow MIA
    </label>}>
      {candidate && <div className="row between mia-chart-quote">
        <strong>{pair ? `${pair.baseName} · ${pair.baseSymbol} / ${pair.quoteSymbol}` : candidate.symbol}</strong>
        <Badge v={candidate.chainId} />
      </div>}
      {candidate && <dl className="mia-facts">
        <dt>Price (USD)</dt><dd>{pair && positive(pair.priceUsd) ? '$' + fmt.px(pair.priceUsd) : '—'}</dd>
        <dt>Liquidity at review</dt><dd>{fmt.usd(positive(candidate.liquidityUsd), 0)}</dd>
        <dt>Age at review</dt><dd>{candidate.ageMs === null ? '—' : `${Math.floor(candidate.ageMs / 60_000)} min`}</dd>
        <dt>Safety evidence</dt><dd><Badge v={candidate.safetyStatus} /></dd>
      </dl>}
      <div className="mia-chart-empty">
        <Icon name="chart" size={27} />
        <strong>{candidate ? 'Verified token candles unavailable' : 'Select a discovered token'}</strong>
        <span>{candidate ? 'FAST shows the recorded DEX snapshot for this pair.' : 'Pair details appear here as MIA discovers new listings.'}</span>
      </div>
      <Freshness at={pair ? snapshot?.asOf : result?.sourceAsOf} label={pair ? 'Quote' : 'Discovery review'} />
    </Card>
    {positions}
    {activity}
    <Card title="Deployment radar" className="mia-research" right={<Badge v="Research only" />}>
      <div role="region" aria-label="Deployment radar">
        <ErrorLine e={source === 'command' ? command.error : dex.error} />
        {!!chains.length && <label className="mia-network-filter">Network
          <select value={chain} onChange={(event) => { setChain(event.target.value); setFollow(true); }}>
            <option value="">All networks</option>
            {chains.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>}
        {candidates.length ? <ul className="mia-candidate-list">
          {candidates.map((item) => <li key={pairKey(item)}>
            <button type="button" aria-pressed={item === candidate} onClick={() => { setSelected(pairKey(item)); setFollow(false); }}>
              <strong>{item.symbol}</strong>
              <span className="hint">{item.chainId} · {fmt.usd(positive(item.liquidityUsd), 0)} liquidity</span>
              <Badge v={item.safetyStatus} />
            </button>
            {item === candidate && <details className="mia-research-detail"><summary>Review safety evidence</summary>
              <ul>{item.reasons.map((reason) => <li key={reason}>{reasonText(reason)}</li>)}</ul>
            </details>}
          </li>)}
        </ul> : <Empty>{result ? 'No new pairs in this research view.' : fast?.stale && fast.result ? 'DEX evidence is stale.' : 'Awaiting a DEX research snapshot.'}</Empty>}
      </div>
      <Link className="mia-panel-link" to="/scanner">Market scanner <Icon name="arrow" size={15} /></Link>
    </Card>
  </>;
}

type MarketList = { tickers: { symbol: string; instrumentId: string }[]; universe: string[] };

function DeepWorkspace({ source, positions, activity, paperPositions }: WorkspaceProps) {
  const [interval, setInterval] = useState<Timeframe>('1h');
  const [symbol, setSymbol] = useState('BTCUSDT');
  const { data: markets, error } = useApi<MarketList>('/api/markets', { topics: ['ticker'], every: 60_000 });
  const universe = new Set(!error ? markets?.universe ?? [] : []);
  const trackedSymbols = (markets?.tickers ?? []).filter((ticker) => universe.has(ticker.instrumentId)).map((ticker) => ticker.symbol);
  const symbols = [...new Set(['BTCUSDT', symbol, ...trackedSymbols])];
  const command = useApi<ResearchSnapshot>(source === 'command' ? '/api/choice/dual/status' : null,
    { topics: ['bot', 'health'], every: 30_000 });
  return <DeepEvidenceWorkspace symbol={symbol} interval={interval}
    positions={positions} activity={activity} paperPositions={paperPositions} research={command.error ? null : command.data}
    marketPicker={<label className="mia-network-filter">Spot market
      <select value={symbol} onChange={(event) => setSymbol(event.target.value)}>
        {symbols.map((item) => <option key={item} value={item}>{item}</option>)}
      </select>
    </label>}
    timeframePicker={<div className="mia-segment mia-timeframes" role="group" aria-label="Chart timeframe">
      {timeframes.map((value) => <button type="button" key={value} aria-pressed={value === interval} onClick={() => setInterval(value)}>{value}</button>)}
    </div>} />;
}

function DeepEvidenceWorkspace({ symbol, interval, positions, activity, research, marketPicker, timeframePicker, paperPositions }: {
  symbol: string; interval: Timeframe; positions: ReactNode; activity: ReactNode; research: ResearchSnapshot | null;
  marketPicker: ReactNode; timeframePicker: ReactNode; paperPositions?: readonly SpotPosition[];
}) {
  const { data, loading, error } = useApi<InstrumentSnapshot>(`/api/instrument/${encodeURIComponent(symbol)}?interval=${interval}`,
    { topics: ['scan'], every: 30_000, isolatePath: true });
  const deep = research?.tradingAuthority === false ? research.deep : null;
  const instrument = error ? undefined : data?.instrument?.id;
  const positionLevels = useMemo(() => instrument ? (paperPositions ?? [])
    .filter((position) => position.instrument === instrument)
    .flatMap((position) => [
      { price: position.entry_price, title: 'Paper entry', color: '#49a9f6' },
      { price: position.stop_price, title: 'Paper stop', color: '#ec6e75' },
      ...position.targets.targets.filter((target) => !target.done).map((target) =>
        ({ price: target.price, title: 'Paper target', color: '#a78bfa' })),
    ]) : [], [instrument, paperPositions]);
  return <>
    <Card title="DEEP spot chart" className="mia-market-chart" right={timeframePicker}>
      {marketPicker}
      <ErrorLine e={error} />
      <MarketWindow data={error ? null : data} loading={loading} symbol={symbol} interval={interval} positionLevels={positionLevels} />
      <Link className="mia-panel-link" to={`/terminal/${encodeURIComponent(symbol)}`}>Market Terminal <Icon name="arrow" size={15} /></Link>
    </Card>
    {positions}
    {activity}
    <Card title="Strategy architect" className="mia-research" right={<Badge v="Research only" />}>
      <div role="region" aria-label="Strategy architect">
        <SpotEvidence snapshot={error ? null : data} symbol={symbol} interval={interval} />
        {deep && <details className="mia-research-detail"><summary>Perpetual futures research</summary>
          {deep.result && !deep.stale && !deep.error ? <DeepEvidence result={deep.result} />
            : <Empty>{deep.result ? 'Futures evidence is stale or expired.' : 'Awaiting a futures research snapshot.'}</Empty>}
        </details>}
      </div>
      <Link className="mia-panel-link" to="/ditas">Decision intelligence <Icon name="arrow" size={15} /></Link>
    </Card>
  </>;
}
