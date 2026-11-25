import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, authInfo, fmt, useApi } from '../api';
import { Action, Badge, Card, Chg, Empty, ErrorLine, Modal, Page, Sparkline, Stat, Tabs, Meter } from '../ui';
import { Icon } from '../brand';
import { GroupTabs } from '../Navigation';
import { useRibbon, type ShellState } from '../StatusRibbon';
import { AutopilotActivity, AutopilotSession, type Mind } from './AutopilotSession';
import { ResearchWorkspace } from './ResearchPanel';

export const StepUp = ({ value, onChange }: { value: string; onChange: (v: string) => void }) =>
  authInfo.mode === 'privy'
    ? <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6} placeholder="Six-digit authenticator code" value={value} onChange={(e) => onChange(e.target.value)} autoComplete="one-time-code" aria-label="Authenticator step-up code" />
    : <input type="password" placeholder="Owner passphrase (step-up)" value={value} onChange={(e) => onChange(e.target.value)} autoComplete="current-password" aria-label="Owner passphrase for step-up authentication" />;

const MODES = [
  ['OBSERVE', 'Observe', 'Scan and explain only. No orders.'],
  ['PAPER', 'Paper', 'Automatic paper entries/exits with live-book fills and real fees.'],
  ['APPROVAL', 'Approval', 'Bot prepares paper orders; you approve each one.'],
  ['BOUNDED_LIVE', 'Bounded live', 'Locked. Requires every release gate, an isolated signer, and explicit authorization.'],
] as const;

function pnlColor(value: number | null | undefined) {
  return value == null || value === 0 ? undefined : value < 0 ? 'down' : 'up';
}

type CommandLane = {
  inFlight: boolean;
  completedAt: number;
  error: string | null;
  deferReason?: string | null;
};
type CommandStatus = {
  readiness: { ready: boolean; role: string; checks: { name: string; status: string; detail: string }[] };
  ledger: { reconciled: boolean; closedPositions: number; netPnl: number };
  recovery: { unresolvedOrders: number; positions: number; verifiedPositions: number };
  protection?: PositionProtection[];
  activity: { count: number; denials: number };
  execution: { fills: number; fees: number; lastFillAt: number | null };
  providers: { live: number; total: number };
  research: {
    fast: { checkedAt: number; stale: boolean; count: number | null };
    deep: { checkedAt: number; stale: boolean; symbol: string | null; error: boolean; state: string | null; fundingRate: number | null; openInterest: number | null };
  };
  choice: null | {
    at: number; observed: number; reason: string | null; selected: string | null;
    outcome: null | { netPnl: number | null; fees: number; entrySlippageBps: number | null };
  };
  latency: { stage: string; samples: number; p95: number | null; p99: number | null }[];
};
const COMMAND_LANES = [
  ['protection', 'Protective exits', 'monitor'],
  ['positionBooks', 'Position order books', ''],
  ['ticker', 'Market tickers', 'tickers'],
  ['scan', 'Market scan and QCI', 'scanner'],
  ['research', 'FAST / DEEP research', ''],
  ['background', 'Maintenance', ''],
] as const;

