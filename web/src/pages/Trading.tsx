import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, authInfo, fmt, useApi, stepUpBody } from '../api';
import { Action, Badge, Card, Chg, Empty, ErrorLine, Modal, Page, Sparkline, Stat, Tabs, Meter , rowProps} from '../ui';

/**
 * Step-up proof for a protected action. With an authenticator enrolled it takes the current 6-digit code; before that,
 * on an existing install, the legacy owner passphrase; with neither, protected actions stay unavailable (the server
 * refuses them) and the input explains how to enable them.
 */
export function StepUp({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  if (authInfo.stepUp === 'totp') return <input inputMode="numeric" pattern="[0-9]*" maxLength={6} placeholder="Authenticator code" value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))} autoComplete="one-time-code" aria-label="Six-digit authenticator code for step-up authentication" style={{ width: 150 }} />;
  if (authInfo.stepUp === 'passphrase') return <input type="password" placeholder="Owner passphrase (step-up)" value={value} onChange={(e) => onChange(e.target.value)} autoComplete="current-password" aria-label="Owner passphrase for step-up authentication" />;
  return <span className="hint warn" role="note">Protected actions need two-factor: <Link to="/security">set up an authenticator app</Link> first.</span>;
}

const MODES = [
  ['OBSERVE', 'Observe', 'Scan and explain only. No orders.'],
  ['PAPER', 'Paper', 'Automatic paper entries/exits with live-book fills and real fees.'],
  ['APPROVAL', 'Approval', 'Bot prepares paper orders; you approve each one.'],
  ['BOUNDED_LIVE', 'Bounded live', 'LOCKED — requires every release gate, an isolated signer and your explicit authorization.'],
];

