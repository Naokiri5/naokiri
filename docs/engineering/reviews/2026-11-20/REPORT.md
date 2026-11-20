# CodeRabbit reconciliation and functional repair pass

## Target and review coverage

Original review target: unified MIA + Solana PR01 at `b17c096`. Before publication the fixes were rebased onto Claude's newer `2c9c21646c3be6fda798c4553216cde22c4506fc` (`claude/mia-omega-01-solana-hunter`, PR47). This retains the unified PR45 histories and subsequent Solana safeguards. The separate cockpit-privacy PR48 is not silently merged into this stack.

Collected review threads from all 48 repository PRs: **161 threads**, of which **73 were marked unresolved**. Each of those 73 has a linked disposition in `CODERABBIT_FINDINGS.json`: **61 already fixed in current code, 10 fixed in this increment, 1 superseded, 1 mitigated**. The other 88 had already been marked resolved and were not individually reopened. Source-level dispositions refer to the selected integration target; a historical PR branch may still lack those fixes. No old GitHub thread was marked resolved by this pass.

Three independent domain investigations covered backend/recovery, research/backtesting and frontend behavior. A separate trading-risk review examined target rounding before implementation and reviewed the actual diff afterward. This is a targeted source review plus broad automated validation, not a claim that every line or third-party integration has been proven correct. CodeRabbit skipped PR45 because it exceeded its file limit; the smaller repair PR permits a new review request.

## Changes

| Area | Defect and resulting behavior |
|---|---|
| Chart evidence | Selected swing lows could exceed older swing highs; bounds now span all selected pivot prices. A sweep described as closing inside a range must actually close between both range boundaries. |
| Paper exits | A partly lot-rounded target could be marked complete after selling too little. Target JSON now retains original fractions and tracks actual `filledQty`; later passes request only the unsold demand. Planned full closure absorbs accumulated dust after checking depth for the entire actual position. Fractions totaling less than one retain their intended residual. |
| Backup verification | A checksum result from another directory or same-size corruption with preserved modification time could appear to verify local bytes. Status binds the directory fingerprint and recomputes the local hash. Retention is skipped when verification status cannot be recorded; the CLI reports that warning. |
| News evidence | Missing, malformed or future publication dates could become current evidence indefinitely. Parsing drops invalid timestamps and persisted reads exclude future rows relative to one assessment time. Valid epoch-zero timestamps are preserved. |
| Strategy replay | Canonical candle validation rejects malformed, missing, duplicate, unordered or forming bars. TIME exits pay spread/slippage exactly once; STOP behavior and shared exit rules remain unchanged. Unclosed final-position PnL is explicitly excluded in the warning. |
| Prediction replay | Sorting snapshots without moving the fair-value series misaligned evidence. Replay now rejects unordered/duplicate/non-safe-integer timestamps, keeping supplied fair values aligned. |
| Terminal | A delayed obsolete analysis POST returning 401 could sign out the current screen. Abort ownership now follows the component's symbol and lifecycle; genuine current authentication failures still use the canonical API behavior. |
| Status | A future engine-completion timestamp could become healthy merely as the retained snapshot aged. It remains checked against the server time that accompanied that snapshot. |
| Tests | Notification TTL uses controlled time, readiness waits belong to the current page, repair freshness fixtures share a fixed Date clock, and DITAS's Refresh query matches the exact intended button. |

### Trading boundaries

The OMS repair is forward-only: an old `done:true` target without `filledQty` is retained as historical state; no quantity history is guessed or rewritten. Target progress, orders, fills, ledger, protective-stop quantity and compare-and-set guards remain in one transaction. Existing shared backtester exit semantics are unchanged. No live order adapter, signing, payout, automatic promotion, risk-policy relaxation or release-gate bypass was added.

### Duplication and organization

No alternate scanner, risk gate, OMS, backup engine or formatter was introduced. Strategy replay reuses `chart/analysis.validateCandles`. The apparently similar fee, day-bucketing and consensus formulas in prior audits have different semantics and were not blindly merged. The new reviews index, linked findings register and file inventory organize follow-up evidence without moving stable source paths or rewriting historical audits. The main documentation index links this review as the current follow-up and labels older reports as historical.

## Verification

Regression evidence before fixes: chart3 failures; partial-target2 failures; backup3 failures; news6 failures; backtest10 failures; prediction7 failures; stale analysis401 and future-engine status reproduced. Guard cases also test unchanged correct behavior. The first integrated run passed1135 server tests (4 skipped),26 web tests and107 browser tests; one DITAS browser test failed because an unscoped Refresh query also matched the header's accessible label. That selector was narrowed; assertions were retained. This initial run preceded the latest Solana rebase and final additional target-progress test.

Final integrated results on the rebased combined source: `npm run typecheck` passed; `npm run build` passed; `npm test` passed **1146 server tests (4 skipped)** and **26 web tests**; `npm run test:e2e` passed **all110 browser tests**; `npm audit --audit-level=high` found **0 vulnerabilities**; the secret scan passed (**521 tracked files**). The existing large-web-bundle build advisory remains. Fixtures are deterministic and offline by default. Native PiP and credential-dependent integrations are not certified by this run. Backup status now hashes local files synchronously to preserve its existing API; this can increase status latency for large snapshots and merits a measured performance follow-up rather than an unsafe metadata-only cache.

## Strategy backtesting evidence and limits

`STRATEGY_FIXTURE_RESULTS.json` contains nine executed runs: each of the three registered strategies over three deterministic 4,000-bar synthetic scenarios. These exercise replay behavior and produce actual run outputs. They are **not historical market returns, profitability evidence or live certification**. See `BACKTEST_REVIEW.json` for canonical replay entry points, focused test commands and research limitations (history acquisition cutoff, trial counting and uncertainty reporting). No historical market dataset was supplied or downloaded in this pass.

One CodeRabbit request remains mitigated, not fully implemented: a database from the unreleased Telegram v6 draft is refused without mutation, and preservation instructions retain its DB/WAL/SHM. A tested v6-to-v8 reconciliation tool still does not exist. No real database was opened, deleted or rewritten by this review.

No deployment, merge, branch deletion or mass PR closure was performed. Continue from the findings register and existing domain owners; no claim is made that all repository functionality is complete.
