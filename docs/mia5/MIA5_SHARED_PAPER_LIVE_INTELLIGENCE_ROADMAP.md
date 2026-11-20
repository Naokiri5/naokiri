# MIA — one intelligence pipeline, separately certified PAPER and LIVE execution

**Status:** Implementation plan + first routing increment, not completion of eight features.  
**Baseline:** unified PR #45 (`claude/mia-unified-01`, 2ceb6dc88ae87a7f324ad3d7f56ecae151288e74).  
**Related:** PR #71 (parity UI), #19 (Hunt ranker, already incorporated into #45), #46/#50/#51/#52 (Solana), #33–#37 (THINK), #56/#61 (B-MIND), #66/#67 (risk), #75 (Guardian).  
**Critical:** No signer or operational LIVE venue in this build; `LIVE_EXECUTION_AVAILABLE=false`. No permissions to switch it on are added by this change.

## Requirement

The same validated market observations, feature algorithms, quality checks, strategy definitions, QCI evidence, DITAS snapshots and model versions should support *both* environments. Do not create duplicate scanners, token radars, QCI coordinators, strategy labs, risk engines, OMSs, ledgers or Trader Joe instances.

An intelligence report is **not** an executable order. Each account independently evaluates available buying power, holdings, exposure, venue rules, data freshness, execution costs, strategy enrollment, risk budgets and current kill switches at the final submission boundary. Keep account-specific ledger, orders, positions, order IDs, approvals, signer/credentials, audit, fee schedules, reconciliation and PnL strictly separated.

```text
SOURCE / MARKET DATA (one normalized, provenance-tracked view)
  -> market/store.ts, market/fabric.ts, market/quality.ts
  -> asset discovery + Hunt watch-only + Solana checks + optional social evidence
  -> canonical scanner + strategy versions + indicators
  -> existing workers / independent challenge / QCI
  -> decision engine / signed snapshot / DITAS / explainability
  -> account-scoped portfolio/risk assessment (required per environment)
  -> EXECUTION ENVIRONMENT ADAPTER (exec/environment.ts)
       PAPER -> canonical exec/oms.ts -> paper account/ledger
       LIVE  -> LOCKED until separately reviewed live adapter/release gates
  -> account-scoped outcomes / research-only comparison / Trader Joe narrative
```

No hunting, social, LLM, forecasting or B-MIND module may call the OMS, risk setters, wallet, signer or exchange-write API. Research ranking never implies `tradeEligible=true`.

## Existing code ownership — do not duplicate

| Responsibility | Canonical code or related PR | Increment needed |
| --- | --- | --- |
| Market sources, freshness, book continuity | `market/fabric.ts`, `market/store.ts`, `market/quality.ts`, `market/depthStream.ts` | Certify reconnection, sequence gaps, source timestamps and priority for held positions |
| Hunt rankings | `hunt/ranker.ts` already in #45 from #19 | Bridge **verified** cache observations to ranking; preserve source currency/time provenance; expose authenticated read-only Hunt Radar |
| Solana token evidence | #46 → #50 → #51 → #52 | Review branch dependency order, integrate on-chain mint/launch checks; add holder, liquidity and sellability evidence only from authenticated feeds |
| Social Calls Radar | Not available as a functioning service | Add separately verified source contracts, read-only events, caller time histories and source attribution; never route social calls directly to entries |
| Certificates / B-MIND | `decision/certificate.ts`, `ditas/*` in #45; #56/#61 | Reconcile instead of duplicating; attach frozen behavioral observations with uncertainty and veto-only/WAIT effects |
| Strategy evaluation | `lab/*`, `knowledge/research.ts`, `ditas/twin.ts` | Same-window challenger evaluation, leak-free replay, inactive/delisted assets, actual-vs-shadow outcomes |
| Trader Joe | `joe/joe.ts`, `joe/live/*` from #44 | Display sourced account-specific paper/live narratives without access to execution authority |
| Paper execution & accounting | `exec/oms.ts`, `portfolio/ledger.ts` | Reuse the canonical paper OMS; no second paper engine |
| Environment boundary | `exec/environment.ts` | Bot now uses this boundary for its PAPER entry path; future LIVE adapter requires separate implementation |
| Release / security | `qa/gates.ts`, `core/mode.ts`, Guardian #75 | Keep LIVE locked; test account isolation, signer isolation, recovery and release prerequisites |

