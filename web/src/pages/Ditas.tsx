import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fmt, useApi } from '../api';
import { Badge, Card, Empty, ErrorLine, Modal, Page, Stat, Tabs } from '../ui';

const tabs = ['Overview', 'Decision ledger', 'Decision Twin', 'Strategy passports', 'Calibration', 'Execution quality', 'Foundation coverage'];
const count = (v: unknown) => Array.isArray(v) ? v.length : typeof v === 'number' ? v : 0;
type Detail = { eventId: string } | { title: string; value: unknown };

/** Read-only DITAS evidence. No control, strategy promotion, simulation or execution authority. */
export function Ditas() {
  const [cohort, setCohort] = useState('');
  const { data, error, loading, reload } = useApi(`/api/ditas${cohort ? `?cohort=${encodeURIComponent(cohort)}` : ''}`, { topics: ['scan', 'decision', 'order', 'position', 'mode'], every: 30_000 });
  const [tab, setTab] = useState(tabs[0]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [detail, setDetail] = useState<Detail | null>(null);
  const counts = data?.counts;
  const reportedCalibration = data?.calibration;
  const pendingCalibration = (reportedCalibration?.cohort ?? '') !== cohort;
  const calibration = pendingCalibration ? undefined : reportedCalibration;
  const calibrationStatus = pendingCalibration ? (error && !loading ? 'UNAVAILABLE' : 'LOADING') : calibration?.status ?? 'UNCALIBRATED';
  return <Page title="DITAS · Decision intelligence" sub="Inspect the evidence behind decisions, strategy health and hypothetical alternatives. Every result is tied to stored records."
    right={<><Badge v={data?.controls?.mode ?? 'OBSERVE'} /><Link className="pill" to="/risk">Risk & emergency controls</Link><button className="sm" onClick={() => { reload(); setRefreshKey((k) => k + 1); }} disabled={loading}>Refresh</button></>}>
    <ErrorLine e={error} />
    <div className="banner info">Research and paper trading. Decision Twin results are hypothetical simulations; rule strength and specialist agreement are not calibrated win probabilities. Live execution remains locked.</div>
    <div className="grid g4" style={{ marginBottom: 14 }}>
      <Stat k="Decision events" v={counts?.events ?? '—'} s="Append-only decision history" />
      <Stat k="Market snapshots" v={counts?.snapshots ?? '—'} s="Evidence available at the decision time" />
      <Stat k="Decision Twin runs" v={counts?.twins ?? '—'} s="Hypothetical; separate from paper fills" />
      <Stat k="Forecast outcomes" v={counts?.outcomes ?? '—'} s={`${counts?.forecasts ?? 0} probability forecasts recorded`} />
    </div>
    <Tabs tabs={tabs} value={tab} onChange={setTab} />
    {!data && !error && <Empty>Loading DITAS records…</Empty>}
    {data && tab === 'Overview' && <div className="col" style={{ gap: 14 }}>
      <div className="grid g2">
        <Card title="Actual portfolio · PAPER" right={<Badge v="PAPER" tone="b-violet" />}>
          <div className="kv"><span>Recorded orders</span><span>{count(data.actual?.orders)}</span><span>Recorded fills</span><span>{count(data.actual?.fills)}</span><span>Closed positions</span><span>{count(data.actual?.closedPositions)}</span><span>Realized PnL</span><span>{fmt.usd(data.actual?.realizedPnl)}</span><span>Fees</span><span>{fmt.usd(data.actual?.fees)}</span></div>
          <p className="hint">Paper execution records from the existing OMS and portfolio ledger. Simulated Decision Twin returns are excluded.</p>
          <Link to="/history">Inspect orders and fills</Link>
        </Card>
        <Card title="Calibration & operating state">
          <div className="col"><div className="row"><Badge v={calibrationStatus} tone="b-warn" /><Badge v={data.controls?.emergency ? 'EMERGENCY' : data.controls?.pausedNewOrders ? 'PAUSED' : 'MONITORING'} /></div>
            <div className="hint">{calibration?.note ?? 'Probability forecasts require observed outcomes and sufficient samples. Evidence scores are not converted into probabilities.'}</div>
            <div className="row"><Link to="/risk">Risk Center</Link><Link to="/intelligence">Agent evidence</Link><Link to="/qhef">Performance</Link><Link to="/qa">Release gates</Link></div></div>
        </Card>
      </div>
      <Card title="Market data truth" flush><div className="tablewrap"><table><thead><tr><th>Instrument</th><th>Data status</th><th>Validation issues</th></tr></thead><tbody>
        {(data.dataHealth ?? []).map((d: any) => <tr key={d.instrumentId}><td>{d.instrumentId}</td><td><Badge v={d.status} /></td><td>{d.issues?.join('; ') || 'No validation issue reported'}</td></tr>)}
      </tbody></table>{!data.dataHealth?.length && <Empty>No market data loaded. No health status is inferred.</Empty>}</div></Card>
      <Card title="Stored market fingerprints" flush><div className="tablewrap"><table><thead><tr><th>Instrument</th><th>Recorded</th><th>Evidence</th></tr></thead><tbody>
        {(data.fingerprints ?? []).map((f: any, i: number) => <tr key={f.id ?? i}><td>{f.instrumentId ?? f.instrument ?? 'See stored record'}</td><td>{fmt.time(f.createdAt ?? f.asOf)}</td><td><button className="sm" onClick={() => setDetail({ title: 'Market DNA fingerprint', value: f })}>Inspect fingerprint</button></td></tr>)}
      </tbody></table>{!data.fingerprints?.length && <Empty>No stored fingerprints yet. Missing fundamentals and other inputs remain explicit.</Empty>}</div></Card>
    </div>}
    {data && tab === 'Decision ledger' && <Card title="Permanent decision memory" flush><div className="tablewrap"><table><thead><tr><th>When</th><th>Event</th><th>Instrument</th><th>Strategy</th><th>Evidence</th></tr></thead><tbody>
      {(data.events ?? []).map((e: any) => <tr key={e.id}><td>{fmt.time(e.createdAt)}</td><td><Badge v={e.kind} /></td><td>{e.instrumentId}</td><td>{e.strategyId ?? '—'}</td><td><button className="sm" onClick={() => setDetail({ eventId: e.id })}>Inspect decision</button></td></tr>)}
    </tbody></table>{!data.events?.length && <Empty>No DITAS events recorded yet. Earlier decisions are not assigned fabricated snapshots.</Empty>}</div></Card>}
    {data && tab === 'Decision Twin' && <Card title="Shadow & counterfactual portfolios · HYPOTHETICAL" right={<Badge v="HYPOTHETICAL" tone="b-warn" />}>
      <p className="hint">Stored simulations use the original decision evidence and explicit fee, spread, slippage and fill assumptions. Hypothetical orders do not create paper positions or change strategy settings.</p>
      <div className="tablewrap"><table><thead><tr><th>Recorded</th><th>Shadow result</th><th>Delayed entry alternative</th><th>WAIT baseline</th><th>Assumptions</th></tr></thead><tbody>
        {(data.twins ?? []).map((t: any) => <tr key={t.id}><td>{fmt.time(t.createdAt)}<div className="hint">Event {t.eventId}</div></td><td><Badge v={t.result?.shadow?.state ?? 'UNKNOWN'} /><div>{fmt.usd(t.result?.shadow?.netPnL)}</div></td><td><Badge v={t.result?.counterfactual?.state ?? 'UNKNOWN'} /><div>{fmt.usd(t.result?.counterfactual?.netPnL)}</div></td><td>{fmt.usd(t.result?.waitBaseline?.netPnL)}</td><td><button className="sm" onClick={() => setDetail({ title: 'Hypothetical Decision Twin · assumptions and alternatives', value: t.result })}>Inspect simulation</button></td></tr>)}
      </tbody></table></div>
      {!data.twins?.length && <Empty>No Decision Twin results recorded. No simulated performance is displayed.</Empty>}
    </Card>}
    {data && tab === 'Strategy passports' && <div className="col" style={{ gap: 14 }}>{(data.passports ?? []).map((p: any) => <Card key={p.id ?? p.strategyId} title={`${p.name ?? p.id ?? p.strategyId} · v${p.version ?? p.strategyVersion}`} right={<Badge v={p.ditasState ?? p.currentStatus ?? 'RESEARCH'} />}>
      <div className="col"><div>{p.description}</div><div className="row"><Badge v={p.paperHealth?.status ?? 'INSUFFICIENT_SAMPLE'} /><span className="hint">{p.paperHealth?.samples ?? 0} recent version-matched paper outcomes · minimum {p.paperHealth?.minimumSamples ?? 30}</span></div><div className="hint">{p.paperHealth?.recommendation ?? 'Inspect the passport for rules, evidence, approval status and known limitations.'}</div><div className="row"><button className="sm" onClick={() => setDetail({ title: 'Strategy passport and health', value: p })}>Inspect passport</button><Link to="/lab">Open Strategy Lab</Link></div></div>
    </Card>)}{!data.passports?.length && <Empty>No strategy passports available.</Empty>}</div>}
    {tab === 'Execution quality' && <ExecutionQuality refreshKey={refreshKey} />}
    {data && tab === 'Calibration' && <Card title="Probability calibration" right={<Badge v={calibrationStatus} tone="b-warn" />}>
      <div className="col"><label className="col" style={{ minWidth: 0 }}>Forecast cohort
          <select aria-label="Forecast cohort" value={cohort} onChange={e => setCohort(e.target.value)} style={{ maxWidth: '100%', minWidth: 0 }}>
            <option value="">Select a cohort to evaluate</option>
            {(reportedCalibration?.cohorts ?? []).map((c: any) => <option key={c.cohort} value={c.cohort}>{c.cohort} · {c.n} forecasts</option>)}
          </select>
        </label>
        <div className="hint">Calibration evaluates stored probability forecasts against outcomes. It does not turn chart confidence, opportunity scores or votes into win probabilities.</div>
        <div className="kv"><span>Matched outcomes</span><span>{calibration?.sample ?? calibration?.sampleSize ?? 0}</span><span>Brier score</span><span>{fmt.num(calibration?.brierScore, 4)}</span><span>Log loss</span><span>{fmt.num(calibration?.logLoss, 4)}</span><span>Expected calibration error</span><span>{fmt.num(calibration?.ece, 4)}</span></div>
        <div className="hint">{calibration?.note ?? 'An insufficient sample remains UNCALIBRATED. No production model is promoted automatically.'}</div>
        <div className="tablewrap"><table><thead><tr><th>Probability bin</th><th>Outcomes</th><th>Mean prediction</th><th>Observed frequency</th><th>95% Wilson interval</th><th>Evidence status</th></tr></thead><tbody>
          {(calibration?.bins ?? []).map((b: any) => <tr key={b.lower}><td>{fmt.num(b.lower, 1)}–{fmt.num(b.upper, 1)}</td><td>{b.count}</td><td>{fmt.num(b.prediction, 3)}</td><td>{fmt.num(b.observed, 3)}</td><td>{b.wilson95 ? `${fmt.num(b.wilson95[0], 3)}–${fmt.num(b.wilson95[1], 3)}` : '—'}</td><td><Badge v={b.status} /></td></tr>)}
        </tbody></table></div>
        {(calibration?.uncertainty ?? []).map((u: string) => <div className="hint warn" key={u}>{u}</div>)}
        <button className="sm" disabled={!calibration} onClick={() => setDetail({ title: 'Calibration metrics, reliability bins and uncertainty', value: calibration })}>Inspect calibration evidence</button>
      </div>
    </Card>}
    {data && tab === 'Foundation coverage' && <Card title="Implementation coverage" flush><div className="tablewrap"><table><thead><tr><th>Foundation</th><th>Status</th><th>Scope and limitations</th></tr></thead><tbody>
      {(data.coverage ?? []).map((c: any) => <tr key={c.foundation}><td>{c.foundation}</td><td><Badge v={c.status} /></td><td>{c.detail}</td></tr>)}
    </tbody></table></div><div style={{ padding: 14 }} className="hint">A passing test suite does not certify live trading, calibrated forecasts or strategy profitability. See the release gates for outstanding evidence.</div></Card>}
    {detail && ('eventId' in detail
      ? <Modal title="Decision evidence and market snapshot" onClose={() => setDetail(null)}>
        <DecisionEvidence key={detail.eventId} eventId={detail.eventId} />
      </Modal>
      : <Modal title={detail.title} onClose={() => setDetail(null)}><DetailJson value={detail.value} /></Modal>)}
  </Page>;
}

type EvidenceSource = { kind: 'TICKER' | 'BOOK' } & (
  | { status: 'UNKNOWN' | 'STALE'; reason: string }
  | {
    status: 'AVAILABLE'; originId: string; dependencyGroup: string;
    eventTimeMs: number | null; receivedTimeMs: number | null; requestStartedAtMs: number | null;
  }
);
interface BehaviorEvidence {
  asOf: number;
  status: 'AVAILABLE' | 'UNKNOWN';
  dataQuality: 'OK' | 'WARN' | 'FAIL';
  evidence: EvidenceSource[];
}

const evidenceReasons: Record<string, string> = {
  TICKER_MISSING_OR_INVALID: 'The snapshot has no valid ticker.',
  TICKER_IDENTITY_MISMATCH: 'The ticker does not match the saved instrument.',
  TICKER_INVALID_SPREAD_OR_CLOCK: 'The saved ticker has an invalid spread or timestamp.',
  TICKER_EXPIRED_AT_CAPTURE: 'The ticker was stale at capture.',
  BOOK_MISSING_OR_INVALID: 'The snapshot has no valid order book.',
  BOOK_INVALID_DEPTH_OR_CLOCK: 'The saved order book has invalid depth or timing.',
  BOOK_EXPIRED_AT_CAPTURE: 'The order book was stale at capture.',
  PRIMARY_IDENTITY_UNVERIFIED: 'A valid ticker is required to attribute the saved order book.',
  SNAPSHOT_QUALITY_FAILED: 'The snapshot failed market data quality checks.',
};

function DecisionEvidence({ eventId }: { eventId: string }) {
  const path = `/api/ditas/events/${encodeURIComponent(eventId)}`;
  const detail = useApi<unknown>(path);
  const evidence = useApi<BehaviorEvidence>(`${path}/behavior-evidence`);
  const report = evidence.data;
  const time = (ts: number | null) => ts === null ? 'Unknown' : fmt.time(ts);
  return <div className="col" style={{ gap: 14 }}>
    <section aria-labelledby="behavior-evidence-heading" className="col" style={{ gap: 10 }}>
      <div className="row between">
        <h3 id="behavior-evidence-heading">B-MIND evidence</h3>
        <Badge v="Research only" />
      </div>
      {evidence.error && <ErrorLine e={`B-MIND evidence unavailable. ${evidence.error}`} />}
      {!report && !evidence.error && <p role="status">Loading B-MIND evidence…</p>}
      {report && <div className="col" style={{ gap: 12 }}>
        <div className="kv">
          <span>Captured at</span><span>{fmt.time(report.asOf)}</span>
          <span>Evidence</span><span><Badge v={report.status} /></span>
          <span>Data quality</span><span><Badge v={report.dataQuality} /></span>
        </div>
        {report.evidence.map(source => <div className="col" key={source.kind} style={{ gap: 4 }}>
          <div className="row"><strong>{source.kind === 'TICKER' ? 'Ticker' : 'Order book'}</strong><Badge v={source.status} /></div>
          {source.status === 'AVAILABLE' ? <div className="kv" style={{ overflowWrap: 'anywhere' }}>
            <span>Dependency group</span><span>{source.dependencyGroup}</span>
            <span>Origin ID</span><code>{source.originId}</code>
            <span>Event time</span><span>{time(source.eventTimeMs)}</span>
            <span>Received at</span><span>{time(source.receivedTimeMs)}</span>
            {source.requestStartedAtMs !== null && <><span>Request started</span><span>{time(source.requestStartedAtMs)}</span></>}
          </div> : <div className="hint">{evidenceReasons[source.reason] ?? 'Evidence is unavailable for this source.'}</div>}
        </div>)}
      </div>}
    </section>
    <ErrorLine e={detail.error} />
    {!detail.data && !detail.error && <p role="status">Loading saved decision…</p>}
    {detail.data != null && <DetailJson value={detail.data} />}
  </div>;
}

function DetailJson({ value }: { value: unknown }) {
  return <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '65vh', overflowY: 'auto', fontSize: 12 }}>{JSON.stringify(value, null, 2)}</pre>;
}

