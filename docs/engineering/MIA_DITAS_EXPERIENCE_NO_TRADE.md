# MIA DITAS paper experience and no-trade review — implementation and safety

## Scope and canonical owners
- The **only** outcome source is existing `positions` with `account=paper-bot`, `status=CLOSED`, decision-linked version and recorded paper OMS financial fields.
- `ditas/experience.ts` is a bounded **read-only projection**, not a second database, training engine, outcome ledger or risk authority. It calls the existing `returnHealth()` from strategy passports.
- Existing `decision/engine.ts` records historical-cohort evidence. In `SHADOW` mode it changes no decision, permission or trade.
- Optional `PAPER_ENFORCE` can **only abstain** when at least 30 same-version, same-regime settled paper trades trigger the existing `DEGRADED_REVIEW` heuristic (the approximate upper interval is below -0.3R); `exec/oms.ts` rechecks at submission to block stale decisions.
- The canonical `risk/gate.ts`, paper order manager, financial ledger, DITAS memory, strategy registry and live gate are unchanged.
- The DITAS workspace and authenticated read-only `GET /api/ditas/experience` expose the evidence and exclusions.

## Why this specific patch
The passport query previously omitted the paper account scope, permitting unrelated account results to contaminate paper health. The new projection requires account, strategy, version and decision identity, and uses a decision-time `asOf` cutoff; malformed legacy data is excluded, not treated as a win or loss. No automatic promotion, strategy modification, whale imitation or learned win probability is claimed.

The current heuristic is a *research and risk-reduction check* rather than proof of strategy degradation. Its normal interval assumes independent outcomes; periods of correlated losses may reduce effective sample size. Enabling enforcement is explicitly opt-in and limited to paper trading. For validation, run the exact tests plus backtest/OMS integration and prospective shadow evaluation.

## Verification
- `npm ci`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run test:e2e`
- `npm run scan:secrets`
- `npm audit --audit-level=high`
- Security, domain-risk and independent review are required before merging.
- Keep `MIA_EXPERIENCE_NO_TRADE_MODE=SHADOW` until sufficient prospective paper evidence exists.
- Never interpret a green CI as trading profitability or live-venue certification.

## Related PRs / avoid duplicate work
- #108: backtest accuracy and execution-cost corrections — reconcile without replacing Strategy Lab.
- #109: whale intelligence — do not feed whale simulations into observed paper experience.
- #111: FAST/DEEP exit assessment — still unconnected to operational position monitoring.
- #89: Adaptive THINK — avoid another coordinator/router and reconcile its decision-report changes before merge.
- #106: paper bundles and migration v6 — this patch adds no migration and does not touch financial writes.
- #110: autonomy roadmap — use as the broader dependency plan; this PR only implements a narrow, verifiable increment.

No 100 parallel developer agents were actually run. Senior-engineering specialties represented in this review: architecture ownership, data provenance, ledger/accounting boundaries, strategy evaluation, quality, security and test planning. Additional implementation slices need separate reviewed PRs.
