# REQUIREMENTS_CONFLICT_REGISTER — Omega (2026-11-19)

Rule (spec §0): preserve both sides, choose the secure interpretation, record any owner decision needed.

| # | Original ask | Conflicting invariant | Chosen interpretation | Owner decision? |
|---|---|---|---|---|
| C-01 | Appendix A §1: p95 <200 ms (stretch <100 ms), 99.9% availability, 100% fills known | CLAUDE.md: never claim a test or measurement that was not made | Targets are recorded as **NOT_MEASURED** goals (`LATENCY_BASELINE.json`). Only a sustained ≥10,000-event trace may claim them, separating venue acknowledgement and finality. | No |
| C-02 | Live execution, real fills, real-money reservation, bounded-live pilot (A §6–8, reqs 050, 100) | Invariant 1: paper only; `LIVE_EXECUTION_AVAILABLE=false` | Design contracts, paper, shadow and testnet work only. Live stays **LIVE_LOCKED** until a separately certified release is explicitly approved by the owner. | **Yes, before any live work** |
| C-03 | "100% paper-to-live parity" | Invariant 4: never invent fills; venues differ | Parity means shared strategy, risk and exit **logic**, with venue differences listed per row. A matching paper result is not certification. | No |
| C-04 | Fast path that skips deep QCI | Invariants 2–3: deterministic gates authoritative, fail closed | The fast path reads cached, versioned evidence with TTLs. Stale evidence denies the entry; it never bypasses risk. | No |
| C-05 | Solana sniping, GMGN and smart-money signals (reqs 011–030) | Invariant 7: provider data is untrusted; DEX `eligibleForAutomation:false` | **Read-only watchlist** (PR-01): `tradingEligible:false`, `executionReady:false`, no signer. `safety.ts` is unchanged. | No |
| C-06 | GMGN, Jupiter, Raydium, Orca integration | Licenses and credentials | Raydium (GPL-3.0) and Orca (custom) are **not imported**. GMGN and RPC clients are inert until server credentials exist. Provider tests count as "not run" without credentials. | **Yes: license and credential decisions** |
| C-07 | Cloudflare domain deployment (A §C, reqs 071–077) | Existing docs describe Tailscale Funnel; no domain or credentials given | Cloudflare Tunnel + Access is the **planned** primary path (`sources/MIA_OMEGA_CLOUDFLARE_DEPLOYMENT_PLAN.md`). Nothing is configured or claimed until the owner gives the exact hostname at an authorized step. | **Yes: domain, host, timing** |
| C-08 | Trader Joe narrates and supervises live orders | THINK import boundaries: Joe may only pause | Joe stays a read-only narrator plus pause. Extending this needs an allow-list review. | No |
| C-09 | "Accuracy" and win probabilities (A §12, req 064) | THINK: `NO_VALID_FORECAST` until a calibrated out-of-sample cohort exists | The starter's `rankScore` and QCI agreement are **ordering and evidence, not probabilities**. The UI labels this explicitly. | No |
