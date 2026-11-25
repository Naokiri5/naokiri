# MIA 5.x — IDENTIFICATION-FIRST, ONE-CORE DEMO + LIVE TRADING MASTER PROMPT

**Stage:** reviewable GitHub integration branch (user explicitly authorized in follow-up); **NOT DEPLOYED** and **NOT LIVE-CERTIFIED**.
**Repository:** https://github.com/Naokiri5/naokiri
**Inspected baseline:** `main` at `6476391f4d7e8f8884c76ac4e31bb3779c444d77` (November 21, 2026). Refresh SHA and inspect current files before future implementation; do not rely on this snapshot indefinitely.
**Related source files supplied:** `MIA_FEATURE_IDENTIFICATION.ts`, `MIA_DEMO_LIVE_PARITY.ts`, `verify-parity.mjs`.

## 0 — YOUR ROLE AND ABSOLUTE INSTRUCTIONS

Act as a coordinated team of TypeScript architect, trading-systems engineer, market-data integrity engineer, risk reviewer, exchange/broker integration specialist, database reliability engineer, security engineer, QA/chaos engineer and release manager. Your highest priority is preservation of MIA's existing financial integrity and data-flow invariants, not adding features for their own sake.

1. **IDENTIFY FIRST, CODE SECOND.** Search the actual main branch and every relevant open PR before adding or moving code. Use file contents, exported functions, dependency graph, runtime call sites, tests and migrations. Existing file names alone do not prove functionality.
2. **FOLLOW-UP AUTHORIZATION UPDATE (2026-11-21).** The owner explicitly authorized GitHub code and document integration after the original offline draft. Commit to a reviewable integration branch, open a PR and run validation. Do not change credentials, deploy, authorize real-money trading, bypass release gates, or merge unrelated stacked PRs without complete base reconciliation and verified checks.
3. **NO DUPLICATE AUTHORITIES.** Do not create a second decision engine, risk gate, OMS, ledger, scanner, event bus, owner authentication framework or market store. Extend existing canonical locations. When two blocks look similar but have different semantics, document the distinction before deduplication.
4. **ONE POLICY CORE FOR DEMO AND LIVE.** Data quality, source truth, token/asset safety, decision validity, position sizing, portfolio limits, stop rules, per-strategy controls, anti-duplicate checks and kill switches must be shared. The execution environment selects a venue adapter only after the common control path approves.
5. **LIVE SAFETY IS NOT OPTIONAL.** Do not enable `BOUNDED_LIVE` or introduce an executable signer until all existing G01–G14 release gates and independent venue/signing/operational certifications pass for the exact production revision, with explicit bounded owner authorization. Missing or stale evidence means DENY. Privy login does not substitute for transaction approval or broker/exchange permissions.
6. **PRESERVE EXISTING MAIN BEHAVIOR.** Do not silently change existing PAPER, APPROVAL, OBSERVE, risk calculations, stop management, accounting, strategy eligibility, API behavior, security controls or UI. Any intentional behavior change gets a separate clearly specified PR/test in a future authorized implementation.
7. **NO PERFORMANCE OR SAFETY FICTION.** Never claim this blueprint enables profitable trading, never represent simulated prices/fills as real venue acknowledgments, and never report a passing CI/deployment without actual run evidence.

## 1 — VERIFIED MAIN INVENTORY: AUTHORITIES TO REUSE