function CentralCommand({ command, lanes, mode }: { command?: CommandStatus; lanes?: Record<string, CommandLane>; mode?: string }) {
  return <section className="col" aria-label="MIA Central Command">
    <Card title="MIA Central Command" right={<Link to="/qa">Release gates</Link>}>
      {command ? <>
        <div className="grid g4">
          <Stat k="Engine authority" v={<Badge v={command.readiness.role} />} s={mode ?? 'Awaiting mode'} />
          <Stat k="Readiness" v={command.readiness.role === 'OFFLINE' ? 'Offline' : command.readiness.ready ? 'Ready' : 'Degraded'}
            s={command.recovery.unresolvedOrders ? `${command.recovery.unresolvedOrders} orders require reconciliation` : 'Paper account'} />
          <Stat k="Closed-position ledger" v={command.ledger.reconciled ? 'Reconciled' : 'Mismatch'}
            s={`${command.ledger.closedPositions} closed · ${fmt.usd(command.ledger.netPnl)} net`} />
          <Stat k="Position protection" v={command.recovery.positions ? `${command.recovery.verifiedPositions} / ${command.recovery.positions} verified` : 'No open positions'}
            s={<Link to="/risk">Risk Center</Link>} />
        </div>
        {command.readiness.checks.filter((check) => check.status === 'fail').map((check) =>
          <div className="hint warn" key={check.name}>{check.detail}</div>)}
      </> : <Empty>Awaiting command status.</Empty>}
    </Card>
    {command && <>
      <div className="grid g2">
        <Card title="Operating lanes" right={<Link to="/connections">{command.providers.live} / {command.providers.total} public sources report live</Link>} flush>
          <div className="tablewrap"><table>
            <thead><tr><th>Lane</th><th>Status</th><th>Last completion</th></tr></thead>
            <tbody>{COMMAND_LANES.map(([id, label, readinessCheck]) => {
              const lane = lanes?.[id];
              const check = command.readiness.checks.find((item) => item.name === readinessCheck);
              const state = command.readiness.role === 'OFFLINE' ? 'Offline' : command.readiness.role === 'STANDBY' ? 'Standby' :
                lane?.error ? 'Error' : check?.status === 'fail' ? 'Overdue' : lane?.deferReason ? 'Deferred' :
                lane?.inFlight ? 'Running' : lane?.completedAt ? 'Completed' : 'Awaiting first pass';
              return <tr key={id}><td>{label}</td><td>{state}{lane?.deferReason && <div className="hint">{lane.deferReason}</div>}</td>
                <td className="faint">{fmt.ago(lane?.completedAt)}</td></tr>;
            })}</tbody>
          </table></div>
        </Card>
        <Card title="Trading intelligence" right={<Link to="/ditas">DITAS</Link>}>
          <div className="kv">
            <span>FAST memecoin</span><span>{command.research.fast.checkedAt
              ? command.research.fast.stale ? 'Stale evidence' : `${command.research.fast.count ?? 0} pairs reviewed`
              : 'Awaiting data'}</span>
            <span>DEEP futures</span><span>{command.research.deep.error ? 'Source unavailable' :
              command.research.deep.checkedAt ? `${command.research.deep.symbol ?? 'Futures'} · ${command.research.deep.stale ? 'Stale evidence' : command.research.deep.state ?? 'Awaiting data'}` :
              'Awaiting data'}</span>
            <span>Funding / open interest</span><span>{fmt.pct(command.research.deep.fundingRate === null ? null : command.research.deep.fundingRate * 100, 4)} / {fmt.num(command.research.deep.openInterest, 1)}</span>
            <span>Shadow choice</span><span>{command.choice?.selected?.split(':').at(-1) ?? command.choice?.reason?.replaceAll('_', ' ') ?? 'Awaiting first comparison'}</span>
            <span>Recent risk denials</span><span>{command.activity.denials} / {command.activity.count} decisions</span>
            {command.choice?.outcome && <>
              <span>Selected paper outcome</span><span>{fmt.usd(command.choice.outcome.netPnl)} net · {fmt.usd(command.choice.outcome.fees)} fees</span>
            </>}
          </div>
        </Card>
      </div>
      <Card title="Execution and latency" right={<Link to="/qhef">QHEF performance</Link>}>
        <div className="grid g3">
          <Stat k="Paper fills" v={String(command.execution.fills)} s={`${fmt.usd(command.execution.fees)} fees · last ${fmt.ago(command.execution.lastFillAt)}`} />
          {([['decision.engine', 'Decision latency'], ['bot.protection', 'Protection latency']] as const).map(([stage, label]) => {
            const sample = command.latency.find((item) => item.stage === stage);
            return <Stat key={stage} k={label} v={sample ? `${fmt.num(sample.p95)} ms` : 'Awaiting samples'}
              s={sample ? `p95 · p99 ${fmt.num(sample.p99)} ms · ${sample.samples} samples` : undefined} />;
          })}
        </div>
      </Card>
    </>}
  </section>;
}

