# MIA hot-path optimization — reconciliation on BrainOS integration

This is an incremental integration of the supplied MIA-HP1–HP5 documents, not a complete implementation of those phases. Existing source roots are server/src and web/src (not packages/server). Prior owners: PR #127 QHEF cockpit, #126 Choice, #128–#131 canonical execution and protective lanes, #135–#137 BrainOS integration.

| Source scope | Canonical owner | Integration / outstanding work |
| --- | --- | --- |
| HP1 latency | core/latency.ts, qhef/qhef.ts | O(1) ring writes, reject invalid measurements, preserve report fields and percentile convention. No latency target certified. |
| HP1 depth / transport | market/quality.ts, market/fabric.ts, providers/binance.ts | Shared structural validator applied to exact quantity book walk; invalid clocks rejected. REST only; canonical provider-wide HTTP 429/Binance 418 Retry-After cooldown added with monotonic timing. WS sequence synchronization, rotation, snapshot buffering and weight accounting still require integration. |
| HP1 cockpit | PR #127 | Reconcile existing cookie-auth/CSRF design, not browser bearer-token storage. No duplicate panel or routes. |
| HP2 scheduling | bot/bot.ts, market/scanner.ts, workers/runtime.ts | Existing independent protection, cooperative scan yields and worker bounds; adaptive pressure / global bounded queue not complete. |
| HP3 evidence / costs | market/quality.ts, scanner, features, decision, risk | Reuse book walk and impact. The two supplied HP3 documents contain wiring summaries rather than complete code. No new cache or evaluator asserted. |
| HP4 allocation / receipts | choice/arbitration.ts, risk/gate.ts, exec/oms.ts, portfolio/ledger.ts | Shadow ranking only; keep atomic risk+ledger writes. Do not use process-memory reservations or release unknown orders by timeout; require durable reconciliation before releasing capital. |
| HP5 domains | market/flinQueue.ts, choice/dualResearch.ts, knowledge/cognitive, lab, DITAS | Explicit boolean token-safety proof validation implemented; provider certification, RPC launch stream, actual sell simulation, venue-specific margin and calibrated strategy ranking remain open. |

FAST is memecoin research; DEEP is futures research. Existing spot paper remains a separate certified-for-testing lane, not routed through either mind. No router or caller-supplied boolean grants execution authority. Both mind paths and LIVE remain locked.

Validation: new tests exercise production latency, book walk and FLIN functions; all belong to existing Vitest CI. Do not infer benchmark improvement, profitable trading, or readiness from source changes. Exact-head CI and independent architecture review required. The extra structural validation adds work at execution time and must be measured with representative depth before any latency claim.

## BrainOS 9.0 — P0/P1/P2 source reconciliation (2026-11-25)

Incremental implementation on #137, not a new execution architecture. Source: nine owner PDFs covering P0 contracts, dependency matrix and compiler audit, FAST re-entry/anti-churn, REFLEX exits, CanonicalOMS, and FAST/OMS/Strategy Arena tests. The supplied "file trees and diffs" PDF contains export instructions rather than actual diffs; use GitHub branch evidence instead.

| Requirement | Canonical owner | Status / decision |
| --- | --- | --- |
| P0 architecture isolation | test/brainos7-authority.audit.test.ts | Extend existing Rolldown AST guard with signer, live-unlock and worker primitives, including reachable helpers. Do not introduce a second checker or assume TS7 exposes the legacy Compiler API. Full 12-layer matrix, alias resolution, symbol/data-flow analysis and unrelated production roots remain unverified. |
| FAST fresh evidence | market/flinQueue.ts | Equal or older source timestamps cannot overwrite persisted evidence; strictly newer evidence can update. Regression tests use canonical DB. Still research-only. |
| FAST anti-churn and reserve floors | risk/gate.ts, risk/policy.ts, portfolio/ledger.ts, exec/oms.ts | Existing risk and position gates remain authoritative. Proposed process-memory cooldown records, caller-supplied risk receipts, fixed 50%/5% reserve floors and continuous DEX re-entry are not imported. Design durable scope/cycle identity, atomic reserves, verified fills and owner policy migration first. |
| REFLEX exits | bot/bot.ts, exec/oms.ts, lab/exits.ts | Existing independent paper protection lane and shared stop/target/trailing/time rules retained. Additional DEX-specific triggers need verified telemetry, position identity, bounded dispatch, durable exit intent and reconciliation. No second interrupt writer. |
| Canonical OMS / parity | exec/oms.ts, exec/recovery.ts, portfolio/ledger.ts | Reject Map-backed replacement and hash/boolean-only authorization. Preserve SQLite transactions and existing fence. Bundle lifecycle, executable AMM quote/fee/tip parity, uncertain venue settlement and certified live adapter remain open. |
| Strategy Arena | lab/lab.ts | Atomically persist status, suspension index and audit; failure rolls back all. Regression preserves existing external certification denial. DSR and nine-stage migration remain open; require comparable Sharpe units, actual trial distribution, out-of-sample data and externally verified certificate. No autonomous promotion to LIVE. |