export function Bot() {
  const { data, error, reload } = useApi('/api/bot', { topics: ['bot', 'order', 'position', 'mode'], every: 20_000 });
  const [pw, setPw] = useState(''); const [amt, setAmt] = useState('10000');
  const s = data?.status; const a = data?.account;
  return <Page title="Bot Account" sub="Dedicated paper strategy allocation (Part 26). The bot can never withdraw, transfer, change destinations, raise its allocation or its own permissions.">
    <ErrorLine e={error} />
    <div className="grid g4" style={{ marginBottom: 14 }}>
      <Stat k="Bot state" v={<Badge v={s?.state ?? '…'} tone={s?.state === 'EMERGENCY' ? 'b-bad' : s?.state === 'PAPER_TRADING' ? 'b-violet' : s?.state === 'PAUSED' ? 'b-warn' : 'b-neutral'} />} s={s ? `${s.cycles} scan cycles · last ${fmt.ago(s.lastScanAt)}` : ''} />
      <Stat k="Allocation equity (paper)" v={fmt.usd(a?.equity)} s={`deposits ${fmt.usd(a?.deposits)} · cash ${fmt.usd(a?.cash)}`} />
      <Stat k="Unrealized / today" v={fmt.usd(a?.unrealizedPnl)} tone={a && a.unrealizedPnl < 0 ? 'down' : 'up'} s={`day ${fmt.pct(a?.dailyPnlPct)} · open risk ${fmt.num(a?.openRiskPct, 2)}%`} />
      <Stat k="Decisions / entries" v={`${s?.decisionsTotal ?? 0} / ${s?.entriesToday ?? 0}`} s={s?.lastError ? <span className="err">{s.lastError}</span> : 'no engine errors'} />
    </div>
    <div className="grid g2">
      <Card title="Automation mode (Part 26.2)"><div className="col">
        {MODES.map(([m, l, d]) => <label key={m} className="row" style={{ alignItems: 'flex-start', opacity: m === 'BOUNDED_LIVE' ? 0.6 : 1 }}><input type="radio" name="mode" checked={s?.mode === m} readOnly style={{ marginTop: 3 }} /><div style={{ flex: 1 }}><b>{l}</b> <span className="muted">— {d}</span></div>
          {s?.mode !== m && (m === 'BOUNDED_LIVE' ? <Badge v="LOCKED" /> : <Action className="sm" label="Switch" run={async () => { try { await api('/api/control', { body: { mode: m, ...stepUpBody(pw) } }); reload(); } finally { setPw(''); } }} />)}</label>)}
        <StepUp value={pw} onChange={setPw} />
        {!s?.policyAccepted && <div className="hint warn">Accept a risk policy in the <Link to="/risk">Risk Center</Link> before paper execution.</div>}
        <div className="row"><Action className="danger" label="Pause new orders" run={async () => { await api('/api/emergency/pause', { body: {} }); reload(); }} />
          {s?.paused && !s?.emergency && <Action label="Resume" run={async () => { try { await api('/api/control', { body: { pausedNewOrders: false, ...stepUpBody(pw) } }); reload(); } finally { setPw(''); } }} />}</div>
        {s?.paused && !s?.emergency && <div className="hint">Resuming needs the owner passphrase above (step-up).</div>}
      </div></Card>
      <Card title="Paper allocation"><div className="col">
        <div className="hint">Funding the paper bot is a simulated deposit into the isolated paper account. It does not authorize trading — the mode does.</div>
        <div className="row"><input type="number" min="1" value={amt} onChange={(e) => setAmt(e.target.value)} style={{ width: 140 }} aria-label="Amount" />
          <Action className="primary" label="Allocate" run={async () => { await api('/api/bot/allocation', { body: { amount: Number(amt), direction: 'DEPOSIT' } }); reload(); }} />
          <Action label="Remove" run={async () => { await api('/api/bot/allocation', { body: { amount: Number(amt), direction: 'WITHDRAW' } }); reload(); }} /></div>
        <div className="tablewrap" style={{ maxHeight: 180 }}><table><tbody>{(data?.ledger ?? []).slice(0, 30).map((l: any) => <tr key={l.id}><td className="faint">{fmt.ago(l.ts)}</td><td><Badge v={l.kind} /></td><td className="num">{fmt.usd(l.amount)}</td><td className="muted">{l.note}</td></tr>)}</tbody></table></div>
      </div></Card>
    </div>
    <div style={{ height: 14 }} />
    <Card title={`Pending approvals (${data?.pending.length ?? 0})`} flush>{data?.pending.length ? <table><thead><tr><th>Created</th><th>Instrument</th><th className="num">Qty</th><th className="num">Stop</th><th>Decision</th><th /></tr></thead><tbody>{data.pending.map((o: any) => <tr key={o.id}><td className="faint">{fmt.ago(o.created_at)}</td><td>{o.instrument.split(':')[2]}</td><td className="num">{o.qty}</td><td className="num">{fmt.px(o.stop_price)}</td><td><Link to={`/decision/${o.decision_id}`}>explain</Link></td><td className="row"><Action className="primary sm" label="Approve" run={async () => { const r = await api(`/api/orders/${o.id}/approve`, { body: {} }); if (!r.ok) throw new Error(r.reason); reload(); }} /><Action className="sm" label="Reject" run={async () => { await api(`/api/orders/${o.id}/reject`, { body: {} }); reload(); }} /></td></tr>)}</tbody></table> : <Empty>No orders awaiting approval. Approvals expire with their consensus window (5 min).</Empty>}</Card>
    <div style={{ height: 14 }} />
    <PositionsTable rows={data?.positions ?? []} onChange={reload} />
    <div style={{ height: 14 }} />
    <Card title="Strategies" right={<Link to="/lab">Strategy Lab →</Link>} flush><table><thead><tr><th>Strategy</th><th>Status</th><th className="num">OOS trades</th><th className="num">OOS expectancy</th><th className="num">Paper trades</th><th className="num">Paper expectancy</th><th>Bot permission</th></tr></thead>
      <tbody>{(data?.strategies ?? []).map((st: any) => { const disabled = data?.status && (data as any).status && false; void disabled; return <tr key={st.id}><td><b>{st.name}</b> <span className="faint">v{st.version}</span></td><td><Badge v={st.status} /></td><td className="num">{st.stats?.trades ?? '—'}</td><td className="num">{st.stats ? `${st.stats.expectancyR.toFixed(3)}R` : '—'}</td><td className="num">{st.live?.trades ?? 0}</td><td className="num">{st.live ? `${st.live.expectancyR.toFixed(2)}R` : '—'}</td><td><StrategyToggle id={st.id} pw={pw} clearPassphrase={() => setPw('')} onChange={reload} /></td></tr>; })}</tbody></table></Card>
  </Page>;
}
/** Revoking reduces risk and needs no passphrase; re-enabling increases it and uses the step-up passphrase entered above. */
function StrategyToggle({ id, pw, clearPassphrase, onChange }: { id: string; pw: string; clearPassphrase: () => void; onChange: () => void }) {
  // MIA-WEB-010: send one operation for THIS strategy; the server applies it to its current list (never a stale copy).
  const shell = useApi('/api/shell', { topics: ['mode'] }); const dis: string[] = shell.data?.control.disabledStrategies ?? []; const off = dis.includes(id);
  return <Action className="sm" label={off ? 'Re-enable' : 'Revoke'} run={async () => { try { await api('/api/control', { body: off ? { enableStrategy: id, ...stepUpBody(pw) } : { disableStrategy: id } }); shell.reload(); onChange(); } finally { if (off) clearPassphrase(); } }} />;
}
export function PositionsTable({ rows, onChange }: { rows: any[]; onChange: () => void }) {
  return <Card title={`Open positions (${rows.length})`} flush>{rows.length ? <div className="tablewrap"><table><thead><tr><th>Instrument</th><th>Strategy</th><th className="num">Qty</th><th className="num">Entry</th><th className="num">Mark</th><th className="num">Stop</th><th>Targets</th><th className="num">Unrealized</th><th>Opened</th><th /></tr></thead>
    <tbody>{rows.map((p: any) => { const u = p.mark != null ? (p.mark - p.entry_price) * p.qty : null; return <tr key={p.id}><td><Link to={`/terminal/${p.instrument.split(':')[2]}`}><b>{p.instrument.split(':')[2]}</b></Link></td><td>{p.strategy}</td><td className="num">{p.qty}</td><td className="num">{fmt.px(p.entry_price)}</td><td className="num">{fmt.px(p.mark)}</td><td className="num">{fmt.px(p.stop_price)}{p.stop_price > p.initial_stop && <span className="up"> ↑</span>}</td><td className="mono" style={{ fontSize: 12 }}>{p.targets.targets.map((t: any) => `${fmt.px(t.price)}${t.done ? '✓' : ''}`).join(' · ')}</td><td className={`num ${u != null && u < 0 ? 'down' : 'up'}`}>{fmt.usd(u)}</td><td className="faint">{fmt.ago(p.opened_at)}</td>
      <td><Action className="sm danger" label="Close" confirm="Close this paper position at market (live bid, with fees)?" run={async () => { await api(`/api/positions/${p.id}/close`, { body: {} }); onChange(); }} /></td></tr>; })}</tbody></table>
    <div className="hint" style={{ padding: '8px 12px' }}>Paper stops are OMS-monitored against live bids (no exchange-native stop exists in paper). A stop trigger is not a guaranteed fill price.</div></div> : <Empty>No open positions.</Empty>}</Card>;
}

