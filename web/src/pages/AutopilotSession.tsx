import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, authInfo, fmt, useApi } from '../api';
import miaImage from '../assets/mia-companion.webp';
import { Icon } from '../brand';
import { Badge, Card, Empty, ErrorLine, Freshness, Meter, Modal } from '../ui';
import { SwipeAuthorize } from '../components/authorization/SwipeAuthorize';

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
/** The owner's persisted trading mandate, as reported by the server. The server enforces it at the OMS. */
type Mandate = {
  market_scope: 'BINANCE_SPOT' | 'SOLANA_MEMECOIN' | 'FUTURES';
  capital_ceiling: number;
  risk_policy_version: number;
  authorized_at: number;
  expires_at: number;
  openExposure: number;
  realizedLoss: number;
  capitalInUse: number;
  expired: boolean;
};
type PaperSpotPreflight = Pick<Preflight, 'canRun' | 'canClose' | 'checks'> & {
  state: string;
  mandate?: Mandate | null;
  authorization?: { maxCapital: number; minDurationHours: number; maxDurationHours: number };
};
type PreflightView = { preflight: Preflight | null; error: string | null; reload: () => Promise<void> | void };

const paperSessionLabels: Record<string, string> = {
  RUNNING: 'Paper session running',
  RECOVERING_ON_BOOT: 'Paper session recovering',
  ENTRY_SUSPENDED_RISK_HALT: 'Paper entries suspended',
  CLOSING_DRAINING_ENTRIES: 'Paper session closing',
  EMERGENCY_KILL_SWITCH: 'Emergency stop active',
};
const sessionTopics = ['mode', 'risk', 'health', 'bot', 'position', 'order'];
const scopeLabels: Record<Mandate['market_scope'], string> = {
  BINANCE_SPOT: 'Binance spot', SOLANA_MEMECOIN: 'Solana memecoins', FUTURES: 'Perpetual futures',
};
const DURATIONS = [
  { hours: 1, label: '1 hour' }, { hours: 8, label: '8 hours' }, { hours: 24, label: '24 hours' },
  { hours: 72, label: '3 days' }, { hours: 168, label: '7 days' }, { hours: 720, label: '30 days' },
];

const MIND_CARDS: Record<Mind, { icon: 'bolt' | 'layers'; title: string; pathway: string; scope: string; summary: string }> = {
  FAST: {
    icon: 'bolt', title: 'Memecoin opportunities', pathway: 'Low-latency pathway', scope: 'Solana memecoins',
    summary: 'Explore newly listed tokens and review their liquidity and risk evidence.',
  },
  DEEP: {
    icon: 'layers', title: 'Futures intelligence', pathway: 'Multi-stage reasoning', scope: 'Perpetual futures',
    summary: 'Examine market structure and the evidence behind strategy hypotheses.',
  },
};

function usePreflight(mind: Mind, environment: Environment): PreflightView {
  const { data, error, reload } = useApi<Preflight>(`/api/session/preflight?mind=${mind}&environment=${environment}`,
    { topics: sessionTopics, every: 30_000, isolatePath: true });
  const preflight = !error && data?.schemaVersion === 'mia.session.preflight.v1'
    && data.mind === mind && data.environment === environment ? data : null;
  return { preflight, error, reload };
}

/** Readiness wording comes only from server checks: a research pathway is never shown as executable. */
function mindReadiness({ preflight, error }: PreflightView) {
  if (error) return { label: 'Readiness unavailable', tone: 'b-warn', detail: 'Refresh checks to try again.' };
  if (!preflight) return { label: 'Checking', tone: 'b-neutral', detail: 'Waiting for server readiness checks.' };
  if (preflight.state === 'EMERGENCY') return { label: 'Emergency stop', tone: 'b-bad', detail: 'New entries are blocked.' };
  if (preflight.canRun) return { label: 'Ready', tone: 'b-good', detail: 'Server checks pass for this pathway.' };
  const research = preflight.checks.find((check) => check.id === 'market-data')?.status === 'PASS';
  const lane = preflight.checks.find((check) => check.id === 'execution-lane');
  return {
    label: lane?.status === 'BLOCKED' ? 'Research only' : 'Not ready',
    tone: 'b-neutral',
    detail: `${research ? 'Research data is current.' : 'Awaiting fresh research data.'} Execution is not certified.`,
  };
}

