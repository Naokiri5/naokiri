# MIA 4.1 development handoff

For the Global Chart Intelligence feature, begin with:

1. `docs/chart-intelligence/GLOBAL_CHART_INTELLIGENCE_AUDIT.md`
2. `docs/chart-intelligence/IMPLEMENTATION_STATUS.md`
3. `docs/chart-intelligence/CHART_ANALYSIS_ENGINE_SPEC.md`
4. `docs/chart-intelligence/CHART_INTELLIGENCE_TEST_REPORT.md`

The owner's brief requires phased implementation. The first increment supplies chart evidence, a terminal panel and a bounded blind-prefix replay API. It does not complete the full intelligence platform. Follow the acceptance gates in the status document and update it after each phase.

Preserve the existing scanner, FeatureEngine, QCI coordinator, central decision engine, deterministic risk veto, OMS, portfolio ledger and strategy lab. Chart detections are currently explanatory only; they have no independent vote or execution authority. Reuse dependency groups when adding derived evidence.

Use actual supported market data only. Never commit secrets, represent heuristic rule strength as a calibrated win probability, enable live trading, automatically promote untested strategies or merge main without explicit owner authorization.

Validation: `npm run typecheck`, `npm test`, `npm run test:e2e`, `npm run scan:secrets`. Benchmark: `node --import tsx scripts/benchmark-chart.mjs`. Live provider tests require external connectivity and are separate from offline fixtures.

## DITAS foundation

For the newer Decision Intelligence, Trust & Adaptive Strategy System work, start with `docs/ditas/IMPLEMENTATION_STATUS.md`, `DITAS_ARCHITECTURE_AUDIT.md`, and the test/certification reports in that directory. The feature branch stacks on the chart intelligence increment. Preserve immutable pre-QCI snapshots, exact probability cohorts and separation of hypothetical simulations from actual paper OMS records. Continue the remaining phases from the status table; no live certification or automatic promotion is implied.
