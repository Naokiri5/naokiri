import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, authInfo, fmt, useApi } from '../api';
import miaImage from '../assets/mia-companion.webp';
import { Icon } from '../brand';
import { Badge, Card, Empty, ErrorLine, Freshness, Modal } from '../ui';

export type Mind = 'FAST' | 'DEEP';
type Environment = 'PAPER' | 'LIVE';
type Check = {
  id: string;
  label: string;
  status: 'PASS' | 'BLOCKED' | 'UNVERIFIED' | 'INFO';
  detail: string;
  observedAt?: number;
};
type Preflight = {
  schemaVersion: 'mia.session.preflight.v1';
  checkedAt: number;
  mind: Mind;
  environment: Environment;
  state: 'PREFLIGHT' | 'EMERGENCY';
  canRun: boolean;
  canClose: boolean;
  checks: Check[];
};
type SessionBoundaries = {
  capitalLimitUsd: number;
  maxSessionLossUsd: number;
  startEquityUsd: number;
  setAt: number;
  capitalUsedUsd: number;
  sessionPnlUsd: number | null;
  breachedAt: number | null;
  breachReason: string | null;
};
type PaperSpotPreflight = Pick<Preflight, 'canRun' | 'canClose' | 'checks'> & {
  state: string;
  boundaries?: SessionBoundaries | null;
  paperEquityUsd?: number | null;
};

/** Suggested starting values: half of paper equity at work, and a loss limit of 2% of equity (the default daily loss limit). */
function suggestedBoundaries(equity: number | null | undefined) {
  if (equity == null || !Number.isFinite(equity) || equity <= 0) return { capital: '', loss: '' };
  return { capital: String(Math.floor(equity * 0.5)), loss: String(Math.max(1, Math.floor(equity * 0.02))) };
}

function boundaryProblem(capital: number, loss: number, equity: number | null | undefined) {
  if (!Number.isFinite(capital) || capital <= 0) return 'Enter a capital limit above zero.';
  if (!Number.isFinite(loss) || loss <= 0) return 'Enter a maximum session loss above zero.';
  if (loss > capital) return 'The maximum session loss cannot exceed the capital limit.';
  if (equity != null && capital > equity) return `The capital limit cannot exceed your paper equity of ${fmt.usd(equity)}.`;
  return '';
}

const paperSessionLabels: Record<string, string> = {
  RUNNING: 'Paper session running',
  RECOVERING_ON_BOOT: 'Paper session recovering',
  ENTRY_SUSPENDED_RISK_HALT: 'Paper entries suspended',
  CLOSING_DRAINING_ENTRIES: 'Paper session closing',
  EMERGENCY_KILL_SWITCH: 'Emergency stop active',
};
const sessionTopics = ['mode', 'risk', 'health', 'bot', 'position', 'order'];

const mindDescriptions: Record<Mind, string> = {
  FAST: 'Explore newly listed tokens and review their liquidity and risk evidence.',
  DEEP: 'Examine market structure and the evidence behind strategy hypotheses.',
};

export function AutopilotSession({ mind, onMindChange }: { mind: Mind; onMindChange: (mind: Mind) => void }) {
  const [environment, setEnvironment] = useState<Environment>('PAPER');
  const modeDescription = useId();
  const environmentDescription = useId();
  return <>
    <div className="mia-mode-bar">
      <div>
        <div className="mia-segment" role="group" aria-label="Intelligence view" aria-describedby={modeDescription}>
          <button type="button" data-mode="fast" aria-pressed={mind === 'FAST'} onClick={() => onMindChange('FAST')}>
            <Icon name="bolt" size={16} /> FAST
          </button>
          <button type="button" data-mode="deep" aria-pressed={mind === 'DEEP'} onClick={() => onMindChange('DEEP')}>
            <Icon name="layers" size={16} /> DEEP
          </button>
        </div>
        <p id={modeDescription} className="hint">{mindDescriptions[mind]}</p>
      </div>
      <div>
        <div className="mia-segment mia-execution" role="group" aria-label="Execution environment" aria-describedby={environmentDescription}>
          <button type="button" aria-pressed={environment === 'PAPER'} onClick={() => setEnvironment('PAPER')}>
            <Icon name="flask" size={15} /> Paper
          </button>
          <button type="button" aria-pressed={environment === 'LIVE'} onClick={() => setEnvironment('LIVE')}>
            <Icon name="lock" size={15} /> Live locked
          </button>
        </div>
        <p id={environmentDescription} className="hint">
          {environment === 'PAPER' ? 'Practice trading with simulated funds.' :
            <>Real-money execution requires authorization. <Link to="/qa">View Live readiness</Link></>}
        </p>
      </div>
    </div>
    <SessionPreflight key={environment} mind={mind} environment={environment} />
  </>;
}

