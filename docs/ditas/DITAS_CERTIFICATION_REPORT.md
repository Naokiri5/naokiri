# DITAS certification status

2026-11-17: NOT CERTIFIED for live trading, profitable strategies or predictive AI calibration.

Offline engineering acceptance for this foundation increment passed; see DITAS_TEST_REPORT.md. This does not replace the remaining dependency phases or prospective evaluation.

| Requirement | Evidence / limit |
|---|---|
| New decision evidence reconstruction | Frozen versioned snapshots, QCI reference, immutable events and correction history tested. Legacy records/raw rejected feed batches/full execution lifecycle are not backfilled. |
| Data failure detection | Clock/identity/OHLCV/book faults and failed secondary frames tested; crypto polling only. |
| Strategy versions | Current rules and OOS version filter tested; unknown historical position versions excluded. Full historical registry remains partial. |
| Actual vs hypothetical separation | Twin has no OMS/ledger dependencies; API tests confirm no actual rows created. Actual metrics use authoritative paper account. |
| Simulation assumptions/look-ahead | Frozen plans, decision-time depth, strictly subsequent closed historical bars and conditional fills tested. Uploaded source provenance is unverified; queue/exit-depth assumptions unvalidated. |
| Calibration | Known-reference metrics and timestamp/cohort/deduplication tests pass. No observed sample establishing a calibrated production model; owner-reported data explicitly unverified. |
| Risk and emergency boundaries | Existing risk/OMS/API/browser regressions pass, live gate unchanged. Unified autonomous operational recovery/stress certification remains pending. |
| Displayed metrics | Backed by stored rows or explicit empty/uncalibrated states; no invented performance values. |
| Prospective paper evaluation | NOT PERFORMED; adequate independent sample, costs and regime stability required. |
| Live authorization | NOT REQUESTED or granted. No live adapter/signer and no merge authorization. |

## Release and rollback

Review this stacked draft separately from the previous chart increment. Do not merge main or enable live execution without explicit owner authorization. Before an eventual deployment, back up the SQLite database and measure immutable snapshot growth/latency on the intended workload. Migration2 is additive and applies transactionally after migration1; ship code/migration together.

Rollback code to the prior application version and retain new DITAS tables as read-only evidence; do not delete history or rewrite a shipped migration. Existing execution tables are not replaced. A later restoration of DITAS should use tested migrations, verified snapshots/events and owner-reviewed configuration. Backup/restore and a complete production recovery drill remain required before certification.
