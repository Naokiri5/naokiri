# MIA DEEP PRECISION — Gap-only implementation record

**PR:** #106, current bundle branch. **Delivery:** first integration milestone (P0/P1), not the complete autonomous DEEP product. Original source remains preserved **without modifying any word** in [sources/dpi/MIA_DPI_ORIGINAL_SOURCE_VERBATIM.txt](sources/dpi/MIA_DPI_ORIGINAL_SOURCE_VERBATIM.txt), with the [complete unified master document](sources/dpi/MIA_5_0_DEEP_PRECISION_COMPLETE_UNIFIED_MASTER.md), [Codex/Claude prompt](sources/dpi/MIA_DPI_CODEX_CLAUDE_MASTER_PROMPT.md) and [reference TypeScript](sources/dpi/MIA_DPI_REFERENCE_ARCHITECTURE.ts.txt). Source TypeScript is archived as .txt to avoid creating a second compiled trading authority.

## Exact integration map

| Feature / source requirement | Existing owner | Delivered now | Remaining gap / constraint |
| --- | --- | --- | --- |
| FAST remains Solana-focused | Draft THINK router #89; Solana Hunter #46/50/52 | No changes to FAST or scanner | Merge/resolve stacked dependencies before active Solana execution |
| DEEP multi-timeframe interpretation | \`server/src/chart/analysis.ts\` and \`market/types.ts\` | \`chart/precision.ts\` reuses confirmed 15m/1h/4h native chart analysis | Real provider-certified 1m/tick stream required for scalping |
| Price-zone hypotheses | Existing ChartReport support/resistance from prior confirmed candles | Long-zone observation, buffer/invalidation/stop/target; volatility-sensitive approximate range, tick rounded | Strategy-specific confirmation, spread/fee-adjusted targets, specialist calibration |
| Trend, liquidity sweeps, FVG, indicators | Existing \`chart/analysis.ts\`, \`features/indicators.ts\` | Reused; no duplicate technical indicator calculations | Research-only; hypothesis not executable liquidity |
| Existing 100-worker coordination | \`workers/registry.ts\`, runtime and QCI | Selects live registry metadata by relevant domain; shows blocked providers and dependency-group count | Actual signed QCI per new zone, independence validation, adversarial challenge is *not yet wired* |
| Canonical risk | \`risk/gate.ts\`, \`risk/policy.ts\` | Preserved untouched. DPI can **never** authorize | QCI/decision/risk owner must later evaluate an actual candidate |
| DEEP zone lifecycle | Canonical decision/OMS + archived reference | Research stages only: NO_TRADE, OBSERVING, ZONE_IDENTIFIED, ZONE_TOUCHED_UNCONFIRMED | Durable independent alert/watch-state, validated trigger, trade state projection, never synthetic fill |
| Market specific futures/forex/stocks/ETFs | \`market/types.ts\`, future provider adapters | Truthful fail-closed MARKET_ADAPTER_NOT_CERTIFIED | Real sessions, contract size, margin, broker spreads, authorization, live reconciliation |
| READ-ONLY UI integration | Existing \`GET /api/instrument/:symbol\`, \`web/src/pages/Markets.tsx\` | Adds \`deepPrecision\` in same response and visible Market Terminal panel, no new route or dashboard | More complete chart visualization, worker evidence panel |
| Data freshness & replay | Existing \`market/quality.ts\`, chart validation/replay | Strict quote/closed-bar reuse and fixed 15m/1h/4h dependencies | Historical zone outcome analysis and calibration |
| LIVE execution and bundle | Existing PR #106 OMS, G01–G14 | **Untouched**; no new trade mode, signer or gateway | Independent certification is required; no 100% accuracy claim |
| DITAS attribution and analytics | Existing \`ditas/*\`, journal | Unchanged, no fabricated outcomes | Walk-forward and genuine order/fill markout attribution |
| Auditable reference source | User attachment and unified docs | Archived original/unified/prompt/reference separately; source fidelity verified against attachments | Avoid future overwrites; append separately |

## Program flow implemented in this draft

\`\`\`text
Market Terminal GET /api/instrument/:symbol
  ├─ Existing market store + verified ticker + canonical quality
  ├─ Existing chart/analysis.ts on 15m + 1h + 4h confirmed candles
  ├─ chart/precision.ts (READ_ONLY, never creates DecisionReport)
  │    ├─ validate each timeframe (existing analyzer)
  │    ├─ infer a directional RESEARCH bias only if 1h & 4h agree
  │    ├─ derive finite, tick-rounded hypothetical zone from prior 15m bars
  │    ├─ invalidate future/stale/missing data, uncertified markets and spot shorts
  │    └─ show worker availability metadata; do NOT claim QCI quorum
  └─ existing web Market Terminal: DEEP PRECISION evidence panel
\`\`\`

**Do not misread research observations as a trade trigger.** A price touching a proposed zone only changes observational state to \`ZONE_TOUCHED_UNCONFIRMED\`. It does not call \`runConsensus\`, \`evaluateRisk\`, \`submitEntry\`, a broker, a signer or a live wallet. Existing emergency, risk and trading protections are unchanged.

## Architecture invariants

- Use one canonical QCI coordinator, 100-worker registry, risk gate, OMS, paper ledger and release gate.
- Do not give the UI caller permission to claim native timeframes, privileged market safety, worker approvals, risk pass, trading venue, account balances or execution authorization.
- All scoring is a research hypothesis. The panel does not show a pseudo probability or guarantee 100% prediction accuracy.
- A bullish/bearish trend from confirmed pivots is not the same as order flow, true market liquidity, or verified entry/exit feasibility.
- A SHORT signal in current spot crypto is blocked; unavailable forex/futures/stocks/ETF broker adapters remain blocked rather than silently falling back to Binance.
- Actual order execution requires a separately created canonical candidate/consensus/risk assessment and existing OMS checks, **not** any return value of the research function.
- The current branch is draft. Do not assume open stacked PR #89 or provider drafts are already on main. Resolve migration dependencies and CI before any merge.

## Tests

\`server/test/precision.test.ts\` covers: research-only authority; original worker registry use; market adapter absence; unsupported scalping feed; canonical quality failure; future/stale/missing quotes; three closed timeframes; spot short veto; non-mutation; invalid tick. Full existing repo CI must still pass.

## Next implementation stages (not certified in this PR)

1. Reconcile THINK router branch #89/#91 and existing QCI packet and zone-provenance versioning without spawning another router or worker pool.
2. Add verified broker **read-only** metadata for forex, futures, equities and ETFs, with session, contract and margin evidence and delayed vs executable quote labeling.
3. Build non-repainting point-in-time zone replay, trigger and missed-zone outcomes, DITAS analytics, and walk-forward calibration.
4. Add durable watch-state alerts. Let the existing decision engine create fresh decisions, never inherit a stale zone's risk authorization.
5. Prototype new venue-specific demo execution only with faithful costs, broker rules and existing OMS risk. Leave LIVE locked until G01–G14 and independent security/trading risk approval.
