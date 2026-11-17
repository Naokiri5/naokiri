# Chart intelligence validation report

Date: 2026-11-17. Node v24.22.1. Feature branch: feat/global-chart-intelligence.

| Check | Result |
|---|---|
| `npm run typecheck` | PASS server + web |
| `npm test` | PASS: 75 tests, 2 skipped; 11 files passed, 1 live-provider file skipped |
| `PLAYWRIGHT_BROWSERS_PATH=/workspace/work/pw-browsers npm run test:e2e` | PASS: 33 browser tests; includes web production build |
| `npm run scan:secrets` | PASS after staging all deliverables |
| `git diff --check` | PASS |
| `node --import tsx scripts/benchmark-chart.mjs` | Completed; see PERFORMANCE_BENCHMARK_REPORT.md |

New deterministic coverage: short-history abstention, no invented trend, gaps, duplicates, invalid OHLCV, non-finite values, forming/future candles, invalid close time, stale histories, engulfing metadata, signal-bar-excluded breakouts, sweep hypotheses, delayed swing confirmation, purity, replay prefix invariance and invalid cursors.

API coverage: existing cache -> chart report; unsupported intervals rejected; replay auth and CSRF checks; visible-prefix response; unsupported timeframe, out-of-bounds cursor and oversized history rejected. Browser coverage: terminal detection, boundaries/evidence panel, invalidation and uncalibrated rule strength; existing navigation, controls, live-mode lock, console errors and mobile suite.

Browser setup initially required installing Chromium. External Google Fonts TLS caused an unrelated offline-suite failure; the test context now fulfills the stylesheet locally so offline tests do not depend on external font services. A new exact-text locator was corrected to select the detection table cell; the final complete browser run passed.

Synthetic data is used only as explicitly named test/benchmark fixtures. No live-market backtest, licensed data integration, strategy profitability, walk-forward stability, calibrated confidence, model promotion, full load/recovery or live execution certification was performed. Those remain acceptance gates for subsequent phases.
