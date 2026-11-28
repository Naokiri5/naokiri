import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { streamState } from './api';
import { deriveStatus, type RibbonModel, type ShellDto } from './status';

export interface ShellState { data: ShellDto | null; requestedAt: number | null; error: string | null; reload: () => void }

/** Ticks once a second inside the component that uses it, so ages advance without re-rendering the whole shell. */
export function useRibbon(shell: ShellState): RibbonModel {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => { const t = window.setInterval(() => setNow(performance.now()), 1000); return () => clearInterval(t); }, []);
  return deriveStatus({ shell: shell.data, requestedAt: shell.requestedAt, error: shell.error, streamConnected: streamState.connected, now });
}

/** Persistent header ribbon: mode, live lock, market data, engine, risk and server link. Each segment opens its source page. */
export function StatusRibbon({ shell }: { shell: ShellState }) {
  const nav = useNavigate(); const model = useRibbon(shell); const s = shell.data;
  const modeCls = !s || model.stale ? 'UNKNOWN' : s.control?.emergency ? 'EMERGENCY' : s.control?.pausedNewOrders ? 'PAUSED' : s.mode === 'OBSERVE' ? 'READ-ONLY' : 'PAPER';
  return <div className="ribbon" role="group" aria-label="Autopilot status">
    {model.segments.map((g) => <button key={g.id} type="button" className={`seg t-${g.tone}`} data-seg={g.id} data-tone={g.tone} title={g.detail}
      aria-label={`${g.label}: ${g.value}. ${g.detail}`} onClick={() => (g.to ? nav(g.to) : shell.reload())}>
      {g.id === 'mode' ? <span className={`mode ${modeCls}`} data-m={s?.display}>{g.value}</span>
        : <><span className={`dot ${g.tone}`} aria-hidden /><span className="k">{g.label}</span><span className="v">{g.value}</span></>}
    </button>)}
  </div>;
}

/** Shown while the last good status is older than the stale window. The alert text is stable; the ticking age sits outside it. */
export function StaleBanner({ shell }: { shell: ShellState }) {
  const model = useRibbon(shell);
  if (!model.stale) return null;
  return <div className="banner stale"><span role="alert">⚠ Lost contact with the MIA server. Everything on screen may be out of date until the link recovers.</span>
    <span>Status last confirmed {model.lastConfirmedAgo ? `${model.lastConfirmedAgo} ago` : 'never'}.</span></div>;
}