const POLICY_FIELDS: [string, string, string][] = [
  ['riskPerTradePct', 'Risk per trade (% equity)', '0.05–2'], ['maxOpenRiskPct', 'Aggregate open risk (%)', '0.1–6'], ['dailyLossPct', 'Daily loss breaker (%)', '0.5–10'], ['weeklyLossPct', 'Weekly loss breaker (%)', '1–20'],
  ['drawdownWarnPct', 'Drawdown warning (%)', '1–30'], ['drawdownHaltPct', 'Drawdown capital-preservation (%)', '2–40'], ['maxConsecutiveLosses', 'Consecutive-loss review', '1–10'], ['cooldownMinutesAfterLossStreak', 'Cooldown after streak (min)', '0–10080'],
  ['maxConcurrentPositions', 'Max concurrent positions', '1–20'], ['maxPositionNotionalPct', 'Max position notional (% equity)', '1–50'], ['maxSpreadBps', 'Max spread (bps)', '1–50'], ['maxSlippageBps', 'Max slippage (bps)', '1–100'],
  ['maxCostR', 'Max round-trip cost (R)', '0.01–0.5'], ['maxPriceDeviationPct', 'Max price deviation at submit (%)', '0.05–3'], ['stopFillBufferPct', 'Conservative stop-fill buffer (%)', '0.1–5'], ['feeRate', 'Fee rate (fraction)', '0–0.005'],
  ['maxCorrelatedPositions', 'Max correlated positions', '1–10'], ['correlationThreshold', 'Correlation threshold', '0.3–0.99'], ['minOpportunityScore', 'Min opportunity score', '40–95'],
];
/** Persistent protection incidents: visible until the owner acknowledges them after executable data has returned. */
function IncidentsCard({ incidents, reload }: { incidents: any[]; reload: () => void }) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  if (!incidents.length) return null;
  return <Card title="Protection incidents" right={<Badge v={`${incidents.filter((i) => i.status === 'OPEN').length} OPEN`} tone="b-bad" />} flush>
    <table><tbody>{incidents.map((i) => <tr key={i.id}>
      <td><b>{i.instrument.split(':')[2] ?? i.instrument}</b><div className="hint">{i.reason}</div><div className="hint">since {fmt.time(i.opened_at)} · seen {i.occurrences}× · last {fmt.ago(i.last_seen_at)}</div></td>
      <td><Badge v={i.status} tone={i.status === 'OPEN' ? 'b-bad' : 'b-warn'} /></td>
      <td>{i.status === 'OPEN' ? <span className="hint">Position kept open — no synthetic fill. New entries on this instrument are blocked until a fresh, deep order book returns.</span>
        : <div className="row"><input aria-label="Acknowledgement note" placeholder="Action taken" value={notes[i.id] ?? ''} onChange={(e) => setNotes({ ...notes, [i.id]: e.target.value })} style={{ width: 160 }} />
          <Action className="sm" label="Acknowledge" run={async () => { await api(`/api/risk/incidents/${i.id}/ack`, { body: { note: notes[i.id] ?? '' } }); reload(); }} /></div>}</td>
    </tr>)}</tbody></table>
  </Card>;
}