function SessionPreflight({ mind, environment }: { mind: Mind; environment: Environment }) {
  const headingId = useId();
  const reasonId = useId();
  const limitsId = useId();
  const [showStepUp, setShowStepUp] = useState(false);
  const [credential, setCredential] = useState('');
  const [capitalLimit, setCapitalLimit] = useState('');
  const [maxLoss, setMaxLoss] = useState('');
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState('');
  const { data, error, reload } = useApi<Preflight>(`/api/session/preflight?mind=${mind}&environment=${environment}`,
    { topics: sessionTopics, every: 30_000, isolatePath: true });
  const paper = useApi<PaperSpotPreflight>(environment === 'PAPER' ? '/api/session/paper-spot' : null,
    { topics: sessionTopics, every: 30_000, isolatePath: true });
  const preflight = !error && data?.schemaVersion === 'mia.session.preflight.v1'
    && data.mind === mind && data.environment === environment ? data : null;
  const paperState = !paper.error && Array.isArray(paper.data?.checks) ? paper.data : null;
  const emergency = preflight?.state === 'EMERGENCY' || paperState?.state === 'EMERGENCY_KILL_SWITCH';
  const paperSessionLabel = paperState && paperSessionLabels[paperState.state];
  const title = emergency ? 'Emergency stop active' : paperSessionLabel || (error ? 'Readiness unavailable' : preflight ? 'Preflight checked' : 'Checking readiness');
  const paperBlocker = paperState?.checks.find((check) =>
    (check.status === 'BLOCKED' || check.status === 'UNVERIFIED') &&
    !(paperState.state === 'RUNNING' && check.id === 'session-lifecycle'));
  const details = emergency ? 'New entries are blocked. Review position protection in the Risk Center.'
    : environment === 'LIVE' ? 'Real-money execution is locked.'
    : paper.error ? 'Paper session readiness is unavailable. Refresh checks to try again.'
    : paperState?.state === 'CLOSING_DRAINING_ENTRIES' ? 'New entries are blocked while MIA protects and reconciles open positions.'
    : paperBlocker?.detail ?? (paperState?.state === 'RUNNING'
      ? 'MIA is monitoring Binance spot markets and existing paper positions.'
      : 'Binance spot paper sessions use simulated funds.');
  const canRun = paperState?.canRun === true;
  const canClose = paperState?.canClose === true;
  const usesAuthenticator = authInfo.mode === 'privy';
  const equity = paperState?.paperEquityUsd;
  const limitsProblem = boundaryProblem(Number(capitalLimit), Number(maxLoss), equity);
  const boundaries = paperState?.boundaries ?? null;

  function openStepUp() {
    if (!capitalLimit && !maxLoss) {
      const suggestion = suggestedBoundaries(equity);
      setCapitalLimit(suggestion.capital);
      setMaxLoss(suggestion.loss);
    }
    setShowStepUp(true);
  }

  async function changeSession(action: 'run' | 'close') {
    if (pending || (action === 'run' ? !canRun || !credential || !!limitsProblem : !canClose)) return;
    const body = action === 'run' ? { password: credential, capitalLimitUsd: Number(capitalLimit), maxSessionLossUsd: Number(maxLoss) } : {};
    setCredential('');
    setShowStepUp(false);
    setActionError('');
    setPending(true);
    try {
      await api(`/api/session/paper-spot/${action}`, { body });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not update the paper session.');
    } finally {
      await paper.reload();
      setPending(false);
    }
  }

  function dismissStepUp() {
    setShowStepUp(false);
    setCredential('');
  }

  return <section className="card mia-session-hero" aria-labelledby={headingId} data-mind={mind.toLowerCase()}>
    <div className="mia-session-main">
      <img className="mia-session-mascot" src={miaImage} alt="" width="96" height="96" />
      <div className="mia-session-copy">
        <h2 id={headingId}>MIA Autopilot</h2>
        <div className="row" role="status">
          <Badge v={title} tone={emergency ? 'b-bad' : error ? 'b-warn' : 'b-neutral'} />
          <Freshness at={preflight?.checkedAt} label="Checked" />
        </div>
        <p id={reasonId}>{details}</p>
        {environment === 'PAPER' && boundaries && <SessionBoundaryUsage boundaries={boundaries} />}
        {environment === 'PAPER' && <p className="hint">FAST and DEEP provide research. Session controls apply to Binance spot paper trading.</p>}
        <ErrorLine e={actionError} />
      </div>
      <div className="mia-session-actions" aria-busy={pending}>
        <button type="button" className="primary" disabled={!canRun || pending} aria-describedby={reasonId} onClick={openStepUp}>
          <Icon name="play" size={17} /> Run Session
        </button>
        <button type="button" disabled={!canClose || pending} aria-describedby={reasonId} onClick={() => void changeSession('close')}>Close Session</button>
        <Link to="/risk" className="mia-panel-link"><Icon name="shield" size={17} /> Emergency controls</Link>
      </div>
    </div>
    <details className="mia-session-checklist" open={error ? true : undefined}>
      <summary>Session readiness checklist</summary>
      {paperState && <>
        <h3>Binance spot paper checks</h3>
        <ul className="mia-preflight-list">
          {paperState.checks.map((check) => <li key={check.id}>
            <div className="row between"><strong>{check.label}</strong><Badge v={check.status} /></div>
            <p className="hint">{check.detail}</p>
          </li>)}
        </ul>
        <h3>{mind} research checks</h3>
      </>}
      {preflight ? <ul className="mia-preflight-list">
        {preflight.checks.map((check) => <li key={check.id}>
          <div className="row between"><strong>{check.label}</strong><Badge v={check.status} /></div>
          <p className="hint">{check.detail}</p>
          {check.observedAt && <Freshness at={check.observedAt} label="Observed" />}
        </li>)}
      </ul> : <p className="hint">{error ?? 'Waiting for server readiness checks.'}</p>}
      <div className="mia-session-links">
        {environment === 'PAPER' && <Link to="/bot#paper-controls">Paper Account</Link>}
        <Link to="/risk">Review Risk Policy</Link>
        <Link to="/connections">Connection Status</Link>
        {environment === 'PAPER' && <Link to="/qa">Live Readiness</Link>}
        <button type="button" className="sm" onClick={() => void Promise.all([reload(), paper.reload()])}>Refresh checks</button>
      </div>
    </details>
    {showStepUp && <Modal title="Authorize Binance spot paper session" onClose={dismissStepUp}>
      <form onSubmit={(event) => { event.preventDefault(); void changeSession('run'); }}>
        <p>This session uses simulated funds and the current risk policy. Set how much capital MIA may have in open positions
          and how much the session may lose before new entries stop. Open positions stay protected either way.</p>
        <div className="grid g2" style={{ gap: 10 }}>
          <label className="col" style={{ gap: 3 }}>
            <span className="hint">Capital limit (USD){equity != null && <> · paper equity {fmt.usd(equity)}</>}</span>
            <input type="number" inputMode="decimal" min="0" step="any" required value={capitalLimit} autoFocus
              onChange={(event) => setCapitalLimit(event.target.value)} aria-describedby={limitsId} />
          </label>
          <label className="col" style={{ gap: 3 }}>
            <span className="hint">Maximum session loss (USD)</span>
            <input type="number" inputMode="decimal" min="0" step="any" required value={maxLoss}
              onChange={(event) => setMaxLoss(event.target.value)} aria-describedby={limitsId} />
          </label>
        </div>
        <p id={limitsId} className="hint" aria-live="polite">
          {limitsProblem || 'Entries stop when open positions would exceed the capital limit, or when session losses reach the maximum.'}
        </p>
        <div className="row">
          <input
            type={usesAuthenticator ? 'text' : 'password'}
            inputMode={usesAuthenticator ? 'numeric' : undefined}
            maxLength={usesAuthenticator ? 6 : 1024}
            pattern={usesAuthenticator ? '[0-9]{6}' : undefined}
            autoComplete={usesAuthenticator ? 'one-time-code' : 'current-password'}
            aria-label={usesAuthenticator ? 'Authenticator step-up code' : 'Owner passphrase for step-up authentication'}
            placeholder={usesAuthenticator ? 'Six-digit authenticator code' : 'Owner passphrase (step-up)'}
            value={credential}
            onChange={(event) => setCredential(event.target.value)}
            required
          />
          <button type="submit" className="primary" disabled={!credential || !canRun || pending || !!limitsProblem}>Authorize and run</button>
          <button type="button" onClick={dismissStepUp}>Cancel</button>
        </div>
      </form>
    </Modal>}
  </section>;
}

