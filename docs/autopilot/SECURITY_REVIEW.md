# Read-only security and lifecycle review — cockpit milestone

Review scope: `web/src/components/MiniCockpit.tsx`, `web/src/cockpit.ts`, `web/src/presentation.tsx`, `web/src/App.tsx`, `web/src/pages/Overview.tsx`, the narrow `CandleChart` export and cockpit CSS. Existing `/api/shell`, `/api/instrument/:symbol`, `/api/notifications` contracts were inspected. `api.ts` is being independently updated/tested by its implementation owner and is not independently certified by this review.

Method: direct code inspection of the current uncommitted milestone after the inventory stage; no runtime, native Picture-in-Picture, provider, order, signing or withdrawal action was executed by this reviewer. Root command/browser evidence must establish executed results. This is not a penetration test, overnight soak or live-trading certification.

## Preserved boundaries and reuse

- The monitor makes authenticated GET reads through the existing `useApi`; its three local asset choices are encoded into the existing instrument endpoint. It adds no POST, allocation, risk-policy, order, signing, wallet or withdrawal route/control.
- Values are rendered with existing `fmt`/`Badge`/`Empty` and the existing chart component, not a new PnL or chart-feature engine. Data remains server-authoritative. Showing a read-only monitor does not make account funds withdrawable.
- `PresentationProvider` validates only `simple|analyst|engineer`, persists one local UI preference, tolerates unavailable localStorage and sends no preference to trading services. It cannot change execution mode or limits.
- App retains its prior route/component set, navigation metadata, global Joe launcher and command palette. The old emergency, stale-data, paper-origin and missing-policy banners stay outside presentation-dependent collapsibles. Overview emergency/protection incidents and critical-alert content also remain outside collapsed details.
- `monitorState` marks missing, nonfinite, zero or future timestamps UNKNOWN, age-expired sources STALE and failed/stale account receipts LAST KNOWN. No local state is presented as a risk approval: final wording retains independent strategy/consensus/risk/mode checks.
- Monitor explicitly labels PAPER ACCOUNT / READ ONLY and explains opener lifetime. Unavailable/failed chart data do not become invented candles or zero balances. The exact-symbol guard prevents a previous asset from being rendered under a new selected symbol; request ownership/abort behavior belongs to the canonical hook.

## Popup lifecycle inspected

- `requestWindow` is invoked only from an explicit user click and a supported secure-context capability. Unsupported or rejected requests keep the in-page monitor instead of requiring native privileges.
- An opening generation token plus mounted/alive ref invalidates a delayed popup when the monitor closes or the shell unmounts (including logout). The resolved stale child is closed rather than populated with account data.
- Component cleanup closes the child; opener pagehide closes it. Child pagehide restores inline rendering. Theme observation is limited to the existing theme attribute and is disconnected on cleanup.
- Only stylesheet/style nodes are cloned; cross-origin stylesheet links are skipped and same-origin link URLs are made absolute. No scripts, tokens or credentials are copied into child markup. React renders text; no `dangerouslySetInnerHTML` was introduced.
- Reusing one content tree as a portal avoids duplicated monitor viewers. The existing shared SSE connection remains canonical; chart/notification hooks subscribe rather than creating another EventSource.

## Findings and checks required before review

| ID | Severity / confidence | Evidence | Smallest action / required test |
|---|---|---|---|
| UI-SEC-01 | P2 monitoring prioritization; direct code evidence | Initial `MiniCockpit` filters WARNING or CRITICAL, then takes the first three in backend order. Three newer WARNING notices can hide an older CRITICAL notice still in the same response. This is not a financial-authority bypass. | Prefer CRITICAL notices before WARNING within the bounded response; label the displayed window as notification history, not complete active protection coverage. Test response with three warnings followed by a critical notice. Link the authoritative notification/risk views for full history and current incidents. |
| UI-SEC-02 | Lifecycle hardening / native behavior NOT TESTED | Child pagehide handler/theme observation are installed by an effect after child state is committed. Code already has generation/unmount checks, but a child that closes during native creation should not be used as a portal target. | Check `target.closed` before committing it and test a request resolving with an already-closed child, immediate user close, delayed resolution after logout/monitor close and normal close/reopen. A synchronous handler is optional hardening if effect ordering proves insufficient. Do not label native PiP certified from a `window.open` capability stub. |
| UI-SEC-03 | Existing backend limitation, outside milestone | The shell's account equity can be drawn from cached portfolio marks; UI source/receipt freshness does not independently prove every held asset mark executable. Native monitor code does not fix that underlying accounting/protection requirement. | Keep diagnostics as display evidence and do not claim unattended safety or verified live valuation. Preserve open incident/risk controls and plan canonical stale-held-mark validation separately. |

The first two are reported to root for correction/verification. This document records the reviewed observations; root's final test report must state which actions were actually implemented and run.

## Required final evidence

- Browser tests for local preference reload/invalid storage, all old routes, desktop/mobile keyboard access and invariant emergency/paper/protection warnings in every preset.
- Monitor tests for initial unknown, fresh/stale/future timestamps, missing account/chart/alerts, request failure, chart symbol changes, alert priority, denied/unsupported floating capability, normal popup close/reopen, delayed request after close/logout, and cleanup of timers/listeners.
- Explicit native Document PiP support limitation if only test doubles were available. Document PiP cannot outlive its opener; persistent native desktop hosting is not implemented here.
- No live trading, funds movement, remote deployment, host/process supervision or 24-hour unattended certification is implied by successful UI tests or screenshots.

## Resolution in this increment

Critical notifications now sort before warnings in the bounded monitor list, with the total count and a Risk Center link. Child-window attachment checks `closed` and uses a layout effect; pending windows are closed after logout/unmount. The focused 10-case browser run passed before the later upstream rebase. Native browser Document Picture-in-Picture remains unverified; mocked lifecycle evidence does not certify platform support. The upstream StatusRibbon’s monotonic request-start timestamp was retained during integration, separate from the monitor’s labeled local receipt timestamp.
