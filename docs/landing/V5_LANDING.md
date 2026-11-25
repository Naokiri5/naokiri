# MIA AI V5 landing page — "Intelligence Unleashed"

Implements the V5.0 master prompt (pastel streetwear × retro-futuristic intelligence) on the existing React/Vite
app. Public route `/`; the protected terminal stays at `/app` and is now lazy-loaded, so the landing page does not ship
the Privy SDK or dashboard code (main bundle 682 kB → 298 kB minified).

## Source map

| Path | Role |
|---|---|
| `web/src/Landing.tsx` | Composition root: one `SceneStore`, one scroll controller, five chapters, nav, rail, footer. |
| `web/src/landing/motion/sceneController.ts` | **Only** scroll owner (T01). Writes `--view`/`--pin` per chapter and `--pin` per `[data-track]`; owns the single reveal `IntersectionObserver`; reduced-motion hook. |
| `web/src/landing/motion/motionRegistry.ts` | Machine-readable T01–T20 catalog (owner, cue, status, fallback). |
| `web/src/landing/motion/characterStates.ts` | AUREUS state machine (IDLE … COMPLETING), pure and unit-tested. |
| `web/src/landing/components/brainCoreScene.ts` | three.js BrainOS core (lazy chunk): translucent pink/blue shell, nucleus, Horizon arcs, 40 deterministic nodes. |
| `web/src/landing/components/EntryShell.tsx` | Click-only handoff to `/app` (View Transitions when available); cancel/Escape restore focus and scroll. |
| `web/src/landing/sections/*` | Arrival, MeetMia, EnterBrainOS, IntelligenceInAction, BeginJourney. |
| `web/src/landing/landing.css` | Tokens, chapter layouts, motion and reduced-motion rules (scoped under `.v5`). |
| `web/public/brand`, `web/public/mascot` | Official logo variants and the AUREUS cutout (see `asset-manifest.json`). |

## Brand and color

- **Logo:** no SVG kit was attached, so the official monochrome rasters embedded in *Brand Guidelines V3.0* were
  extracted unchanged (compact lockup, slogan lockup, symbol, app icons) and exported as black or white only. They are
  never tinted; the dashboard uses them as CSS masks filled with pure `#000`/`#FFF` per theme. Minimum sizes respected
  (compact 160 px in the nav; symbol ≥ 32 px).
- **Slogan:** "Trading reimagined for the age of intelligence" is the hero `<h1>` text exactly; ™ appears only in the footer line.
- **Tokens:** cream `#FFF5F7`, candy pink `#F48BB8`, sky blue `#8FD3F4`, lavender `#8E8196` (decorative only),
  graphite `#2B2430`, muted `#62566B`. Pink/blue buttons always carry graphite text.
- **Contrast (computed, WCAG 2.x):** graphite on cream 14.06, on pink 6.60, on blue 9.15; muted on cream 6.42,
  on white 6.86; dashboard faint `#7A6D82` on white 4.84; danger `#B42318` on its tint 5.65. White on pink (2.27) and
  white on blue (1.64) are never used for text.
- **Semantics:** profit/loss, errors and approvals use independent status colors (green/red/amber), never pink or blue.
- No gold remains in active styles: the old Obsidian Palazzo stylesheet (`web/src/landing.css`) was removed.

## Five chapters (cue sheet)

| # | Chapter | Scroll design | Dominant transition | Exit anchor |
|---|---|---|---|---|
| 01 | The Arrival (cream) | ~100 svh | T03+T06 masked slogan lines (load); T08 parallax CRT stack, tape, arch; AUREUS peeks over the monitor | Architectural arch |
| 02 | Meet MIA (blush) | natural height | T11 pink/blue curtain → T18 AUREUS reveal before the THINK backplate; street-sign plates are real links; T16 detail crops | Portal seed (pink/blue orb) |
| 03 | Enter BrainOS (ice/cream) | 340 vh, one pinned stage | T06 circular portal mask + T13 camera dolly into the WebGL core; T20 node assembly at 40–58 %; layers fade in by `--pin`; blocked decision at 86 % | Grid backdrop → chart grid |
| 04 | Intelligence in Action (white) | 300 vh pinned product stage, then FAST/DEEP, Guardian, trio | T04 sticky stage, SENSE→LEARN stepper, T17 tilt on the decorative back-plate only, T09 stagger | White curtain |
| 05 | Begin Your Journey (graphite) | natural height | T11 curtain retracts; T03 slogan return; T15 magnetic CTA; T19 entry shell on click | `/app` (Privy) or restored landing |

Mobile (≤ 900 px) and reduced motion replace both pinned stages with stacked, fully visible panels.

## Twenty techniques

`MOTION_REGISTRY` is the source of truth (and is unit-tested to contain T01–T20 exactly once with a fallback).
Implemented: T01–T04, T06–T09, T11, T13–T20. **Fallback:** T05 (no approved 3D environment — the camera move is limited
to the core scene) and T12 (no approved image sequence — the static master render is used). **Deferred:** T10
horizontal scroll (adds a second axis inside the pinned stage without improving comprehension).

## AUREUS

Only one approved render exists. Its near-white background was removed with an edge-connected matte (no recolor,
no retouch); states change framing, gaze and caption only — no fake limb articulation. A rig, turnaround or pose
sequence would plug into `Aureus.tsx` per state.

## Authentication handoff

Phases: `idle → requested → navigate('/app')`. The shell explains that Privy opens next, that sign-in is identity
only, and that trading stays paper/locked. Scrolling cannot open it (e2e-tested); duplicate clicks are ignored;
Escape/Cancel restore focus and scroll. All real states (pending, verified, owner check, 2FA, errors) remain in the
existing `WalletLogin`/server flow — no second auth system.

## Honesty rules applied

- FAST (memecoins) and DEEP (futures) are labeled **Planned mode · not live** because no memecoin or futures venue
  exists in this repository; each card states what works today.
- Guardian lists only safeguards present in the code as "In build"; token-safety scoring and margin guards are "Proposed".
- Every chart and number is a deterministic local fixture labeled DEMO/illustrative; the page makes no API calls (e2e-tested).

## Performance and accessibility

- three.js loads only when Chapter 03 is within 800 px; renders only while visible and the tab is active; DPR capped
  (2, or 1.5 on small screens); all GPU resources disposed on unmount; WebGL failure or context loss keeps the SVG core.
- Reduced motion (system setting or the footer toggle) disables parallax, pinning, curtains, line masks and continuous
  rendering; content and controls are unchanged.
- Semantic headings per chapter, skip link, keyboard-operable nav, chapter rail, street-sign links, pipeline steps and
  demo controls; decorative layers are `aria-hidden` and never sit above interactive elements.
- Core Web Vitals were **not** measured in this environment (no field data); measure on the deployed origin.

## Not verified here / remaining asset needs

- Reference sites (loanmeme.io and the three V5 inspiration boards) were not inspected; no reference artwork is used.
- Approved SVG brand kit, mascot turnaround/rig or pose sequence, and licensed display-font confirmation (Archivo, OFL, via Google Fonts).
- Styleframes/contact sheet beyond the screenshots captured during development.
