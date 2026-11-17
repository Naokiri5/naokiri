# Portfolio intelligence

Reuse portfolio/ledger.ts, correlation.ts and risk/gate.ts. Existing policy independently sizes against capital, open risk, concentration, correlation, drawdown and loss budgets. Unknown correlation stays conservative. DITAS overview queries only PAPER_ACCOUNT actual OMS records; Twin results never enter this projection. No agents can increase size or change policy.

Sector, shared-event, asset-class budgets, volatility contribution and correlation-shock allocation remain PARTIAL/MISSING pending reliable data and owner-reviewed policy changes. They are not silently approximated with agent agreement. Tests retain existing exposure/capital/emergency regression checks. No additional allocator service is introduced.
