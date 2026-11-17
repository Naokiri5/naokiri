# Changelog

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
