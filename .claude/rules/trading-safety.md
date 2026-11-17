---
paths:
  - "server/src/market/**/*.ts"
  - "server/src/features/**/*.ts"
  - "server/src/workers/**/*.ts"
  - "server/src/decision/**/*.ts"
  - "server/src/risk/**/*.ts"
  - "server/src/exec/**/*.ts"
  - "server/src/portfolio/**/*.ts"
---

# Trading-system safety rules

- Treat market data freshness, provenance, completeness and cross-source disagreement as first-class safety inputs.
- Fail closed on stale/future-dated inputs, missing required evidence, invalid sizing or unexecutable book depth.
- Never let a worker, consensus vote, LLM response or frontend request bypass the deterministic decision/risk gates.
- Keep indicator calculation separate from indicator interpretation: `features/indicators.ts` is canonical; `workers/indicators.ts` maps calculated snapshots to readings.
- Preserve position/ledger/order/fill reconciliation and idempotency.
- Do not change fees, slippage limits, risk sizing, stop behavior, execution eligibility or release gates without explicit task scope and regression tests.
- Do not turn paper execution into live execution. No real order endpoint, signer or private-key handling belongs in this build.
- When a proposed refactor crosses the market → decision → risk → OMS boundary, map the complete data flow and obtain an independent trading-risk review before editing.
