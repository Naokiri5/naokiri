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
