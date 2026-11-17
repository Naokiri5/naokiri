# Trade failure challenger

Status: implementation design for subsequent increments; not a claim of completion.

Extend qci/challenge.ts rather than creating a parallel authority. Produce sourced contradictions, severity, mitigation and PASS/FAIL/ABSTAIN for regime mismatch, false breakout, late entry, stop/volatility, event, liquidity, cost, stale data, correlation and strategy decay. Missing feeds must be explicit. Acceptance: a challenger never authorizes execution; all critical vetoes reach the existing deterministic risk/OMS path.
