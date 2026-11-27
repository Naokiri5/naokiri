import { useEffect, useId, useReducer, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { Icon } from '../../brand';
import { SWIPE_IDLE, swipeProgress, swipeReducer } from './swipe';

/**
 * Reusable "swipe to authorize" control (MIA Atelier, section 3).
 *
 * Ways to authorize, each a deliberate act:
 *  - drag the handle to the end of the track;
 *  - focus the handle and press Enter or Space (a fresh key press on the handle itself; a held or repeating key, or
 *    an Enter that started in a form field, never counts);
 *  - "Can't swipe?" opens a second, explicit "Confirm" button for touch screen readers and switch users.
 * A plain mouse click on the handle does nothing. The action fires once; the parent changes `resetKey` to allow
 * another attempt. Emergency and protective controls must not use this component: they stay one direct action away.
 * The control only expresses intent: the server still verifies the owner and re-checks every limit.
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
  const [alternate, setAlternate] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLButtonElement>(null);
  const startX = useRef(0);
  const firedFor = useRef<number | string | null>(null);
  const hintId = useId();
  const inactive = disabled || busy;

  useEffect(() => { dispatch({ type: 'reset' }); setAlternate(false); }, [resetKey]);
  // Becoming disabled mid-gesture cancels it, so a release after the inputs changed cannot fire.
  useEffect(() => { if (inactive) dispatch({ type: 'reset' }); }, [inactive]);
  useEffect(() => {
    // One action per reset key, even if the component re-renders while the request is in flight.
    if (state.phase !== 'fired' || inactive || firedFor.current === resetKey) return;
    firedFor.current = resetKey;
    onAuthorize();
  }, [state.phase, inactive, resetKey, onAuthorize]);

  const progressAt = (clientX: number) => swipeProgress(startX.current, clientX,
    track.current?.clientWidth ?? 0, (handle.current?.offsetWidth ?? 0) + 12);

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (inactive || state.phase === 'fired') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    startX.current = event.clientX;
    dispatch({ type: 'start' });
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    // Handle the key here and suppress the browser's synthetic click, so only this explicit path can authorize.
    event.preventDefault();
    if (!event.repeat && !inactive) dispatch({ type: 'keyboard' });
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
        onKeyDown={onKeyDown}>
        <Icon name={busy ? 'shield' : 'arrow'} size={20} />
      </button>
    </div>
    <p id={hintId} className="hint mia-swipe-hint" role="status">
      {busy ? 'MIA is verifying this request. Success is shown only after the server confirms it.'
        : 'Slide all the way to the right, or focus the handle and press Enter.'}
    </p>
    {!alternate
      ? <button type="button" className="sm ghost mia-swipe-alt" disabled={inactive || state.phase === 'fired'} onClick={() => setAlternate(true)}>
        Can't swipe? Confirm with a button
      </button>
      : <div className="row mia-swipe-alt">
        <button type="button" className="primary" disabled={inactive || state.phase === 'fired'} onClick={() => dispatch({ type: 'keyboard' })}>
          Confirm authorization
        </button>
        <button type="button" className="sm ghost" onClick={() => setAlternate(false)}>Back to swipe</button>
      </div>}
  </div>;
}