type ManagedPaperPosition = {
  id: string;
  account: string;
  instrument: string;
  qty: number;
  entry_price: number;
  mark: number | null;
  stop_price: number;
  targets: { targets: { price: number; done: boolean }[] };
  opened_at: number;
};

type PositionProtection = { positionId: string; protected: boolean; issue: string | null };

function ManagedPositions({ rows, protection }: { rows?: ManagedPaperPosition[]; protection?: PositionProtection[] }) {
  return <Card title="Open positions" className="mia-managed-positions" right={<Link to="/smart-portfolio">Portfolio</Link>}>
    {!rows ? <Empty>Waiting for paper positions.</Empty>
      : rows.length ? <ul className="mia-position-list">
        {rows.map((position) => {
          const symbol = position.instrument.split(':').at(-1) ?? position.instrument;
          const stop = protection?.find((item) => item.positionId === position.id);
          const pnl = position.mark === null ? null : (position.mark - position.entry_price) * position.qty;
          return <li key={position.id}>
            <div className="row between">
              <strong>{symbol}</strong>
              <Badge v="Paper" tone="b-violet" />
            </div>
            <dl className="mia-facts">
              <dt>Entry</dt><dd>{fmt.px(position.entry_price)}</dd>
              <dt>Last available mark</dt><dd>{fmt.px(position.mark)}</dd>
              <dt>Size</dt><dd>{fmt.num(position.qty, 6)}</dd>
              <dt>Unrealized P&L</dt><dd className={pnlColor(pnl)}>{fmt.usd(pnl)}</dd>
              <dt>Stop-loss</dt><dd>{fmt.px(position.stop_price)}</dd>
              <dt>Profit targets</dt><dd>{position.targets.targets.map((target) => fmt.px(target.price) + (target.done ? ' reached' : '')).join(' · ') || '—'}</dd>
              <dt>Opened</dt><dd>{fmt.ago(position.opened_at)}</dd>
            </dl>
            <div className="row">
              <Badge v={stop?.protected ? 'Protective stop verified' : stop ? 'Protection needs attention' : 'Protection unverified'}
                tone={stop?.protected ? 'b-good' : 'b-warn'} />
              <Link to="/risk">Review protection</Link>
            </div>
            {stop?.issue && <p className="hint">{stop.issue}</p>}
          </li>;
        })}
      </ul> : <Empty>No open paper positions.</Empty>}
  </Card>;
}

function RiskSummary({ shell, command }: { shell: ShellState; command?: CommandStatus }) {
  const ribbon = useRibbon(shell);
  const risk = ribbon.segments.find((segment) => segment.id === 'risk');
  const protectionUnverified = command && command.recovery.verifiedPositions < command.recovery.positions;
  const riskStatus = risk?.tone === 'bad' ? (shell.data?.control.emergency ? 'Emergency stop' : 'New entries blocked')
    : protectionUnverified && !ribbon.stale ? 'Protection needs attention'
    : risk?.tone === 'warn' ? (shell.data?.control.pausedNewOrders ? 'New entries paused'
      : !shell.data?.policyAccepted ? 'Risk policy needed' : 'Risk limits restricted')
    : risk?.tone === 'ok' ? 'Within account limits' : 'Unverified';
  const riskTone = risk?.tone === 'bad' ? 'b-bad' : riskStatus === 'Within account limits' ? 'b-neutral' : 'b-warn';
  return <Stat k="Risk Status" v={<Badge v={riskStatus} tone={riskTone} title={risk?.detail} />}
    s={<Link to="/risk">Review risk and protection</Link>} />;
}