function SessionBoundaryUsage({ boundaries }: { boundaries: SessionBoundaries }) {
  const pnl = boundaries.sessionPnlUsd;
  return <p className="hint" data-testid="session-boundaries">
    Capital in use {fmt.usd(boundaries.capitalUsedUsd)} of {fmt.usd(boundaries.capitalLimitUsd)} · Session P&amp;L{' '}
    {pnl == null ? 'unverified' : fmt.usd(pnl)} · {boundaries.breachedAt
      ? <Badge v={`Loss limit ${fmt.usd(boundaries.maxSessionLossUsd)} reached`} tone="b-bad" />
      : <>entries stop at a {fmt.usd(boundaries.maxSessionLossUsd)} loss</>}
  </p>;
}

type Activity = {
  at: number;
  kind: 'DECISION' | 'FILL' | 'REJECTION' | 'ALERT' | 'INCIDENT';
  title: string;
  detail: string;
  tone: 'good' | 'bad' | 'warn' | 'info';
  link: string | null;
  count: number;
  firstAt: number;
};
const categories: Record<Activity['kind'], string> = {
  DECISION: 'Strategy', FILL: 'Execution', REJECTION: 'Risk', ALERT: 'System', INCIDENT: 'Position',
};

export function AutopilotActivity() {
  const { data, error } = useApi<{ activity: Activity[] }>('/api/activity',
    { topics: ['decision', 'order', 'position', 'notification', 'risk', 'scan'], every: 30_000 });
  return <Card title="MIA Activity" className="mia-activity" flush>
    {error ? <Empty>Activity unavailable. <Link to="/connections">Check connections</Link></Empty>
      : data?.activity.length ? <ul className="mia-activity-list">
        {data.activity.slice(0, 8).map((item) => <li key={JSON.stringify([item.kind, item.at, item.title, item.detail])}>
          <details>
            <summary>
              <span className="row between">
                <Badge v={categories[item.kind]} tone={`b-${item.tone}`} />
                <time className="hint" dateTime={new Date(item.at).toISOString()} title={fmt.time(item.at)}>
                  {new Date(item.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </time>
              </span>
              <strong>{item.title}</strong>
              {item.count > 1 && <span className="hint"> · {item.count} events since {fmt.time(item.firstAt)}</span>}
            </summary>
            <p>{item.detail}</p>
            {item.link && <Link to={item.link}>View recorded evidence <Icon name="arrow-up-right" size={13} /></Link>}
          </details>
        </li>)}
      </ul> : <Empty>{data ? 'No decisions, paper fills or alerts have been recorded yet.' : 'Loading activity…'}</Empty>}
  </Card>;
}
