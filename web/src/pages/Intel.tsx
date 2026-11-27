import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, fmt, useApi } from '../api';
import { Badge, Card, Chg, Empty, ErrorLine, Page, Tabs, useSort, Action, Freshness, Modal } from '../ui';
import { StepUp } from './Trading';

export function Scanner() {
  const { data, error } = useApi('/api/scanner', { topics: ['scan', 'decision'], every: 30_000 });
  const [tab, setTab] = useState('Market board'); const [filter, setFilter] = useState(''); const nav = useNavigate();
  const [sym, setSym] = useState(''); const [ana, setAna] = useState<any>(null);
  const board = (data?.board ?? []).filter((r: any) => !filter || r.symbol.includes(filter.toUpperCase()));
  const { sorted, th } = useSort<any>(board, 'quoteVolume');
  return <Page title="AI Scanner" sub="Deep-tier universe (most liquid Binance spot pairs) evaluated on every closed 1h candle by 3 versioned strategies → 100-worker QCI → decision engine → risk gate. Scores are evidence summaries, never win probabilities."
    right={<><Freshness at={data?.lastScanAt} label="last scan" /><input placeholder="Analyze symbol…" value={sym} onChange={(e) => setSym(e.target.value)} style={{ width: 150 }} /><Action label="Analyze now" className="primary" disabled={!sym} run={async () => setAna(await api('/api/analyze', { body: { symbol: sym } }))} /></>}>
    <ErrorLine e={error} />
    <Tabs tabs={['Market board', `Decisions (${data?.decisions.length ?? 0})`, `Rejected (${data?.rejections.length ?? 0})`, 'Strategies']} value={tab.startsWith('Decisions') ? `Decisions (${data?.decisions.length ?? 0})` : tab.startsWith('Rejected') ? `Rejected (${data?.rejections.length ?? 0})` : tab} onChange={setTab} />
    {tab === 'Market board' && <Card title={`${board.length} instruments`} right={<input placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />} flush>
      <div className="tablewrap"><table><thead><tr>{th('symbol', 'Asset')}{th('price', 'Price', true)}{th('changePct', '24h', true)}{th('quoteVolume', 'Volume', true)}{th('regime', 'Regime')}<th>Safety</th><th>Data</th>{th('spreadBps', 'Spread', true)}{th('rsi1h', 'RSI 1h', true)}<th>Indicators</th><th>Signals / last decision</th></tr></thead>
        <tbody>{sorted.map((r: any) => <tr key={r.instrumentId} className="click" onClick={() => nav(`/terminal/${r.symbol}`)}>
          <td><b>{r.base}</b> <span className="faint">{r.symbol.replace(r.base, '')}</span></td><td className="num">{fmt.px(r.price)}</td><td className="num"><Chg v={r.changePct} /></td><td className="num">{fmt.big(r.quoteVolume)}</td>
          <td><Badge v={r.regime} /> {r.regimeStability && r.regimeStability !== 'STABLE' && <Badge v={r.regimeStability} title="Entries wait until the regime is confirmed for 3 closed candles" />}</td><td><Badge v={r.safety} /></td><td><Badge v={r.quality} title={r.qualityIssues.join('; ')} /></td><td className="num">{fmt.num(r.spreadBps, 1)}</td><td className="num">{fmt.num(r.rsi1h, 0)}</td>
          <td><span className="up">{r.bullish}↑</span> <span className="down">{r.bearish}↓</span></td>
          <td>{r.signals.map((s: string) => <Badge key={s} v={s} tone="b-violet" />)} {r.lastDecision && <Link to={`/decision/${r.lastDecision.id}`} onClick={(e) => e.stopPropagation()}><Badge v={r.lastDecision.decision} /> {r.lastDecision.score}</Link>}</td></tr>)}</tbody></table>
        {!sorted.length && <Empty>Waiting for the first scan cycle (market data loading)…</Empty>}</div></Card>}
    {tab.startsWith('Decisions') && <DecisionTable rows={data?.decisions ?? []} />}
    {tab.startsWith('Rejected') && <Card title="Rejection intelligence (Part 16.8)" flush><div className="tablewrap"><table><thead><tr><th>When</th><th>Asset</th><th>Stage</th><th>Reason</th></tr></thead><tbody>{(data?.rejections ?? []).map((r: any, i: number) => <tr key={i}><td className="faint">{fmt.ago(r.at)}</td><td><b>{r.symbol}</b></td><td><Badge v={r.stage} /></td><td>{r.reason}</td></tr>)}</tbody></table>{!data?.rejections.length && <Empty>No rejected candidates yet.</Empty>}</div></Card>}
    {tab.startsWith('Rejected') && <Card title="Waiting for capacity" right={<span className="hint">re-evaluated through the full risk gate after a position settles; expires with its candle</span>} flush><div className="tablewrap"><table><thead><tr><th>Asset</th><th>Strategy</th><th>Blocked by</th><th>Evaluations</th><th>Expires</th></tr></thead><tbody>{(data?.waitingCapacity ?? []).map((w: any) => <tr key={w.key}><td><b>{w.instrumentId}</b></td><td>{w.strategyId}</td><td>{w.reasons.join('; ')}</td><td className="num">{w.evaluations}</td><td className="faint">{new Date(w.expiresAt).toLocaleTimeString()}</td></tr>)}</tbody></table>{!data?.waitingCapacity?.length && <Empty>No signal is waiting for capacity.</Empty>}</div></Card>}
    {tab === 'Strategies' && <div className="grid g3">{(data?.strategies ?? []).map((s: any) => <Card key={s.id} title={`${s.name} v${s.version}`}><div className="col"><div className="muted">{s.description}</div><div className="kv"><span>Interval</span><span>{s.interval}</span><span>Regimes</span><span>{s.regimes.map((r: string) => <Badge key={r} v={r} />)}</span></div></div></Card>)}</div>}
    {ana && <Modal title="On-demand analysis" onClose={() => setAna(null)}>{ana.decision ? <DecisionView report={ana} /> : <AnalysisNoSignal a={ana} />}</Modal>}
  </Page>;
}
function AnalysisNoSignal({ a }: { a: any }) {
  return <div className="col"><div className="banner info">{a.reason}</div><div className="row"><Badge v={a.regime} /><Badge v={a.safety.status} /><Badge v={a.quality.status} /></div>
    <IndicatorGrid list={a.indicators} /></div>;
}
export function IndicatorGrid({ list }: { list: any[] }) {
  return <div className="tablewrap" style={{ maxHeight: 320 }}><table><thead><tr><th>Specialist</th><th>Indicator</th><th>TF</th><th className="num">Value</th><th>Reading</th></tr></thead><tbody>{list.map((x) => <tr key={x.id}><td className="faint mono">{x.id}</td><td>{x.name}</td><td>{x.interval}</td><td className="num">{x.value == null ? '—' : fmt.num(x.value, Math.abs(x.value) < 10 ? 3 : 1)}</td><td><span className={x.signal > 0.25 ? 'up' : x.signal < -0.25 ? 'down' : 'muted'}>{x.label}</span></td></tr>)}</tbody></table></div>;
}
export function DecisionTable({ rows }: { rows: any[] }) {
  const nav = useNavigate();
  return <Card flush><div className="tablewrap"><table><thead><tr><th>When</th><th>Asset</th><th>Strategy</th><th>Regime</th><th className="num">Score</th><th>QCI</th><th>Risk</th><th>Decision</th></tr></thead>
    <tbody>{rows.map((d) => <tr key={d.id} className="click" onClick={() => nav(`/decision/${d.id}`)}><td className="faint">{fmt.ago(d.createdAt)}</td><td><b>{d.asset}</b></td><td>{d.strategy.id}</td><td><Badge v={d.regime} /></td><td className="num">{d.score}</td><td><Badge v={d.consensus.state} /></td><td>{d.risk ? <Badge v={d.risk.decision} title={d.risk.reasonCodes.join('\n')} /> : <span className="faint">—</span>}</td><td><Badge v={d.decision} /></td></tr>)}</tbody></table>
    {!rows.length && <Empty>No candidates yet. Strategies fire only when their entry conditions are met on a closed 1h candle — most hours produce none, by design.</Empty>}</div></Card>;
}