export function Bot({ legacy = false, shell }: { legacy?: boolean; shell: ShellState }) {
  const { data, error, reload } = useApi('/api/bot', { topics: ['bot', 'order', 'position', 'mode', 'risk', 'health'], every: 20_000 });
  const [pw, setPw] = useState(''); const [amt, setAmt] = useState('10000');
  const [mind, setMind] = useState<Mind>('FAST');
  const s = error ? undefined : data?.status; const a = error ? undefined : data?.account;
  const command: CommandStatus | undefined = error ? undefined : data?.command;
  const marksMissing = a?.marksMissing.length ?? 0;
  const unrealized = marksMissing ? null : a?.unrealizedPnl;
  const rows = error ? undefined : (data?.positions as ManagedPaperPosition[] | undefined)?.filter((position) => position.account === 'paper-bot');

  return <Page title={legacy ? 'Bot Account' : 'Autopilot'} right={
    <Link className="mia-panel-link" to="/overview">Account overview <Icon name="arrow-up-right" size={15} /></Link>
  }>
    <ErrorLine e={error} />
    <AutopilotSession mind={mind} onMindChange={setMind} />
    <div className="grid g4 mia-dashboard-section mia-account-summary" aria-label="Paper account summary">
      <Stat k="Account Equity" v={fmt.usd(marksMissing ? null : a?.equity)}
        s={marksMissing ? 'Waiting for position prices' : a ? 'Available paper cash ' + fmt.usd(a.cash) : 'Paper account value'} />
      <Stat k="Active Positions" v={a?.openCount ?? '—'} s="Open paper holdings" />
      <Stat k="Today's P&L" v={fmt.usd(a?.realizedToday)} tone={pnlColor(a?.realizedToday)}
        s={a ? <>Realized today (UTC) · Unrealized {fmt.usd(unrealized)}</> : 'Closed trades and open holdings'} />
      <RiskSummary shell={shell} command={command} />
    </div>
    <ResearchWorkspace mind={mind} source={!data || error ? undefined : command ? 'command' : 'market'} paperPositions={rows}
      positions={<ManagedPositions rows={rows} protection={error ? undefined : data?.command?.protection} />} activity={<AutopilotActivity />} />
    <details className="mia-advanced" open={legacy ? true : undefined}>
      <summary>Advanced Details</summary>
      {!legacy && <GroupTabs />}
    {command && <div className="mia-dashboard-section"><CentralCommand command={command} lanes={s?.lanes} mode={s?.display} /></div>}
    <div className="grid g2" id="paper-controls" tabIndex={-1} aria-label="Paper settings">
      <Card title="Automation mode"><div className="col">
        {MODES.map(([mode, label, description]) => <div key={mode} className="mia-mode-option">
          <div><strong>{label}</strong><p>{description}</p></div>
          {mode === 'BOUNDED_LIVE'
            ? <Link to="/qa">Release gates</Link>
            : s?.mode === mode
              ? <Badge v="Selected" tone="b-violet" />
              : <Action className="sm" label={'Switch to ' + label} disabled={!s || !!error} run={async () => {
                try { await api('/api/control', { body: { mode, password: pw || undefined } }); reload(); }
                finally { setPw(''); }
              }} />}
        </div>)}
        <StepUp value={pw} onChange={setPw} />
        {!s?.policyAccepted && <div className="hint warn">Accept a risk policy in the <Link to="/risk">Risk Center</Link> before paper execution.</div>}
        <div className="row"><Action className="danger" label="Pause new orders" run={async () => { await api('/api/emergency/pause', { body: {} }); reload(); }} />
          {s?.paused && !s?.emergency && <Action label="Resume" run={async () => { try { await api('/api/control', { body: { pausedNewOrders: false, password: pw || undefined } }); reload(); } finally { setPw(''); } }} />}</div>
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
    </details>
  </Page>;
}
/** Revoking reduces risk and needs no passphrase; re-enabling increases it and uses the step-up passphrase entered above. */
function StrategyToggle({ id, pw, clearPassphrase, onChange }: { id: string; pw: string; clearPassphrase: () => void; onChange: () => void }) {
  const shell = useApi('/api/shell'); const dis: string[] = shell.data?.control.disabledStrategies ?? []; const off = dis.includes(id);
  return <Action className="sm" label={off ? 'Re-enable' : 'Revoke'} run={async () => { try { await api('/api/control', { body: off ? { disabledStrategies: dis.filter((x) => x !== id), password: pw || undefined } : { disabledStrategies: [...dis, id] } }); shell.reload(); onChange(); } finally { if (off) clearPassphrase(); } }} />;
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
          {data?.control.pausedNewOrders && !data?.control.emergency && <Action label="Resume new orders (step-up)" run={async () => { try { await api('/api/control', { body: { pausedNewOrders: false, password: pw || undefined } }); reload(); } finally { setPw(''); } }} />}
          {data?.control.emergency && <Action label="Clear emergency (step-up)" run={async () => { try { await api('/api/control', { body: { emergency: false, pausedNewOrders: false, password: pw || undefined } }); reload(); } finally { setPw(''); } }} />}
          <div className="row"><input placeholder='Type "CLOSE ALL"' value={confirm} onChange={(e) => setConfirm(e.target.value)} style={{ width: 150 }} /><Action className="danger" label="Close all positions" run={async () => { try { setResult(await api('/api/emergency/close-all', { body: { confirm, password: pw || undefined } })); reload(); } finally { setPw(''); } }} /></div>
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
            <div className="row"><StepUp value={pw} onChange={setPw} /><Action className="primary" label={data?.policy ? 'Save new version' : 'Accept policy'} run={async () => { try { await api('/api/risk/policy', { body: { policy: draft, password: pw || undefined } }); reload(); } finally { setPw(''); } }} /><button onClick={() => setDraft({ ...data.defaults })}>Reset to defaults</button></div>
          </div>}
        </Card>
        <Card title="Correlation of open positions (1h returns)" flush>{data?.correlation.instruments.length ? <table><thead><tr><th />{data.correlation.instruments.map((i: string) => <th key={i}>{i.split(':')[2].replace('USDT', '')}</th>)}</tr></thead><tbody>{data.correlation.matrix.map((row: any[], i: number) => <tr key={i}><td>{data.correlation.instruments[i].split(':')[2].replace('USDT', '')}</td>{row.map((c, j) => <td key={j} className="num" style={{ background: c == null ? undefined : `rgba(240,80,90,${Math.max(0, c) * 0.35})` }}>{c == null ? '?' : c.toFixed(2)}</td>)}</tr>)}</tbody></table> : <Empty>No open positions.</Empty>}</Card>
        <Card title="Policy history" flush><table><tbody>{(data?.history ?? []).map((h: any) => <tr key={h.version}><td>v{h.version}</td><td className="faint">{fmt.time(h.created_at)}</td><td>{h.accepted_by}</td><td className="hint">risk {h.policy.riskPerTradePct}% · day {h.policy.dailyLossPct}% · DD {h.policy.drawdownHaltPct}%</td></tr>)}</tbody></table>{!data?.history.length && <Empty>No versions yet.</Empty>}</Card>
      </div>
    </div>
  </Page>;
}

