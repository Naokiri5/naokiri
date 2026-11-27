# BrainOS Omega - Critical Repair, Integration and Operational Completion: repair tracker

Tracks the owner's *MIA BrainOS Omega - Critical Repair, Integration and Operational Completion* (26 Nov 2026), 30
repairs in packages A-F, on branch `naokiri/jolly-wozniak-8q7ial` (PR #140). Paper only; LIVE stays locked. A repair is
**Done** only when code plus a test in this repository shows it. Updated 2026-11-26.

Status: **Done**, **Partial** (some evidence, named gap), **Open** (not started), **Owner action** (needs a decision,
credential or setting outside the repository), **Gated** (must not be built before an earlier gate passes).

## Architecture impact check (done before coding)

| Question | Answer |
|---|---|
| New engine, store or scheduler? | No. Every change extends an existing owner: risk gate, Strategy Lab, DITAS outcome records, QCI coordinator, worker reliability, provider transport, background lane. |
| Duplicates existing logic? | No. `oosCohort` moved into `lab/evidence.ts` so the gate and the Lab share one qualification; integrity checks reuse `verifyTradeOutcomes`; the discount reuses `workerReliability`. |
| Touches risk gate or QCI? | Yes, deliberately and only in the risk-reducing direction (new denials; SUPPORT can only lose weight). Exits never pass through the gate and are tested to keep working. |
| Gives anything trading authority? | No. Everything here can only refuse or weaken an entry. Re-enabling needs the owner (strategy promotion, step-up acknowledgement). |

## Made functional in this increment (owner request: "make it functional and not read only")

| Was read-only | Now | Evidence |
|---|---|---|
| Strategy qualification shown in the Lab | Risk gate denies `STRATEGY_NOT_QUALIFIED` for a PAPER strategy whose stored evidence no longer qualifies. Verdict memoized, keyed on strategy version, fill-model version and the stored backtest ids/timestamps. | `risk/gate.ts`, `lab/evidence.ts`, `risk-qualification-gate.test.ts` (7 tests, mutation-checked: 5 fail without the check) |
| Verified-loss evidence | Suspends a losing PAPER strategy automatically (earlier commit). | `strategy-health-verified.test.ts` |
| Outcome settlement, linker and hash checks | Risk gate denies `EVIDENCE_INTEGRITY_FAILED` on an unacknowledged settlement mismatch, a closed trade unlinked for over 30 minutes, or an altered outcome record. Owner clears investigated records (exact id plus stored hash, content hash and finding kind, as reviewed) with step-up; any later edit reopens the finding, and a settlement acknowledgement never clears a tamper finding. A failed hash check, a malformed stored state, or a flagged record that disappeared denies. | `ditas/evidenceIntegrity.ts`, `GET /api/evidence-integrity`, `POST /api/evidence-integrity/acknowledge`, DITAS page panel, `evidence-integrity.test.ts` (15 cases, mutation-checked: 6 fail without the check), `api.test.ts`, e2e |
| Worker reliability report | A worker version with at least 30 supports whose win rate (95% upper bound) is below the base win rate (95% lower bound) has its SUPPORT scored as ABSTAIN by QCI. OPPOSE, vetoes, challenge panel and stored signed packets are unchanged; the record lists discounted votes. Only hash-intact outcomes and the current worker version count. | `qci/supportDiscount.ts`, `qci/coordinator.ts` (method `domain-capped-weighted-v2`, coordinator 1.1.0), `workers/reliability.ts`, `qci-support-discount.test.ts` (500-case property check that support never rises), `worker-reliability.test.ts` |

Closed-trade linker failures are now isolated per position and reported (`linkClosedTrades().failed`); a lost lease
still stops the pass.

## Independent trading-risk review

Two blockers found and fixed, then confirmed resolved on re-review:

- B1: a hash check that failed (for example on one unparseable record) left the last clean result in place. Now the
  check hashes raw columns and flags unhashable rows, and a failed attempt is stored and denies (`HASH_CHECK_FAILED`).
- B2: an acknowledgement bound only to the stored hash, so a content-only edit stayed hidden. Now it binds to the
  exact reviewed version and is re-checked on every gate evaluation.

Confirmed: the support discount can never raise support or lower opposition (500-case property test), vetoes and the
challenge panel see the original packets, and exits never pass through the gate.

**Decided 2026-11-26 (owner: "fix all of the problem"):** a maximum age for the stored hash check. Once a check
exists, an attempt older than 10 minutes (about ten background passes) denies new entries with `HASH_CHECK_STALE`, so a
stalled background lane can no longer leave an old clean result in force. Exits are unaffected. Test:
`evidence-integrity.test.ts` ("denies when the hash check has stopped running"), mutation-checked.

Follow-ups done: append-only migration 11 indexes the gate's evidence queries (`positions(account,status,closed_at)`,
`ditas_trade_outcomes(settlement,closed_at)`; upgrade and query-plan test); positions that keep failing to link get
exponential backoff (1 minute doubling to 1 hour, in memory) so newer positions still link (mutation-checked).
Still known and fail-closed: a CLOSED position without a close time pauses entries until repaired; per-evaluation
work still grows with the number of acknowledged mismatch records.

