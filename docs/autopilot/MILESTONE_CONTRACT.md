# Milestone: reusable compact paper cockpit

Baseline: integrated Claude PR #7 at b624b52d7dc0bc87310e92193e8da276286b8976. PR #8 is already included in that branch. This feature branch preserves its ancestry and does not merge main or overwrite Claude's integration. Both uploaded source documents are preserved under sources/ with SHA256 manifest. Their embedded pseudocode is a requirement/design input, not an existing API or an authorization to move funds.

## Assessment and reuse gate

Read all 100 tickets and all45 engineering questions; see the three ticket inventories and question sets. Existing nav.ts/Navigation.tsx already supply all six requested groups. Existing JoeDrawer and singleton API/SSE client are reused; no second navigator, assistant, scanner, risk engine, OMS, ledger or auth layer is created. Existing server loops run independently of browsers, but hosted24h supervision/recovery/backup proof is absent. Unattended/live certification remains UNKNOWN/BLOCKED, never inferred from HTTP200.

## Selected change

- Tickets002/093: UI-only saved Simple/Analyst/Engineer views, with optional detail accessible by keyboard. All safety warnings/account-origin notices and existing routes remain.
- Tickets003/005/006/009: read-only monitor, reusing Shell's authenticated paper snapshot and existing CandleChart. Source time and browser receipt time remain distinct; unknown/future/stale data are labeled honestly. Symbol selection uses existing instrument API, with no trading POSTs.
- Prerequisite: canonical useApi ignores/cancels obsolete requests and clears pending refresh timers. No second fetch/SSE abstraction.
- Document PiP only from user gesture, secure capability detection and same-origin app styling. One monitor tree, inline or portal. Unsupported/rejected requests use an inline panel, never an unrequested popup. Logout/unmount/opener close closes pending/open children. The child cannot outlive its opener.

## Contracts and ownership

One UI implementation owner: App.tsx, presentation.tsx, pages/Overview.tsx, components/MiniCockpit.tsx, narrow styles and existing CandleChart export. One canonical request-hook owner: api.ts plus independent race tests. Auditors own disjoint inventory/question docs. Root coordinates test/diff/publication.

Presentation preference: `ViewMode = 'simple' | 'analyst' | 'engineer'`, localStorage only; invalid/unavailable storage falls back safely. No server preference/migration or trading policy changes.

Monitor consumes existing GET /api/shell (passed from parent), GET /api/instrument/:symbol?interval=1h and GET /api/notifications while visible. No new Fastify endpoint, job, DB migration or EventSource. Status fields include account origin PAPER, actual operating mode, equity/dailyPct, scanner/source timestamps, policy/paused/emergency and critical notifications. Read-only DOM controls may choose a symbol or navigate, never authorize an order or withdrawal.

## Tests and rollback

Baseline commands and results must be retained separately from post-change results. Add Playwright checks for all3 modes/storage, safety visibility, inline fallback, rejected/native-or-mocked PiP lifecycle, source freshness, request races and logout cleanup, plus existing full routes. Native browser capability and mocked contract coverage must be labeled separately. Screenshots must identify offline data/fixtures. Run install/typecheck/unit/browser/build/secrets/advisory checks; do not run real orders or claim24h soak from short tests.

Rollback this UI commit to restore previous composition; ignore the presentation localStorage key. Server records, risk configuration and credentials are unaffected. Hosting, native Tauri companion, real balances, live trading/signing and withdrawals require separate work/authorization. Remaining tickets are tracked, not declared implemented by copying specifications.
