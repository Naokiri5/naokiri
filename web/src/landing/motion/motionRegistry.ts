import type { ChapterId } from './chapters';

/**
 * Machine-readable catalog of the twenty V5 transition techniques. Every technique has exactly one owning module,
 * an honest status and a fallback. Status meanings:
 *   implemented — running in this build (subject to reduced-motion and capability checks)
 *   fallback    — the specified fallback ships because the required asset or capability is missing
 *   deferred    — intentionally not built; the fallback is what visitors see
 */
export type MotionStatus = 'implemented' | 'fallback' | 'deferred';
export type MotionTrigger = 'load' | 'scroll' | 'pointer' | 'click' | 'reveal';

export interface MotionTechnique {
  id: `T${string}`;
  name: string;
  chapters: ChapterId[];
  trigger: MotionTrigger;
  owner: string;
  cue: string;
  status: MotionStatus;
  fallback: string;
  note?: string;
}

export const MOTION_REGISTRY: readonly MotionTechnique[] = [
  { id: 'T01', name: 'Cinematic Scrollytelling', chapters: ['arrival', 'meet', 'brainos', 'action', 'journey'], trigger: 'scroll', owner: 'motion/sceneController.ts',
    cue: 'One controller maps native scroll to --view/--pin per chapter and the active chapter.', status: 'implemented', fallback: 'Semantic stacked chapters; no forced scrolling.' },
  { id: 'T02', name: 'Scroll-Scrubbing', chapters: ['meet', 'brainos', 'action'], trigger: 'scroll', owner: 'motion/sceneController.ts + landing.css',
    cue: 'Character framing, BrainOS plates and the product stepper derive from clamped chapter progress.', status: 'implemented', fallback: 'All states visible at once with readable copy.' },
  { id: 'T03', name: 'Kinetic Typography', chapters: ['arrival', 'journey'], trigger: 'load', owner: 'sections/Arrival.tsx, sections/BeginJourney.tsx',
    cue: 'Slogan lines rise through overflow masks, 90 ms stagger; DOM text stays whole and exact.', status: 'implemented', fallback: 'Text rendered immediately, no movement.' },
  { id: 'T04', name: 'Sticky Section Transition', chapters: ['action'], trigger: 'scroll', owner: 'sections/IntelligenceInAction.tsx',
    cue: 'One pinned product stage on desktop; SENSE → LEARN steps advance with local progress.', status: 'implemented', fallback: 'Stacked product panels (mobile and reduced motion).' },
  { id: 'T05', name: '3D Camera Fly-Through', chapters: ['meet', 'brainos'], trigger: 'scroll', owner: 'components/brainCoreScene.ts',
    cue: 'Camera dollies toward the intelligence core along one axis as Chapter 03 pins.', status: 'fallback', fallback: 'Layered 2.5D portal plus the core dolly; no architectural 3D world exists.',
    note: 'No approved 3D environment or arch model was supplied; the fly-through is limited to the core scene (shared with T13).' },
  { id: 'T06', name: 'Mask Reveal', chapters: ['arrival', 'brainos'], trigger: 'scroll', owner: 'landing.css (.v5-mask, .v5-portal)',
    cue: 'Headline line masks on load; a Horizon-shaped circular mask opens the Cognitive Lab.', status: 'implemented', fallback: 'Content fully visible.' },
  { id: 'T07', name: 'Shared Element Morphing', chapters: ['brainos', 'action', 'journey'], trigger: 'click', owner: 'components/EntryShell.tsx',
    cue: 'Enter MIA control morphs into the entry shell (View Transitions where supported); core grid hands over to the chart grid.', status: 'implemented', fallback: 'Direct route change with focus preserved.' },
  { id: 'T08', name: 'Layered Parallax', chapters: ['arrival', 'meet'], trigger: 'scroll', owner: 'landing.css (--view driven layers)',
    cue: 'Foreground 0.14, midground 0.08, background 0.03 of local displacement; clamped.', status: 'implemented', fallback: 'Static layers.' },
  { id: 'T09', name: 'Bento Grid Stagger', chapters: ['action'], trigger: 'reveal', owner: 'sections/IntelligenceInAction.tsx',
    cue: 'FAST/DEEP posters and the product trio enter once, 80 ms stagger, DOM order preserved.', status: 'implemented', fallback: 'Cards visible in logical order.' },
  { id: 'T10', name: 'Horizontal Scroll', chapters: ['action'], trigger: 'scroll', owner: 'sections/IntelligenceInAction.tsx',
    cue: 'Optional feature track inside the pinned stage.', status: 'deferred', fallback: 'Stacked product panels.',
    note: 'Adds a second axis inside the sticky stage without improving comprehension; deferred per optional-embellishment rule.' },
  { id: 'T11', name: 'Curtain Reveal', chapters: ['arrival', 'meet', 'action', 'journey'], trigger: 'scroll', owner: 'sections/MeetMia.tsx, sections/BeginJourney.tsx',
    cue: 'Pink and blue panels part as Chapter 02 enters; a graphite curtain rises into Chapter 05.', status: 'implemented', fallback: 'Direct scene switch.' },
  { id: 'T12', name: 'Image Sequence Animation', chapters: ['meet'], trigger: 'scroll', owner: 'components/Aureus.tsx',
    cue: 'Progress-indexed mascot frames.', status: 'fallback', fallback: 'Approved static master render per chapter.',
    note: 'No approved frame sequence or rig exists; frames are never fabricated.' },
  { id: 'T13', name: 'Zoom-Through Transition', chapters: ['brainos'], trigger: 'scroll', owner: 'components/brainCoreScene.ts',
    cue: 'Core keeps its center while the camera dollies in and the circular mask widens.', status: 'implemented', fallback: 'Static SVG core and architecture list.' },
  { id: 'T14', name: 'Liquid Morphing', chapters: ['brainos'], trigger: 'scroll', owner: 'components/brainCoreScene.ts',
    cue: 'Low-amplitude vertex contour drift on the core surface only; paused during particle assembly peak.', status: 'implemented', fallback: 'Static contour.' },
  { id: 'T15', name: 'Magnetic Interaction', chapters: ['arrival', 'journey'], trigger: 'pointer', owner: 'components/MagneticCta.tsx',
    cue: 'Inner label layer follows a fine pointer by at most 6 px; hit area and focus ring never move.', status: 'implemented', fallback: 'Ordinary hover/focus feedback.' },
  { id: 'T16', name: 'Blur-to-Focus', chapters: ['meet'], trigger: 'reveal', owner: 'sections/MeetMia.tsx',
    cue: 'Streetwear detail crops sharpen from 6 px blur over 450 ms on first reveal; text never blurred.', status: 'implemented', fallback: 'Sharp artwork from first render.' },
  { id: 'T17', name: 'Perspective Card Transition', chapters: ['action'], trigger: 'scroll', owner: 'components/ProductPreview.tsx',
    cue: 'Only the decorative instrument back-plate tilts up to 4°; readable data stays flat.', status: 'implemented', fallback: 'Flat frame.' },
  { id: 'T18', name: 'Interactive Character Motion', chapters: ['meet', 'brainos', 'action', 'journey'], trigger: 'scroll', owner: 'components/Aureus.tsx + motion/characterStates.ts',
    cue: 'State machine selects framing and gaze per chapter; subtle pointer response on fine pointers only.', status: 'implemented', fallback: 'Approved static pose per chapter.',
    note: 'Uses the single approved render; no limb articulation is simulated.' },
  { id: 'T19', name: 'Seamless View Transition', chapters: ['journey'], trigger: 'click', owner: 'components/EntryShell.tsx',
    cue: 'Explicit Enter MIA click opens a branded entry shell, then routes to /app where the existing Privy sign-in runs.', status: 'implemented', fallback: 'Normal navigation and focus restoration.' },
  { id: 'T20', name: 'Particle Assembly', chapters: ['brainos'], trigger: 'scroll', owner: 'components/brainCoreScene.ts',
    cue: '40 deterministic pink and blue nodes (24 on small screens) assemble into the core topology at local 40–58%.', status: 'implemented', fallback: 'Static SVG topology.' },
];
