# MIA 6.0 Living Intelligence Atelier

## Visual direction

The four supplied images informed the lettering scale, character materials, FAST palette, and pacing of the product story. The companion video in the reference folder informed the illuminated visor and restrained character movement. The brief's liquid-glass description informed the navigation, selectors, and panels. The interface uses original artwork and an orbit-shaped MIA mark.

The landing page opens with the MIA companion and a shared FAST and DEEP selection. The story follows a market observation through discovery, assessment, and a recorded outcome. The interactive strategy chart, example conversation, and paper portfolio are labeled as illustrations. The protected workspace uses quieter surfaces and leaves chart, order, and risk information unobstructed.

## Design system

| Element | Implementation |
| --- | --- |
| Typography | Self-hosted Manrope for controls and body text. Instrument Serif italic appears in the editorial headline. Both font licenses ship with the web source. |
| Color | Midnight ink and lavender surfaces. Azure identifies discovery, lavender identifies research, champagne identifies protection, and lime identifies the main action. Profit, loss, warnings, and emergency state have independent semantic colors and text. |
| Components | Existing cards, badges, inputs, action buttons, tables, and status ribbon share the new tokens. Pressed states, focus outlines, and text labels communicate selection and risk. |
| Responsive behavior | The landing artwork follows the headline on narrow screens. The cockpit moves from three columns to a vertical layout, with session controls and risk information ahead of the chart. |
| Motion | Character entry, posture changes, and radar sweeps use short transform or opacity transitions. The public page has a saved motion preference and honors the operating system preference. The workspace honors the operating system preference. |

## Character reference

| Character | Silhouette and materials | Movement |
| --- | --- | --- |
| MIA | Oversized pearlescent visor shell, lavender seams, ink-purple faceplate, lime eyes, and a champagne compass on the chest. Rounded limbs and a raised open hand define the hovering pose. | One entrance movement, posture changes between intelligence views, and four selectable points in the decision orbit. |
| Trader Joe | Warm ivory body, amber wraparound visor, compact headset, and a golden holographic notebook. The chat crops the same artwork to an avatar. | A short attentive tilt when a reply starts. |

## Workspaces and data

| Screen | Existing service |
| --- | --- |
| Autopilot | The bot account and status ribbon read the owner shell, paper ledger, trading policy, and protection state. Paper controls use the existing control and emergency endpoints and require the established authorization. |
| FAST | The production site uses its DEX snapshot and safety assessment. Builds with Central Command use the authenticated FAST research snapshot. |
| DEEP | The production site uses closed BTC spot chart evidence. Builds with Central Command can display a futures research hypothesis with an expiry and missing evidence. |
| Smart Portfolio | The paper portfolio API supplies balances, realized P&L, the equity series, reconciliation status, and marked positions. The exposure view depends on available marks. |
| Trader Joe | The existing authenticated conversation endpoint supplies replies. The interface displays the tools returned with the latest reply when available. |
| Settings | Color theme is a browser preference. Existing endpoints persist notification and calendar settings. Operational controls link to their owning pages. |

The cockpit has a separate paper environment and live release-gate status. Trading permission continues to come from the current owner session and deterministic controls. The durable Run Session and Close Session lifecycle would require server support.

## Production packaging

