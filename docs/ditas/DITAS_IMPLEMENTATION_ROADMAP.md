# Implementation roadmap

Audit complete before implementation. This increment integrates phases 1–6 and a read-only dashboard while reusing existing risk/portfolio/execution/safety services. Independent pure helper authoring is parallel after the audit; dependent writes/hooks are integrated sequentially. Status and precise limitations are recorded in IMPLEMENTATION_STATUS.md.

1. Harden existing market truth gate; adversarial tests and existing risk regressions.
2. Append migration and frozen snapshot/event memory; scanner/no-signal/central decision hooks; immutability/atomicity/restart tests.
3. DNA on explicit point-in-time inputs; normalized similarity with missingness and time filters.
4. Strategy passports with version-aware evidence; preserve existing status vocabulary/owner authority.
5. Research-only Decision Twin using shared exits; fee/spread/slippage/depth assumptions, stop-first, delayed entry, no-trade and open/no-fill states.
6. Independent calibration: stored forecasts before outcomes, metrics and sample uncertainty; no vote-to-probability conversion.
7–10. Reuse current risk/OMS/worker/safety controls; separately plan broader portfolio budgets, execution telemetry, LLM evaluation and autonomous recovery.
11–12. Defer arena/stress certification until the stored evidence and evaluation datasets are sufficient.
13. DITAS overview and evidence/simulation drilldowns backed by actual storage; test empty and populated states.
14. Offline regression/acceptance reports now; prospective paper evaluation and live certification remain incomplete.
