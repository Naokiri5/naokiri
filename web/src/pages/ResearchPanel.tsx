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
  knownQuote?: boolean;
  mintObservation?: { status: string; slot: number; checkedAt: number } | null;
  reasons: string[];
};
type FastResult = { sourceAsOf: number; candidates: Candidate[]; mintSourceStatus?: 'NOT_CHECKED' | 'OBSERVED' | 'UNAVAILABLE' };
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
type ForecastScore = { brierScore: number; logLoss: number };
type DirectionForecast = {
  targetAt: number;
  deadbandBps: number;
  probabilities: { BULLISH: number; SIDEWAYS: number; BEARISH: number };
  empiricalPriceRange: { lower: number; upper: number };
  historicalEvaluation: { sampleCount: number; model: ForecastScore; uniform: ForecastScore };
  calibrationStatus: 'MEASURED_NOT_CERTIFIED';
  tradingAuthority: false;
};
type DeepResult = {
  symbol: string;
  market: 'CRYPTO_PERPETUAL_FUTURES';
  tradingAuthority: false;
  source: string;
  asOf: number;
  state: string;
  reason: string;
  chartEvidence: Record<Timeframe, { status: string; trend: string }>;
  marketContext?: {
    funding: { rate: number; localAt: number } | null;
    openInterest: { quantity: number; localAt: number } | null;
  };
  scenarioAnalysis?: {
    calibration: 'UNCALIBRATED';
    tradingAuthority: false;
    relativeWeights: { bullish: number; sideways: number; bearish: number };
  } | null;
  directionForecasts?: Partial<Record<Timeframe, DirectionForecast>>;
  plan: {
    direction: string;
    entryTrigger: string;
    invalidationLevel: number;
    expiresAt: number;
    requiredMissing: readonly string[];
  } | null;
};
type DeepStatus = { symbol: string | null; stale: boolean; error: string | null; result: DeepResult | null };
type DeepInstrument = DeepStatus & { instrumentId: string; symbol: string };
type ResearchSnapshot = {
  tradingAuthority: false;
  fast: { stale: boolean; result: FastResult | null };
  deep: DeepStatus;
  deepInstruments?: readonly DeepInstrument[];
};
const reasonText = (reason: string) => reason.replaceAll('_', ' ').toLowerCase();
const pairKey = (item: { chainId: string; pairAddress: string }) => item.chainId + ':' + item.pairAddress;
const percentage = (share: number, precision = 0) => `${fmt.num(share * 100, precision)}%`;

