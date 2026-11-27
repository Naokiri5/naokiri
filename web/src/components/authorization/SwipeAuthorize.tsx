import { useEffect, useId, useReducer, useRef, type CSSProperties, type PointerEvent } from 'react';
import { Icon } from '../../brand';
import { SWIPE_IDLE, swipeProgress, swipeReducer } from './swipe';

/**
 * Reusable "swipe to authorize" control (MIA Atelier, section 3).
 *
 * Drag the handle to the end of the track, or focus it and press Enter or Space: activation from a keyboard or an
 * assistive technology is the accessible alternative to the gesture. A mouse click without a drag does nothing, so a
 * stray click cannot authorize. The action fires once; the parent changes `resetKey` to allow another attempt
 * (for example after the server rejected the request). Emergency and protective controls must not use this
 * component: they stay one direct action away.
 */
export function SwipeAuthorize({ label, onAuthorize, disabled = false, busy = false, resetKey = 0, describedBy }: {
  label: string;
  onAuthorize: () => void;
  disabled?: boolean;
  busy?: boolean;
  resetKey?: number | string;
  describedBy?: string;
}) {
  const [state, dispatch] = useReducer(swipeReducer, SWIPE_IDLE);
  const track = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLButtonElement>(null);
  const startX = useRef(0);
  const firedFor = useRef<number | string | null>(null);
  const hintId = useId();
  const inactive = disabled || busy;

  useEffect(() => { dispatch({ type: 'reset' }); }, [resetKey]);
  useEffect(() => {
    // One action per reset key, even if the component re-renders while the request is in flight.
    if (state.phase !== 'fired' || firedFor.current === resetKey) return;
    firedFor.current = resetKey;
    onAuthorize();
  }, [state.phase, resetKey, onAuthorize]);

  const progressAt = (clientX: number) => swipeProgress(startX.current, clientX,
    track.current?.clientWidth ?? 0, (handle.current?.offsetWidth ?? 0) + 12);

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (inactive || state.phase === 'fired') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    startX.current = event.clientX;
    dispatch({ type: 'start' });
  }

  const status = busy ? 'Verifying with the server...' : state.phase === 'fired' ? 'Authorization sent' : label;
  return <div className="mia-swipe" data-phase={state.phase} data-disabled={inactive || undefined}
    style={{ '--swipe-progress': state.progress } as CSSProperties}>
    <div ref={track} className="mia-swipe-track">
      <span className="mia-swipe-fill" aria-hidden="true" />
      <span className="mia-swipe-label" aria-hidden="true">{status}</span>
      <button ref={handle} type="button" className="mia-swipe-handle" disabled={inactive || state.phase === 'fired'}
        aria-label={`${label}: swipe right, or press Enter`} aria-describedby={[hintId, describedBy].filter(Boolean).join(' ')}
        onPointerDown={onPointerDown}
        onPointerMove={(event) => { if (state.phase === 'dragging') dispatch({ type: 'move', progress: progressAt(event.clientX) }); }}
        onPointerUp={() => dispatch({ type: 'release' })}
        onPointerCancel={() => dispatch({ type: 'reset' })}
        // detail === 0: activated by Enter/Space or an assistive technology, never by a plain mouse click.
        onClick={(event) => { if (event.detail === 0 && !inactive) dispatch({ type: 'keyboard' }); }}>
        <Icon name={busy ? 'shield' : 'arrow'} size={20} />
      </button>
    </div>
    <p id={hintId} className="hint mia-swipe-hint" role="status">
      {busy ? 'MIA is verifying this request. Success is shown only after the server confirms it.'
        : 'Slide all the way to the right, or focus the handle and press Enter.'}
    </p>
  </div>;
}