## Continuous multi-trade: settlement-triggered re-evaluation

When the protection lane closes a position, the bot starts an opportunity scan immediately instead of waiting for
the next scheduled scan (`MIA_SCAN_INTERVAL_MS`, default 60 s), so freed capital and slots are reconsidered at once.
At most one early scan per 10 s; it runs on the scan lane, never inside protection, and every entry still passes the
full risk gate (`bot/bot.ts` `requestSettlementRescan`; test in `ops-lease-hardening.test.ts`, mutation-checked).

Scanner repair (roadmap 27 Nov, CT01-04 "capacity-blocked candidate revalidated after confirmed settlement"): the
scanner used to mark an instrument/strategy/candle as processed whatever the outcome, so a signal denied only for
capacity was never reconsidered on that candle and the settlement rescan found nothing to do. Now a risk denial made
only of capacity codes (`MAX_CONCURRENT_POSITIONS`, `CORRELATION_LIMIT`, `INSUFFICIENT_BUYING_POWER`,
`CASH_RESERVE_FLOOR_REACHED`, `AGGREGATE_OPEN_RISK`; `SIZE_BELOW_VENUE_MINIMUM` counts only alongside one of these, as
it is what a squeezed size produces) is held as waiting for capacity. It is re-evaluated, with a fresh candidate, QCI
and risk decision, only after a paper position settles, at most 20 waiting signals per scan; it expires when its
candle is superseded; the queue is capped at 500. Any other denial or an approval ends the key as before, and a restart keeps that rule using
the stored decisions. `/api/scanner` returns `waitingCapacity`; the Intel page Rejected tab lists it
(`market/scanLedger.ts`, `market/scanner.ts`, `scan-capacity-reevaluation.test.ts`, 15 tests including the real risk gate,
mutation-checked). Independent trading-risk review: no blockers; its restart-guard and re-evaluation-volume findings are
fixed. Not yet: a durable candidate queue across restarts, and re-evaluation after owner funding, partial exits or a
tightened stop (only full settlements advance the capacity epoch, which can miss an opportunity but never adds one).

## The 30 repairs

