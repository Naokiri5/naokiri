# THINK slice 3: risk-gate correlation and sizing invariants

- **Status:** tests only. The independent risk gate (`server/src/risk/gate.ts`) is unchanged.
- **Tickets:** MIA-THINK-053, 052, 047.
- **Test file:** `server/test/risk-correlation-sizing.test.ts`, run in the required CI test job.

## Correlated exposure (053)

The gate counts open positions whose 1h log-return correlation with the candidate is at or above `correlationThreshold` (default 0.8). It denies when that count reaches `maxCorrelatedPositions` (default 2). The tests use seeded fixtures (same seed = identical returns) and prove four cases:

- 2 correlated open positions → `DENY` with `CORRELATION_LIMIT 2 correlated open positions`.
- 1 correlated open position → below the limit, so no correlation denial.
- Uncorrelated positions → counted as 0.
- **Unknown correlation (no overlapping history) counts as correlated**, so the gate fails closed.

## Sizing invariants (052, 047)

Volatility reaches the gate through the stop distance; strategies set ATR-based stops. Across stop distances from 0.5% to 20%:

- **No wider stop increases size.** Quantity never increases as the stop widens.
- **No overspend.** Planned maximum loss ≤ risk budget, and notional ≤ the `maxPositionNotionalPct` cap.
- **Stops fill worse than triggered.** The stop is assumed to fill worse than its trigger (`stopFillBufferPct`).
- **Fixed budget.** The risk budget is a fixed share of equity (`riskPerTradePct`); a tighter stop never raises the money at risk.
- **Rounding only ever goes down.** Step-size rounding only lowers quantity, by less than one step.

## Not built (needs an independent trading-risk review before changing the gate)

- **Volatility-scaled risk budget (052):** lowering `riskPerTradePct` itself when realised volatility spikes.
- **Factor clustering (053):** grouping by funding, beta, liquidity or common underlying, beyond pairwise return correlation.
- **Macro-event exposure limits (059).**
