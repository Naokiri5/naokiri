# MIA BrainOS — specification traceability (2026-11-25)

This document maps the owner's **MIA BrainOS — Autonomous Intelligence Workflow** brief to the code that already
fulfills each responsibility, so new work repairs integration instead of adding a second engine. It was produced by
reading the code on this branch, which is the open draft stack `main ← #128 ← #129 ← #130 ← #132 ← #135 ← #137`
(head `b2005c1`) plus the session-boundary increment described in §5.

**Status legend.** *Implemented*: code and tests exist on this branch. *Partial*: the responsibility exists but part of
the brief is missing. *Research-only*: evidence is produced but has no execution authority. *Open*: not implemented.
Nothing here is on `main` until the stack is reviewed and merged. Paper trading only; LIVE stays locked.

## 1. Why no new "brain" service was added

The brief's own rule is "audit whether an existing engine already performs its responsibility; repair its integration
before creating a replacement." The stack already has one leader-fenced engine (`server/src/bot/bot.ts`), one risk
authority (`server/src/risk/gate.ts`), one OMS (`server/src/exec/oms.ts`), one ledger (`server/src/portfolio/ledger.ts`),
one durable session state machine (`server/src/ops/durableSession.ts`) and one memory/evidence store family (DITAS,
knowledge A–F, audit log). A separate "BrainOS orchestrator" would duplicate the engine's scheduling and lease fencing.

## 2. Operating phases (brief §2)

| # | Phase | Canonical owner on this branch | Status |
|---|---|---|---|
| 01 | Initialization | `bot/bot.ts` `holdEngine` + `ops/lease.ts` (engine lease), `ops/integrity.ts` `takeoverIntegrity` (quick_check, schema, audit chain, decision-memory chain, ledger reconcile, protective stops) | Implemented |
| 02 | Awakening | `recoverDurableSessionAfterTakeover` (suspends any prior session), `exec/recovery.ts` `unreconciledPaperOrders` | Implemented |
| 03 | Perception | `market/fabric.ts`, `market/quality.ts`, `providers/*` | Implemented (spot); derivatives/on-chain research-only |
| 04 | Understanding | `market/scanner.ts`, `regime/regime.ts`, `chart/analysis.ts` | Implemented |
| 05 | Cognition | `workers/*`, `qci/coordinator.ts`, `qci/challenge.ts`, `decision/think-router.ts` | Implemented |
| 06 | Decision | `decision/engine.ts` (NO_TRADE is a first-class result); `choice/arbitration.ts` shadow comparison | Implemented; Choice is shadow-only |
| 07 | Validation | `risk/gate.ts` re-run inside the OMS write transaction; `ops/paperSpotEntry.ts` session gate | Implemented |
| 08 | Execution | `exec/oms.ts` `submitEntry` (depth-walk fill, idempotent client order IDs, fenced writes) | Implemented (paper) |
| 09 | Supervision | Independent protection lane in `bot/bot.ts` → `oms.monitorPositions`; `exec/incidents.ts` | Implemented |
| 10 | Adaptation | Trailing stop and partial targets in `lab/exits.ts` via the OMS | Partial (see §4) |
| 11 | Exit | Stop, trailing stop, targets, time exit in `oms.monitorPositions` | Implemented |
| 12 | Reflection | `ditas/*` decision ledger, `oms.autopsy`, `journal/*` | Partial |
| 13 | Learning | `lab/lab.ts` strategy health/suspension, `ditas/calibration.ts`, `ditas/forecastVerifier.ts` | Research-only; no automatic promotion |
| 14 | Continuation | Scan lane cadence in `bot/bot.ts` | Implemented |

## 3. Awakening checks (brief §3) → Run Session preflight

`GET /api/session/paper-spot` (`ops/sessionPreflight.ts` `paperSpotSessionPreflight`) gates **Run Session**:

| Brief step | Check id(s) | Status |
|---|---|---|
| System initialization | `execution-lane` (current leader holds the engine lease) | Implemented |
| Memory restoration | Takeover integrity + boot recovery (§2, 01–02) | Implemented |
| Security verification | `owner-verification` (step-up available), `owner-control`, owner step-up on POST `/run` | Implemented. Exchange credentials: not applicable to paper |
| Portfolio reconciliation | `paper-account`, `paper-recovery`, `position-protection` | Implemented |
| Market synchronization | `position-protection`: the protection lane ran recently and every open position has a fresh executable price and book | Partial: no market-wide ticker freshness check before Run; each entry still requires fresh quotes and books in the risk gate and OMS |
| **Capital and risk boundaries** | **`session-boundaries`** — added in §5 | **Implemented by this increment** |
| Restricted / recovery state | `ENTRY_SUSPENDED_RISK_HALT`, `RECOVERING_ON_BOOT`, `EMERGENCY_KILL_SWITCH` | Implemented |