Merge gate: exact-head CI, security/architecture review and deployment checks. Do not label this full BrainOS 9.0 or enable real-money execution. FAST/DEEP remain research-only, PAPER retains existing session and policy controls, and LIVE remains locked.

## BrainOS 9.0 P2 Smart Portfolio and cognitive coordinator (2026-11-25)

Source: the four uploaded P2 allocator/coordinator specifications and corresponding Vitest suites. Canonical owners are risk/policy.ts, risk/gate.ts, portfolio/ledger.ts, exec/oms.ts, choice/arbitration.ts and bot/bot.ts. PR #67 contains related shadow-only allocation research on a different stack; do not import its separate research calculation as trading authority.

- Implement optional, owner-accepted minUnallocatedReservePct and minSettlementReservePct in the existing versioned policy. Values are percentages (50 and 5, not 0.50 and 0.05), individually 0–100, combined at most 100. Existing policies without these fields retain their prior behavior; example configuration is not automatically applied.
- The current PAPER ledger has one cash balance, not independent settlement wallets. The two policy reserves are disjoint **logical portions** of the same cash balance. The floor is calculated using current pre-entry equity. Fee-inclusive headroom is max(0, (cash - equity * combinedPct/100)/(1 + feeRate)). The existing per-position notional and loss limits still apply. Size against the worst permitted entry price; the existing OMS rechecks the resulting actual notional cap under the fill transaction. No new balance, reservation store or execution authority.
- Tests extend the existing risk and OMS suites: invalid and unauthorized policy edits, legacy behavior, capped entry, fee-inclusive cash floor, subsequent fresh evaluation, late policy tightening, and continuing protective exits.
- No UI policy controls added in this increment; the fields are supported by the server policy contract. Separate ring-fenced settlement accounting and verified venue-specific fees are not claimed.
- Reject literal coordinator wiring: await of exit dispatch must not couple independent protection to reasoning; an interrupt is not a settled close. Do not remove held positions or release capital until confirmed fills reconcile. Simulated intra-cycle budgets cannot reserve real money across concurrent cycles. The current scan/protection/research lanes remain separate.
- Reject fabricated performance fallback (0.75 confidence or predicted edge used as verified expectancy), upward leverage floor during deterioration, rounding capital up beyond headroom, and missing lock evidence treated as unlocked. The supplied test uses a static hash as live certification and accesses assetId at the wrong nesting level; its expected FAST allocation also assumes a requested amount not established by the coordinator.
- Remaining P2 work: verified performance-driven taper, per-asset/engine caps on actual classified exposures, fresh QHEF/strategy evidence, multi-proposal shadow budget simulation, durable venue settlement/reservations, Strategy Arena and FAST/DEEP lane certification. Do not promote to LIVE or replace the canonical OMS. No profitability or latency claim.

Release gate: exact-head CI and independent review required; existing live locks remain. This is an incremental PAPER risk improvement, not complete P2 implementation.

## BrainOS P0–P2 hardening increment (2026-11-25)

The 19-document proposal is a roadmap, not evidence that its proposed parallel modules exist or are production-ready. Baseline #137 dc86ac7 passed CI run 45532484407. Continue its canonical PAPER architecture rather than import a second ledger, runtime authority, scheduler or certification path.

Implemented:
- P0: acceptPolicy now commits the owner-approved policy version and its audit row under the canonical BEGIN IMMEDIATE transaction. A late audit failure rolls back the policy update.
- P1: optional owner policy fields postExitCooldownMs, stopLossCooldownMs, entryFrequencyWindowMs, maxEntriesPerWindow and adaptiveDrawdownSizing. Existing accepted policies without these fields retain behavior. Frequency window and cap must be supplied together.
- Risk gate reads actual persisted PAPER positions for the most recent same-instrument closed exit and account-wide rolling entry count. Stop or trailing-stop closure applies the longer configured cooldown. No second counter or migration. Frequency counts filled position entries, not proposals, approvals, or network dispatch attempts. Existing OMS rechecks risk before committing under its write lock.
- Optional account-wide taper uses existing persisted deposit-invariant account high-water marks and closed loss streak: >=2.5% drawdown or >=3 losses => 0.65x; >=5% or >=5 losses => 0.35x; >=8% or >=7 losses => zero. Apply to per-trade risk budget and existing notional cap; other risk gates remain unchanged. No automatic policy mutation or leverage increase. Existing tighter breakers take precedence.
- Extend server/test/risk.test.ts and server/test/oms.test.ts with risk validation, taper, atomic policy rollback and actual paper entry/stop/SQLite reopen regression. Tests are not prospective market evidence.