function DeepEvidence({ result }: { result: DeepResult }) {
  const [horizon, setHorizon] = useState<Timeframe>('15m');
  const plan = result.plan;
  const funding = result.marketContext?.funding;
  const openInterest = result.marketContext?.openInterest;
  const scenario = result.scenarioAnalysis;
  const weights = scenario?.calibration === 'UNCALIBRATED' && scenario.tradingAuthority === false ? scenario.relativeWeights : null;
  const direction = result.directionForecasts?.[horizon];
  const forecast = direction?.calibrationStatus === 'MEASURED_NOT_CERTIFIED' && direction.tradingAuthority === false
    && direction.targetAt > Date.now() ? direction : null;
  return <div className="col mia-research-detail">
    <div className="row between"><strong>{result.symbol} perpetual</strong><Badge v={result.state} /></div>
    <div className="row">{timeframes.map((interval) => <Badge key={interval} v={interval + ' ' + result.chartEvidence[interval].trend} />)}</div>
    <dl className="mia-facts">
      <dt>Observed funding rate</dt><dd>{fmt.pct(funding ? funding.rate * 100 : null, 4)} {funding && <Freshness at={funding.localAt} />}</dd>
      <dt>Observed open interest</dt><dd>{fmt.num(openInterest?.quantity, 1)} {openInterest && <Freshness at={openInterest.localAt} />}</dd>
    </dl>
    {!!result.directionForecasts && <label className="mia-network-filter">Forecast horizon
      <select value={horizon} onChange={(event) => setHorizon(event.target.value as Timeframe)}>
        {timeframes.map((interval) => <option key={interval}>{interval}</option>)}
      </select>
    </label>}
    {forecast ? <dl className="mia-facts" aria-label={`${horizon} direction forecast`}>
      <dt>{horizon} direction forecast · Measured, uncertified</dt>
      <dd>Bullish {percentage(forecast.probabilities.BULLISH, 1)} · Sideways {percentage(forecast.probabilities.SIDEWAYS, 1)} · Bearish {percentage(forecast.probabilities.BEARISH, 1)}</dd>
      <dt>10th–90th percentile price range</dt><dd>{fmt.px(forecast.empiricalPriceRange.lower)}–{fmt.px(forecast.empiricalPriceRange.upper)} · target {fmt.time(forecast.targetAt)}</dd>
      <dt>Sideways threshold</dt><dd>±{forecast.deadbandBps} bps from the reference close</dd>
      <dt>Historical Brier score</dt><dd>{fmt.num(forecast.historicalEvaluation.model.brierScore, 3)} model / {fmt.num(forecast.historicalEvaluation.uniform.brierScore, 3)} uniform · {forecast.historicalEvaluation.sampleCount} observations</dd>
      <dt>Historical log loss</dt><dd>{fmt.num(forecast.historicalEvaluation.model.logLoss, 3)} model / {fmt.num(forecast.historicalEvaluation.uniform.logLoss, 3)} uniform</dd>
    </dl> : <div className="hint">Awaiting a current {horizon} direction forecast.</div>}
    {weights && <dl className="mia-facts">
      <dt>Scenario weights · Uncalibrated</dt><dd>Bullish {percentage(weights.bullish)} · Sideways {percentage(weights.sideways)} · Bearish {percentage(weights.bearish)}</dd>
    </dl>}
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

function FuturesResearch({ research }: { research: ResearchSnapshot | null }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  if (research?.tradingAuthority !== false) return null;
  const instruments = research.deepInstruments;
  const selection = instruments?.find((instrument) => instrument.instrumentId === selectedId) ?? instruments?.[0];
  const row = instruments ? selection : research.deep;
  const result = row?.result;
  const now = Date.now();
  const matchesMarket = result?.market === 'CRYPTO_PERPETUAL_FUTURES' && result.symbol === row?.symbol && result.tradingAuthority === false;
  const stale = row?.stale || (result && (result.asOf > now || (result.plan && result.plan.expiresAt <= now)));
  let status = 'Awaiting a futures research snapshot.';
  if (row?.error) status = 'Futures research source unavailable.';
  else if (result && !matchesMarket) status = 'Futures evidence unavailable for this instrument.';
  else if (result && stale) status = 'Futures evidence is stale or expired.';
  return <details className="mia-research-detail"><summary>Perpetual futures research</summary>
    {instruments?.length && selection ? <label className="mia-network-filter">Futures instrument
      <select value={selection.instrumentId} onChange={(event) => setSelectedId(event.target.value)}>
        {instruments.map((instrument) => <option key={instrument.instrumentId} value={instrument.instrumentId}>{instrument.symbol}</option>)}
      </select>
    </label> : null}
    {result && matchesMarket && !stale && !row?.error ? <DeepEvidence result={result} /> : <Empty>{status}</Empty>}
  </details>;
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
  const [selected, setSelected] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const snapshot = !dex.error && dex.data && dexFresh(dex.data.asOf) ? dex.data : null;
  const fast = !command.error && command.data?.tradingAuthority === false ? command.data.fast : null;
  const fallback = snapshot && source === 'market' ? {
    sourceAsOf: snapshot.asOf,
    candidates: snapshot.pairs
      .filter((pair) => pair.chainId === 'solana' && pair.pairCreatedAt !== null && pair.pairCreatedAt <= snapshot.asOf && snapshot.asOf - pair.pairCreatedAt <= 24 * 60 * 60_000)
      .map((pair) => ({
        symbol: pair.baseSymbol, chainId: pair.chainId, pairAddress: pair.pairAddress, liquidityUsd: pair.liquidityUsd,
        ageMs: snapshot.asOf - pair.pairCreatedAt!, safetyStatus: pair.safety.status, reasons: pair.safety.reasons,
      }))
      .sort((a, b) => a.ageMs - b.ageMs).slice(0, 20),
  } : null;
  const result: FastResult | null = source === 'command' ? fast && !fast.stale ? fast.result : null : fallback;
  const candidates = (result?.candidates ?? []).filter((item) => item.chainId === 'solana');
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
        {candidate.mintObservation && <>
          <dt>Finalized mint check</dt><dd><Badge v={candidate.mintObservation.status} /> · Slot {fmt.num(candidate.mintObservation.slot, 0)}</dd>
        </>}
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
        {result?.mintSourceStatus === 'UNAVAILABLE' && <p className="hint">Solana mint checks are currently unavailable.</p>}
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
    positions={positions} activity={activity} paperPositions={paperPositions}
    // useApi(null) keeps its last data; show command research only while the command source is active and healthy.
    research={source === 'command' && !command.error ? command.data : null}
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
        <FuturesResearch research={research} />
      </div>
      <Link className="mia-panel-link" to="/ditas">Decision intelligence <Icon name="arrow" size={15} /></Link>
    </Card>
  </>;
}