export function Risk() {
  const { data, error, reload } = useApi('/api/risk', { topics: ['position', 'mode', 'risk'], every: 20_000 });
  const [draft, setDraft] = useState<any>(null); const [pw, setPw] = useState(''); const [confirm, setConfirm] = useState(''); const [result, setResult] = useState<any>(null);
  useEffect(() => { if (data && !draft) setDraft({ ...(data.policy?.policy ?? data.defaults) }); }, [data, draft]);
  const a = data?.account; const p = data?.policy?.policy ?? data?.defaults;
  return <Page title="Risk Center" sub="Deterministic, fail-closed risk authority (Part 17). No agent, QCI result or assistant can bypass it. Limits change only through this authenticated, versioned workflow.">
    <ErrorLine e={error} />
    {!data?.policy && <div className="banner info">No risk policy accepted yet. Review the conservative paper defaults below and accept them (or adjust) to enable paper execution.</div>}
    {data?.policy?.invalid && <div className="banner warn">Stored risk policy v{data.policy.version} is invalid. Review and accept a valid policy before opening paper positions.</div>}
    <div className="grid g-1-2">
      <div className="col" style={{ gap: 14 }}>
        <Card title="Circuit breakers">{a && p ? <div className="col">
          <Meter label="Daily loss" value={-a.dailyPnlPct} limit={p.dailyLossPct} /><Meter label="Weekly loss" value={-a.weeklyPnlPct} limit={p.weeklyLossPct} /><Meter label="Drawdown (halt)" value={a.drawdownPct} limit={p.drawdownHaltPct} /><Meter label="Open risk" value={a.openRiskPct} limit={p.maxOpenRiskPct} />
          <div className="kv"><span>Equity</span><span className="mono">{fmt.usd(a.equity)}</span><span>Start of day</span><span className="mono">{fmt.usd(a.startOfDayEquity)}</span><span>High-water mark</span><span className="mono">{fmt.usd(a.highWaterMark)}</span><span>Loss streak</span><span>{a.consecutiveLosses} / {p.maxConsecutiveLosses}</span><span>Leverage</span><span>disabled (spot, hard constraint)</span></div>
        </div> : <Empty>…</Empty>}</Card>
        <Card title="Emergency controls (Part 17.8)"><div className="col">
          <div className="hint">Each action is distinct and reports its own state. Cancelling orders does not protect positions; emergency stop does not auto-close positions.</div>
          <Action className="danger" label="Pause new orders" run={async () => { setResult(await api('/api/emergency/pause', { body: {} })); reload(); }} />
          <Action label="Cancel pending entry orders" run={async () => { setResult(await api('/api/emergency/cancel-pending', { body: {} })); reload(); }} />
          <Action label="Verify / protect existing positions" run={async () => { setResult(await api('/api/emergency/protect', { body: {} })); reload(); }} />
          <Action className="danger" label="EMERGENCY STOP" confirm="Engage emergency stop? New orders are blocked and pending entries cancelled. Positions are not closed." run={async () => { setResult(await api('/api/emergency/stop', { body: {} })); reload(); }} />
          {data?.control.pausedNewOrders && !data?.control.emergency && <Action label="Resume new orders (step-up)" run={async () => { try { await api('/api/control', { body: { pausedNewOrders: false, ...stepUpBody(pw) } }); reload(); } finally { setPw(''); } }} />}
          {data?.control.emergency && <Action label="Clear emergency (step-up)" run={async () => { try { await api('/api/control', { body: { emergency: false, pausedNewOrders: false, ...stepUpBody(pw) } }); reload(); } finally { setPw(''); } }} />}
          <div className="row"><input placeholder='Type "CLOSE ALL"' value={confirm} onChange={(e) => setConfirm(e.target.value)} style={{ width: 150 }} /><Action className="danger" label="Close all positions" run={async () => { try { setResult(await api('/api/emergency/close-all', { body: { confirm, ...stepUpBody(pw) } })); reload(); } finally { setPw(''); } }} /></div>
          <StepUp value={pw} onChange={setPw} />
          {result && <div className="card"><div className="bd"><div className="row">Result: <Badge v={result.state ?? 'CONFIRMED'} /></div><pre className="hint">{JSON.stringify(result, null, 1).slice(0, 1200)}</pre></div></div>}
        </div></Card>
        <IncidentsCard incidents={data?.incidents ?? []} reload={reload} />
        <Card title="Position protection" flush>{data?.protection.positions.length ? <table><tbody>{data.protection.positions.map((x: any) => <tr key={x.positionId}><td>{x.instrument.split(':')[2]}</td><td>{x.protected ? <Badge v="PROTECTED" tone="b-good" /> : <Badge v="UNVERIFIED" tone="b-bad" />}</td><td className="muted">{x.issue ?? `stop ${fmt.px(x.stop)}`}</td></tr>)}</tbody></table> : <Empty>No open positions.</Empty>}</Card>
      </div>
      <div className="col" style={{ gap: 14 }}>
        <Card title={`Risk policy ${data?.policy ? `v${data.policy.version} (accepted ${fmt.ago(data.policy.created_at)})` : '— not accepted'}`}>
          {draft && <div className="col">
            <div className="grid g3" style={{ gap: 10 }}>{POLICY_FIELDS.map(([k, l, r]) => <label key={k} className="col" style={{ gap: 3 }}><span className="hint">{l} <span className="faint">[{r}]</span></span><input type="number" step="any" value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value === '' ? '' : Number(e.target.value) })} /></label>)}</div>
            <div className="hint">Illustrative paper defaults from the spec — not financial advice. Hard bounds are enforced server-side; leverage is fixed at 1×. Limits are never raised automatically after profits.</div>
            <div className="row"><StepUp value={pw} onChange={setPw} /><Action className="primary" label={data?.policy ? 'Save new version' : 'Accept policy'} run={async () => { try { await api('/api/risk/policy', { body: { policy: draft, ...stepUpBody(pw) } }); reload(); } finally { setPw(''); } }} /><button onClick={() => setDraft({ ...data.defaults })}>Reset to defaults</button></div>
          </div>}
        </Card>
        <Card title="Correlation of open positions (1h returns)" flush>{data?.correlation.instruments.length ? <table><thead><tr><th />{data.correlation.instruments.map((i: string) => <th key={i}>{i.split(':')[2].replace('USDT', '')}</th>)}</tr></thead><tbody>{data.correlation.matrix.map((row: any[], i: number) => <tr key={i}><td>{data.correlation.instruments[i].split(':')[2].replace('USDT', '')}</td>{row.map((c, j) => <td key={j} className="num" style={{ background: c == null ? undefined : `rgba(240,80,90,${Math.max(0, c) * 0.35})` }}>{c == null ? '?' : c.toFixed(2)}</td>)}</tr>)}</tbody></table> : <Empty>No open positions.</Empty>}</Card>
        <Card title="Policy history" flush><table><tbody>{(data?.history ?? []).map((h: any) => <tr key={h.version}><td>v{h.version}</td><td className="faint">{fmt.time(h.created_at)}</td><td>{h.accepted_by}</td><td className="hint">{h.policy ? <>risk {h.policy.riskPerTradePct}% · day {h.policy.dailyLossPct}% · DD {h.policy.drawdownHaltPct}%</> : 'Invalid stored policy'}</td></tr>)}</tbody></table>{!data?.history.length && <Empty>No versions yet.</Empty>}</Card>
      </div>
    </div>
  </Page>;
}