Reconciliation and exclusions:
| Package | Canonical owner / gap |
| --- | --- |
| P0 CI and static boundary | .github/workflows/ci.yml and test/brainos7-authority.audit.test.ts already run; reuse existing npm and Node version. No duplicate workflow or passWithNoTests. Three consecutive exact-head runs and independent release review remain open. |
| P0 financial reservation and reconciliation | db/db.ts, portfolio/ledger.ts, portfolio/calendar.ts, exec/oms.ts, exec/recovery.ts, ops/lease.ts. PAPER fills, ledger writes and protective stop are atomic. External asynchronous reservations, integer money migration, partial/ambiguous venue execution and independent wallet reconciliation remain open. Do not create the proposed second balance ledger or second fencing epoch. NOT_FOUND alone must not release an uncertain venue order. |
| P1 anti-churn and sizing | Implemented account/symbol subset above. Engine-level counters, directional flip-flop protection (no short execution in canonical PAPER), engine-specific drawdown and performance under genuine execution remain open. |
| P1 exposure and unified shadow cycle | Keep canonical positions, risk, choice arbitration and OMS. Require authoritative engine attribution, durable unresolved order exposure, same-snapshot research sizing and concurrency tests before parity claims. No synthetic live dispatch. |
| P2 verified strategy profiles and DITAS | Existing lab/lab.ts and ditas/calibration.ts own lifecycle and calibration. No generated outcomes or assumed probabilities may certify an edge. Require immutable real outcome provenance, independent holdout, correct multiple-testing statistics and health evidence. Health-gated adaptation remains open. |
| P2 bridge | Existing cognitive modules live under knowledge/cognitive; retain read-only boundaries. Injected financial callbacks can violate isolation even with no imports. Do not provide cognitive memory an independent order-authority port. |
| P2 session harness, CLI, HMAC, readiness and promotion | Existing qa/gates.ts and core/mode.ts remain authoritative; no signer, live adapter, live startup unlock, or production deployment change. The proposed CLI has a fallback development signing secret and seeds synthetic winning trades. A signed synthetic artifact does not prove prospective performance, venue reconciliation, or security. No eval-based deploy/rollback commands. Tests of simulated readiness are not production certification. |

Gate: #137 remains draft until exact-head CI and integration review. All live controls stay locked; no live unlock, certification artifact, or deployment was performed.

## Eight-priority OMS and release hardening increment (2026-11-25)

Source: seven owner-provided PDFs, priorities 1–8. Baseline f75d66c passed CI run 45535860115. Reuse #137, not the proposed replacement packages/server hierarchy.

| Priority | Canonical implementation / remaining gap |
| --- | --- |
| 1 Exact merge evidence | Existing .github/workflows/ci.yml checks out and asserts github.sha in both jobs (PR event merge commit, push event head). It still runs the existing typecheck, build, tests, audit and browser checks. No duplicate workflow. Branch protection, fresh exact-merge checks and independent approval remain separate. |
| 2 Durable external-order reservations | PAPER settles within one SQLite transaction and does not dispatch to an external venue. No second balance or OMS created. External reservations require real venue identity, owner-authorized funds, persisted lease fence and transactionally coupled order/ledger updates; not implemented. |
| 3 Ambiguous and partial fill reconciliation | Existing portfolio/calendar.ts reconciliation now checks each closed position individually and detects unlinked BUY/SELL principal entries. Equal and opposite errors cannot cancel in the account aggregate. exec/recovery.ts denies new entries on unknown and unresolved persisted PAPER order states; exits remain independent. Regression tests in server/test/oms.test.ts. This detects faults; does not automatically backfill venue fills or release external locks. Open PRs #64/#72 contain a related read-only venue assessor absent from this branch: reconcile ownership before importing it. |
| 4 Engine exposure | Existing long-only spot positions remain authoritative. No independent sleeve balances or position store. Actual per-engine classification, reserved/ambiguous exposure, venue leverage and isolated breakers remain unfinished. |
| 5 Strategy sizing | Preserve versioned Strategy Lab and reduction-only risk sizing. Proposed multipliers up to 2x cannot override existing authorized limits; caller-supplied performance snapshots are not verified evidence. |
| 6 DITAS learning | Preserve canonical immutable decision/outcome memory and existing calibration. Health-gated adaptive updates remain unfinished. |
| 7 Unattended certification | 72h actual PAPER/TESTNET soak remains pending. A SHA-256 digest of a caller-supplied JSON manifest is not trusted attestation; hydrating a fresh in-memory DB from the manifest cannot verify actual persisted production integrity. Dry-run with a zero-hour minimum must never issue a live-authorizing certificate. |
| 8 Railway/Privy boundary | Preserve existing hard LIVE lock and release gates. A writable directory and configured Privy identifiers alone do not establish volume persistence, least-privilege policy enforcement, or wallet authorization. No production promotion script or deployment changes. |

The proposed external-order state machine has no explicit fence in its ReserveOrderInput contract; callbacks for ledger and protective-stop writes must not introduce nontransactional side effects. Require definitive venue status and authenticated cumulative executions, not timeout or missing order evidence, before releasing reserved funds. The reconciliation additions are PAPER-only, not full external order recovery or multi-sleeve parity. Do not merge until exact new head/merge CI is verified; LIVE remains locked.
