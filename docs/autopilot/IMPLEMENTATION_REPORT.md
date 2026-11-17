# Autopilot compact cockpit implementation

## Delivered scope

Adds persistent Simple, Analyst and Engineer presentation presets; a compact paper account overview; critical alerts outside optional details; and one read-only asset monitor that moves between an inline panel and supported Document Picture-in-Picture. The chart reuses CandleChart and existing authenticated endpoints. The monitor cannot submit orders, change limits, fund accounts or withdraw.

Canonical useApi now binds data to resource paths, aborts obsolete requests and prevents late responses (including stale 401s) from replacing the current view. It clears SSE debounce work on cleanup. It preserves the newer upstream monotonic request-start timestamp used by StatusRibbon and separately exposes a labeled browser receipt timestamp.

The original two uploads remain byte-identical, checked against SOURCE_MANIFEST.json. All 100 tickets and 45 engineering questions have source contracts and evidence-based assessment documents. BASELINE_STATUS.csv is frozen at the original b624b52 assessment: 65 PARTIAL, 15 MISSING, 15 BLOCKED, 5 IN_PR_ONLY. Those historical statuses are not a current claim about the newer branch.

## Integration with Claude’s work

Rebased onto Claude integration commit 1f1aa5f5a1c39f3b3981c3c75415d316dfac9432 before publication. Its status ribbon, authentication changes, honest logout, supervisor, backup and engine hardening remain intact. A duplicate local History fix was dropped in favor of Claude’s implementation, retaining a request-loop regression check. Read the newer docs/engineering inventory and audit/soak reports with the preserved earlier assessment. No separate Claude model was invoked or messaged; this handoff and actual Claude branch ancestry provide the collaboration surface.

## Verification

Fresh integrated results: npm run typecheck passed. npm test passed 544 server tests, with 3 skipped (42 files passed, 1 skipped); npm test -w web passed 19 status-model tests. npm run scan:secrets passed. Original upload SHA256 verification and exactly 100 baseline rows passed. Production web build passed with the existing large-bundle advisory.

Final integrated browser run: 75/75 passed (npm run test:e2e), including the 10 cockpit tests, four request-race/history checks, existing navigation, authentication, status ribbon and trading-control regressions. Mobile offline-fixture screenshot was visually reviewed. Focused pre-rebase cockpit checks passed 10/10 and request/navigation checks passed 10/10. These earlier results do not substitute for final integration evidence. Initial cockpit fixtures lacked a required risk limit and were corrected. After rebase, request-race selectors were updated for upstream accessible buttons and the test file runs after the suite’s first-owner setup flow.

## Limits and continuation

This is the compact presentation/monitor milestone, not completion of all 100 functions. Native Document Picture-in-Picture on a real supported desktop remains unverified; browser tests cover unsupported fallback and explicitly mocked window lifecycle, theme, logout and late-resolution cleanup. Synthetic offline charts are test fixtures, not live performance evidence. No new 24-hour soak, hosted recovery or backup restoration certification was performed by this increment; refer to upstream reports for their exact measured bounds.

No merge, deployment, live trading, signing, automatic strategy promotion or payout was performed. Continue from existing contracts, accepting one testable increment at a time. Rollback by reverting this feature commit; there is no database migration. Presentation preference uses only mia-presentation localStorage.
