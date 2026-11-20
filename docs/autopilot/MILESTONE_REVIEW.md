# Independent cockpit milestone design review

Baseline inspected: integrated PR #7, `b624b52d7dc0bc87310e92193e8da276286b8976`. This is a read-only architecture/security assessment, not a claim that proposed code or browser behavior already works. Read `CLAUDE.md`, `.claude/rules/frontend.md`, the requested ticket details, and current App, navigation, Overview, Joe, API hooks, UI primitives and authenticated route DTOs.

## Reuse inventory and narrow boundary

- Six requested navigation groups already exist in `web/src/nav.ts` and `Navigation.tsx`, including mobile navigation, sibling tabs, command-palette metadata and the existing route set. Do not create a second navigation registry or delete routes.
- The single global Trader Joe drawer already exists in `App.tsx` and `pages/Joe.tsx`, with pathname context and a deep-linkable full page. Do not clone its chat service or create new AI authority.
- `/api/shell` already supplies paper account equity/daily PnL, operating controls, scanner/feed timestamps, policy status, alert count and release summary. `/api/overview` supplies detailed risk/incidents/activity/alerts. `/api/instrument/:symbol` already supplies observed candles. No new backend API or database table is needed for this UI-only increment.
- The existing SSE connection is singleton `connectStream()` in `api.ts`, owned by authenticated App lifecycle. The monitor may subscribe through `useStream`/`useApi`; it must not construct another EventSource or provider connection.
- Simple/Analyst/Engineer density and a floating read-only mini cockpit were not found by search. They are suitable additions to existing composition, not substitutes for headless hosting or safety certification.

## Recommended component and data ownership

Use a small validated presentation preference (`simple | analyst | engineer`) in localStorage with an in-memory fallback. This preference changes presentation only: all existing routes, balances, APIs and permissions remain the same. Mount the shared provider in authenticated Shell. Keep the emergency, stale-data, paper-account-origin and protection-incident warnings outside collapsible advanced sections. Simple can collapse diagnostics; Analyst/Engineer reveal more detail, but every section remains keyboard reachable and available by disclosure.

Mount exactly one MiniCockpit controller under Shell. Pass the Shell's existing fetched DTO/error/loading information as props instead of fetching `/api/shell` again. If detailed alerts are needed, share the existing overview query at a common owner or issue one bounded monitor-only overview request while the monitor is open; do not run multiple hidden copies. Use one selected instrument request through the canonical hook and a validated symbol state. Sparkline must use actual returned closes and the existing Sparkline primitive; absent/invalid series renders unavailable rather than generated prices.

Render one content tree, either in an inline fallback panel or via `createPortal` into a Document PiP container. A portal preserves React/router/presentation context; a separate `createRoot` would require recreating those providers and risks parallel subscriptions. Closing PiP should restore an inline view or safely hide it according to explicit UI state, never mount a duplicate tree.

## Required canonical request fix

`web/src/api.ts` currently permits an old request to update state after `path` changes, and it does not clean up its SSE debounce timeout on unmount. A selected-asset monitor would inherit this financial-display mismatch. Add cancellation or a request generation/ownership check to the canonical `useApi` hook, including same-path overlapping reloads, null path, errors and unmount. Do not implement a monitor-specific fetch client. Clear or identify the displayed data when its resource path changes so a new symbol cannot temporarily label old candles. Preserve existing API error/unauthorized behavior and request headers.

A generation/ownership check must also prevent an obsolete failure or finally block from overwriting the current path's error/loading state. Manual `setData` callers should retain their supported contract. Debounced stream callbacks must use the current path and be canceled on unmount. Test slow A/fast B with A finishing last, stale failures, two same-path reloads, and unmount before debounce.

## PiP security and lifecycle contract

- Only call `documentPictureInPicture.requestWindow()` directly from an explicit user click, after secure-context/capability detection. Do not call from mount effects. Unsupported, denied or failed PiP requests retain a usable inline panel with an honest explanation; do not create an unrelated popup fallback.
- Handle an in-flight open request resolving after logout, unmount, close or a newer request: close the returned child and do not reattach sensitive account content. Guard double clicks and re-use/focus a single existing child.
- Copy application styles with known stylesheet links/styles and absolute stylesheet URLs. Do not use user-controlled HTML or broad `innerHTML` injection. Synchronize `data-theme` to the child document and clean its MutationObserver/listeners up.
- Clean up child pagehide/unload listeners and child window on authenticated Shell unmount, logout and opener pagehide. A Document PiP cannot survive its opener; state that limitation in UI and handoff. Persistent native Tauri windows require a separate approved project.
- No signing, keys, withdrawal, funding, mode mutation or unrestricted trading controls belong in this monitor. It is a viewer; existing Risk Center remains the authoritative place for approved controls.

