# Changelog

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