export function Portfolio() {
  const { data, error, reload } = useApi('/api/portfolio', { topics: ['position'], every: 20_000 });
  const a = data?.account;
  return <Page title="Smart Portfolio" sub="Track paper equity, exposure, and reconciled positions." right={<span className="mia-context-badge"><Icon name="flask" size={15} /> Paper account</span>}>
    <ErrorLine e={error} />
    {!!a?.marksMissing?.length && <div className="banner info" role="status">Missing market marks for {a.marksMissing.length} position(s). Equity includes estimated position values.</div>}
    <div className="grid g4 mia-dashboard-section">
      <Stat k="Total equity" v={fmt.usd(a?.equity)} s={a ? 'Net allocation ' + fmt.usd(a.deposits) : undefined} />
      <Stat k="Available cash" v={fmt.usd(a?.cash)} s={a ? 'Positions ' + fmt.usd(a.positionsValue) : undefined} />
      <Stat k="Realized P&L" v={fmt.usd(data?.reconciliation.positionsRealized)} tone={pnlColor(data?.reconciliation.positionsRealized)}
        s={data ? data.reconciliation.closedPositions + ' positions closed' : undefined} />
      <Stat k="Unrealized P&L" v={fmt.usd(a?.unrealizedPnl)} tone={pnlColor(a?.unrealizedPnl)} s={a ? 'Today ' + fmt.pct(a.dailyPnlPct) : undefined} />
    </div>
    <div className="grid mia-portfolio-grid mia-dashboard-section">
      <Card title="Realized equity curve" right={<Link to="/history">Trading history</Link>}>
        {data?.equityCurve.length > 1
          ? <Sparkline values={data.equityCurve.map((point: { equity: number }) => point.equity)} height={152} color="var(--mia-lavender)" />
          : <div className="mia-chart-empty mia-portfolio-empty"><Icon name="chart" size={24} /><strong>No equity series yet</strong><span>The curve appears after two or more closed positions.</span></div>}
      </Card>
      <Card title="Asset exposure">
        <AssetExposure positions={data?.open} equity={a?.equity} marksMissing={!!a?.marksMissing?.length} />
      </Card>
    </div>
    <div className="grid g4 mia-dashboard-section">
      <Stat k="Total return" v={a?.deposits ? fmt.pct((a.equity - a.deposits) / a.deposits * 100) : '—'} tone={pnlColor(a?.deposits ? a.equity - a.deposits : null)} />
      <Stat k="Drawdown" v={a ? fmt.num(a.drawdownPct) + '%' : '—'} />
      <Stat k="Open risk" v={a ? fmt.num(a.openRiskPct) + '%' : '—'} s={a ? fmt.usd(a.openRiskUsd) + ' at risk' : undefined} />
      <Stat k="Reconciliation" v={<Badge v={data ? data.reconciliation.ok ? 'PASS' : 'FAIL' : 'Awaiting ledger'} />} s={data?.reconciliation.detail} />
    </div>
    <PositionsTable rows={data?.open ?? []} onChange={reload} />
    <div style={{ height: 14 }} />
    <Card title="Closed positions" flush><div className="tablewrap"><table><thead><tr><th>Closed</th><th>Instrument</th><th>Strategy</th><th className="num">Entry</th><th className="num">Exit</th><th>Exit reason</th><th className="num">Fees</th><th className="num">Net PnL</th><th className="num">R</th></tr></thead>
      <tbody>{(data?.closed ?? []).map((p: any) => <tr key={p.id}><td className="faint">{fmt.time(p.closed_at)}</td><td>{p.instrument.split(':')[2]}</td><td>{p.strategy}</td><td className="num">{fmt.px(p.entry_price)}</td><td className="num">{fmt.px(p.exit_price)}</td><td><Badge v={p.exit_reason} /></td><td className="num">{fmt.usd(p.fees)}</td><td className={`num ${p.realized_pnl < 0 ? 'down' : 'up'}`}>{fmt.usd(p.realized_pnl)}</td><td className="num">{(p.realized_pnl / p.planned_risk).toFixed(2)}</td></tr>)}</tbody></table>{!data?.closed.length && <Empty>No closed positions.</Empty>}</div></Card>
    <div className="grid g2" style={{ marginTop: 14 }}><Card title="External wallets"><Badge v="PENDING_CREDENTIALS" /> <span className="muted">{data?.external.wallets}</span></Card><Card title="Exchange accounts"><Badge v="PENDING_CREDENTIALS" /> <span className="muted">{data?.external.exchanges}</span></Card></div>
  </Page>;
}

