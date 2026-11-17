import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { streamState } from './api';
import { deriveStatus, type RibbonModel, type ShellDto } from './status';

/** Re-render once a second so ages and staleness advance without new data. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

export function useRibbon(shell: { data: ShellDto | null; updatedAt: number | null; error: string | null }): RibbonModel {
  const now = useNow();
  return deriveStatus({ shell: shell.data, fetchedAt: shell.updatedAt, error: shell.error, streamConnected: streamState.connected, now });
}

/** Persistent header ribbon: mode, live lock, market data, engine, risk and server link. Each segment opens its source page. */
export function StatusRibbon({ model, shell, onRetry }: { model: RibbonModel; shell: ShellDto | null; onRetry: () => void }) {
  const nav = useNavigate();
  const modeCls = !shell || model.stale ? 'UNKNOWN' : shell.control.emergency ? 'EMERGENCY' : shell.control.pausedNewOrders ? 'PAUSED' : shell.mode === 'OBSERVE' ? 'READ-ONLY' : 'PAPER';
  return <div className="ribbon" role="group" aria-label="Autopilot status">
    {model.segments.map((s) => <button key={s.id} type="button" className={`seg t-${s.tone}`} data-seg={s.id} data-tone={s.tone} title={s.detail}
      aria-label={`${s.label}: ${s.value}. ${s.detail}`} onClick={() => (s.to ? nav(s.to) : onRetry())}>
      {s.id === 'mode' ? <span className={`mode ${modeCls}`} data-m={shell?.display}>{s.value}</span>
        : <><span className={`dot ${s.tone}`} aria-hidden /><span className="k">{s.label}</span><span className="v">{s.value}</span></>}
    </button>)}
  </div>;
}
