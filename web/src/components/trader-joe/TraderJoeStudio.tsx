import { lazy, Suspense, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { streamState, useApi, useStream } from '../../api';
import { useRibbon, type ShellState } from '../../StatusRibbon';
import { Badge } from '../../ui';
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
const STATE_LABELS: Record<JoeState, { label: string; tone: string }> = {
  STANDBY: { label: 'Standby', tone: 'b-neutral' }, LISTENING: { label: 'Listening', tone: 'b-info' },
  TYPING: { label: 'Answering', tone: 'b-info' }, SCANNING: { label: 'Scan completed', tone: 'b-info' },
  RESEARCHING: { label: 'Decision recorded', tone: 'b-info' }, MONITORING: { label: 'Session running', tone: 'b-good' },
  RISK_ALERT: { label: 'Risk attention', tone: 'b-warn' }, DISCONNECTED: { label: 'Data disconnected', tone: 'b-warn' },
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
  try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; }
}

/**
 * Trader Joe's interactive studio, driven by real BrainOS signals (see JoeStateMapper). Presentation only: it reads
 * the shell status, the paper session state and the event stream; it cannot submit orders, change risk settings or
 * touch wallets. Every monitor in the scene has an equivalent link below it for keyboard and screen-reader users.
 */
export function TraderJoeStudio({ shell, chat }: { shell: ShellState; chat: 'idle' | 'composing' | 'waiting' }) {
  const ribbon = useRibbon(shell); // also re-renders once a second, which expires event reactions on time
  const session = useApi<{ state?: unknown }>('/api/session/paper-spot', { topics: ['bot', 'mode', 'risk', 'position'], every: 30_000 });
  const [lastEvent, setLastEvent] = useState<JoeEvent | null>(null);
  const [show3d, setShow3d] = useState(default3d);
  const reducedMotion = useReducedMotion();
  const nav = useNavigate();
  useStream((topic, payload) => { const e = joeEventFrom(topic, payload, Date.now()); if (e) setLastEvent(e); });

  const view = mapJoeState({
    shell: shell.data, shellUnavailable: ribbon.stale || !!shell.error, streamConnected: streamState.connected,
    sessionState: !session.error && typeof session.data?.state === 'string' ? session.data.state : null,
    chat, lastEvent, now: Date.now(),
  });
  const label = STATE_LABELS[view.state];
  const toggle = () => setShow3d((on) => {
    try { localStorage.setItem(PREF_KEY, on ? 'off' : 'on'); } catch { /* preference is per-visit only */ }
    return !on;
  });

  return <section className="mia-joe-studio" aria-label="Trader Joe studio" data-state={view.state}>
    <div className="mia-joe-stage">
      {show3d
        ? <Suspense fallback={<JoeFallback caption="Loading the 3D studio..." />}>
          <TraderJoeScene state={view.state} reducedMotion={reducedMotion} onMonitor={(m) => nav(MONITORS[m].to)} />
        </Suspense>
        : <JoeFallback />}
    </div>
    <div className="mia-joe-studio-status" role="status" aria-live="polite">
      <Badge v={label.label} tone={label.tone} />
      <p>{view.caption}</p>
    </div>
    <nav className="mia-joe-monitor-links" aria-label="Joe's monitors">
      {(Object.keys(MONITORS) as MonitorId[]).map((id) => <Link key={id} to={MONITORS[id].to}>{MONITORS[id].label}</Link>)}
      <button type="button" className="sm ghost" onClick={toggle} aria-pressed={show3d}>{show3d ? 'Use still image' : 'Show 3D studio'}</button>
    </nav>
  </section>;
}