The Railway package used the exact source snapshot of the previous active deployment as its base. The visual changes apply to its frontend and corresponding browser tests. The existing Privy owner and member sign-up flows are supported. A file comparison verified that 151 server and runtime manifest files match the previous upload. The separate draft worktree can display Central Command research when its API is present. [Central Command draft](https://github.com/Naokiri5/naokiri/pull/132)

## Release verification

- Railway reported a successful deployment on November 23, 2026 at 5:39 p.m. PHT. HTTPS health, public landing assets, mobile navigation, owner entry, member sign-up, the terms page, and the anonymous dashboard API guard passed on the custom domain. [Landing page](https://www.miaai.trade/) · [Autopilot](https://www.miaai.trade/autopilot)
- The production package passed type checking, the production build, 43 frontend unit tests, and 62 Playwright tests. Signed-in dashboard tests ran with an isolated paper account. The draft Central Command build passed 63 Playwright tests.
- The server unit suite reported 460 passes, 3 skips, and 63 failures on Windows for the production package. The previous release reproduced the same 63 failing test names.
- Railway deployment `bd09b568-38fe-42e0-823f-2177ae4c2935` superseded `ba23460a-edd8-47f8-a256-9eaef4851f7b`. [Railway release](https://railway.com/project/f5c95b28-a786-4854-aa24-1366fa5bcb87/service/b5482bb3-fcae-4c75-b59f-86f14969a12a?id=bd09b568-38fe-42e0-823f-2177ae4c2935)

## MIA Atelier Living Intelligence (unified interface spec, Nov 2026)

The owner's "MIA ATELIER - Living Intelligence" specification refines this design into a soft-white workspace, a
swipe authorization sheet and an interactive Trader Joe studio. It is delivered in phases; each row states what is
actually implemented. The interface stays a presentation and authorized-command layer: BrainOS keeps running on the
server whether or not the page is open, and three.js is never on the trading path.

| Phase | Scope | Status |
| --- | --- | --- |
| 01 Visual foundation | Soft-white tokens (Cloud White `#F6F7F9`, Pure White cards, Soft Coral `#F0ABA3`, Powder Blue `#BDD7EE`, Sage `#C5DCD0`, Graphite `#252B31`), 20 px card radius, soft shadows, frosted header, graphite primary action, press feedback. The light Atelier theme is the default; an explicit dark choice is remembered. Coral and powder blue are decorative; gain/loss keep semantic green/red, and links/focus use powder-blue ink so coral is never read as a loss. | Done (`web/src/tokens.css`, `styles.css`, `theme.tsx`) |
| 02 Data integration | Components read the existing authoritative endpoints (`/api/shell`, `/api/session/paper-spot`, `/api/stream`). | Done for the surfaces below; remaining pages unchanged |
| 03 Swipe authorization | Reusable `SwipeAuthorize` (`web/src/components/authorization/`). Applied to Run Session: the sheet shows environment, market, capital ceiling, duration and "withdrawal permission: not granted" before the swipe. Keyboard/assistive-tech alternative (Enter or Space on the handle); a plain mouse click cannot authorize; Enter in a field moves focus to the handle instead of submitting; fires once per attempt. The server stays authoritative: step-up verification (single-use codes) and `SESSION_NOT_CLOSED` reject duplicates (`server/test/durable-session.test.ts`). Close Session and emergency controls stay one direct action, as the spec requires. | Done for Run Session. Wallet connect, withdrawal and risk-policy changes keep their current owner-verified flows; real withdrawals and signing remain locked. |
| 04 Interactive charts | Unified area/candle styling and recorded trade overlays on Lightweight Charts. | Not started |
| 05 Trader Joe 3D | `web/src/components/trader-joe/`: `JoeStateMapper` (pure, tested) maps real signals - shell status, paper session state, chat request, and stream events (`scan`, `decision`, risk incident `OPEN`, position `closed`) - to the storyboard states. Missing, malformed or stale status shows a calm "status unavailable" state, never a busy one. `studio.ts` draws a procedural low-poly workstation (character, chair, three monitors, keyboard, mouse, mug with steam, lamp, coral floor grid). Screens show stylised "ILLUSTRATIVE" graphics, or "NO VERIFIED DATA" when disconnected, never prices. Monitors open Decision records, Market terminal and Portfolio, with equal links for keyboard users. The scene and three.js load in a separate lazy chunk. Rendering pauses off-screen and in background tabs; reduced motion draws still frames; WebGL loss or absence falls back to the static artwork. 3D is off by default on save-data or two-core devices, and the owner can toggle it. | Done (procedural). A rigged Blender GLB with animation clips can replace `buildJoe` behind the same `JoeStudio` interface. |
| 06 Gamification | Evidence-based milestones, cosmetic customization, session replay. No profit confetti, streaks or trade-count rewards. | Not started |
| 07 Production validation | Mobile performance profiling and authenticated PAPER integration of the swipe flow. The offline e2e suite cannot reach an enabled Run Session. | Partial: unit tests (swipe and state mapper), e2e studio test, existing suites |

Trader Joe has no access to wallet secrets, order submission or risk-policy changes: the studio components import no
API mutation, and the chat keeps its existing permission-limited tools.