export function Portfolio() {
  const { data, error, reload } = useApi('/api/portfolio', { topics: ['position'], every: 20_000 });
  const a = data?.account;
  return <Page title="Portfolio" sub="Paper bot account (ledger is the source of truth). External wallets and exchange balances appear once read-only connections are configured.">
    <ErrorLine e={error} />
    <div className="grid g4" style={{ marginBottom: 14 }}>
      <Stat k="Equity" v={fmt.usd(a?.equity)} s={`deposits ${fmt.usd(a?.deposits)}`} /><Stat k="Total return" v={a?.deposits ? fmt.pct(((a.equity - a.deposits) / a.deposits) * 100) : '—'} tone={a && a.equity < a.deposits ? 'down' : 'up'} />
      <Stat k="Positions value" v={fmt.usd(a?.positionsValue)} s={`${a?.openCount ?? 0} open · cash ${fmt.usd(a?.cash)}`} /><Stat k="Reconciliation" v={<Badge v={data?.reconciliation.ok ? 'PASS' : 'FAIL'} />} s={data?.reconciliation.detail} />
    </div>
    <Card title="Realized equity curve">{data?.equityCurve.length > 1 ? <Sparkline values={data.equityCurve.map((x: any) => x.equity)} height={120} /> : <Empty>Curve appears after closed paper trades.</Empty>}</Card>
    <div style={{ height: 14 }} />
    <PositionsTable rows={data?.open ?? []} onChange={reload} />
    <div style={{ height: 14 }} />
    <Card title="Closed positions" flush><div className="tablewrap"><table><thead><tr><th>Closed</th><th>Instrument</th><th>Strategy</th><th className="num">Entry</th><th className="num">Exit</th><th>Exit reason</th><th className="num">Fees</th><th className="num">Net PnL</th><th className="num">R</th></tr></thead>
      <tbody>{(data?.closed ?? []).map((p: any) => <tr key={p.id}><td className="faint">{fmt.time(p.closed_at)}</td><td>{p.instrument.split(':')[2]}</td><td>{p.strategy}</td><td className="num">{fmt.px(p.entry_price)}</td><td className="num">{fmt.px(p.exit_price)}</td><td><Badge v={p.exit_reason} /></td><td className="num">{fmt.usd(p.fees)}</td><td className={`num ${p.realized_pnl < 0 ? 'down' : 'up'}`}>{fmt.usd(p.realized_pnl)}</td><td className="num">{(p.realized_pnl / p.planned_risk).toFixed(2)}</td></tr>)}</tbody></table>{!data?.closed.length && <Empty>No closed positions.</Empty>}</div></Card>
    <div className="grid g2" style={{ marginTop: 14 }}><Card title="External wallets"><Badge v="PENDING_CREDENTIALS" /> <span className="muted">{data?.external.wallets}</span></Card><Card title="Exchange accounts"><Badge v="PENDING_CREDENTIALS" /> <span className="muted">{data?.external.exchanges}</span></Card></div>
  </Page>;
}