| Capability | Canonical path / inspected implementation | Identification | Action |
|---|---|---|---|
| Provider ingestion | `server/src/market/fabric.ts`, `server/src/providers/*` | IN_MAIN | EXTEND existing adapters |
| Market store | `server/src/market/store.ts` | IN_MAIN | REUSE one market state |
| Data quality | `server/src/market/quality.ts`, `server/src/chart/analysis.ts` | IN_MAIN | EXTEND freshness/continuity |
| Indicator calculations | `server/src/features/indicators.ts` | IN_MAIN | REUSE, never recompute in workers |
| Worker evidence | `server/src/workers/registry.ts`, `runtime.ts` | IN_MAIN | REUSE deterministic evidence evaluators |
| Consensus | `server/src/qci/coordinator.ts` | IN_MAIN | REUSE; evidence only |
| Trade decisions | `server/src/decision/engine.ts` | IN_MAIN | EXTEND one decision pipeline |
| Risk gate | `server/src/risk/gate.ts`, `policy.ts` | IN_MAIN | EXTEND one independent policy |
| Modes | `server/src/core/mode.ts` | IN_MAIN | REUSE OBSERVE/PAPER/APPROVAL/BOUNDED_LIVE |
| Paper OMS | `server/src/exec/oms.ts` | IN_MAIN | REUSE; it revalidates risk before entry |
| Financial ledger | `server/src/portfolio/ledger.ts` | IN_MAIN | REUSE accounting authority; add scoped live accounts only after design review |
| Evidence history | `server/src/ditas/memory.ts` | IN_MAIN | EXTEND immutable provenance |
| Engine leader lease | `server/src/ops/lease.ts` | IN_MAIN | REUSE; extend with external-order fencing if required |
| Release gates | `server/src/qa/gates.ts` | IN_MAIN | REUSE G01–G14; do not hardcode green |
| Database and migrations | `server/src/db/db.ts`, `migrations.ts` | IN_MAIN | REUSE transaction and migration helpers |
| Frontend API | `web/src/api.ts` | IN_MAIN | REUSE transport / SSE |
| Owner sessions | `server/src/api/auth.ts` | IN_MAIN | PRESERVE until secured Privy migration |
| Backups | `server/src/ops/backup.ts`, `integrity.ts` | IN_MAIN | REUSE with restore checks |

**Critical interpretation:** `EXISTING_IN_MAIN` denotes inspected source ownership, NOT live certification or profitable behavior.

## 2 — UNMERGED CANDIDATES: REVIEW, DON'T DUPLICATE

- **PR #103:** draft Privy owner/wallet sign-in and TOTP integration against main. Reconcile with #38 and #54; do not create another login system.
- **PR #92:** paper/testnet/live environment proposal. Compare contracts, order scopes, and setup behavior before accepting.
- **PR #97:** non-executing live readiness and order-state modeling. Reuse compatible types/reducers rather than a second live state machine.
- **PR #95:** multi-market research/provider adapters. Verify exact supported datasets, permission scopes, and whether feeds are executable.
- **PR #41:** typed event envelope proposal. Adopt a single compatible event schema.
- **PR #43:** scoped durable transactional outbox. Extend only to domains requiring crash-safe messaging.
- **PR #101:** risk-reducing emotion overlay in an unmerged branch. Keep explanatory/evidence-only, with no ability to authorize trades.
- **PR #100 and other broad merge PRs:** non-mergeable/overlapping integration candidates; do not force-merge 100+ commits.

Before coding, produce an evidence-based `FEATURE_ID, STATUS, CANONICAL_OWNER, EXISTING_EXPORTS, CALL_SITES, DEPENDENT_PR, GAPS, PROPOSED_ACTION, TESTS` inventory. Statuses: `IN_MAIN_VERIFIED`, `IN_MAIN_PARTIAL`, `UNMERGED_CANDIDATE`, `MISSING`, `BLOCKED_EXTERNAL`, `UNVERIFIED`. Cross-check Git history so a change already merged upstream is not re-applied.

## 3 — TARGET SINGLE-PATH EXECUTION TOPOLOGY

```
Exchange / broker / blockchain / data vendors
                |
   Existing provider adapters / ingestion
                |
  Existing market quality + source/provenance
                |
       Existing MarketStore
                |
   Shared indicator snapshot + strategy candidate
                |
      Workers -> QCI -> MIA decision engine
                |
         ONE canonical risk gate
                |
     Release/authorization/environment guard
                |
        ONE OMS entry lifecycle boundary
           /                 \
  Existing PAPER OMS       Certified LIVE venue port
    (paper ledger)         (real broker/exchange orders)
           \                 /
       Scoped reconciliation, journal, audit
                |
        DITAS observability + dashboard
```

