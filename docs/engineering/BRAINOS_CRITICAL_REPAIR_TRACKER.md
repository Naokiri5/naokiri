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

## Not claimed

Nothing here makes a strategy profitable. The new controls reduce risk when evidence is missing, broken or measured
as bad; they never add exposure. No hosted test, staging DAST or real-data qualification has been run.