export function Journal() {
  const [kind, setKind] = useState(''); const { data, error } = useApi(`/api/journal${kind ? `?kind=${kind}` : ''}`, { topics: ['order', 'position', 'decision'] });
  const orders = useApi('/api/orders', { topics: ['order'] }); const [tab, setTab] = useState('Journal'); const [sel, setSel] = useState<any>(null);
  return <Page title="Trade Journal" sub="Complete decision and execution record (Part 20): fills, exits, autopsies, interventions and risk events. Losing and rejected trades are never hidden.">
    <ErrorLine e={error} /><Tabs tabs={['Journal', 'Orders', 'Decisions']} value={tab} onChange={setTab} />
    {tab === 'Journal' && <Card flush right={<select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind"><option value="">All kinds</option>{['FILL', 'EXIT', 'AUTOPSY', 'ORDER', 'INTERVENTION', 'RISK', 'SYSTEM'].map((k) => <option key={k}>{k}</option>)}</select>} title="Entries">
      <div className="tablewrap" style={{ maxHeight: 650 }}><table><tbody>{(data ?? []).map((j: any) => <tr key={j.id} className={j.detail ? 'click' : ''} onClick={() => j.detail && setSel(j)}><td className="faint" style={{ whiteSpace: 'nowrap' }}>{fmt.time(j.ts)}</td><td><Badge v={j.kind} tone={j.kind === 'AUTOPSY' ? 'b-violet' : j.kind === 'RISK' ? 'b-bad' : 'b-info'} /></td><td>{j.summary}</td></tr>)}</tbody></table>{!data?.length && <Empty>Journal is empty.</Empty>}</div></Card>}
    {tab === 'Orders' && <Card flush><div className="tablewrap" style={{ maxHeight: 650 }}><table><thead><tr><th>Created</th><th>Client order ID</th><th>Instrument</th><th>Side</th><th>Type</th><th>Purpose</th><th className="num">Qty</th><th className="num">Avg</th><th className="num">Fees</th><th>Status</th></tr></thead><tbody>{(orders.data ?? []).map((o: any) => <tr key={o.id}><td className="faint">{fmt.time(o.created_at)}</td><td className="mono faint" style={{ fontSize: 11 }}>{o.client_order_id}</td><td>{o.instrument.split(':')[2]}</td><td><Badge v={o.side} /></td><td>{o.type}</td><td>{o.purpose}</td><td className="num">{o.qty}</td><td className="num">{fmt.px(o.avg_price)}</td><td className="num">{fmt.usd(o.fees, 4)}</td><td><Badge v={o.status} title={o.reject_reason ?? ''} /></td></tr>)}</tbody></table></div></Card>}
    {tab === 'Decisions' && <DecisionsList />}
    {sel && <Modal title={sel.summary} onClose={() => setSel(null)}><pre>{JSON.stringify(sel.detail, null, 2)}</pre></Modal>}
  </Page>;
}
function DecisionsList() {
  const [f, setF] = useState(''); const { data } = useApi(`/api/decisions${f ? `?decision=${f}` : ''}`);
  return <Card flush right={<select value={f} onChange={(e) => setF(e.target.value)} aria-label="Decision filter"><option value="">All decisions</option>{['APPROVED_FOR_MONITORING', 'WAIT_FOR_CONFIRMATION', 'PAPER_TRADE', 'APPROVED_FOR_USER_CONFIRMATION', 'REJECTED', 'INSUFFICIENT_DATA'].map((x) => <option key={x}>{x}</option>)}</select>} title="Decision records">
    <div className="tablewrap"><table><tbody>{(data ?? []).map((d: any) => <tr key={d.id}><td className="faint">{fmt.time(d.created_at)}</td><td>{d.instrument.split(':')[2]}</td><td>{d.strategy}</td><td className="num">{d.score}</td><td><Badge v={d.decision} /></td><td>{d.risk_decision && <Badge v={d.risk_decision} />}</td><td><Link to={`/decision/${d.id}`}>explain</Link></td></tr>)}</tbody></table>{!data?.length && <Empty>No decisions.</Empty>}</div></Card>;
}

export function Calendar() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7)); const { data, error } = useApi(`/api/calendar?month=${month}`, { topics: ['position'] });
  const [day, setDay] = useState<any>(null);
  const [y, m] = month.split('-').map(Number); const first = new Date(Date.UTC(y, m - 1, 1)); const lead = (first.getUTCDay() + 6) % 7; const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const byDate = new Map((data?.days ?? []).map((d: any) => [d.date, d]));
  const shift = (k: number) => { const d = new Date(Date.UTC(y, m - 1 + k, 1)); setMonth(d.toISOString().slice(0, 7)); };
  return <Page title="Profit Calendar" sub={data?.definition} right={<><button onClick={() => shift(-1)}>‹</button><b className="mono">{month}</b><button onClick={() => shift(1)}>›</button><span className="hint">UTC{data?.tzOffsetMin ? `${data.tzOffsetMin > 0 ? '+' : ''}${data.tzOffsetMin / 60}` : ''}</span></>}>
    <ErrorLine e={error} />
    {data && <div className="grid g4" style={{ marginBottom: 14 }}><Stat k="Net realized" v={fmt.usd(data.summary.net)} tone={data.summary.net < 0 ? 'down' : 'up'} /><Stat k="Fees" v={fmt.usd(data.summary.fees)} /><Stat k="Trades" v={data.summary.trades} s={`${data.summary.greenDays} green / ${data.summary.redDays} red days`} /><Stat k="Best / worst day" v={<span style={{ fontSize: 15 }}>{data.summary.bestDay ? fmt.usd(data.summary.bestDay.net) : '—'} / {data.summary.worstDay ? fmt.usd(data.summary.worstDay.net) : '—'}</span>} /></div>}
    <Card><div className="cal">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="hint" style={{ textAlign: 'center' }}>{d}</div>)}
      {Array.from({ length: lead }, (_, i) => <div key={`l${i}`} className="d out" />)}
      {Array.from({ length: days }, (_, i) => { const date = `${month}-${String(i + 1).padStart(2, '0')}`; const d: any = byDate.get(date); return <div key={date} className={`d ${d ? (d.net >= 0 ? 'pos' : 'neg') : ''}`} onClick={() => d && setDay(d)} role={d ? 'button' : undefined} tabIndex={d ? 0 : -1}><div className="hint">{i + 1}</div>{d && <><div className={`mono ${d.net >= 0 ? 'up' : 'down'}`}>{fmt.usd(d.net)}</div><div className="hint">{d.trades} trade{d.trades > 1 ? 's' : ''}</div></>}</div>; })}
    </div></Card>
    {day && <Modal title={`${day.date} · ${fmt.usd(day.net)}`} onClose={() => setDay(null)}><table><thead><tr><th>Instrument</th><th>Strategy</th><th>Exit</th><th className="num">Fees</th><th className="num">Net</th></tr></thead><tbody>{day.items.map((x: any) => <tr key={x.id}><td>{x.instrument.split(':')[2]}</td><td>{x.strategy}</td><td>{x.exit_reason}</td><td className="num">{fmt.usd(x.fees)}</td><td className={`num ${x.realized_pnl < 0 ? 'down' : 'up'}`}>{fmt.usd(x.realized_pnl)}</td></tr>)}</tbody></table></Modal>}
  </Page>;
}