export function DecisionPage() {
  const { id } = useParams(); const { data, error } = useApi(`/api/decisions/${id}`);
  return <Page title="Decision record" sub="Part 8.3 trade explanation · Part 16.10 opportunity report · Part 29.6 consensus record"><ErrorLine e={error} />{data && <DecisionView report={data.report} consensus={data.consensus} />}</Page>;
}
export function DecisionView({ report: r, consensus }: { report: any; consensus?: any }) {
  const [tab, setTab] = useState('Explanation');
  return <div className="col" style={{ gap: 14 }}>
    <div className="row"><h2 style={{ fontSize: 18 }}>{r.asset}</h2><Badge v={r.decision} /><Badge v={r.direction} tone={r.direction === 'LONG' ? 'b-good' : 'b-neutral'} /><Badge v={r.consensus.state} /><span className="muted">{r.strategy.id} v{r.strategy.version} · {r.regime} · {fmt.time(r.createdAt)}</span></div>
    <div className="banner info" style={{ marginBottom: 0 }}>{r.disclaimer}</div>
    <Tabs tabs={['Explanation', 'Pipeline steps', 'Score factors', 'QCI consensus', 'Indicators']} value={tab} onChange={setTab} />
    {tab === 'Explanation' && <div className="grid g2">
      <Card title="Trade plan"><div className="kv">
        <span>Market</span><span>{r.market} · {r.venue}</span><span>Final decision</span><span><b>{r.finalDecision}</b></span><span>Reason</span><span>{r.reason}</span>
        <span>Entry condition</span><span>{r.entryCondition}</span><span>Invalidation</span><span>{r.invalidation}</span>
        <span>Stop-loss</span><span className="mono">{fmt.px(r.stopLoss)}</span>
        <span>Take-profit</span><span className="mono">{r.takeProfit.map((t: any) => `${fmt.px(t.price)} (${t.r}R, ${t.fraction * 100}%)`).join(' · ')}</span>
        <span>Position size</span><span className="mono">{r.positionSize ? `${r.positionSize.qty} ≈ ${fmt.usd(r.positionSize.notional)} · max loss ${fmt.usd(r.positionSize.plannedMaxLoss)}` : 'not sized (not eligible for execution)'}</span>
        <span>Expected costs</span><span className="mono">fees {fmt.usd(r.expectedCosts.feesUsd)} · spread {fmt.num(r.expectedCosts.spreadBps, 1)}bps · slippage {fmt.num(r.expectedCosts.slippageBps, 1)}bps · {r.expectedCosts.costR ?? '—'}R · funding {r.expectedCosts.funding}</span>
        <span>Data freshness</span><span><Badge v={r.dataFreshness.status} /> quote {fmt.num((r.dataFreshness.quoteAgeMs ?? 0) / 1000, 0)}s · book {fmt.num((r.dataFreshness.bookAgeMs ?? 0) / 1000, 0)}s</span>
        <span>Opportunity score</span><span className="mono">{r.opportunity.score} <span className="faint">({r.opportunity.version})</span></span>
      </div></Card>
      <div className="col" style={{ gap: 14 }}>
        <Card title="Supporting evidence"><ul style={{ margin: 0, paddingLeft: 18 }}>{r.supportingEvidence.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></Card>
        <Card title="Opposing evidence"><ul style={{ margin: 0, paddingLeft: 18 }}>{r.opposingEvidence.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></Card>
        <Card title="Risk assessment"><ul style={{ margin: 0, paddingLeft: 18 }}>{r.riskAssessment.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul>{r.risk && <div className="row" style={{ marginTop: 8 }}>Risk gate: <Badge v={r.risk.decision} /> <span className="faint">policy v{r.risk.policyVersion} · trace {r.risk.traceId}</span></div>}</Card>
        <Card title="Missing information">{r.missingInformation.length ? <ul style={{ margin: 0, paddingLeft: 18 }}>{r.missingInformation.map((x: string, i: number) => <li key={i} className="muted">{x}</li>)}</ul> : <span className="muted">none</span>}</Card>
      </div></div>}
    {tab === 'Pipeline steps' && <Card flush><table><tbody>{r.steps.map((s: any) => <tr key={s.step}><td className="faint mono">{s.step}</td><td>{s.name}</td><td><Badge v={s.result} /></td><td className="muted">{s.detail}</td></tr>)}</tbody></table></Card>}
    {tab === 'Score factors' && <Card flush><table><thead><tr><th>Factor</th><th className="num">Weight</th><th className="num">Value</th><th>Basis</th></tr></thead><tbody>{r.opportunity.factors.map((f: any) => <tr key={f.factor}><td>{f.factor}{f.missing && <> <Badge v="MISSING" tone="b-warn" /></>}</td><td className="num">{(f.weight * 100).toFixed(0)}%</td><td className="num">{f.value}</td><td className="muted">{f.basis}</td></tr>)}</tbody></table></Card>}
    {tab === 'QCI consensus' && (consensus ? <ConsensusView c={consensus} /> : <Empty>Consensus record {r.consensus.id} — open from Decisions page for full detail.</Empty>)}
    {tab === 'Indicators' && <IndicatorGrid list={r.indicators} />}
  </div>;
}
export function ConsensusView({ c }: { c: any }) {
  const [domain, setDomain] = useState<string | null>(null);
  return <div className="col" style={{ gap: 14 }}>
    <div className="grid g4">
      <div className="card stat"><div className="bd"><div className="k">State</div><div className="v" style={{ fontSize: 15 }}><Badge v={c.state} /></div><div className="s">expires {fmt.time(c.expires_at)}</div></div></div>
      <div className="card stat"><div className="bd"><div className="k">Weighted support / opposition</div><div className="v">{c.weighted_support} / {c.weighted_opposition}</div><div className="s">{c.method.id} · {c.method.calibration}</div></div></div>
      <div className="card stat"><div className="bd"><div className="k">Workers</div><div className="v">{c.workers.responding}/{c.workers.eligible}</div><div className="s">{c.workers.abstaining} abstain · {c.workers.failed} failed · {c.workers.rejected_packets} rejected</div></div></div>
      <div className="card stat"><div className="bd"><div className="k">Analysis time</div><div className="v">{c.analysis_ms} ms</div><div className="s">{c.dependency_groups} dependency groups</div></div></div>
    </div>
    <Card title="Reason codes"><ul style={{ margin: 0, paddingLeft: 18 }}>{c.reason_codes.map((x: string, i: number) => <li key={i}>{x}</li>)}</ul></Card>
    <Card title="Evidence domains (dependency-capped)" flush><table><thead><tr><th>Domain</th><th>Required</th><th className="num">Weight</th><th className="num">Groups</th><th className="num">↑</th><th className="num">↓</th><th className="num">○</th><th className="num">Score</th><th /></tr></thead>
      <tbody>{c.domains.map((d: any) => <tr key={d.domain} className="click" onClick={() => setDomain(domain === d.domain ? null : d.domain)}><td>{d.domain}</td><td>{d.required ? 'yes' : ''}</td><td className="num">{(d.weight * 100).toFixed(0)}%</td><td className="num">{d.groups}</td><td className="num up">{d.support}</td><td className="num down">{d.oppose}</td><td className="num faint">{d.abstain}</td><td className="num">{d.score == null ? '—' : d.score.toFixed(2)}</td><td className="faint">{c.packets ? 'packets ▾' : ''}</td></tr>)}</tbody></table>
      {domain && c.packets && <div className="tablewrap" style={{ maxHeight: 300, borderTop: '1px solid var(--line)' }}><table><tbody>{c.packets.filter((p: any) => p.evidence_domain === domain).map((p: any) => <tr key={p.packet_id}><td className="mono faint">{p.worker_id}</td><td><Badge v={p.stance} /></td><td className="faint">{p.dependency_group}</td><td>{p.reason_codes.join('; ')}</td></tr>)}</tbody></table></div>}</Card>
    <Card title="Challenge panel"><div className="grid g2">{c.challenge.map((x: any) => <div key={x.reviewer} className="card"><div className="bd"><div className="row between"><b>{x.reviewer.replace('_', ' ')}</b><span className="row"><Badge v={x.stance} />{x.critical && <Badge v="CRITICAL" />}</span></div><ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{x.findings.map((f: string, i: number) => <li key={i} className="muted">{f}</li>)}</ul></div></div>)}</div></Card>
    {c.missing_inputs.length > 0 && <Card title="Missing inputs"><ul style={{ margin: 0, paddingLeft: 18 }}>{c.missing_inputs.map((x: string, i: number) => <li key={i} className="muted">{x}</li>)}</ul></Card>}
  </div>;
}

export function Intelligence() {
  const { data, error, reload } = useApi('/api/intelligence', { topics: ['scan'], every: 60_000 });
  const [tab, setTab] = useState('Market workers'); const [dom, setDom] = useState('all'); const [sel, setSel] = useState<any>(null); const [pw, setPw] = useState('');
  const workers = (data?.workers ?? []).filter((w: any) => dom === 'all' || w.domain === dom);
  return <Page title="AI Intelligence" sub={data?.note}><ErrorLine e={error} />
    <div className="grid g4" style={{ marginBottom: 14 }}>
      <div className="card stat"><div className="bd"><div className="k">Market workers</div><div className="v">{data?.workers.length ?? '—'}</div><div className="s">{data?.effectiveness ? `${data.effectiveness.productiveDataDriven} productive of ${data.effectiveness.dataDriven} data-driven · ${data.effectiveness.constantRule} constant-rule · ${data.effectiveness.providerBlocked} awaiting providers` : '—'} · {data?.workers.filter((w: any) => w.quarantined).length ?? 0} quarantined</div></div></div>
      <div className="card stat"><div className="bd"><div className="k">Indicator specialists</div><div className="v">{data?.indicatorSpecialists.length ?? '—'}</div><div className="s">feed scoring; no QCI votes (no double counting)</div></div></div>
      <div className="card stat"><div className="bd"><div className="k">Worker pool</div><div className="v">{data?.pool.concurrency ?? '—'}</div><div className="s">concurrent · {data?.pool.deadlineMs}ms deadline · timeout ⇒ ABSTAIN</div></div></div>
      <div className="card stat"><div className="bd"><div className="k">Quorum policy</div><div className="v" style={{ fontSize: 15 }}>≥{data?.policy.supportThreshold} / ≤{data?.policy.maxOpposition}</div><div className="s">min response {((data?.policy.minResponseRatio ?? 0) * 100).toFixed(0)}% · valid {((data?.policy.validityMs ?? 0) / 60000).toFixed(0)} min · NOT_CALIBRATED</div></div></div>
    </div>
    <Tabs tabs={['Market workers', 'Indicator specialists', 'Consensus records', 'Domains']} value={tab} onChange={setTab} />
    {tab === 'Market workers' && data?.workers.some((w: { quarantined: boolean }) => w.quarantined) && <div className="row" style={{ marginBottom: 14 }}><span className="hint">Releasing quarantine requires the owner passphrase.</span><StepUp value={pw} onChange={setPw} /></div>}
    {tab === 'Market workers' && <Card flush right={<select value={dom} onChange={(e) => setDom(e.target.value)}><option value="all">All domains</option>{data?.domains.map((d: any) => <option key={d.domain} value={d.domain}>{d.domain} ({d.workers})</option>)}</select>} title={`${workers.length} workers`}>
      <div className="tablewrap"><table><thead><tr><th>ID</th><th>Role</th><th>Domain</th><th>Dependency group</th><th>Flags</th><th className="num">↑</th><th className="num">↓</th><th className="num">○</th><th className="num">Fail</th><th>Health</th></tr></thead>
        <tbody>{workers.map((w: any) => <tr key={w.id}><td className="mono faint">{w.id}</td><td>{w.name}</td><td>{w.domain}</td><td className="faint mono">{w.dependencyGroup}</td><td>{w.mandatory && <Badge v="MANDATORY" tone="b-info" />} {w.canVeto && <Badge v="VETO" tone="b-bad" />}</td>
          <td className="num up">{w.stats?.support ?? 0}</td><td className="num down">{w.stats?.oppose ?? 0}</td><td className="num faint">{w.stats?.abstain ?? 0}</td><td className="num">{w.stats?.failed ?? 0}</td>
          <td>{w.quarantined ? <span className="row"><Badge v="QUARANTINED" tone="b-bad" /><Action className="sm" label="Release" run={async () => { try { await api(`/api/workers/${w.id}/release`, { body: { password: pw || undefined } }); reload(); } finally { setPw(''); } }} /></span> : w.pending ? <Badge v="PROVIDER PENDING" tone="b-neutral" /> : w.capability === 'CONSTANT_RULE' ? <Badge v="CONSTANT RULE" tone="b-warn" title="Fixed verdict by construction; adds no market information" /> : <Badge v="HEALTHY" tone="b-good" />}</td></tr>)}</tbody></table></div></Card>}
    {tab === 'Indicator specialists' && <Card flush><div className="tablewrap"><table><thead><tr><th>ID</th><th>Indicator</th><th>Timeframe</th></tr></thead><tbody>{data?.indicatorSpecialists.map((x: any) => <tr key={x.id}><td className="mono faint">{x.id}</td><td>{x.name}</td><td>{x.interval}</td></tr>)}</tbody></table></div></Card>}
    {tab === 'Consensus records' && <Card flush><div className="tablewrap"><table><thead><tr><th>When</th><th>Instrument</th><th>Strategy</th><th>State</th><th className="num">Support</th><th className="num">Opp.</th><th className="num">Resp.</th><th className="num">ms</th></tr></thead>
      <tbody>{data?.consensus.map((c: any) => <tr key={c.consensus_id} className="click" onClick={() => api(`/api/consensus/${c.consensus_id}`).then(setSel)}><td className="faint">{fmt.ago(c.created_at)}</td><td>{c.instrument_id.split(':')[2]}</td><td>{c.strategy_id}</td><td><Badge v={c.state} /></td><td className="num">{c.weighted_support}</td><td className="num">{c.weighted_opposition}</td><td className="num">{c.workers.responding}/{c.workers.eligible}</td><td className="num">{c.analysis_ms}</td></tr>)}</tbody></table>
      {!data?.consensus.length && <Empty>No consensus rounds yet — they run when a strategy produces a candidate.</Empty>}</div></Card>}
    {tab === 'Domains' && <Card flush><table><thead><tr><th>Domain</th><th className="num">Workers</th><th className="num">Weight cap</th><th>Required for quorum</th></tr></thead><tbody>{data?.domains.map((d: any) => <tr key={d.domain}><td>{d.domain}</td><td className="num">{d.workers}</td><td className="num">{(d.weight * 100).toFixed(0)}%</td><td>{d.required ? <Badge v="REQUIRED" tone="b-info" /> : ''}</td></tr>)}</tbody></table></Card>}
    {sel && <Modal title={`Consensus ${sel.consensus_id}`} onClose={() => setSel(null)}><ConsensusView c={sel} /></Modal>}
  </Page>;
}
