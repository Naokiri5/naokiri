# BrainOS 100-Worker Cognitive Integration: evidence tracker

Tracks the owner's *MIA BrainOS - Internalizing the 100 Workers* (26 Nov 2026) on branch `naokiri/jolly-wozniak-8q7ial`
(PR #140). Paper only; LIVE stays locked. Updated 2026-11-26.

## Architecture impact check (done before coding)

| Question | Answer |
|---|---|
| New agents, registry, worker pool, scheduler or memory database? | No. One read-only module next to `workers/effectiveness.ts`. |
| Moves or renames workers? | No. All 100 worker ids, versions and implementations are unchanged. |
| Changes QCI weights, thresholds or votes? | No. Reliability is reported, never fed back automatically. |
| Gives workers authority? | No. Workers stay analytical evidence; only the risk gate and OMS act. |

## P0 inventory (verified by test)

`server/test/worker-reliability.test.ts` asserts exactly 100 unique worker ids in the 11 domains the document lists:
trend 12, momentum 10, volatility 8, flow 10, liquidity 10, structure 10, regime 8, news 8, onchain 6, risk 10,
execution 8. Capabilities: 86 data-driven, 11 provider-blocked, 3 constant-rule.

## This increment: outcome-linked worker reliability (P4, gap "effectiveness measures participation")

`server/src/workers/reliability.ts`, `GET /api/intelligence/reliability`. For every ledger-verified closed trade, the QCI
packets stored with its consensus record (kept by retention because the decision led to an order) are scored against
the net outcome: SUPPORT is correct on a net win, OPPOSE on a net loss.

- Per worker: votes, stance accuracy and win rate when supporting, with Wilson intervals, only at 30 or more votes.
- Constant-rule workers are labelled `POLICY_CONFIRMATION` and never measured as predictors (document gap: "fixed-rule
  workers can contribute supportive evidence").
- Dependency groups are measured once per trade by majority stance, so correlated workers cannot inflate the evidence
  (master prompt item 9). Mutation-checked.
- Trades whose packets were compacted are counted, not guessed.
- Limitation stated in the output: only executed trades are scored, so accuracy on rejected opportunities is unknown.

## Phase status (document section 08)

| Phase | Status | Evidence / remaining |
|---|---|---|
| P0 Inventory | Done | Test above. |
| P1 One registry, one scheduling authority | Existing | `workers/registry.ts`, `workers/runtime.ts` (bounded pool, 250 ms deadlines, quarantine), dispatched only from the existing scheduler. |
| P2 Adaptive worker selection | Not built | Needs a design: which workers are mandatory per market. Mandatory domains and vetoes already exist in QCI. |
| P3 QCI + immutable snapshots | Existing | Dependency-capped weighting, required domains, DITAS frozen snapshots. |
| P4 Outcomes linked to worker findings | **First slice done** | This increment; next is feeding measured reliability into owner-reviewed QCI weight proposals (never automatic). |
| P5 Provider-blocked workers | Blocked | 11 news/on-chain workers need provider credentials; they abstain honestly today. |
| P6 Worker execution limits | Partial | Per-dispatch concurrency 16 and deadlines exist; a global limit and forcible interruption are not built. |
| P7 Execution parity | Not applicable yet | No TESTNET or LIVE adapter exists. |
