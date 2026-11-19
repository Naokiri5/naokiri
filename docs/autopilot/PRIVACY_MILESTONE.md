# Ticket 007: cockpit privacy milestone

Status: **PARTIAL**. Source: original blueprint ticket 007, preserved in `sources/`. Assessed and implemented against Claude integration commit `a65b62bd5da81be060d2b9d852c19916dc233625` on 2026-11-19. PR17 was already merged into that branch; its presentation/monitor code is reused.

## Contract and delivery

One shared **Hide cockpit amounts** toggle controls Overview and its inline or floating read-only monitor. It is a pressed-state toggle with a stable accessible name; the visible label changes to Reveal when enabled. All three Overview presentation modes share it. The toggle also appears inside the floating monitor and updates both windows through the existing React portal/context tree.

The local `mia-cockpit-privacy` boolean preference is read before the authenticated screen renders, persists across reloads when browser storage is available, and works in memory when storage is denied. No account values are persisted, logged, changed or sent to any API by toggling. The canonical `fmt`, API/SSE hooks, scanner, ledger, decision/risk engine, auth and execution contracts are unchanged.

| Surface | Masked | Preserved |
|---|---|---|
| Compact and detailed Overview account cards | Equity, cash, deposits, position value, fees, realized/unrealized PnL, daily/weekly return, drawdown, open-risk figures and PnL colors | Labels, paper origin, mode, stale-response state, open-position/incident counts and missing-mark warning |
| Overview risk monitor | Numeric meter text, bars and accessible numeric attributes are not mounted | Emergency/paused state, policy status, protection status and Risk Center link |
| Header | Account figures and detailed free text in displayed risk values, tooltips and accessible names; free-text status errors | Authoritative segment tone/state, breaker/emergency/no-policy/marks-missing/loss-streak/stale states and destinations |
| Overview prose | Briefing, activity title/detail, alert title/body, provider error tooltips, request-error details | Alert severity, activity kind, timestamps, critical/protection banners and links |
| Trader Joe drawer | Drawer transcript/input is not mounted while masked | Generic explanation and Close action; unmasking restores normal drawer behavior (an unsent local draft is discarded when the drawer unmounts) |
| Inline/PiP monitor | Equity, daily PnL, alert title/body and free-text instrument errors | Paper/read-only/mode labels, source timestamps, stale/emergency warnings, critical-alert priority and safety links |

The UI states the boundary while enabled: **“Cockpit amounts hidden. Other workspaces and exports may still show account details.”** Public market prices, candlestick axes, volume and market-change figures intentionally remain visible; the monitor states this too.

This is render-time replacement, not CSS blur or hidden raw DOM. It is a screen-sharing convenience, not an authorization or data-redaction boundary: authenticated API responses and account state still exist in browser memory and developer tools.

## Coverage and remaining requirements

Ticket007 remains PARTIAL because Bot Account, Portfolio, Wallet/withdrawal preview, History/CSV, Journal, Calendar, full Trader Joe page, decision sizing, DITAS records and other detailed workspaces are outside this increment. No export preview exists today. Downloads continue to contain original account data. The scope notice persists during navigation; it does not imply those pages are masked. Local tabs do not synchronize preferences with each other; a PiP child shares its originating tab's state. Preferences are browser-local, not owner/server preferences.

Continue with explicit render-time sensitive fields on those workspaces, including input values, chart series, free-text notes, JSON inspectors and downloadable artifacts. Do not treat shared currency formatting alone as adequate coverage. No database migration or financial authority is needed for this feature.

## Review and verification

Independent read-only review found the provider-error tooltip as an additional free-text leak; it is now replaced while masking. The review also caught a missing-mark warning initially hidden with a secondary label; that safety warning is preserved. The reviewer did not execute browser tests.

Fresh verification: `npm run typecheck` and `npm run build` passed. `npm test` passed 688 server tests (3 skipped) and 30 web tests, including 9 privacy safety-state checks. The focused privacy browser run passed 5/5. `npm run test:e2e` passed all 82 browser tests, including existing authentication, status, trading controls, navigation, DITAS and monitor regressions. Initial focused runs exposed two test-selector issues (Joe’s Close label and the inline monitor sharing the header); the selectors were corrected without weakening privacy assertions. `npm audit --audit-level=high` found 0 vulnerabilities; the secret scan passed. Both preserved upload SHA256 hashes still match. Browser assertions seed distinctive synthetic account amounts and free-text markers and inspect body text (including collapsed details), accessible snapshots, tooltips, labels and input values. They exercise all three views, reload, denied storage, inline/PiP bidirectional updates, mobile layout and absence of financial POSTs. PiP is explicitly mocked; native platform PiP support remains unverified.

Rollback: revert this increment. The only retained preference is `mia-cockpit-privacy`; deleting it resets the toggle. Preserved source uploads and historical `BASELINE_STATUS.csv` remain unchanged.