- DO NOT create a new OMS or financial ledger just because the adapters differ.
- Data fabric is an evidence source, never a command to send funds.
- Trader Joe, sentiment overlays, 100 workers, chart AI and the frontend may propose/explain/veto but cannot sign, change owner limits or bypass risk.
- Live/DEMO decisions must be linked to exactly one frozen evidence snapshot, decision ID, risk policy version, unique intent key, strategy version, account ID, environment and engine/venue state.

## 4 — ENVIRONMENT MAPPING AND PARITY

| Product environment | Existing MIA mode | Order effect | Allowed status |
|---|---|---|---|
| OBSERVE | `OBSERVE` | Analyze/monitor only | Already supported |
| DEMO (paper) | `PAPER` | Existing simulated order-book fills | Already supported, keep existing OMS |
| DEMO with approval | `APPROVAL` | Owner-confirmed paper orders | Already supported; do not auto-approve NEEDS_REVIEW |
| TESTNET (optional) | Future deliberately separate capability | Real exchange sandbox if available | Investigate PR #92; never label as live production |
| LIVE (real money) | `BOUNDED_LIVE` | Real, verified broker/exchange order | **NOT AVAILABLE on inspected main; locked until certified** |

**Parity contract:** For any identical market snapshot and strategy/policy/account exposure conditions, both modes should produce the same foundational eligibility decision and risk limits. Environment-specific differences such as actual balances, execution venue rules, liquidity, fees, leverage, settlement, keys and market access must be explicit inputs, not silent exceptions. Do not compare a simulated demo account to a real account and claim identical dollar sizing; compare policy and decision logic under controlled equivalent fixtures.

A futures risk model can be added as a typed extension of the SAME risk authority, not a parallel futures risk gate. Venue-native liquidation, margin and funding controls are additional DENY conditions in live mode.

## 5 — TYPE SCRIPT ADAPTATION PLAN (NO WRITES YET)

Review the companion source files in this order:

1. `MIA_FEATURE_IDENTIFICATION.ts` — authoritative feature ownership manifest and identification routine; check the current repository tree, functions and open PRs before using any status.
2. `MIA_DEMO_LIVE_PARITY.ts` — pure, dependency-injected shared orchestration guard. It does **not** implement risk arithmetic or broker actions; those remain injected from MIA's existing code.
3. `verify-parity.mjs` — offline proof-of-concept tests only. Its in-memory reservation mock is FOR TESTS ONLY.

**Future integration to existing main (proposal only):**

- Wire `evaluateRisk()` through `server/src/risk/gate.ts` using account-specific trusted state. Main currently uses a paper account; live must add reconciled real balances/positions safely before parity can be claimed.
- Wire DEMO through existing `submitEntry(report, actor)` in `server/src/exec/oms.ts`; it already performs last-moment risk checks and atomic paper writes. Confirm adapter idempotency against its `entry-${report.candidateId}` client ID.
- Keep `getControl()` and its owner step-up from `core/mode.ts` and `api/routes.ts` as the only execution-mode authority; never toggle mode by setting a boolean in frontend code.
- Wire G01–G14 from `qa/gates.ts` and bind the acceptance record to the actual production artifact hash, independently verified release evidence, owner approval and real operational checks. Existing `releaseGates()` does not by itself provide complete production revision attestation. Missing attestation must block live.
- Keep liveVenue UNDEFINED in every actual runtime until a separate auditable certified broker/exchange connector and isolated signing service exist. No hidden fake live venue is allowed.
- Extend `exec/oms.ts` *carefully* to support a venue interface while keeping a single order state lifecycle and existing paper snapshots. Do not call a second sidecar OMS directly from the bot.
- Add append-only, account+environment+order-unique durable reservation; use a UNIQUE index, transactions, and external venue client-order-ID reconciliation. An in-memory Set or Map is insufficient across restarts. A disputed/unknown order status is quarantined, not re-submitted.
- Enforce authenticated, bounded owner activation and a real production transaction firewall. The server verifies authorization; clients cannot supply `verifiedOwnerStepUp` or certification booleans.
- Require venue-native protective-order ACK (or a verified equivalent with an independently approved protection design), synchronized balances and order reconciliation before real-money entry.
- Use a monotonic, provider-aware time/freshness contract; distinguish source time vs receivedAt, snapshot time, and policy/evaluation time.
- Add environment+account fields to orders, fills and position keys only through tested additive migrations; do not reinterpret existing `paper-bot` rows as live records.

