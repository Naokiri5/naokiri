# BrainOS Closed-Loop Execution Architecture: evidence tracker

Tracks the owner's *MIA BrainOS - Closed-Loop Execution Architecture* (26 Nov 2026) on branch
`naokiri/jolly-wozniak-8q7ial` (PR #140, which contains #137 and #139). Paper only; LIVE stays locked. Updated
2026-11-26.

## Architecture impact check (done before coding)

| Question | Answer |
|---|---|
| New engine, scheduler, database, event system or execution path? | No. Two read-only DITAS modules over records that already exist. |
| Duplicates existing logic? | No. The chain reuses the existing fill events (`exec/fillEvents.ts`, which already record session, trace, decision, order and position ids), decisions, DITAS events, orders, fills, ledger and outcome records. REFLECT reads the immutable outcome record and the strategy registry. |
| Touches risk gate, OMS, ledger or session authority? | No. |
| Gives anything authority? | No. Attribution never changes a strategy, policy or sizing. |

## What was built this increment

- **Evidence chain** (section 04, acceptance test 12): `server/src/ditas/evidenceChain.ts`,
  `GET /api/ditas/trade-outcomes/:id/chain`. Rebuilds session -> trace -> decision (+ frozen snapshot) -> orders ->
  fills -> ledger -> position -> settled outcome and checks every link. Missing or inconsistent links are named
  (`AUTHORIZING_SESSION_NOT_RECORDED`, `TRACE_MISMATCH`, `FILL_EVENTS_INCOMPLETE`, `SETTLED_OUTCOME_NOT_LINKED`,
  `OUTCOME_RECORD_ALTERED`, ...); nothing is inferred to fill a gap.
- **REFLECT error attribution** (section 10): `server/src/ditas/reflect.ts`. The five categories, each a fixed rule:
  forecast (first target never reached), strategy (decision regime outside the strategy's validated regimes), entry
  (entry cost above 0.1R versus the decision reference), exit (a favourable move given back on a loss), execution
  (costs removed a gross edge, or loss beyond planned risk). Missing evidence is reported as unassessed; a loss with no
  attributable error is reported as such. Attribution runs only on a verified, untampered outcome.

## Acceptance checklist (section 12) with evidence

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 01 | Rejected risk decision produces zero order submissions | Verified | `risk-authorization.test.ts` "makes zero execution calls when the risk gate refuses" |
| 02 | Duplicate signal cannot create duplicate exposure | Verified (paper) | Risk gate `DUPLICATE_INSTRUMENT_POSITION`, idempotent client order ids; `crash.oms.test.ts` race cases |
| 03 | Concurrent strategies cannot spend the same capital | Verified (paper) | One SQLite write transaction per entry; `risk-authorization.test.ts` second-lane test; `crash.oms.test.ts` barrier races |
| 04 | TESTNET balances cannot reach LIVE accounts | Not applicable yet | No TESTNET or LIVE account exists; gate refuses any non-paper account (`ACCOUNT_UNSUPPORTED`) |
| 05 | Expired mandate prevents new entries | Verified | `trading-mandate.test.ts` "an expired mandate or changed risk policy blocks new entries" |
| 06 | Unknown venue outcomes preserve unresolved reservations | Not built | Paper has no asynchronous venue; unresolved paper orders already quarantine new risk (`UNRECONCILED_PAPER_ORDERS`, `oms.test.ts`) |
| 07 | Partial fills reconcile against actual fees and exposure | Partial | Partial exits verified against the ledger (`ditas-trade-outcomes.test.ts`); paper entries are all-or-none |
| 08 | Protective exits stay responsive during research overload | Partial | `ops-lease-hardening.test.ts` "closes a protected paper position on schedule while ticker and book refreshes are still pending"; no measured saturation test |
| 09 | Railway restart restores durable trading state | Verified (local) | `crash.oms.test.ts` (SIGKILL at every checkpoint), `durable-session.test.ts`; not yet run on Railway |
| 10 | Closing a session prevents new trades | Verified | `oms.test.ts` `SESSION_NOT_RUNNING` |
| 11 | Learning uses only verified, labelled outcomes | Verified | `ditas-trade-outcomes.test.ts` (MISMATCH excluded), `ditas-evaluation.test.ts`, `ditas-evidence-chain.test.ts` (altered record refused) |
| 12 | Every completed trade can be reconstructed from its evidence chain | **Verified (new)** | `ditas-evidence-chain.test.ts` |
| 13 | No unauthorized wallet signing or withdrawals | Verified by absence | No signer or withdrawal path exists; `brainos7-authority.audit.test.ts` |
| 14 | Missing LIVE certification blocks real-money orders | Verified | `gates.test.ts`, `api.test.ts` (LIVE_CANDIDATE refused), `qa/gates.ts` |

## Recommendation on the next P0 items (tasks 5-8)

Durable external capital reservations, partial-fill reconciliation and uncertain-order recovery only have meaning with
an asynchronous venue adapter: today a paper fill, its ledger rows and its position commit in one SQLite transaction,
so a reservation would be created and consumed in the same instant. Building that machinery without an adapter would
add OMS complexity with no behavioural benefit. The sound order is to design the reservation lifecycle together with a
Binance Spot TESTNET adapter (task 10), which needs owner-provided testnet API keys, behind an independent trading-risk
design review.
