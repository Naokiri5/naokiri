import { describe, expect, it } from 'vitest';
import { SWIPE_COMPLETE_AT, SWIPE_IDLE, swipeProgress, swipeReducer, type SwipeEvent, type SwipeState } from './swipe';

const run = (events: SwipeEvent[], from: SwipeState = SWIPE_IDLE) => events.reduce(swipeReducer, from);

describe('swipe progress', () => {
  it('maps handle travel onto 0..1 and clamps both ends', () => {
    expect(swipeProgress(100, 100, 400, 64)).toBe(0);
    expect(swipeProgress(100, 268, 400, 64)).toBe(0.5);
    expect(swipeProgress(100, 900, 400, 64)).toBe(1);
    expect(swipeProgress(100, 10, 400, 64)).toBe(0);
  });
  it('is 0 for degenerate or non-finite geometry instead of jumping to complete', () => {
    expect(swipeProgress(0, 50, 60, 64)).toBe(0);
    expect(swipeProgress(0, Number.NaN, 400, 64)).toBe(0);
    expect(swipeProgress(0, 50, Number.POSITIVE_INFINITY, 64)).toBe(0);
  });
});

describe('swipe authorization state', () => {
  it('fires only when released past the threshold', () => {
    expect(run([{ type: 'start' }, { type: 'move', progress: SWIPE_COMPLETE_AT - 0.01 }, { type: 'release' }])).toEqual(SWIPE_IDLE);
    expect(run([{ type: 'start' }, { type: 'move', progress: SWIPE_COMPLETE_AT }, { type: 'release' }]).phase).toBe('fired');
  });
  it('ignores movement that did not start with a press on the handle', () => {
    expect(run([{ type: 'move', progress: 1 }, { type: 'release' }])).toEqual(SWIPE_IDLE);
  });
  it('has a keyboard alternative that needs no gesture', () => {
    expect(run([{ type: 'keyboard' }]).phase).toBe('fired');
  });
  it('cannot fire twice until reset (duplicate submission guard)', () => {
    const fired = run([{ type: 'keyboard' }]);
    for (const e of [{ type: 'start' }, { type: 'move', progress: 0 }, { type: 'release' }, { type: 'keyboard' }] as SwipeEvent[]) {
      expect(swipeReducer(fired, e)).toBe(fired);
    }
    expect(swipeReducer(fired, { type: 'reset' })).toEqual(SWIPE_IDLE);
  });
});