export function Lab() {
  const { data, error, reload } = useApi('/api/lab'); const [strat, setStrat] = useState('trend_pullback'); const [sym, setSym] = useState('BTCUSDT'); const [bars, setBars] = useState(3000);
  const [res, setRes] = useState<any>(null); const [pw, setPw] = useState('');
  const S = (x: any) => x ? `${x.trades} trades · win ${(x.winRate * 100).toFixed(0)}% · E ${x.expectancyR.toFixed(3)}R · PF ${Number.isFinite(x.profitFactor) ? x.profitFactor.toFixed(2) : '∞'} · maxDD ${x.maxDrawdownR.toFixed(1)}R` : '—';
  return <Page title="Strategy Lab" sub="Point-in-time backtests on real Binance history with fees, spread, slippage, next-bar entries, conservative intrabar ordering and a chronological in-sample / out-of-sample split. Only OUT-OF-SAMPLE results feed live scoring.">
    <ErrorLine e={error} />
    <Card title="Run backtest"><div className="row">
      <select value={strat} onChange={(e) => setStrat(e.target.value)} aria-label="Strategy">{(data?.strategies ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      <input list="lab-syms" value={sym} onChange={(e) => setSym(e.target.value.toUpperCase())} style={{ width: 140 }} aria-label="Symbol" /><datalist id="lab-syms">{(data?.universe ?? []).map((s: string) => <option key={s} value={s} />)}</datalist>
      <select value={bars} onChange={(e) => setBars(Number(e.target.value))} aria-label="History"><option value={1500}>1,500 bars</option><option value={3000}>3,000 bars</option><option value={6000}>6,000 bars</option></select>
      <Action className="primary" label="Run" run={async () => { setRes(await api('/api/lab/backtest', { body: { strategyId: strat, symbol: sym, bars } })); reload(); }} />
      <Action label="Run on whole deep tier" run={async () => { for (const s of (data?.universe ?? []).slice(0, 12)) { try { await api('/api/lab/backtest', { body: { strategyId: strat, symbol: s, bars } }); } catch { /* continue */ } } reload(); }} />
    </div>{res && <div className="col" style={{ marginTop: 12 }}><div className="kv"><span>In-sample</span><span className="mono">{S(res.inSample)}</span><span>Out-of-sample</span><span className="mono">{S(res.outOfSample)}</span><span>Period</span><span>{fmt.time(res.from)} → {fmt.time(res.to)} ({res.bars} bars)</span></div><Sparkline values={[0, ...res.equityR]} height={90} /><ul className="hint" style={{ margin: 0 }}>{res.warnings.map((w: string) => <li key={w}>{w}</li>)}</ul></div>}</Card>
    <div style={{ height: 14 }} />
    <Card title="Strategy lifecycle (Part 18)" right={<StepUp value={pw} onChange={setPw} />} flush><table><thead><tr><th>Strategy</th><th>Status</th><th>OOS aggregate</th><th>Monte Carlo (100 trades @0.5%)</th><th>Paper</th><th>Actions</th></tr></thead>
      <tbody>{(data?.strategies ?? []).map((s: any) => <tr key={s.id}><td><b>{s.name}</b><div className="hint">{s.note}</div></td><td><Badge v={s.status} /></td><td className="mono" style={{ fontSize: 12 }}>{s.stats ? `${S(s.stats)} · ${s.stats.instruments} instr.` : '—'}</td>
        <td className="mono" style={{ fontSize: 12 }}>{s.stats?.monteCarlo ? `P5 ${fmt.pct(s.stats.monteCarlo.returnP5 * 100, 1)} · P50 ${fmt.pct(s.stats.monteCarlo.returnP50 * 100, 1)} · DD95 ${(s.stats.monteCarlo.maxDdP95 * 100).toFixed(1)}%` : '—'}</td>
        <td className="mono">{s.live ? `${s.live.trades} · ${s.live.expectancyR.toFixed(2)}R` : '—'}</td>
        <td className="row">{s.status !== 'PAPER' && <Action className="sm" label="Promote to paper" run={async () => { try { await api(`/api/lab/strategy/${s.id}/status`, { body: { status: 'PAPER', ...stepUpBody(pw) } }); reload(); } finally { setPw(''); } }} />}{s.status !== 'SUSPENDED' && <Action className="sm" label="Suspend" run={async () => { await api(`/api/lab/strategy/${s.id}/status`, { body: { status: 'SUSPENDED' } }); reload(); }} />}<Action className="sm" label="Live candidate" title="Blocked until release gates pass" run={async () => { try { await api(`/api/lab/strategy/${s.id}/status`, { body: { status: 'LIVE_CANDIDATE', ...stepUpBody(pw) } }); } finally { setPw(''); } }} /></td></tr>)}</tbody></table></Card>
    <div style={{ height: 14 }} />
    <Card title="Backtest history" flush><div className="tablewrap"><table><thead><tr><th>When</th><th>Strategy</th><th>Instrument</th><th>Out-of-sample</th></tr></thead><tbody>{(data?.backtests ?? []).map((b: any) => <tr key={b.id} {...rowProps(() => setRes(b), `Open backtest ${b.id}`)}><td className="faint">{fmt.ago(b.created_at)}</td><td>{b.strategyId}</td><td>{b.instrument.split(':')[2]}</td><td className="mono" style={{ fontSize: 12 }}>{S(b.outOfSample)} <Chg v={null} /></td></tr>)}</tbody></table>{!data?.backtests.length && <Empty>No backtests yet.</Empty>}</div></Card>
  </Page>;
}