| # | Pri | Repair | Status | Evidence or remaining work |
|---|---|---|---|---|
| 01 | P0 | Consolidate overlapping PRs | Owner action | #140 is stacked on #137 and #139 (per the V3 tracker). Choosing the merge candidate and closing superseded PRs is the owner's decision; exact-head CI on #140 is the evidence to use. |
| 02 | P0 | One component ownership map | Done | `docs/BRAINOS_V2_COMPONENT_INVENTORY.md`; this increment added no parallel engine (impact table above). |
| 03 | P0 | Wire `deepCycle.ts` and `coldLane.ts` to scheduler lanes | Gated | Checked 2026-11-26: `runDeepCognitiveCycle` returns NO_TRADE unless a FUTURES venue is certified (repair 19), and `runBoundedSgeColdLane` needs genome evaluator hooks that have no executable rule implementation (repair 14). Scheduling either now would only spend CPU and record invocations that test nothing. Wire after 14 and 19, on a bounded research lane that cannot delay protection. |
| 04 | P0 | Capability graph with dependency health and invocation evidence | Partial | `knowledge/capabilityGraph.ts` feeds session preflight and the brain snapshot. Per-capability freshness and last-invocation evidence not recorded. |
| 05 | P0 | Durable session and trading mandate as canonical owners | Done | `ops/durableSession.ts`, `ops/tradingMandate.ts` used by the OMS, preflight and routes; no second policy store was added. |
| 06 | P0 | Streaming feeds with sequence validation and recovery | Open | Provider transport is HTTPS polling (`providers/http.ts`). |
| 07 | P1 | `tradeBars.ts` connected to live events | Partial | Used by event replay and volume spikes; not by live feature ingestion. |
| 08 | P1 | Worker selection by instrument, regime and required domains | Partial | Applicability by market exists (94 of 100 for CEX spot); no regime or freshness selection. |
| 09 | P0 | System-wide concurrency budgets and cancellation | Partial | Worker pool: concurrency 16, 250 ms deadline, quarantine (`workers/runtime.ts`). No global budget across research lanes. |
| 10 | P1 | Eleven provider-blocked workers | Owner action | Need data-provider credentials; they abstain until then. |
| 11 | P0 | Decision certificates (PR #33) | Owner action | Bringing #33 in needs the owner's decision on its overlap with QCI records. |
| 12 | P1 | Automatic forecasts verified and calibrated | Partial | `verifyDueForecasts` runs on the background lane; calibration by horizon, market and regime not yet reported. |
| 13 | P0 | Do not trade unproven strategies | Done (gate) | Qualification required to promote and now to keep opening positions (table above). No strategy has qualified on real data in this repository. |
| 14 | P1 | Genome funnel connected to real Lab experiments | Gated | Genome rule ids have no executable implementation (V3 tracker); needs a design decision first. |
| 15 | P1 | Closed-loop learning | Partial | Verified-loss suspension, evidence integrity halt and worker support discount are active. Drift detection and champion/challenger not built. |
| 16 | P0 | FAST Solana discovery into `flinQueue` | Gated | Research-only until 17 exists. |
| 17 | P0 | Memecoin sellability verification | Open | Program/authority inspection and sell-route simulation not built; no DEX execution path exists. |
| 18 | P1 | Calls radar and volume spikes on verified evidence | Partial | `market/volumeSpike.ts` uses trade bars; social calls stay untrusted text. |
| 19 | P0 | DEEP futures contract specs, funding, liquidation | Gated | Futures stay research-only (`binanceFuturesResearch.ts`). |
| 20 | P0 | Multi-market OMS adapters | Gated | No external venue adapter; paper OMS only. Do not activate other markets without verified data and risk behaviour. |
| 21 | P0 | Integer or decimal money in storage | Open | Monetary columns are SQLite REAL. Needs an additive migration and a reconciliation test; not started because it touches every ledger write. |
| 22 | P0 | Durable reservations for asynchronous venues | Gated | Needed only with an external venue adapter (20). |
| 23 | P0 | Authoritative venue order states | Gated | As 22. Paper fills are synchronous and reconciled at startup. |
| 24 | P0 | REFLEX protection lane extensions | Partial | Independent protection lane, protection incidents, session halt exist; evidence-backed invalidation and liquidity-deterioration exits not built. |
| 25 | P0 | Hosted recovery tests | Owner action | Crash-injection suite runs locally (`test/crash/`); staging deployment needed for hosted tests. |
| 26 | P0 | Provider destination allowlist | Done | `providers/http.ts` `providerDestinationDenial`, `provider-destination.test.ts`. |
| 27 | P0 | SECURE Omega coverage | Partial | See `MIA_SECURE_OMEGA_EVIDENCE_MATRIX.md` (25 implemented, 8 partial, 6 missing, 8 owner action). |
| 28 | P0 | EVIDENCE Omega coverage | Partial | Outcome linkage, evidence chain and coverage, and now an integrity halt. External integrity checkpoints and persisted decision certificates remain (`EVIDENCE_OMEGA_TRACKER.md`). |
| 29 | P0 | Railway storage and deployment blockers | Owner action | Resize the volume, set `MIA_BACKUP_KEY`, then deploy. Cloudflare Workers Builds fails on every branch because the repository has no Worker configuration; disable that check or add a config. |
| 30 | P0 | Production certification | Gated | Needs 25, 27, 29 and prospective PAPER results. LIVE stays locked. |

Totals (counted from the table): 4 done, 10 partial, 3 open, 5 owner action, 8 gated. One row counts as done for the
gate only (13); profitability is still unproven.

## Connectivity, execution and adaptive reliability (owner PDF, 27 Nov 2026)

Mapped against the code before building; each part extends an existing owner, no new engine.

| Proposed part | Existing owner | Status | Evidence or reason |
|---|---|---|---|
| OrderBookIntegrityGuard | `market/quality.ts` | Already in place | Crossed, unordered, future-dated and stale books, future quotes and cross-venue disagreement already fail data quality, and the risk gate refuses entries on a stale or missing book. Sequence-gap resync applies to streaming books; providers are HTTPS polling (repair 06). |
| RegimeTransitionGate | `regime/regime.ts`, `market/scanner.ts` | **Done (new)** | `regime/transition.ts`: entries require the regime confirmed for 3 closed candles with fewer than 4 changes in the last 12; transitioning, unstable or unknown regimes wait. Uses a bounded snapshot history in the feature engine. Only restricts entries; since backtest model 3 the Lab applies the same check (see the qualification section). `regime-transition.test.ts`, scanner test, mutation-checked. |
| RuntimePreFlightLatch | `ops/integrity.ts`, `risk/gate.ts` | **Done (new)** | The takeover integrity checks (quick_check, schema, audit and memory chains, ledger reconcile, protective stops) now re-run every 30 minutes on the background lane (`ops/runtimeIntegrity.ts`); the gate denies `RUNTIME_INTEGRITY_FAILED`, `_STALE` (over 90 minutes) or `_INVALID`. About 0.5 s per run on a 600 MB database (measured locally). `runtime-integrity.test.ts`, mutation-checked. |
| AmbiguousOrderReconciler | `exec/recovery.ts`, `exec/oms.ts` | Already in place (PAPER) | Paper fills are synchronous; unresolved paper orders block entries (`UNRECONCILED_PAPER_ORDERS`). Venue status queries only matter with an external adapter (repairs 20, 22, 23: gated). |
| PartialFillLedgerBridge | `exec/oms.ts`, `exec/fillEvents.ts` | Partial | Idempotent fill recording and `fill.recorded.v1` exist; exact integer money is repair 21 (open). |
| SwarmSharedRingTelemetryBus | `core/bus.ts`, `core/telemetry.ts` | Not built | No benchmark shows a need; the PDF itself says to add shared memory only when measured. |
| ChoiceArbitrationScorer | `choice/arbitration.ts` | Unchanged | Remains shadow-only; no qualified strategy exists to rank. |
| DitasCalibrationDriftMonitor | `ditas/calibration.ts` | Not built | No automatic parameter updater exists to freeze; strategy suspension and the worker support discount already act on verified outcomes. |

Independent trading-risk review: no blockers. Fixed from it: a failed write while recording the takeover result no
longer refuses takeover (that would have left open positions unmonitored); the check yields to protection timers
first and its duration is recorded (`ops.runtime_integrity`); a failed result is retried after 5 minutes instead of
30; the owner gets one alert when the result turns from clean to failed; protective exits are tested to work while
it has failed. Since backtest model 3 the backtest and historical session simulation apply the same stability check, so qualification evidence matches live entries (see the strategy qualification section below). While the bot is stopped for more
than 90 minutes, manual paper entries are refused as `RUNTIME_INTEGRITY_STALE`.

## Runtime Spine V2 (owner PDF, 27 Nov 2026)

Gap analysis by the architecture subagent against this branch, then implemented by two engineer subagents in
separate file sets. The V2 reference code (its own SQLite tables, permits and outbox) was not copied in: each
invariant was mapped to the existing owner.

| V2 requirement | Status | Evidence or remaining work |
|---|---|---|
| Persisted desired session state, no auto-rearm, stop only when flat and reconciled | Already in place (partial) | `ops/durableSession.ts`: recovery moves RUNNING to a risk halt, a draining session stays draining, close finishes only when flat and reconciled. Not yet: scoping by account/environment, and pause as a session state (it is a control flag). |
| Never-reused lease fencing epoch | **Done (new)** | Migration 12 adds `runtime_lease_epochs` and `runtime_leases.epoch`; every new acquisition or takeover takes the next epoch in the same transaction; release never resets it; `ownsLease`/`assertWriteFence` compare it, so a stale writer with the same holder and timestamp is refused. Takeover integrity also re-runs on a new epoch. `ops-lease.test.ts` (6 cases incl. upgrade from v11), mutation-checked. |
| Single coalescing scheduler, no lost wake | **Done (new)** | A wake (settlement rescan, interval) arriving while a scan pass runs is no longer dropped: it marks the scan dirty and exactly one more pass runs afterwards, only while running and still leader (`bot/bot.ts` `scanLane`). `ops-lease-hardening.test.ts` (5 cases), mutation-checked. |
| Risk permit bound to the entry, re-verified by the OMS | Already in place (partial) | `exec/authorization.ts` binds account, instrument, side, qty, price, cost, policy version and expiry, issued and verified in one transaction. No revision/epoch binding (not needed while fills are synchronous). |
| Durable intent before dispatch, no blind retry | Already in place for PAPER | Paper fills are atomic; stuck orders block entries (`exec/recovery.ts`). Needed only with an external adapter (gated). |
| Outbox, consumer receipts, dead critical topic | Partial | `fill.recorded.v1` is appended in the fill transaction; closed-trade linking is exactly-once by primary key. No consumer receipts table or dead-topic gate yet. |
| Bounded workers | Already in place | `workers/runtime.ts`: 16 concurrent, 250 ms deadline, quarantine. |
| Fixed-point money | Open | Repair 21. |

Independent trading-risk review: no blockers. Applied: the engine also compares the epoch when checking it is still
leader, and a lease row with a corrupted epoch is treated as invalid (fail closed); the read-only lease witness now
reads the epoch (a pre-12 database counts as epoch 0). Known and open, pre-existing: an invalid lease row (for example
after the clock moves backwards) leaves every process on standby, so open paper positions are not monitored until
the owner intervenes; this should surface as a critical readiness state.

## Strategy qualification pipeline (owner PDF Part II, 27 Nov 2026)

Mapped by the architecture subagent against the existing Lab, then built by two full-stack subagents in separate
file sets. Every change makes qualification stricter; nothing was loosened, and no second backtester was added.

| Rulebook item | Status | Evidence or remaining work |
|---|---|---|
| Chronological out-of-sample holdout, no look-ahead | Already in place | `lab/backtest.ts` 60/40 split, incremental feature engine. |
| Net expectancy after costs, confidence lower bound > 0, deflated Sharpe | Already in place | `lab/qualification.ts` (1.96 z; DSR >= 0.95 with trials counted). |
| Exact strategy version | Already in place | `lab/evidence.ts` skips other versions. |
| Health monitoring and suspension | Already in place | `lab/lab.ts` `checkStrategyHealth` (verified-loss and decay). |
| Profit factor >= 1.2 | **Done (new)** | `PROFIT_FACTOR_TOO_LOW`. |
| Drawdown within envelope | **Done (new)** | `DRAWDOWN_TOO_LARGE`, max 10R out-of-sample: placeholder pending owner confirmation (may only be tightened). |
| Walk-forward consistency | **Done (new)** | `PERIOD_INCONSISTENT`: out-of-sample trades in exit order split into 3 equal periods; the most recent must be positive and at most one may be non-positive. The PDF's own breakout example (good in 2024, losing in both 2025 halves) is rejected. |
| Cost stress | **Done (new)** | `COST_STRESS_FAILED`: still positive with a positive lower bound at 2x modeled costs; trades carry `costR`; evidence without it fails closed. |
| Backtest matches live entry rules | **Done (new)** | Backtest and historical session simulation now require the confirmed (STABLE) regime, as live does. `BACKTEST_MODEL_VERSION` is 3. |
| Sample size 200 | Not changed | Minimum stays 30 out-of-sample trades; raising it is an owner decision. |
| Dataset provenance hash, parameter-stability sweep, champion/challenger, PAPER forward validation as a promotion precondition | Open | Not built. |

Independent trading-risk review: no blockers. Applied from it: version-2-only evidence is reported as needing a
re-run (`LEGACY_FILL_MODEL`) rather than "no backtest", and the Lab warns on any old model version; tied exits sort
losers first (conservative drawdown and periods); regression tests for v2 evidence including the gate denial, an
uneven 31-trade split, a no-loss cohort, the session-simulation fixture regime, and a check that every strategy runs on
1h (the live stability check uses the 1h engine). Known approximation: the 2x cost stress shifts each trade by one
cost unit and does not re-simulate fills at the higher cost.

**Operational consequence:** stored backtests from model version 2 no longer qualify. Until each strategy is re-run
under version 3 in the Strategy Lab, the risk gate refuses new entries for it (open positions stay protected). No
strategy had qualified on real data before this change either.

## Not claimed

Nothing here makes a strategy profitable. The new controls reduce risk when evidence is missing, broken or measured
as bad; they never add exposure. No hosted test, staging DAST or real-data qualification has been run.
