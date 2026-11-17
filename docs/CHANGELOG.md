# Changelog

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
- Full audit against spec Parts 1–33 (`REQUIREMENTS_TRACEABILITY.md`): 27 implemented, 34 partial, 4 missing, 9 blocked,
  0 mocked.
- Security audit (`SECURITY.md`): 1 high-severity dependency advisory found (SEC-01), no committed secrets.
- Documentation reorganised into the required `docs/` file set; the old numbered docs were renamed, not duplicated.
- No application code changed in Phase 0.

## 2026-11-16: PR #1 merged into `main`
- Startup repair: container-aware host binding, Windows-safe entry point, cross-platform scripts, repo-relative paths,
  auto-build of the UI, clear port-conflict and Node-version messages.
- MIA 4.1 application: API, owner auth, Trader Joe, 19-workspace terminal UI, paper OMS, risk engine, QCI with 100 workers,
  50 indicator specialists, strategy lab, wallet center (read-only), release gates.
