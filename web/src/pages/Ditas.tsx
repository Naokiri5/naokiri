import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, fmt, useApi } from '../api';
import { Badge, Card, Empty, ErrorLine, Modal, Page, Stat, Tabs } from '../ui';

const tabs = ['Overview', 'Decision ledger', 'Decision Twin', 'Strategy passports', 'Calibration', 'Execution quality', 'Intelligence evaluation', 'Foundation coverage'];
const count = (v: unknown) => Array.isArray(v) ? v.length : typeof v === 'number' ? v : 0;

/** Read-only DITAS evidence. No control, strategy promotion, simulation or execution authority. */
export function Ditas() {
  const [cohort, setCohort] = useState('');
  const { data, error, loading, reload } = useApi(`/api/ditas${cohort ? `?cohort=${encodeURIComponent(cohort)}` : ''}`, { topics: ['scan', 'decision', 'order', 'position', 'mode'], every: 30_000 });
  const [tab, setTab] = useState(tabs[0]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [detail, setDetail] = useState<{ title: string; value: unknown } | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const inspectEvent = async (id: string) => {
    setOpening(id); setDetailError(null);
    try { setDetail({ title: 'Decision evidence and market snapshot', value: await api(`/api/ditas/events/${encodeURIComponent(id)}`) }); }
    catch (e: any) { setDetailError(e.message); }
    finally { setOpening(null); }
  };
  const counts = data?.counts;
  const reportedCalibration = data?.calibration;
  const pendingCalibration = (reportedCalibration?.cohort ?? '') !== cohort;
  const calibration = pendingCalibration ? undefined : reportedCalibration;
  const calibrationStatus = pendingCalibration ? (error && !loading ? 'UNAVAILABLE' : 'LOADING') : calibration?.status ?? 'UNCALIBRATED';
  return <Page title="DITAS · Decision intelligence" sub="Inspect the evidence behind decisions, strategy health and hypothetical alternatives. Every result is tied to stored records."
    right={<><Badge v={data?.controls?.mode ?? 'OBSERVE'} /><Link className="pill" to="/risk">Risk & emergency controls</Link><button className="sm" onClick={() => { reload(); setRefreshKey((k) => k + 1); }} disabled={loading}>Refresh</button></>}>
    <ErrorLine e={error} /><ErrorLine e={detailError} />
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
      {(data.events ?? []).map((e: any) => <tr key={e.id}><td>{fmt.time(e.createdAt)}</td><td><Badge v={e.kind} /></td><td>{e.instrumentId}</td><td>{e.strategyId ?? '—'}</td><td><button className="sm" disabled={opening === e.id} onClick={() => inspectEvent(e.id)}>{opening === e.id ? 'Loading…' : 'Inspect decision'}</button></td></tr>)}
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
    {tab === 'Intelligence evaluation' && <IntelligenceEvaluation refreshKey={refreshKey} />}
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
    {detail && <Modal title={detail.title} onClose={() => setDetail(null)}><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: '65vh', overflowY: 'auto', fontSize: 12 }}>{JSON.stringify(detail.value, null, 2)}</pre></Modal>}
  </Page>;
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

/** One-line summary of a measured area; the full metrics stay available under "Details". */
function evaluationSummary(a: any): string {
  const m = a.metrics; if (!m) return '';
  const pct = (x: number) => `${fmt.num(x * 100, 1)}%`, ci = (v: any, f: (x: number) => string) => `${f(v.mean ?? v.rate)} (95% ${f(v.lower)} to ${f(v.upper)})`;
  const r = (x: number) => `${fmt.num(x, 2)}R`;
  switch (a.area) {
    case 'DIRECTIONAL': return `Gross win rate ${ci(m.grossWinRate, pct)}`;
    case 'PROBABILITY': return m.cohorts.map((c: any) => `${c.cohort}: Brier ${fmt.num(c.brierScore, 3)} (n=${c.sample})`).join(' | ');
    case 'ENTRY': return `Adverse slippage ${ci(m.adverseSlippageBps, (x) => `${fmt.num(x, 1)} bps`)}, p90 ${fmt.num(m.p90Bps, 1)} bps`;
    case 'EXIT': return `Captured ${ci(m.meanCaptureOfFavourableMove, pct)} of the favourable move`;
    case 'REGIME': return m.regimes.map((g: any) => `${g.regime}: ${g.netR ? r(g.netR.mean) : 'needs evidence'} (n=${g.sample})`).join(' | ');
    case 'PERFORMANCE': return `Net expectancy ${ci(m.netExpectancyR, r)}, max drawdown ${r(m.maxDrawdownR)}`;
    default: return '';
  }
}

/** Six kinds of accuracy from verified evidence only; areas below their minimum sample say so instead of guessing. */
function IntelligenceEvaluation({ refreshKey }: { refreshKey: number }) {
  const { data, error, loading, reload } = useApi<any>('/api/ditas/evaluation', { topics: ['position'] });
  useEffect(() => { if (refreshKey) reload(); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps -- the page Refresh button also reloads this panel
  return <Card title="BrainOS intelligence evaluation" right={<Badge v={data?.label ?? 'PAPER'} tone="b-violet" />} flush>
    <ErrorLine e={error} />
    {!data && loading && <div role="status" aria-live="polite"><Empty>Loading evaluation evidence...</Empty></div>}
    {data && <div className="tablewrap"><table><thead><tr><th>Accuracy</th><th>Status</th><th>Evidence</th><th>Result</th></tr></thead><tbody>
      {data.areas.map((a: any) => <tr key={a.area}><td><b>{a.area}</b><div className="hint">{a.question}</div></td>
        <td><Badge v={a.status} tone={a.status === 'MEASURED' ? undefined : 'b-warn'} /></td>
        <td className="mono">{a.sample} / {a.minimumSample}</td>
        <td>{a.metrics ? <>{evaluationSummary(a)}<details><summary className="hint">Details</summary><pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{JSON.stringify(a.metrics, null, 2)}</pre></details></> : <span className="hint">{a.note}</span>}</td></tr>)}
    </tbody></table></div>}
    {data && <ul className="hint" style={{ padding: '8px 28px' }}>{data.limitations.map((l: string) => <li key={l}>{l}</li>)}</ul>}
  </Card>;
}
