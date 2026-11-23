import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { fmt, useApi } from '../api';
import miaImage from '../assets/mia-companion.webp';
import { Icon } from '../brand';
import { Badge, Card, Empty, Freshness } from '../ui';

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
    <SessionPreflight mind={mind} environment={environment} />
  </>;
}

function SessionPreflight({ mind, environment }: { mind: Mind; environment: Environment }) {
  const headingId = useId();
  const reasonId = useId();
  const { data, error, reload } = useApi<Preflight>(`/api/session/preflight?mind=${mind}&environment=${environment}`,
    { topics: ['mode', 'risk', 'health', 'bot', 'position', 'order'], every: 30_000, isolatePath: true });
  const preflight = !error && data?.schemaVersion === 'mia.session.preflight.v1'
    && data.mind === mind && data.environment === environment ? data : null;
  const emergency = preflight?.state === 'EMERGENCY';
  const lane = preflight?.checks.find((check) => check.id === 'execution-lane');
  const policy = preflight?.checks.find((check) => check.id === 'risk-policy');
  const title = emergency ? 'Emergency stop active' : error ? 'Readiness unavailable' : preflight ? 'Preflight checked' : 'Checking readiness';
  const details = emergency ? 'New entries are blocked. Review position protection in the Risk Center.'
    : error ? 'MIA could not verify this environment. Refresh its checks before relying on this status.'
    : preflight ? policy?.status === 'BLOCKED' && environment === 'PAPER' ? policy.detail : lane?.detail ?? 'Session controls are unavailable for this trading mode.'
    : 'MIA is checking your selected mode and environment.';

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
      </div>
      <div className="mia-session-actions">
          <button type="button" className="primary" disabled aria-describedby={reasonId}>
          <Icon name="play" size={17} /> Run Session
        </button>
        <button type="button" disabled aria-describedby={reasonId}>Close Session</button>
        <Link to="/risk" className="mia-panel-link"><Icon name="shield" size={17} /> Emergency controls</Link>
      </div>
    </div>
    <details className="mia-session-checklist" open={error ? true : undefined}>
      <summary>Session readiness checklist</summary>
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
        <button type="button" className="sm" onClick={() => void reload()}>Refresh checks</button>
      </div>
    </details>
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
