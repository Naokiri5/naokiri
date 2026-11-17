# Compact cockpit — PR A: six-destination navigation

The source is the owner's *MIA 4.1 Compact Autopilot Cockpit* master prompt and the HTML prototype that came with it.
The prompt says to implement **PR A only**, then wait for approval before PR B–F. This document is the change record
for PR A.

**Baseline.** Branch `claude/blissful-planck-lazglg` (PR #7), commit `0090b78` before these edits. PR #8 was already
cherry-picked into this branch, and DITAS and Quant Academy routes exist here, so all of them are included in the
navigation.

## Information architecture: before and after

| Before (4 groups, 27 flat links) | After (6 destinations, one submenu level, plus Trader Joe) |
|---|---|
| **Command:** Overview, DITAS, Market Terminal, AI Scanner, Asset Discovery, AI Intelligence, Quant Academy, QHEF, Trader Joe | **Home:** `/` |
| **Markets:** Bubble Map, Whales, Copy Trading, Holder Map, News | **Markets:** `/terminal` (+ `/terminal/:symbol`), `/scanner`, `/discover`, `/bubbles`, `/whales`, `/holders`, `/copy`, `/news` |
| **Trading:** Bot, Risk, Portfolio, History, Journal, Calendar, Strategy Lab | **Autopilot:** `/bot`, `/risk`, `/lab` |
| **Account:** Wallet, Security, Connections, Notifications, Release Gates, Settings | **Portfolio:** `/portfolio`, `/history`, `/journal`, `/calendar`, `/wallet` |
| | **AI Intelligence:** `/intelligence`, `/ditas`, `/qhef`, `/academy` (+ `/decision/:id`) |
| | **Settings & Security:** `/connections`, `/notifications`, `/security`, `/qa`, `/settings` |
| | **Trader Joe:** the floating launcher (unchanged) and `/joe` |

Every URL from before still exists, and the route table in `App.tsx` is unchanged.

## Behaviour

- **Route metadata in one file** (`web/src/nav.ts`): groups, pages, plain-language descriptions and search synonyms.
  The sidebar, page tabs, mobile bar and command palette all read from it, so there is no second list of routes.
- **Sidebar** (`web/src/Navigation.tsx`):
  - Each destination is a disclosure button (`aria-expanded`, `aria-controls`) with one submenu level.
  - The destination that holds the current page opens automatically, and the current page is marked `aria-current`.
  - Which groups are open is remembered in `localStorage`. If storage is unavailable, everything still works.
- **Collapsed rail:** each destination becomes an icon link to its first page, with a title and an accessible label.
- **Sibling tabs:** a row of tabs under the top bar links the pages in the same destination (for example, every
  Markets page from the Terminal).
- **Mobile:**
  - The bottom bar shows Home, Markets, Autopilot, Portfolio and **More**, which opens the full menu.
  - Escape closes the menu, and so does choosing a page.
  - The operating-mode badge, the risk chip and the alert banners stay in the top bar.
  - Touch targets are at least 44 px.
- **Command palette (Ctrl/⌘+K):** it keeps all its actions and now understands synonyms:
  - "profit" finds Portfolio and Profit Calendar.
  - "ai bots" finds AI Intelligence.
  - "fund" finds both Bot Account (paper capital) and Wallet & Withdrawals (labelled real and locked).
  - Direct name matches rank first, so "pause new" + Enter still runs *Pause new orders*. A regression test covers this.
- **Presentation only.** No backend changes. Navigation cannot change the operating mode, risk limits, funding or
  strategy approval, and a browser test asserts that the mode badge is unchanged after visiting every route.

## Files

| File | Change |
|---|---|
| `web/src/nav.ts` | New: route metadata and helpers (`groupForPath`, `pageForPath`, `ALL_PAGES`) |
| `web/src/Navigation.tsx` | New: `SideNav`, `GroupTabs`, `MobileNav` |
| `web/src/App.tsx` | Uses those components; Escape closes the mobile menu; collapse button has an accessible label. Routes are unchanged. |
| `web/src/palette.tsx` | Takes `NavPage[]`; synonym search with ranking |
| `web/src/styles.css` | Navigation styles, using the existing colour tokens |
| `e2e/navigation.spec.ts` | New: 7 browser tests (listed below) |

## Tests

The new browser tests check the following:
1. Every original route opens from its destination, keeps its URL, and leaves the mode unchanged.
2. Deep links such as `/terminal/BTCUSDT` open the right destination, and the sibling tabs work.
3. Keyboard: a group opens and closes with Enter.
4. The collapsed rail reaches each destination.
5. Palette synonyms work, and direct action matches stay first.
6. Mobile at 390 px: the bottom bar, More, Escape and page selection close the menu, there is no horizontal overflow,
   and the mode badge stays visible.
7. There are no console errors during navigation.

## Rollback

Revert the PR A commit. No data, API or migration is involved.

## Not in PR A (awaiting owner approval, per the prompt)

- **PR B:** Home setup banner and Simple-mode cards.
- **PR C:** a contextual Trader Joe launcher.
- **PR D:** a Picture-in-Picture mini monitor with an overlay fallback.
- **PR E:** a persisted Simple/Expert preference and a WCAG audit at 200% zoom.
- **PR F:** hosted 24/7 backend. This is a separate approval.
- Restoring per-page filters and the chart selection when switching views is not done.