## 4. Position monitoring (brief §8)

| Condition | Owner | Status |
|---|---|---|
| Profit target reached | `oms.monitorPositions` partial targets | Implemented |
| Strong trend continuation | Trailing stop after `trailAfterR` | Implemented |
| Stop-loss triggered | OMS-monitored protective stop | Implemented |
| Session closed | `requestPaperSpotClose` → drain → `finishDurableClose` | Implemented |
| Exchange connection failure | Stale/missing data ⇒ no invented fill, persistent incident, entries blocked | Implemented |
| Excessive loss in the session | **Session loss REFLEX (§5)** | **Implemented by this increment** |
| Strategy invalidation, market reversal | — | Open |
| Liquidity deterioration | Incidents only; no discretionary protective exit | Partial |
| Whale selling pressure | `whales/prints.ts` evidence only | Open (draft #111 not wired) |
| Excessive portfolio exposure | Risk gate denies new entries; no automatic reduction | Partial |

## 5. Increment delivered here: owner-set session boundaries + REFLEX

The brief makes the owner responsible for "authorizing a session and establishing capital and risk boundaries."
On #137, **Run Session** accepted only step-up; boundaries came solely from the account-wide risk policy.

- **Run Session requires** `capitalLimitUsd` and `maxSessionLossUsd` (`ops/sessionBoundaries.ts`). Validation: positive,
  finite, loss ≤ capital, capital ≤ current paper equity, every open position priced. Stored per fence epoch in
  migration **v7** `brainos_session_boundaries`, in the same transaction that opens the session; any refusal rolls back.
- **Capital boundary**: the entry cost of all open paper positions plus the executed fill notional must stay within the
  limit. Checked in `exec/oms.ts` `submitEntry` after the depth-walk fill and before any write. Deny-only: sizing by the
  risk gate is unchanged.
- **Loss boundary**: session P&L = (equity − net deposits) − the value at Run, so deposits and withdrawals never count.
  A missing mark makes the loss unverifiable: entries are denied, but no breach is recorded.
- **REFLEX** (`enforceSessionLossBoundary`): when verified loss reaches the limit, the session moves to
  `ENTRY_SUSPENDED_RISK_HALT`, the breach is recorded once, pending paper approvals are cancelled and a CRITICAL
  notification is sent. It runs in the protection lane **after** `monitorPositions`, inside its own error guard, so it
  can never delay an exit. Resuming requires the owner to close the session and authorize a new one, which takes a new
  baseline.
- **Visibility**: the preflight returns a `session-boundaries` check and a `boundaries` payload; Autopilot asks for both
  limits in the Run dialog (pre-filled with 50% of equity and 2% of equity) and shows capital in use and session P&L.
- **Compatibility**: a session that was running before v7 has no boundaries row and is denied new entries
  (`SESSION_BOUNDARIES_MISSING`) until the owner closes it and runs a new one. Takeover already suspends sessions.

Tests: `server/test/session-boundaries.test.ts` (validation and rollback, capital rejection without ledger writes,
REFLEX with continued stop protection, missing marks, deposit invariance, legacy session, protection-lane REFLEX and
notification, v6→v7 upgrade), plus updated `durable-session`, `brainos-paper-flow` and `api` tests.

## 6. Remaining gaps, in recommended order

1. **Land the stack.** #128 → #129 → #130 → #132 → #135 → #137 (and this increment) are open drafts totaling roughly
   12,800 added lines. Every later BrainOS phase depends on them. Review and merge in dependency order before adding
   more surface.
2. **Discretionary exits** (§4 open rows): strategy invalidation, reversal, liquidity deterioration and exposure
   reduction need trading-risk review and replay evidence before automation. Reconcile with draft #111 rather than
   writing a parallel evaluator.
3. **FAST and DEEP execution lanes** remain research-only: FAST needs verified token safety and sell routes; DEEP needs a
   derivatives OMS adapter with margin and liquidation controls.
4. **REFLECT → learning loop**: closed-trade attribution and shadow vetoes are in drafts #112/#113; promotion must stay
   owner-reviewed.
5. **Session capital-aware sizing**: today the capital limit denies an entry that does not fit; sizing it down to the
   remaining headroom would belong in `risk/gate.ts` and needs its own risk review.
6. **LIVE**: remains locked behind G01–G14, a certified venue adapter and signer, and explicit owner authorization.
