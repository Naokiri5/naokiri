# MIA hot-path optimization — reconciliation on BrainOS integration

This is an incremental integration of the supplied MIA-HP1–HP5 documents, not a complete implementation of those phases. Existing source roots are server/src and web/src (not packages/server). Prior owners: PR #127 QHEF cockpit, #126 Choice, #128–#131 canonical execution and protective lanes, #135–#137 BrainOS integration.

| Source scope | Canonical owner | Integration / outstanding work |
| --- | --- | --- |
| HP1 latency | core/latency.ts, qhef/qhef.ts | O(1) ring writes, reject invalid measurements, preserve report fields and percentile convention. No latency target certified. |
| HP1 depth / transport | market/quality.ts, market/fabric.ts, providers/binance.ts | Shared structural validator applied to exact quantity book walk; invalid clocks rejected. REST only; WS sequence synchronization, rotation, snapshot buffering, and weight-aware cooldown still require integration. |
| HP1 cockpit | PR #127 | Reconcile existing cookie-auth/CSRF design, not browser bearer-token storage. No duplicate panel or routes. |
| HP2 scheduling | bot/bot.ts, market/scanner.ts, workers/runtime.ts | Existing independent protection, cooperative scan yields and worker bounds; adaptive pressure / global bounded queue not complete. |
| HP3 evidence / costs | market/quality.ts, scanner, features, decision, risk | Reuse book walk and impact. The two supplied HP3 documents contain wiring summaries rather than complete code. No new cache or evaluator asserted. |
| HP4 allocation / receipts | choice/arbitration.ts, risk/gate.ts, exec/oms.ts, portfolio/ledger.ts | Shadow ranking only; keep atomic risk+ledger writes. Do not use process-memory reservations or release unknown orders by timeout; require durable reconciliation before releasing capital. |
| HP5 domains | market/flinQueue.ts, choice/dualResearch.ts, knowledge/cognitive, lab, DITAS | Explicit boolean token-safety proof validation implemented; provider certification, RPC launch stream, actual sell simulation, venue-specific margin and calibrated strategy ranking remain open. |

FAST is memecoin research; DEEP is futures research. Existing spot paper remains a separate certified-for-testing lane, not routed through either mind. No router or caller-supplied boolean grants execution authority. Both mind paths and LIVE remain locked.

Validation: new tests exercise production latency, book walk and FLIN functions; all belong to existing Vitest CI. Do not infer benchmark improvement, profitable trading, or readiness from source changes. Exact-head CI and independent architecture review required. The extra structural validation adds work at execution time and must be measured with representative depth before any latency claim.