/** Read-only paper execution quality (actual paper OMS orders and fills only; never hypothetical Twin results). */
function ExecutionQuality({ refreshKey }: { refreshKey: number }) {
  const { data, error, loading, reload } = useApi<any>('/api/ditas/execution?limit=100', { topics: ['order', 'position'] });
  useEffect(() => { if (refreshKey) reload(); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps -- the page Refresh button also reloads this panel
  const rows: any[] = data?.orders ?? [];
  return <Card title="Paper execution quality" right={<Badge v={data?.label ?? 'PAPER'} tone="b-violet" />} flush>
    <ErrorLine e={error} />
    {!data && loading && <div role="status" aria-live="polite"><Empty>Loading paper execution records…</Empty></div>}
    <div className="tablewrap"><table><thead><tr><th>Order</th><th>Purpose</th><th>Status</th><th>Filled</th><th>Avg fill</th><th>Expected</th><th>Adverse slippage</th><th>Fees</th><th>First fill</th></tr></thead><tbody>
      {rows.map((o) => <tr key={o.orderId}><td><b>{o.instrumentId.split(':').pop()}</b> <Badge v={o.side} /><div className="hint mono">{o.orderId}</div></td><td>{o.purpose}</td><td><Badge v={o.status} /></td>
        <td className="mono">{fmt.num(o.filledQty, 6)} / {fmt.num(o.requestedQty, 6)}</td><td className="mono">{fmt.px(o.averageFillPrice)}</td><td className="mono">{fmt.px(o.expectedPrice)}</td>
        <td className="mono">{o.adverseSlippageBps == null ? <span className="hint">n/a</span> : `${fmt.num(o.adverseSlippageBps, 1)} bps`}</td><td className="mono">{fmt.usd(o.fees, 4)}</td>
        <td className="mono">{o.firstFillDelayMs == null ? '—' : `${o.firstFillDelayMs} ms`}</td></tr>)}
    </tbody></table></div>
    {data && !rows.length && <Empty>No paper orders yet.</Empty>}
    {data && <ul className="hint" style={{ padding: '8px 28px' }}>{data.limitations.map((l: string) => <li key={l}>{l}</li>)}</ul>}
  </Card>;
}
