# Changelog

## Unreleased: Privy optional embedded wallets (2026-11-18)
- **Optional:** with `MIA_PRIVY_EMBEDDED_WALLETS=1`, the owner can create a Privy-secured wallet from Security Center. MIA only shows its address.
- **Still locked:** signing, sending, delegated signing, funding and key export. A new CI test fails if MIA's Privy code uses any of those Privy APIs.

## Unreleased: Tailscale Funnel guide (2026-11-18)
- **New guide:** `docs/operations/TAILSCALE_FUNNEL.md` gives MIA a free HTTPS address with Tailscale Funnel (for your phone, or Privy's Allowed origins).
- **Safety:** requests relayed by Tailscale Serve or Funnel are treated as remote even though they arrive from this computer, so the setup code and normal lockout still apply.

## Unreleased: Privy sign-in (2026-11-18)
- **New: sign in with Privy** (email, phone, Google, Apple, passkey, wallet, as enabled in your Privy dashboard). Link your Privy account once in Security Center, with your passphrase; after that the login screen offers "Sign in with Privy".
- **Safety:** the server checks every Privy token, and only your linked account can sign in. Your passphrase is still needed for sensitive actions. Wallets are view-only; creating embedded wallets and signing, sending, funding or exporting are LOCKED.
- **Off by default:** nothing changes, and the browser security policy stays strict, unless `MIA_PRIVY_APP_ID` is set.
- **Known issue:** Privy's wallet libraries trigger a high-severity `npm audit` warning (old `zod`), so the CI audit job fails until Privy updates.
- **Docs:** `docs/operations/PRIVY_SIGN_IN.md`.

## Unreleased: Vike research provider and Paper/Live contract (2026-11-18)
- **New: Vike on-chain research** (Discover → Vike research tab): token screener and search from data.vike.io, read-only. It is labelled research only and can never place, approve or size a trade.
- **Key safety:** the key is read only from the server setting `MIA_VIKE_API_KEY`. Without it MIA shows PENDING_CREDENTIALS and sends nothing. Presigned archive links never leave the server.
- **Paper/Live:** Live trading stays locked. Every Live command is refused (`LIVE_LOCKED`), and `/api/trading/environments` shows it truthfully.
- **Docs:** `docs/research/VIKE_INTEGRATION.md`.

## Unreleased: Master repair audit (2026-11-18)
- **A broken saved risk setting can no longer stop a stop-loss.** Exits use the last valid fee rate, and new entries stay blocked until the owner fixes the setting. The release gate shows a broken setting as FAIL.
- **Worker votes:** a required area (for example liquidity) now needs its own evidence. A worker from another area can no longer count for it.
- **Login:** behind a proxy, a stranger's wrong passwords can no longer block the owner's close-all.
- **Backups:** a manual backup run in the wrong folder now fails instead of backing up an empty database.
- **Server install:** the systemd unit creates its data folder, and its crash-loop limit now actually applies.
- **Streaming (still off by default):** snapshot retries back off, lagging or broken books are not used, a silent connection reconnects, and the local book stays small (1.67 → 0.039 ms per update).
- **CI:** the security audit runs as its own required job, so tests always run and report.
- **Register:** `docs/engineering/MASTER_AUDIT_2026-11-18.md`.

## Unreleased: Architecture blueprint (2026-11-18)
- **Streaming order books (milestone 3), off by default.** With `MIA_STREAMING=1`, open positions and the deep tier get Binance WebSocket books that are checked update by update. Any gap, bad data or crossed book throws the local book away and re-syncs. REST polling stays the fallback. Live latency has not been measured yet.
- **QA evidence is tied to the exact build (Q-01).** The release gate accepts a test report only from the same commit, a clean tree and a run at most 7 days old.
- **Stale leader proven with two real processes (L-01).** An old leader's write fails after another process takes the lease.
- **Draft PR #17 (autopilot cockpit) merged into this branch,** with its request-cancelling bug fixed.
- **Status table:** `docs/engineering/BLUEPRINT_STATUS.md`.

## Unreleased: Debug audit Batch C (2026-11-17)
- **Trading History no longer refetches in a loop.** It made 753 requests in 3 s before the fix.
- **Strategy revoke/re-enable** is a single operation on the server's current list.
- **Bot work loops** cannot crash the process on a database error.
- **Provider data is validated where it comes in:** symbol rules, cross-venue quotes, timestamps and DEX ids. Token safety no longer reports PASS on missing or stale data.
- **Smaller fixes:** live mode shows LOCKED in the UI; Academy checks the upload limit first; table rows work from the keyboard; open risk includes the stop buffer and exit fee.
- **Measurements:** decision-memory growth measured at ≈ 394 MB/day, which needs an owner decision. Performance baseline script: `scripts/load-baseline.mjs`.

## Unreleased: Debug audit Batch B (2026-11-17)
- **Stale prices fail closed.** A stale or future-dated price for an open position now counts as missing, so the risk gate denies new entries (MIA-RISK-001).
- **Exits and risk policy.** A paper exit can no longer roll back forever when a small position closes early in a pass (MIA-OMS-003). A stored risk policy that fails validation is denied (MIA-RISK-006).
- **Resource and injection limits.** EPUB spine amplification is bounded. Provider symbols and links are treated as untrusted. Trader Joe can pause only when the owner asks, and its tool calls are capped. Academy research runs are rate limited.
- **Operations.** The database file is owner-only. Graceful stop no longer hangs while a browser tab is open (32 s → 1.1 s), and the shutdown order is fixed. The supervisor treats a spawn failure as a crash.
- **Web.** The Joe chat keeps the message and shows the error when a send fails. The terminal no longer shows the previous symbol. A page error boundary keeps banners visible. An empty book no longer crashes the page. Missing data ages show as "missing". Stale search responses are ignored.
- **Audit records.** The machine-readable file inventory is `docs/engineering/audit-files.json`. The full register is §8 of `DEBUG_AUDIT_2026-11-17.md`.

## Unreleased: Debug audit Batch A (2026-11-17)
- **SEC-13 fixed.** First-owner setup from a non-local browser (forwarded port, container, LAN) now needs a one-time code printed in the server console. A loopback socket that carries proxy headers counts as remote. Tests: `server/test/auth-setup.test.ts`, `e2e/auth.spec.ts`.
- **MIA-WEB-001 fixed.** Sign-out only leaves the app after the server confirms; a failed sign-out says the session is still active.
- **Audit report.** `docs/engineering/DEBUG_AUDIT_2026-11-17.md` holds the bug register, the CR-01–CR-20 matrix, and review notes for Capy PR #13.
- **SEC-14 (global lockout) reproduced** and left open for an owner decision.

## Unreleased: Autopilot Phase 1 (24/7 PAPER-only server)
- **Single-runner engine lease.** Migration v5 adds `runtime_leases`. Only the lease holder scans and manages paper positions, and a second copy waits on STANDBY.
- **Readiness.** `GET /api/ready` is unauthenticated and returns 200 or 503.
- **Stall alarm.** One CRITICAL notification when the scanner stalls, and one when it recovers.
- **Graceful drain on SIGTERM.**
- **Backups.** Snapshots with a sha256 manifest, optional AES-256-GCM encryption, retention, scheduled runs by the leader, and a restore check (integrity, schema, audit chain, DITAS chain). Run them yourself with `npm run backup -- create|verify|list`.
- **Supervisor.** `npm run start:supervised` restarts crashes with bounded backoff and stops after a crash loop. Adds the `deploy/mia.service` systemd unit.
- **Inventory.** `docs/engineering/AUTOPILOT_100_INVENTORY.md` gives the status of all 100 backlog items.
- **Soak.** `docs/engineering/PHASE1_SOAK.md` records the headless soak. It was shorter than 24 h and did not run on a hosted server.
- Nothing is deployed and live execution stays locked.
## Unreleased: engine lease hardening (builds on the Phase 1 engine lease in bot/bot.ts and ops/)
- The lanes re-check the lease synchronously with the existing holdEngine() right before writing after awaited network
  calls: the position monitor and approval expiry in the ticker lane, OMS writes from onDecision in the scan lane, and
  backups plus strategy suspension in the background lane. A copy that lost the lease writes none of these and drops to
  STANDBY. Not covered: the decision record and its DITAS event that decide() writes before onDecision; a demoted copy
  can still record one evaluation per candidate, and the new leader then skips that candle (fail closed, no trade).
- A refused takeover stays refused until the engine is restarted: the process cannot re-acquire the lease.
- Every takeover (STOPPED or STANDBY to LEADER) first runs integrity checks on the live database (ops/integrity.ts:
  quick_check, schema version, audit chain, decision-memory chain, ledger reconcile, protective stops on open positions),
  built from the existing verifiers. On failure the lease is released, the engine stops, and the reason goes to
  lastError, the journal and a CRITICAL notification. Nothing is repaired.
- New botStatus.lastMonitorAt and monitorFailing fields. /api/ready gets a leader-only monitor check that fails while
  the latest monitor pass errored or no pass completed within three ticker intervals. Standby and offline behave as before.
  The status ribbon judges the monitor by the same fields (MONITOR FAILING / MONITOR STALLED).
- MIA_ENGINE_LEASE_TTL_MS shortens the lease for offline tests only (ignored when online). A new two-process test SIGKILLs the leader and checks that
  the standby takes over only after the TTL, with no overlapping writes.

## Unreleased: Compact cockpit PR A (six-destination navigation)
- Navigation is regrouped into Home · Markets · Autopilot · Portfolio · AI Intelligence · Settings & Security, plus
  Trader Joe. It adds a one-level submenu, a collapsible rail, sibling-page tabs and a mobile bottom bar with More.
- The command palette understands synonyms, and direct action matches rank first.
- This is presentation only: all routes and URLs are unchanged, and there are no backend changes.
- 7 new browser tests. See `docs/engineering/NAVIGATION_PR_A.md`.

## Unreleased: Overview dashboard + backend input hardening
- **Overview dashboard** (`server/src/dashboard/overview.ts`, `web/src/pages/Overview.tsx`). It is a read-only composition of authoritative state and has these panels:
  - paper account (equity, cash, positions, unrealized and realized P&L, today/week, drawdown)
  - market intelligence (breadth, BTC regime, scanner recency, worker status)
  - risk monitor (mode, policy, emergency, incidents, limit meters, live-gate summary)
  - data-source health
  - de-duplicated activity feed

  The fields of the original `/api/overview` contract are kept.
- A shared `Meter` component is now used by both the Overview and the Risk Center.
- DITAS has a new **Execution quality** tab for the PR #8 report.
- **Fix B-1:** repeated query keys were bound straight to SQL, and the internal SQLite error text was returned to the
  client. Every remaining raw route input is now Zod-validated.
- Runtime verification report: `docs/engineering/DASHBOARD_RUNTIME_VERIFICATION.md`. It covers 28 routes crawled live
  with 0 issues, an API sweep, the live paper workflow, and dev and production modes.

## Unreleased: MIA 4.2 Phase 0 + P0/P1 slice
- **Branch reconciliation:** PR #8 (read-only DITAS execution-quality report) was cherry-picked onto the integration
  branch. It did not conflict with or duplicate anything.
- **P0 execution safety:** persistent protection incidents (migration v4, `exec/incidents.ts`).
  - An open paper position that cannot be exited creates a de-duplicated, restart-safe incident.
  - The incident blocks new entries on that instrument until executable data returns.
  - It moves to RECOVERED when data returns, then needs owner acknowledgement with a note.
  - It appears as a Risk Center panel.
- **Fail-closed OMS fixes:**
  - Future-dated quotes are refused.
  - Protection now requires fresh book depth.
  - The combined multi-target exit size is checked against book depth.
  - Nested `tx()` works on every supported Node version.
- **Worker accounting:**
  - The Market breadth worker uses real advance/decline data.
  - Every worker is classified as data-driven, constant-rule or provider-blocked.
  - Measured productivity is shown on the Intelligence page.
- **Phase 0 engineering docs:** `docs/engineering/`, covering the inventory, the 40-row traceability CSV, the
  duplication report and `scripts/inventory.mjs`.
- The duplicate SHA-256 helpers were replaced by the shared `core/util.ts:sha256`.

## Unreleased: Quant Academy (knowledge & research subsystem)
- New `server/src/knowledge/` module and `/academy` page. It covers:
  - ingesting PDF, EPUB, DOCX, HTML, Markdown and TXT, with resumable PDF processing
  - keyword, vector and hybrid search with cited sources
  - concept cards, source-conflict tracking and evidence classes
  - an immutable, reproducible research lab with volatility clustering, autocorrelation and purged/embargoed
    walk-forward experiments
  - a memory map for categories A–F
- Migration 3 (append-only) adds the `kb_*` and `research_*` tables.
- Decision reports carry explanatory `knowledge.refs`. Trader Joe gains a read-only `search_knowledge` tool. Neither
  has any trading authority.
- Fix: text-sniffed document metadata no longer overwrites container metadata (for example, the EPUB `dc:date`).
- `migrate(db, target)` accepts an optional target version, for upgrade tests.
- 31 new unit/integration tests and 1 new browser flow. See `docs/academy/`.

## Unreleased: production-repair integration (branch `claude/blissful-planck-lazglg`, PR to `main`)
Integrates the four open pull requests into one tested branch without removing any of their work:
PR #3 `claude/mia-production-repair`, PR #4 `fix/mia-4.1-audit-repairs`, PR #5 `feat/global-chart-intelligence`,
PR #6 `feat/ditas-foundation`.
- Order management follows CLAUDE.md invariant #4 strictly: no paper fill (entry or exit) without a fresh order book
  deep enough for the full size; otherwise the position stays open and a CRITICAL protection alert fires.
- Market-data quality gate combines PR #3 execution freshness limits with DITAS structural validation; a stale or
  future-dated order book fails closed; candle batches use the request-time closed-candle cut-off.
- DITAS duplicate forecasts/outcomes are rejected as client errors (400) instead of raw database faults.
- Root-level error handler: no internal error text reaches the browser from any route.
- 7 regression tests for the audited defects; 246 unit/integration tests and 37 browser checks pass.

## Unreleased: production repair (branch `claude/mia-production-repair`)
- **Paper execution (OMS)**: entries refuse order books older than 60 s (`MIA_MAX_EXEC_BOOK_AGE_MS`) and are priced from
  the freshest ask plus book-walk slippage; exits never walk a stale book and always complete (book, partial book +
  conservative tail, or buffered fresh quote). Entries check cash, target-through and duplicate submissions.
- **Accounting**: exit state, fills, ledger and position are written in one transaction, so a take-profit is never marked
  done without its quantity being sold; exit quantities respect lot size (no unsellable dust); deterministic exit order ids.
- **Market data**: book timestamps taken at request start with `lastUpdateId` ordering; forming candles no longer ingested
  as closed; out-of-order tickers dropped; open-position instruments stay in the deep tier and their books refresh every
  ticker cycle; one failing interval no longer freezes the others.
- **Risk gate**: denies on a stale book, an invalid entry price, or any non-finite input (NaN used to pass every limit).
- **Indicators**: NaN no longer poisons EMAs/ADX permanently; flat series gives RSI 50.
- **Engine**: background lane can't overlap; a rules/ticker outage no longer skips position monitoring; one failing
  candidate no longer aborts the whole scan.
- **Security**: SEC-02, SEC-05, SEC-09 (auth bypass), SEC-10 (passphrase in audit log), SEC-11, SEC-12 resolved; see `SECURITY.md`.
- **API**: validated query parameters (interval, limit, minVolume, month), correct status codes, hardened SSE stream.

## Unreleased: Phase 1 foundation hardening (branch `claude/blissful-planck-lazglg`)
- Security: `@fastify/static` 10.1.11 (SEC-01 resolved, `npm audit` clean); static-serving traversal tests; CSV formula-injection guard.
- CI: GitHub Actions with secret scan, dependency audit, typecheck, unit tests and Playwright browser suite.
- New workspaces: Asset Discovery, QHEF Performance, Security Center, Copy Trading, Trading History (+ CSV export).
- Command palette (Ctrl/⌘+K); `x-request-id` on every response.
- Fixes: Market Terminal no longer crashes before market data loads; event-loop delay reports true blocking time.

## Unreleased: Phase 0 audit (branch `claude/blissful-planck-lazglg`)
- Full audit against spec Parts 1–33 (`docs/planning/REQUIREMENTS_TRACEABILITY.md`): 27 implemented, 34 partial, 4 missing, 9 blocked,
  0 mocked.
- Security audit (`SECURITY.md`): 1 high-severity dependency advisory found (SEC-01), no committed secrets.
- Documentation reorganised into the required `docs/` file set; the old numbered docs were renamed, not duplicated.
- No application code changed in Phase 0.

## 2026-11-16: PR #1 merged into `main`
- Startup repair: container-aware host binding, Windows-safe entry point, cross-platform scripts, repo-relative paths,
  auto-build of the UI, clear port-conflict and Node-version messages.
- MIA 4.1 application: API, owner auth, Trader Joe, 19-workspace terminal UI, paper OMS, risk engine, QCI with 100 workers,
  50 indicator specialists, strategy lab, wallet center (read-only), release gates.