function MindCard({ mind, selected, view, onSelect }: { mind: Mind; selected: boolean; view: PreflightView; onSelect: () => void }) {
  const titleId = useId();
  const detailId = useId();
  const card = MIND_CARDS[mind];
  const readiness = mindReadiness(view);
  return <button type="button" className="mia-mind-card" data-mode={mind.toLowerCase()} aria-pressed={selected}
    aria-labelledby={titleId} aria-describedby={detailId} onClick={onSelect}>
    <span className="mia-mind-head">
      <span className="mia-mind-icon" aria-hidden="true"><Icon name={card.icon} size={18} /></span>
      <span id={titleId} className="mia-mind-name">{mind}</span>
      <span className="mia-mind-status"><Badge v={readiness.label} tone={readiness.tone} /></span>
    </span>
    <span className="mia-mind-title">{card.title}</span>
    <span id={detailId} className="mia-mind-detail">{card.summary} {readiness.detail}</span>
    <span className="mia-mind-facts">
      <span>{card.scope}</span>
      <span>{card.pathway}</span>
    </span>
  </button>;
}

export function AutopilotSession({ mind, onMindChange }: { mind: Mind; onMindChange: (mind: Mind) => void }) {
  const [environment, setEnvironment] = useState<Environment>('PAPER');
  const environmentDescription = useId();
  const views: Record<Mind, PreflightView> = { FAST: usePreflight('FAST', environment), DEEP: usePreflight('DEEP', environment) };
  return <>
    <div className="mia-mandate-bar">
      <div className="mia-mind-cards" role="group" aria-label="Intelligence view">
        {(['FAST', 'DEEP'] as const).map((value) => <MindCard key={value} mind={value} selected={mind === value}
          view={views[value]} onSelect={() => onMindChange(value)} />)}
      </div>
      <div className="mia-environment">
        <span className="mia-field-label">Environment</span>
        <div className="mia-segment mia-execution" role="group" aria-label="Execution environment" aria-describedby={environmentDescription}>
          <button type="button" aria-pressed={environment === 'PAPER'} onClick={() => setEnvironment('PAPER')}>
            <Icon name="flask" size={15} /> Paper
          </button>
          <button type="button" aria-pressed={environment === 'LIVE'} onClick={() => setEnvironment('LIVE')}>
            <Icon name="lock" size={15} /> Live locked
          </button>
        </div>
        <p id={environmentDescription} className="hint">
          {environment === 'PAPER' ? 'Practice trading with simulated funds. Selecting a view never starts trading.' :
            <>Real-money execution requires separate certification. <Link to="/qa">View Live readiness</Link></>}
        </p>
      </div>
    </div>
    <SessionPreflight key={environment} mind={mind} environment={environment} view={views[mind]} />
  </>;
}

function MandateSummary({ paper }: { paper: PaperSpotPreflight }) {
  const mandate = paper.mandate;
  const protection = paper.checks.find((check) => check.id === 'position-protection');
  if (!mandate || paper.state === 'CLOSED') {
    return <p className="hint mia-mandate-empty">
      No active mandate. Run Session asks you to authorize capital and a duration before MIA may open paper positions.
    </p>;
  }
  return <div className="mia-mandate">
    <dl className="mia-mandate-summary" aria-label="Session mandate">
      <div><dt>Market</dt><dd>{scopeLabels[mandate.market_scope]} · Paper</dd></div>
      <div><dt>Risk policy</dt><dd>Version {mandate.risk_policy_version}</dd></div>
      <div>
        <dt>{mandate.expired ? 'Mandate expired' : 'Mandate expires'}</dt>
        <dd><time dateTime={new Date(mandate.expires_at).toISOString()}>{fmt.time(mandate.expires_at)}</time></dd>
      </div>
      <div><dt>Position protection</dt><dd>{protection ? <Badge v={protection.status} /> : '—'}</dd></div>
    </dl>
    <Meter label="Authorized capital in use" value={mandate.capitalInUse} limit={mandate.capital_ceiling} unit=" USD" />
    <p className="hint mia-mandate-breakdown">
      {fmt.usd(mandate.openExposure)} in open positions · {fmt.usd(mandate.realizedLoss)} net realized loss under this mandate, fees included
    </p>
  </div>;
}