## Eight delivery tracks

1. **PR reconciliation, P0.** Re-check current `main`, #45, #71 and all subsequent stacked heads. Build file-level ownership and conflict matrix, run tests on the actual integrated head, do not blindly merge. **This PR** only changes the bot PAPER entry call site to use the existing adapter and adds a regression test.
2. **TITAN HUNTER, P1.** Supply source-time-correct cached ranking, `/api/hunt/*` read-only routes, Hunt Radar in existing Discover, explicit reasons and negative evidence. Keep candidate `WATCH_ONLY` in both environment views.
3. **Solana safety, P1.** Integrate the existing #46→#52 watch-only stack, then add holder concentration, LP drain/lock, chain finality, and sellability when compatible data is available. Missing checks must be `UNVERIFIED`, not `SAFE`.
4. **Feed resilience, P1.** Certify diff-book continuity, REST snapshot fallback, stale/gap quarantine, resource quotas, provider failover and open-position priority with fault injection. PAPER and future LIVE must use the same market-quality rules; execution eligibility remains account/venue-specific.
5. **Social Calls Radar, P2.** Add schema-versioned, timestamped, opt-in licensed/authorized read-only source events. Show unverified claims as unverified, deduplicate reposts, measure realized hypothetical returns after costs against source and time; feed observations to research only.
6. **Certificates and B-MIND, P2.** Reuse current DITAS and THINK records; link observed fear/FOMO/herding hypotheses with provenance, freshness and uncertainty. Behavioral output can explain or recommend WAIT; it cannot independently ALLOW, size or execute a trade.
7. **Historical research, P2.** Use existing labs/DITAS. Include fees, taxes where relevant, slippage, bad exit depth, delisted assets, false signals, walk-forward and multiple-testing controls. No automatic promotion of unvalidated strategies or sharing PAPER PnL as LIVE outcomes.
8. **Trader Joe Live, P3.** Finish account-aware read-only status, alert and lifecycle stories from actually committed records. A LIVE view must display `LOCKED/NOT_CERTIFIED` and no synthetic live trades.

## Environment parity contract for EVERY future increment

Each feature PR must provide a pair of test cases using the exact same frozen, timestamped source evidence:

- **Shared signal parity:** same normalized input + same strategy/version -> same analysis evidence under PAPER and LIVE research context, where account-independent.
- **Risk isolation:** different balances/positions, policy or venue rules -> separate risk outcomes; neither outcome can authorize the other account.
- **Execution isolation:** PAPER only writes to paper OMS and paper ledger; LIVE cannot reuse its orders, fills, approvals or position protection.
- **Locked-live refusal:** every order/withdrawal/signature path returns explicit `LIVE_LOCKED` until venue certification, signer/credential scoping, reconciliation, protective-stop equivalence, audit/rollback and owner approval are complete.
- **Source fidelity:** missing, stale, reorged, legally unavailable or unverified data fails closed; no invented timestamps, probabilities, safety labels or profits.
- **Regression:** existing paper risk/OMS behavior, position monitoring, QCI, approvals, leases, single-writer rules, CSRF, secret scans, e2e and recovery tests must still pass.

Do not change `LIVE_EXECUTION_AVAILABLE` or merge/deploy without explicit owner review. This plan is not a statement that these integrations are all built or certified.

## This PR: exact behavior and verification scope

- **Changed:** `bot/onDecision` PAPER branch now dispatches via the existing `executionAdapter('PAPER').submitEntry()` rather than importing `submitEntry` directly. The same internal `exec/oms.ts` is called through its thin adapter; existing write lease fencing and account policy remain intact.
- **Unchanged:** scanner, QCI, decision, risk, OMS internals, ledger, APROVAL queue, protective exits, all credentials, signing, withdrawals, and LIVE lock.
- **Regression test added:** PAPER adapter entry results carry environment `PAPER`, and attempted LIVE entry/close throw without modifying orders, fills, account or cash.
- **Not yet run:** full repository CI on this draft head. Check `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`, `npm run scan:secrets`, `npm audit --audit-level=high` on the GitHub PR before any merge.