## 6 — EXECUTION INVARIANTS (MUST BE TESTED)

1. A decision exists, was produced by the canonical engine and has a non-expired QCI record.
2. The associated snapshot is complete, coherent and within the venue-specific freshness budget.
3. Instrument and account belong to the requested environment and authorized owner.
4. Data-quality and asset-safety gates are satisfied (otherwise DENY).
5. One canonical risk policy determines sizing and exposure; invalid/NaN/Infinity values DENY.
6. Existing emergency stop and paused/disabled strategy states DENY new entries in both modes.
7. Policy, strategy, source snapshot and all execution conditions are revalidated immediately before submitting.
8. Release gates and owner authorization are additional requirements for LIVE, never substitutes for risk.
9. No automated interpretation of `NEEDS_REVIEW` as `ALLOW`; use the existing owner-approval workflow.
10. A unique durable intent is recorded atomically before any external side effect; the reservation assigns and persists a venue-compatible client order ID.
11. After timeout/crash, query the venue by stable client order ID; do not blindly resubmit.
12. Partial/unknown/rejected/filled states must be ledger-consistent and replay-safe.
13. Live protection orders are acknowledged and monitored, not just modeled in a simulated DB.
14. A stale engine lease, lost fencing, failed health check, or split-brain blocks new external orders.
15. Every control decision, denial, acknowledgement, fee, fill and reconciliation has an auditable trace.
16. Demo balances and real balances cannot mix, even if an instrument ID matches.
17. A broken audit chain, damaged database or unverified restore stops live authorization.
18. A hosted frontend can never invoke a privileged wallet signer directly through a hidden endpoint.
19. Actual exchange/broker credentials are stored in server-side secret management and scoped to minimal permissions.
20. A successful paper backtest, 30-day sample, or integration test alone does not establish profitability or authorize real-money trading.

## 7 — MARKET COVERAGE AND DATA ROUTING

Use capability-based adapters:

```ts
type Capability = 'MARKET_DATA' | 'BROKER_ACCOUNT' | 'PAPER_EXECUTION' | 'TESTNET_EXECUTION' | 'LIVE_EXECUTION' | 'NATIVE_STOPS' | 'READ_ONLY_BALANCES';
type VenueCapability = {venueId:string; assetClasses:readonly string[]; capabilities:readonly Capability[]; orderTypes:readonly string[]; supportsClientOrderId:boolean; provenance:string};
```

Add crypto CEX, Solana DEX, EVM DEX, broker stocks/ETF, FX, derivatives and yield providers only through explicit host/network licensing checks. `MARKET_DATA` does not imply `LIVE_EXECUTION`. A wallet login does not imply an exchange or brokerage account with trading rights. A DEX signal does not imply honeypot clearance or trade execution readiness. Stop when chain ID, mint/contract identity, decimals, pool liquidity, transaction simulation or slippage protections are missing.

## 8 — AUTH / PRIVY / WALLET INTERPRETATION

Privy user/wallet identity and actual trade authorization are separate concerns. Prefer existing PR #103 if it passes review of signatures, DID binding, owner enrollment, challenge verification, CSRF, origin/CSP, step-up, logout and session lifecycle. Never bypass the owner session to activate live. Do not allow any LLM, Trader Joe plugin, mobile client or public browser code to hold a private trading signer. Use scoped, short-lived, revocable bounded authorization with independent protective services and full action audit.

## 9 — STORAGE, RUNTIME AND DEPLOYMENT