function SessionPreflight({ mind, environment, view }: { mind: Mind; environment: Environment; view: PreflightView }) {
  const headingId = useId();
  const reasonId = useId();
  const capitalHint = useId();
  const [showStepUp, setShowStepUp] = useState(false);
  const [credential, setCredential] = useState('');
  const [capital, setCapital] = useState('');
  const [durationHours, setDurationHours] = useState(24);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState('');
  const { preflight, error, reload } = view;
  const paper = useApi<PaperSpotPreflight>(environment === 'PAPER' ? '/api/session/paper-spot' : null,
    { topics: sessionTopics, every: 30_000, isolatePath: true });
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
  const maxCapital = paperState?.authorization?.maxCapital ?? 0;
  const capitalValue = Number(capital);
  const capitalValid = capital.trim() !== '' && Number.isFinite(capitalValue) && capitalValue > 0 && capitalValue <= maxCapital;

  async function changeSession(action: 'run' | 'close') {
    if (pending || (action === 'run' ? !canRun || !credential || !capitalValid : !canClose)) return;
    const body = action === 'run' ? { password: credential, capitalCeiling: capitalValue, durationHours } : {};
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
        {environment === 'PAPER' && <p className="hint">FAST and DEEP provide research. Session controls apply to Binance spot paper trading.</p>}
        <ErrorLine e={actionError} />
      </div>
      <div className="mia-session-actions" aria-busy={pending}>
        <button type="button" className="primary" disabled={!canRun || pending} aria-describedby={reasonId} onClick={() => setShowStepUp(true)}>
          <Icon name="play" size={17} /> Run Session
        </button>
        <button type="button" disabled={!canClose || pending} aria-describedby={reasonId} onClick={() => void changeSession('close')}>Close Session</button>
        <Link to="/risk" className="mia-panel-link"><Icon name="shield" size={17} /> Emergency controls</Link>
      </div>
    </div>
    {environment === 'PAPER' && paperState && <MandateSummary paper={paperState} />}
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
      <form className="mia-mandate-form" onSubmit={(event) => {
        // Enter in a field never authorizes and never moves focus to the handle (a held key would then repeat on it).
        // Only the swipe control's own explicit paths authorize.
        event.preventDefault();
      }}>
        <p>
          MIA may open Binance spot positions with simulated funds, within the current risk policy and the capital you
          authorize. When the mandate expires, new entries stop and existing positions stay protected until they close.
        </p>
        <label>
          <span className="mia-field-label">Authorized capital (USD)</span>
          <input type="number" inputMode="decimal" max={maxCapital || undefined} step="any" value={capital}
            onChange={(event) => setCapital(event.target.value)} aria-describedby={capitalHint} required autoFocus />
          <span id={capitalHint} className="hint">
            Up to {fmt.usd(maxCapital)} of paper capital. This limit includes positions that are already open.
          </span>
        </label>
        <label>
          <span className="mia-field-label">Mandate duration</span>
          <select value={durationHours} onChange={(event) => setDurationHours(Number(event.target.value))}>
            {DURATIONS.map((option) => <option key={option.hours} value={option.hours}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span className="mia-field-label">{usesAuthenticator ? 'Authenticator code' : 'Owner passphrase'}</span>
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
        </label>
        <dl className="mia-auth-preview" aria-label="Permissions you are authorizing">
          <div><dt>Environment</dt><dd>PAPER (simulated funds)</dd></div>
          <div><dt>Market</dt><dd>Binance Spot</dd></div>
          <div><dt>Capital ceiling</dt><dd>{fmt.usd(capitalValid ? capitalValue : null)}</dd></div>
          <div><dt>Session duration</dt><dd>{DURATIONS.find((option) => option.hours === durationHours)?.label}</dd></div>
          <div><dt>Withdrawal permission</dt><dd>Not granted</dd></div>
        </dl>
        <SwipeAuthorize label="Swipe to authorize" busy={pending}
          disabled={!credential || !capitalValid || !canRun}
          onAuthorize={() => void changeSession('run')} />
        <div className="row">
          <button type="button" onClick={dismissStepUp}>Cancel</button>
        </div>
      </form>
    </Modal>}
  </section>;
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
