/**
 * Swipe-to-authorize gesture model. Pure, so the thresholds are unit-tested without a DOM.
 *
 * The swipe only expresses the owner's deliberate intent in the browser. It is never proof of authorization: the
 * server still requires step-up verification and re-checks ownership, mandate limits, risk policy and release gates
 * on every request. A completed swipe fires its action at most once until the control is explicitly reset.
 */

/** Fraction of the track the handle must cross before release counts as an authorization. */
export const SWIPE_COMPLETE_AT = 0.92;

/** Handle travel as a fraction of the usable track (0 = start, 1 = end), clamped and safe against bad geometry. */
export function swipeProgress(startX: number, currentX: number, trackWidth: number, handleWidth: number): number {
  const travel = trackWidth - handleWidth;
  if (![startX, currentX, trackWidth, handleWidth].every(Number.isFinite) || travel <= 0) return 0;
  return Math.min(1, Math.max(0, (currentX - startX) / travel));
}

export type SwipePhase = 'idle' | 'dragging' | 'fired';

export interface SwipeState { phase: SwipePhase; progress: number }
export type SwipeEvent =
  | { type: 'start' }
  | { type: 'move'; progress: number }
  | { type: 'release' }
  | { type: 'keyboard' }
  | { type: 'reset' };

export const SWIPE_IDLE: SwipeState = { phase: 'idle', progress: 0 };

/**
 * Reducer for the control. `fired` is terminal until `reset`: further drags, releases or key presses cannot fire
 * the action a second time, which is the client half of duplicate-submission protection.
 */
export function swipeReducer(state: SwipeState, event: SwipeEvent): SwipeState {
  if (state.phase === 'fired') return event.type === 'reset' ? SWIPE_IDLE : state;
  switch (event.type) {
    case 'start': return { phase: 'dragging', progress: state.progress };
    case 'move': return state.phase === 'dragging' ? { phase: 'dragging', progress: event.progress } : state;
    case 'release': return state.phase === 'dragging' && state.progress >= SWIPE_COMPLETE_AT ? { phase: 'fired', progress: 1 } : SWIPE_IDLE;
    case 'keyboard': return { phase: 'fired', progress: 1 };
    case 'reset': return SWIPE_IDLE;
  }
}