type MarkedPosition = { instrument: string; mark: number | null; qty: number };

function AssetExposure({ positions, equity, marksMissing }: { positions?: MarkedPosition[]; equity?: number; marksMissing: boolean }) {
  if (!positions) return <Empty>Awaiting portfolio data.</Empty>;
  if (!positions.length) return <Empty>No open positions.</Empty>;
  if (marksMissing || positions.some(({ mark }) => mark === null)) return <Empty>Exposure is unavailable until each position has a market mark.</Empty>;
  if (equity == null || equity <= 0) return <Empty>Exposure needs a positive account equity.</Empty>;
  const byInstrument = new Map<string, number>();
  for (const { instrument, mark, qty } of positions) {
    byInstrument.set(instrument, (byInstrument.get(instrument) ?? 0) + qty * (mark ?? 0));
  }
  const exposure = [...byInstrument].sort((a, b) => b[1] - a[1]);
  return <ul className="mia-exposure-list">
    {exposure.map(([instrument, value]) => {
      const percent = value / equity * 100;
      return <li key={instrument}>
        <div className="row between"><strong>{instrument.split(':').at(-1)}</strong><span className="mono">{fmt.usd(value)} · {fmt.num(percent, 1)}%</span></div>
        <div className="bar" aria-hidden="true"><i style={{ width: Math.min(100, Math.max(0, percent)) + '%' }} /></div>
      </li>;
    })}
  </ul>;
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
  const [running, setRunning] = useState<string | null>(null);
  const batch = useRef<AbortController | null>(null);
  const batchSymbols = (data?.universe ?? []).slice(0, 12) as string[];
  useEffect(() => () => batch.current?.abort(), []);

  async function runOne() {
    setRunning(`Running ${sym}`);
    try {
      setRes(await api('/api/lab/backtest', { body: { strategyId: strat, symbol: sym, bars } }));
      await reload();
    } finally {
      setRunning(null);
    }
  }

  async function runBatch() {
    const controller = new AbortController();
    const { signal } = controller;
    batch.current = controller;
    const failures: string[] = [];
    try {
      for (const [index, symbol] of batchSymbols.entries()) {
        setRunning(`Running ${index + 1} of ${batchSymbols.length} · ${symbol}`);
        const request = { body: { strategyId: strat, symbol, bars }, signal };
        try {
          try {
            await api('/api/lab/backtest', request);
          } catch (error) {
            // The API rate limit rejects before starting the backtest. Only that response can be retried safely.
            if (!(error instanceof ApiError) || error.status !== 429) throw error;
            const retryAfter = error.retryAfterSeconds;
            if (retryAfter == null || retryAfter > 10) throw error;
            setRunning(`Waiting for the rate limit · ${symbol} (${index + 1} of ${batchSymbols.length})`);
            await new Promise((resolve) => window.setTimeout(resolve, retryAfter * 1000));
            if (signal.aborted) return;
            await api('/api/lab/backtest', request);
          }
        } catch (error) {
          if (signal.aborted) return;
          failures.push(`${symbol} · ${error instanceof Error ? error.message : 'backtest failed'}`);
        }
      }
      await reload();
      if (failures.length) throw new Error(`${batchSymbols.length - failures.length} of ${batchSymbols.length} backtests completed. ${failures.join(' | ')}`);
    } finally {
      batch.current = null;
      if (!signal.aborted) setRunning(null);
    }
  }

  const S = (x: any) => x ? `${x.trades} trades · win ${(x.winRate * 100).toFixed(0)}% · E ${x.expectancyR.toFixed(3)}R · PF ${Number.isFinite(x.profitFactor) ? x.profitFactor.toFixed(2) : '∞'} · maxDD ${x.maxDrawdownR.toFixed(1)}R` : '—';
  return <Page title="Strategy Lab" sub="Point-in-time backtests on real Binance history with fees, spread, slippage, next-bar entries, conservative intrabar ordering and a chronological in-sample / out-of-sample split. Only OUT-OF-SAMPLE results feed live scoring.">
    <ErrorLine e={error} />
    <Card title="Run backtest"><div className="row">
      <select value={strat} onChange={(e) => setStrat(e.target.value)} aria-label="Strategy">{(data?.strategies ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      <input list="lab-syms" value={sym} onChange={(e) => setSym(e.target.value.toUpperCase())} style={{ width: 140 }} aria-label="Symbol" /><datalist id="lab-syms">{(data?.universe ?? []).map((s: string) => <option key={s} value={s} />)}</datalist>
      <select value={bars} onChange={(e) => setBars(Number(e.target.value))} aria-label="History"><option value={1500}>1,500 bars</option><option value={3000}>3,000 bars</option><option value={6000}>6,000 bars</option></select>
      <Action className="primary" label="Run" disabled={running !== null} run={runOne} />
      <Action label={batchSymbols.length === 0 ? 'Run batch' : `Run first ${batchSymbols.length} ${batchSymbols.length === 1 ? 'symbol' : 'symbols'}`} disabled={running !== null || batchSymbols.length === 0} run={runBatch} />
    </div>{running && <div className="hint" role="status">{running}</div>}{res && <div className="col" style={{ marginTop: 12 }}><div className="kv"><span>In-sample</span><span className="mono">{S(res.inSample)}</span><span>Out-of-sample</span><span className="mono">{S(res.outOfSample)}</span><span>Period</span><span>{fmt.time(res.from)} → {fmt.time(res.to)} ({res.bars} bars)</span></div><Sparkline values={[0, ...res.equityR]} height={90} /><ul className="hint" style={{ margin: 0 }}>{res.warnings.map((w: string) => <li key={w}>{w}</li>)}</ul></div>}</Card>
    <div style={{ height: 14 }} />
    <Card title="Strategy lifecycle (Part 18)" right={<StepUp value={pw} onChange={setPw} />} flush><table><thead><tr><th>Strategy</th><th>Status</th><th>OOS aggregate</th><th>Monte Carlo (100 trades @0.5%)</th><th>Paper</th><th>Actions</th></tr></thead>
      <tbody>{(data?.strategies ?? []).map((s: any) => <tr key={s.id}><td><b>{s.name}</b><div className="hint">{s.note}</div></td><td><Badge v={s.status} /></td><td className="mono" style={{ fontSize: 12 }}>{s.stats ? `${S(s.stats)} · ${s.stats.instruments} instr.${s.stats.modelVersion === 1 ? ' · earlier fill model' : ''}` : '—'}</td>
        <td className="mono" style={{ fontSize: 12 }}>{s.stats?.monteCarlo ? `P5 ${fmt.pct(s.stats.monteCarlo.returnP5 * 100, 1)} · P50 ${fmt.pct(s.stats.monteCarlo.returnP50 * 100, 1)} · DD95 ${(s.stats.monteCarlo.maxDdP95 * 100).toFixed(1)}%` : '—'}</td>
        <td className="mono">{s.live ? `${s.live.trades} · ${s.live.expectancyR.toFixed(2)}R` : '—'}</td>
        <td className="row">{s.status !== 'PAPER' && <Action className="sm" label="Promote to paper" run={async () => { try { await api(`/api/lab/strategy/${s.id}/status`, { body: { status: 'PAPER', password: pw || undefined } }); reload(); } finally { setPw(''); } }} />}{s.status !== 'SUSPENDED' && <Action className="sm" label="Suspend" run={async () => { await api(`/api/lab/strategy/${s.id}/status`, { body: { status: 'SUSPENDED' } }); reload(); }} />}<Action className="sm" label="Live candidate" title="Blocked until release gates pass" run={async () => { try { await api(`/api/lab/strategy/${s.id}/status`, { body: { status: 'LIVE_CANDIDATE', password: pw || undefined } }); } finally { setPw(''); } }} /></td></tr>)}</tbody></table></Card>
    <div style={{ height: 14 }} />
    <Card title="Backtest history" flush><div className="tablewrap"><table><thead><tr><th>When</th><th>Strategy</th><th>Instrument</th><th>Out-of-sample</th></tr></thead><tbody>{(data?.backtests ?? []).map((b: any) => <tr key={b.id} className="click" onClick={() => setRes(b)}><td className="faint">{fmt.ago(b.created_at)}</td><td>{b.strategyId}</td><td>{b.instrument.split(':')[2]}</td><td className="mono" style={{ fontSize: 12 }}>{S(b.outOfSample)} <Chg v={null} /></td></tr>)}</tbody></table>{!data?.backtests.length && <Empty>No backtests yet.</Empty>}</div></Card>
  </Page>;
}
