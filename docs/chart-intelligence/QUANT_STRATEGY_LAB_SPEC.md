# Quantitative strategy lab

Status: implementation design for subsequent increments; not a claim of completion.

Extend lab/strategies.ts, backtest.ts, exits.ts and lab.ts. Existing three strategies and IS/OOS split are research baselines. Add rolling chronological train/validation/test windows, frozen parameters, holding-period embargoes, source universe history, fees/spread/slippage and cost sensitivity. Reuse conservative stop/target ordering. Acceptance: independent replay agreement, no overlap leakage, adequate OOS samples, expectancy/profit-factor/drawdown stability. No automatic strategy promotion from a high win rate.