- Current backend uses Node/Fastify polling, SQLite WAL and an in-process engine lease. Deploy on persistent compute with persistent, backed-up data storage; do not put the long-running engine into an ordinary Vercel Function.
- Superseded 2026-11-25: Railway hosts the single stateful service (engine + API + UI), Cloudflare provides routing/security, and Vercel is retired (see `docs/operations/RAILWAY_CLOUDFLARE_DEPLOYMENT.md`). Verify secrets, TLS, WebSocket/SSE support, canonical host and secure cookies.
- Current Vercel `naokiri-server` failed at the inspected commit with `TS2688 Cannot find type definition file for 'node'`. Repair workspace installation and dev-dependency presence in build; do not conflate a successful build with production operational certification.
- Verify backup restore, failover, leader fencing, stale-data shutdown, open-position monitoring, market-provider outages, venue API outages and domain cutover before a live release.

## 10 — STAGED INTEGRATION CHANGE ORDER (IMPLEMENT SAFELY IN DEPENDENCY ORDER)

**A. Identification and consolidation (no behavior changes):** PR lineage graph, canonical ownership, duplicate candidates, test surface, current SHA.

**B. Contracts and tests:** typed evidence envelope, execution intent, order-state reconciler interface, environment/account scoping, unit/property tests. Any viable PR #41/#43 code must be evaluated first.

**C. Demo-only harmless bridge:** trace new contracts through existing paper OMS without changing fills/ledger; verify identical outputs and deny paths against baseline.

**D. Live simulation + connector readiness:** testnet sandbox, verified venue protocol, limited credentials, signer boundary, price/fee models, native stops, full ledger/position reconciliation. No real order in development.

**E. Certification:** G01–G14, external review, 30-day+ paper sample, crash/stress/chaos, bounded capital caps, human go/no-go and explicit owner approval.

**F. Deployment:** only after an authorized implementation PR has passed end-to-end tests, staging, restore tests and operational acceptance. Start with conservative bounded limits; automatic kill switch must persist across restarts.

## 11 — REQUIRED TEST MATRIX

At minimum, write and run deterministic tests for:

1. Feature ID uniqueness and one canonical owner.
2. Open PR candidates never misidentified as merged functionality.
3. DEMO mode accepts `PAPER_TRADE` only.
4. LIVE mode accepts eligible future `APPROVED_FOR_BOUNDED_EXECUTION` only.
5. OBSERVE cannot execute.
6. APPROVAL never auto-executes without owner flow.
7. No permission without accepted risk policy.
8. Same risk implementation is called for DEMO and LIVE.
9. Account/environment IDs cannot be mixed.
10. Fresh quote/book/candles and cross-venue sanity.
11. Missing book, stale book, future timestamp, NaN/Infinity DENY.
12. Honeypot/unknown asset fail closed.
13. Expired consensus DENY.
14. Missing/uncertain strategy promotion DENY.
15. Duplicate instrument/order/entry DENY.
16. Daily/weekly/drawdown/correlation exposure break.
17. Partial fills/fees/accounting and native stop reconciliation.
18. Decision-to-risk and final order source trace.
19. Duplicate idempotency key across concurrent workers.
20. Crash before reservation, after reservation and after venue ACK.
21. Submission timeout -> UNKNOWN, never blind retry.
22. Leader fencing under stale/taken-over engine.
23. Missing, duplicated, stale or failed release gate DENY LIVE.
24. Missing signer, venue, protection or reconciliation DENY LIVE.
25. Mismatched build SHA DENY LIVE.
26. Unbound or expired owner step-up DENY LIVE.
27. Live authorization cannot be forged by browser-provided fields.
28. Pause, emergency and incident flag DENY both modes.
29. Restore/rollback preserves audit and ledger invariants.
30. CI: `npm ci`, secret scan, dependency audit, typecheck, build, full tests, Playwright and production smoke tests.

Carry forward the repository's existing `server/test/oms.test.ts`, `risk.test.ts`, `crash.oms.test.ts`, `ops-lease-*`, `ditas-*`, `api.test.ts`, `e2e/*`; never remove them to make a build pass. Unit mocks cannot substitute for real venue certification.

