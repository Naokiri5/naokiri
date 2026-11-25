import type { ChapterId } from './chapters';

/**
 * AUREUS visual state machine (T18). The only approved artwork is one static master render, so each state
 * selects framing, gaze direction and a caption — never fake limb articulation. A rig or pose sequence can
 * replace the framing per state later without changing callers.
 */
export type CharacterState =
  | 'IDLE' | 'AWAKENING' | 'WELCOMING' | 'OBSERVING' | 'WALKING'
  | 'THINKING' | 'ANALYZING' | 'PROTECTING' | 'PRESENTING' | 'COMPLETING';

export const CHARACTER_STATES: readonly CharacterState[] = [
  'IDLE', 'AWAKENING', 'WELCOMING', 'OBSERVING', 'WALKING', 'THINKING', 'ANALYZING', 'PROTECTING', 'PRESENTING', 'COMPLETING',
];

/** Deterministic: the same chapter and progress always select the same state, in either scroll direction. */
export function characterStateFor(chapter: ChapterId, view: number, pin: number): CharacterState {
  switch (chapter) {
    case 'arrival': return view < 0.55 ? 'AWAKENING' : 'WALKING';
    case 'meet': return view < 0.38 ? 'WELCOMING' : view < 0.58 ? 'IDLE' : 'OBSERVING';
    case 'brainos': return pin < 0.55 ? 'THINKING' : 'ANALYZING';
    case 'action': return pin < 0.45 ? 'PRESENTING' : pin < 0.7 ? 'ANALYZING' : 'PROTECTING';
    case 'journey': return view < 0.5 ? 'COMPLETING' : 'WELCOMING';
  }
}

export const STATE_CAPTION: Record<CharacterState, string> = {
  IDLE: 'Calm and ready',
  AWAKENING: 'Waking up',
  WELCOMING: 'Saying hello',
  OBSERVING: 'Watching the core',
  WALKING: 'On the move',
  THINKING: 'Following the reasoning',
  ANALYZING: 'Checking the evidence',
  PROTECTING: 'Standing with the risk gate',
  PRESENTING: 'Showing the terminal',
  COMPLETING: 'Bringing it together',
};
