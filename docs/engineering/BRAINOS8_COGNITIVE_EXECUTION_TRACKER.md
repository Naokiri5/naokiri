# BrainOS 8 - Autonomous Cognitive Execution: evidence tracker

Tracks the owner's roadmap *MIA BrainOS - Autonomous Cognitive Execution* (26 Nov 2026), section 9 milestones A0-A8,
on branch `naokiri/jolly-wozniak-8q7ial` (PR #140, which contains #137 and #139). A milestone is **Done** only with
reproducible evidence in this repository. Paper only; LIVE stays locked. Updated 2026-11-26.

## Milestones

| ID | Deliverable | Status | Evidence | Remaining |
|---|---|---|---|---|
| A0 | Architecture baseline | **In progress** | Risk defects closed: W11 notional cap (`c98c8c1`), rounding, default-policy fallback and execution cost (`233b2ce`, `RISK_AUTHORIZATION_HARDENING.md`). #139 mandate merged into this branch; duplicate session boundaries withdrawn. Component ownership: `docs/BRAINOS_V2_COMPONENT_INVENTORY.md`. | Exact-head CI on #140; owner decision on merging #140 into #137 or main. |
| A1 | Cognitive integration | **Not started** | `knowledge/cognitive/deepCycle.ts` and `coldLane.ts` have no callers in `server/src` (checked with grep). `decision/think-router.ts` is used by `decision/engine.ts`. | Invoke the DEEP cycle from the background lane on frozen snapshots, with trace ids, cancellation, bounded work and explicit NO_TRADE; advisory only. |
| A2 | Outcome-linked memory | **First slice done** | `ditas/tradeOutcomes.ts`: one immutable record per settled paper position linking decision, DITAS decision event and snapshot, orders, fills and ledger-verified settlement (migration 10, immutability triggers, record hashes). Runs on the existing background lane (`bot/bot.ts`), leader-fenced. Read-only API: `/api/ditas/trade-outcomes`, `/summary`, `/verify`. Tests: `server/test/ditas-trade-outcomes.test.ts` (10). | Feed verified outcomes into calibration cohorts and strategy passports; REFLECT lessons; UI. |
| A3 | FAST PAPER | Blocked | `market/tradeBars.ts`, `market/volumeSpike.ts`, `market/flinQueue.ts` (research). | Solana event feed credentials, token-safety evidence, route and swap-cost model, a separate paper adapter. The Binance spot lane is not evidence for memecoin execution. |
| A4 | DEEP PAPER | Blocked | Futures research klines only. | Contract specs, margin and liquidation model, funding/OI data. |
| A5 | Strategy Arena | Not started | Strategy Lab backtester, `lab/sessionSimulation.ts`, `knowledge/cognitive/genomes.ts`. | Point-in-time datasets, walk-forward and holdout, multiple-testing control, frozen baselines. |
| A6 | Capital coordination | Partial | Entries serialized in one SQLite write transaction; gate re-reads cash; mandate ceiling; entry authorization bound to max cost. | Durable reservations with `consumed + released = reserved` (roadmap P0.3). |
| A7 | Operational certification | Not started | Crash-injection suite `crash.oms.test.ts`; storage guard. | 72-hour PAPER soak on Railway (volume resize and backup key first). |
| A8 | Restricted LIVE readiness | Locked | `qa/gates.ts`. | Independent security review and explicit owner authorization. |

## Closed-trade feedback (roadmap section 4, steps 1-6)

| Step | Status |
|---|---|
| 1 Freeze snapshot, decision and strategy version | Linked: decision report, strategy version and the DITAS decision event's frozen snapshot id are captured per trade. Snapshots are frozen by DITAS at decision time. |
| 2 Link order, fills, fees and lifecycle | Done for paper positions: entry and exit order ids, fill-derived quantities, prices, fees and hold time. |
| 3 Verify settlement through the ledger | Done: BUY, SELL and FEE ledger totals must match the fills, and ledger net must equal recorded PnL, or the record is `MISMATCH` and excluded from summaries. |
| 4 Compare expected and actual; attribute | Factual attribution only: favourable excursion, costs removing a gross edge, entry slippage against the decision reference, loss beyond planned risk, 1R reached before a stop. It does not separate a good decision that lost from a poor one. |
| 5 Persist verified evidence | Done: immutable rows, hash verification endpoint. |
| 6 Review against a frozen baseline | Not started (A5). |

Summaries are review evidence only: below 30 verified trades per strategy version they are labelled
`INSUFFICIENT_SAMPLE`; nothing promotes, suspends or resizes a strategy, and no record carries trading authority.