## 12 — 100-POINT ROOT-CAUSE CONTROL INVENTORY

Treat these as investigation/acceptance IDs, **NOT 100 confirmed bugs**. An item becomes a verified defect only with a reproducible test, source location, failed expected invariant, severity and repair evidence. Each maps to the user-facing previous audit and to a single responsible module.

### Repository and integration (1–10)
1. Open PR congestion → classify and retire superseded reviews.
2. Stacked branch dependencies → lineage graph and base-first merges.
3. Non-mergeable large PR → small reconciliation PRs.
4. Duplicate review targets → one canonical integration record.
5. Competing Privy implementations → reuse validated auth branch.
6. Main/branch capability drift → commit-scoped feature registry.
7. Multiple master prompts → requirements traceability table.
8. Unchecked PR checklist → enforced evidence gates.
9. Stale project-status docs → generated source-of-truth status.
10. Unknown file owner → explicit domain ownership contracts.

### Fabric and messaging (11–20)
11. Process-only event bus → scope transport to runtime needs.
12. `unknown` bus payloads → validated event schemas.
13. Parallel event-contract proposals → reconcile PR #41.
14. Inconsistent event ordering → sequenced source partitions.
15. No generalized durable replay → use DITAS/outbox where appropriate.
16. Broken cross-stage traces → propagate trace and causation IDs.
17. Unbounded subscriber work → queue budgets and backpressure.
18. Topic dictionary drift → central event-topic registry.
19. Multi-account event ambiguity → account-scoped events.
20. Lost failed downstream work → idempotent durable retry/reconcile.

### Market coverage and providers (21–30)
21. Spot-centric execution → venue capabilities.
22. Symbol normalization conflicts → canonical identifiers.
23. Tokenized stocks misclassified → underlying/settlement check.
24. Reference FX confused with executable FX → feed capability label.
25. Equity feed absent → licensed market-data/broker integration.
26. Derivatives unavailable → contract/margin specifications.
27. Wallet analytics unavailable → vetted on-chain evidence.
28. Polling misses rapid changes → stream plus recovery snapshots.
29. Failover not complete → source health and freshness policy.
30. Non-commercial news restrictions → compliant provider/license.

### Data accuracy (31–40)
31. Receipt/source timestamp confusion → separate clocks.
32. Future observations → fail closed + tests.
33. Candle gaps → range backfill and continuity checks.
34. Open candle treated as closed → finality flags.
35. Provider clock skew → UTC source normalization.
36. Book sequence gaps → replay/snapshot reconciliation.
37. Precision and minimum-order errors → venue metadata.
38. Feature loses origin → source snapshot identifiers.
39. Wrong freshness TTL → market/horizon-specific policy.
40. Process-memory reconstruction → validated warm startup.

### Intelligence (41–50)
41. Deterministic workers misdescribed as LLMs → honest registry.
42. Missing worker evidence inputs → capability/abstain state.
43. Uncalibrated effectiveness → prospective outcome cohorts.
44. Correlated evidence double count → dependency caps.
45. Scores mistaken for probabilities → calibration and labeling.
46. Unversioned opinions → worker/model version lineage.
47. Slow intelligence blocks execution → bounded hot/background lanes.
48. Missing inputs treated as negative → explicit missing/abstain.
49. Opposing evidence hidden → challenge records.
50. LLM prompt injection → advisory-only isolation.

### Decisions and strategy (51–60)
51. Loss-making historical strategies → promotion evidence.
52. Tiny sample sizes → qualification thresholds.
53. Research confused with deployment → staged strategy lifecycle.
54. Timeframe conflicts → explicit precedence/abstention policy.
55. Snapshot drift across awaits → immutable decision snapshot.
56. Scores incorrectly promoted to probabilities → separate metric types.
57. Emotions control execution → evidence-only/veto boundary.
58. Backtest overfit → rolling OOS and forward paper results.
59. Look-ahead leakage → point-in-time validation.
60. Missing decision lifecycle links → DITAS immutable events.