## Freshness and truthful display

Do not treat a connected SSE socket, periodic HTTP200 or browser receipt time as proof of scanner/market health. Validate source timestamps: missing, invalid or future ticker/scan times are UNKNOWN; old source timestamps are STALE. Respect backend `dataHealth.stale`, control emergency/pause and policy status. Account values from a failed/aged fetch may be shown as LAST KNOWN with its age, never as currently verified. The shell response has no dedicated server snapshot timestamp, so any local `receivedAt` must be described as receipt time, not a verified market event time.

Use a bounded frontend clock while visible so stale labels advance even when SSE stops; clean it up on hide/unmount. Render finite values through existing formatters. Never coerce absent PnL to zero or label paper values withdrawable. A mode or account-origin field missing from a response is UNKNOWN, not a green PAPER/live status inference. Critical alerts must remain visible across every presentation mode and both monitor locations.

## Acceptance and evidence

1. Existing navigation registry and routes unchanged; desktop/mobile/keyboard journeys and global Joe still work.
2. Three view modes persist UI-only preference, tolerate invalid/unavailable storage, and retain global emergency/paper/stale/incident warnings.
3. One monitor content owner and one authenticated SSE connection. Opening/closing/moving monitor does not duplicate polling or issue financial POSTs.
4. Inline unsupported and rejected-PiP paths tested; supported native PiP tested when the actual browser permits it. If lifecycle is exercised with an API mock, explicitly label it a contract test rather than native support certification.
5. Selected asset race and stale/future/missing source snapshots tested; no old-symbol chart under a new label and no fabricated chart.
6. Logout/unmount/pending-open/pagehide closes child and removes private data, listeners and intervals. Theme and router context work through the portal.
7. Run current suite, new focused browser cases, typecheck/build and secret scan. Capture actual screenshots only from the tested app, clearly labeling offline fixtures.
8. A UI-only browser test is not a 24-hour headless PAPER soak. Hosting, process supervision, backup/restore, singleton job leases and prospective risk evaluation remain separate unfinished work.

## File ownership proposal and rollback

One UI implementation owner: `App.tsx`, a presentation context module, `Overview.tsx`, mini cockpit component and narrow CSS additions. One canonical hook owner: `api.ts`, with coordinated regression tests; avoid simultaneous edits. Tests may live in one new Playwright spec so existing suites are retained. Documentation preserves the two originals byte-for-byte and maps every ticket before implementation.

No migration or trading-service changes needed. Roll back the UI-only commit to restore prior composition; local presentation preference can be ignored by the prior version and must never alter server settings. Do not merge main, deploy an always-on host or unlock financial capabilities through this milestone.

## Implementation review follow-up

The canonical hook now supplies request cancellation and logical request ownership, resource-keyed render guards, null-resource reset, debounce/interval cleanup and `updatedAt` as local successful-response receipt time. The shared EventSource and API authorization/CSRF contract remain unchanged. No new backend route was added.

Focused browser command executed against the parent-built app:

```
env -u ANTHROPIC_API_KEY -u TELEGRAM_BOT_TOKEN -u TELEGRAM_CHAT_ID MIA_OFFLINE=1 PLAYWRIGHT_BROWSERS_PATH=/workspace/work/pw-browsers ./node_modules/.bin/playwright test -c e2e/playwright.config.ts e2e/request-races.spec.ts e2e/navigation.spec.ts
```

Final result: **10 passed** (three new API race/lifecycle cases and seven navigation cases). The API race fixtures deliberately let old HTTP200/401 requests finish despite transport cancellation; neither replaced the new asset or revoked the current view. The debounce case observed the full 600ms deadline after route unmount and confirmed no orphaned refetch. Existing route, keyboard, mobile, mode-preservation and command-palette assertions passed.

The initial focused run passed the three API cases but exposed a test selector collision: the old global `role=option` selector selected the new presentation dropdown's native Simple option. The existing palette test now scopes its options to the named Command palette dialog and waits for authenticated Shell readiness before sending the shortcut. No assertion was removed. Final log: `work/autopilot-evidence/api-navigation-e2e.log` outside the repository. An earlier npm-exec command-line invocation failed on argument parsing before running tests; direct local Playwright invocation above succeeded.

Native Document PiP/browser-specific validation and the entire combined regression suite are owned by the parent milestone run; they are not inferred from this focused result. No 24-hour headless soak or live certification has occurred.
