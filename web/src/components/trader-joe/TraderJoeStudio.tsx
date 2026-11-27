import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { streamState, useApi, useStream } from '../../api';
import { Icon } from '../../brand';
import { useRibbon, type ShellState } from '../../StatusRibbon';
import { Badge, Card } from '../../ui';
import { joeEventFrom, mapJoeState, type JoeEvent, type JoeState } from './JoeStateMapper';
import { JoeFallback } from './JoeFallback';
import type { MonitorId } from './studio';

/** three.js and the scene load only when the studio is actually shown. */
const TraderJoeScene = lazy(() => import('./TraderJoeScene'));

const MONITORS: Record<MonitorId, { to: string; label: string }> = {
  decisions: { to: '/ditas', label: 'Decision records' },
  market: { to: '/terminal', label: 'Market terminal' },
  portfolio: { to: '/smart-portfolio', label: 'Portfolio' },
};
const WORKSPACES = [
  { to: '/autopilot', label: 'Session readiness' },
  ...Object.values(MONITORS),
  { to: '/risk', label: 'Risk Center' },
];
const STATE_LABELS: Record<JoeState, { label: string; tone: string }> = {
  STANDBY: { label: 'Standby', tone: 'b-neutral' }, LISTENING: { label: 'Listening', tone: 'b-info' },
  TYPING: { label: 'Answering', tone: 'b-info' }, SCANNING: { label: 'Scan completed', tone: 'b-info' },
  RESEARCHING: { label: 'Decision recorded', tone: 'b-info' }, MONITORING: { label: 'Session running', tone: 'b-good' },
  RISK_ALERT: { label: 'Risk attention', tone: 'b-warn' }, REJECTION: { label: 'Candidate rejected', tone: 'b-neutral' },
  RECOVERING: { label: 'Session recovering', tone: 'b-info' }, DISCONNECTED: { label: 'Data disconnected', tone: 'b-warn' },
  POSITION_REVIEW: { label: 'Position closed', tone: 'b-info' }, SESSION_CLOSING: { label: 'Session closing', tone: 'b-warn' },
  SYSTEM_ERROR: { label: 'Status unavailable', tone: 'b-warn' },
};
const PREF_KEY = 'mia-joe-3d';

function useReducedMotion() {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(query); const on = () => setReduced(m.matches);
    m.addEventListener('change', on); return () => m.removeEventListener('change', on);
  }, []);
  return reduced;
}

/** 3D is on by default only where it is likely to run smoothly; the owner's explicit choice always wins. */
function default3d(): boolean {
  try {
    const stored = localStorage.getItem(PREF_KEY);
    if (stored === 'on' || stored === 'off') return stored === 'on';
  } catch { /* storage can be blocked */ }
  const nav = navigator as Navigator & { connection?: { saveData?: boolean } };
  if (nav.connection?.saveData || (nav.hardwareConcurrency ?? 4) <= 2) return false;
  return webglAvailable();
}

/** Probe once per page load and release the probe context at once: browsers cap live WebGL contexts. */
let webglProbe: boolean | null = null;
function webglAvailable(): boolean {
  if (webglProbe !== null) return webglProbe;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    webglProbe = !!gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { webglProbe = false; }
  return webglProbe;
}

/**
 * Trader Joe's interactive studio, driven by real BrainOS signals (see JoeStateMapper). Presentation only: it reads
 * the shell status, the paper session state and the event stream; it cannot submit orders, change risk settings or
 * touch wallets. Every monitor in the scene has an equivalent link below it for keyboard and screen-reader users.
 */
export function TraderJoeStudio({ shell, chat }: { shell: ShellState; chat: 'idle' | 'composing' | 'waiting' }) {
  const ribbon = useRibbon(shell); // also re-renders once a second, which expires event reactions on time
  const session = useApi<{ state?: unknown }>('/api/session/paper-spot', { topics: ['bot', 'mode', 'risk', 'position'], every: 30_000 });
  // Open protection incidents persist until data recovers, so Joe keeps the alert instead of only reacting to the event.
  const incidents = useApi<{ status?: unknown }[]>('/api/risk/incidents', { topics: ['risk', 'position'], every: 60_000 });
  const [lastEvent, setLastEvent] = useState<JoeEvent | null>(null);
  const [show3d, setShow3d] = useState(default3d);
  const reducedMotion = useReducedMotion();
  const nav = useNavigate();
  useStream((topic, payload) => { const e = joeEventFrom(topic, payload, Date.now()); if (e) setLastEvent(e); });

  const view = mapJoeState({
    shell: shell.data, shellUnavailable: ribbon.stale || !!shell.error, streamConnected: streamState.connected,
    sessionState: !session.error && typeof session.data?.state === 'string' ? session.data.state : null,
    openIncidents: !incidents.error && Array.isArray(incidents.data) ? incidents.data.filter((i) => i?.status === 'OPEN').length : null,
    chat, lastEvent, now: Date.now(),
  });
  const label = STATE_LABELS[view.state];
  const toggle = () => setShow3d((on) => {
    try { localStorage.setItem(PREF_KEY, on ? 'off' : 'on'); } catch { /* preference is per-visit only */ }
    return !on;
  });

  return <section className="mia-joe-studio" aria-label="Trader Joe studio" data-state={view.state}>
    <Card className="mia-joe-studio-panel">
      <div className="mia-joe-studio-heading">
        <h2>Studio</h2>
        <button type="button" className="sm ghost" onClick={toggle} aria-pressed={show3d}>
          {show3d ? 'Use still image' : 'Show 3D studio'}
        </button>
      </div>
      <div className="mia-joe-stage">
        {show3d
          ? <Suspense fallback={<JoeFallback caption="Loading the 3D studio..." />}>
            <TraderJoeScene state={view.state} reducedMotion={reducedMotion} onMonitor={(m) => nav(MONITORS[m].to)} />
          </Suspense>
          : <JoeFallback />}
      </div>
      <div className="mia-joe-studio-status" role="status">
        <Badge v={label.label} tone={label.tone} />
        <p>{view.caption}</p>
      </div>
      <nav className="mia-joe-workspace-links" aria-label="Related workspaces">
        <h3>Related workspaces</h3>
        <ul>{WORKSPACES.map(({ to, label }) => <li key={to}><Link to={to}>
          {label} <Icon name="chevron" size={13} />
        </Link></li>)}</ul>
      </nav>
    </Card>
  </section>;
}