### Risk and OMS (61–70)
61. New integration bypasses risk → mandatory central risk adapter.
62. Paper OMS mistaken for live → live absence certification gate.
63. Demo/live rule drift → canonical policy parity tests.
64. OMS-monitored stop mistaken for native stop → enforce live protection.
65. Unrealistic paper fills → latency/queue-aware simulation tests.
66. Futures margin gaps → leverage/funding/liquidation overlays.
67. Duplicate retries → durable client-order ID/reconciliation.
68. Stale leader writes → fencing and lease checks.
69. Double depth consumption → combined-book regression.
70. Positions during recovery → monitor/protection readiness gate.

### Storage (71–80)
71. Multiple financial truth writers → authoritative ledger/OMS.
72. Ephemeral database hosting → durable backend/storage.
73. Blocking synchronous SQL → measured workload budgets.
74. Inconsistent mark/equity → reconcile by environment/account.
75. Broken evidence hashes → quarantine on integrity failure.
76. Unencrypted backup → managed AES-256-GCM policy.
77. Lost evidence key → backed-up key continuity.
78. Unsafe migration order → staged additive migration tests.
79. Unbounded research storage → measured retention budgets.
80. Restore never rehearsed → periodic isolated restore drills.

### Security and identity (81–90)
81. Privy absent from main → review PR #103.
82. Legacy passphrase transition → secure migration planning.
83. Overexposed first-run setup → owner provisioning restrictions.
84. Global lockouts abused → scoped rate limiting and recovery.
85. Cookie HTTPS misconfiguration → secure cookie/origin tests.
86. Inline-style CSP allowance → scoped CSP hardening.
87. Outbound request injection → destination allowlisting.
88. Auth downgrade fallback → production fail-closed wallet mode.
89. Missing isolated signer → externally audited signing service.
90. Backend origin bypasses Cloudflare → origin protection.

### Deployment/QA (91–100)
91. Backend TS2688 build failure → workspace dependency fix.
92. Serverless cron treated as persistent engine → proper host.
93. Domain-to-API auth mismatch → secure routing and sessions.
94. Node runtime mismatch → pinned tested runtime.
95. Passing stacked PR ≠ passing integration → merge-SHA CI.
96. Optional tests on `main` → required branch protection.
97. Unattested gate evidence → build-hash binding.
98. Incomplete paper soak → complete observed evaluation.
99. No long-running stress proof → load/soak/chaos runs.
100. Untested rollback/recovery → operational incident exercises.

## 13 — MANDATORY OUTPUT FROM CODEX / CLAUDE WHEN THIS IS AUTHORIZED LATER

Return in this exact order:

A. `BASELINE_SHA` and complete checked branch/PR matrix.
B. Function-level feature identification: exists, duplicate, partial, gap, blocked; every verdict with path/export/consumer evidence.
C. A before/after architecture and authoritative data-flow map.
D. A **minimal-diff** change plan by existing canonical module, with expected API/schema changes.
E. Production TypeScript implementation **only after approval** and code/test review. No separate risk/OMS or silent live unlock.
F. Automated proof of demo/live parity for equivalent controlled fixtures, then venue-specific extra safeguards.
G. Test outputs, security evidence and exact unverified items.
H. Deployment guidance and rollback instructions; **do not deploy automatically**.

## 14 — COMPLETION DEFINITION

"Available in DEMO" means the existing paper workflow remains operational with shared policy contracts and passing accounting/OMS tests.

"LIVE-ready architecture" means a type-safe, tested plan with a still-locked live port.

"Available in LIVE" may only be claimed after **real** broker/DEX adapters, isolated signers, verified account state, native protection, durable idempotency, G01–G14, complete release checks, explicit bounded owner authorization, deployment/recovery acceptance and independent sign-off. This document and its companion `.ts` files do not satisfy that condition. The project must not accept real money merely because this code typechecks.

**END OF MASTER PROMPT.**