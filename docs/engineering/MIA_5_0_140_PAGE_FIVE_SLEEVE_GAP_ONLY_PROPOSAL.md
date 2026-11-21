# MIA 5.0 — 140-page five-sleeve TypeScript bundle: full-source preservation and non-duplicating integration proposal

**Status: DRAFT PROPOSAL + ONE READ-ONLY FEATURE SLICE. NOT A PRODUCTION IMPLEMENTATION OF THE PDF.**
**Reviewed:** 2026-11-21
**Repository:** https://github.com/Naokiri5/naokiri
**Base:** `claude/mia-unified-01` from unmerged PR #45 at `b02d6d5e1abe65190ee71f14471d001d595e276b`.
**Other unmerged work:** #55 (JDR-001), #50 (Solana read-only), #64 (venue read-only reconciliation), #67 (macro guard/Kelly research), #82 (opt-in closed-bar ATR Chandelier), #84 (read-only T+5s markout). Check every PR head again before subsequent work.

## 1. Source preservation

| Evidence | Exact reference |
| --- | --- |
| Uploaded immutable original | `combine all of your idea in one  typescript add i....pdf`, 140 pages, 780,589 bytes |
| SHA-256 of the original PDF | `7e45fd1132b13e72115248d803ff33fad3f17b956d89f5a6cdf25e918dccc341` |
| Entire parsed PDF text, inert | [MIA_5_0_140_PAGE_MULTI_SLEEVE_PDF_PARSED_VERBATIM.txt](sources/MIA_5_0_140_PAGE_MULTI_SLEEVE_PDF_PARSED_VERBATIM.txt), all 140 pages in source order, all 19 BEGIN_FILE and 19 END_FILE markers |
| Original bytes | The user's original PDF attachment and corresponding SHA-verified downloadable source archive remain separate from GitHub. The GitHub text is a parsed PDF transcript, not a byte-for-byte PDF binary or verified original pre-PDF TypeScript. |
| PDF-source code | Never silently reformat, strip U+200B, import or compile the archive. New, reviewed code goes in canonical modules and tests only. |

The PDF asks for 19 modules across five sleeves: `futures`, `spot`, `memecoin`, `yield`, `stocks_etf`. This is a **proposal**, not evidence those modules are operational. Its `MIA_5_0_UNIFIED_MULTI_SLEEVE_ARCHITECTURE.ts` headline is not a proof the file exists in source control. GitHub's current backend is Fastify, TypeScript and node:sqlite, not the PDF's replacement SQLite databases and server.

## 2. MIA-ID source-to-owner matrix (all 19 IDs)

| PDF module | Proposed module | Existing canonical owner / work | Classification and decision |
| --- | --- | --- | --- |
| MIA-ID-01 | Five-sleeve types/contracts | `market/types.ts`, `market/coverage.ts`, `core/mode.ts`, `exec/environment.ts` | **PARTIAL**. This PR adds truthful read-only capability projection; defer any canonical instrument-ID changes to M5-U01 review. |
| MIA-ID-02 | Futures MTF/HMM + OI/funding/OFI/CVD classifier | `features/indicators.ts`, `regime/regime.ts`, `workers/*`, `market/coverage.ts` | **BLOCKED DATA / RESEARCH**. Current derivatives venue coverage unavailable. Do not synthesize VPIN/HMM or introduce another signal engine. |
| MIA-ID-03 | `SleeveRiskBudgetManager` | `risk/gate.ts`, `risk/policy.ts`, `portfolio/stress.ts` | **DUPLICATE AUTHORITY / DEFER**. Only read-only allocation diagnostics may be proposed. No second gate, 4x leverage, or automatic risk increases. |
| MIA-ID-04 | Macro/earnings skill and feed | `risk/gate.ts`; proposed `risk/macroCalendar.ts` in PR #67 | **DRAFT PARTIAL**. Reuse/review #67; no duplicate calendar. Require verified event-time provenance and equity earnings source, not inferred corporate-action timestamps. |
| MIA-ID-05 | Exit waterfall profiles | `lab/exits.ts`, `exec/oms.ts`, `exec/incidents.ts`, PR #82 | **PARTIAL**. Existing stop/TP/BE/time rules and draft ATR work; OFI/VPIN stage needs validated data and historical replay. No second exit timer. |
| MIA-ID-06 | `MultiSleeveRouter` | `market/fabric.ts`, `fabric/*`, `bot/bot.ts`, `exec/environment.ts` | **DUPLICATE**. Do not create another execution/event router; extend existing contracts only. |
| MIA-ID-07 | Solana byte parser and Ed25519 signing | Solana watchlist and read-only mint checks on stacked PR #50; existing `safety/*` | **PARTIAL + SIGNER BLOCKED**. Review on-chain proofs; never introduce production private keys or standalone signing authority. |
| MIA-ID-08 | Memecoin Jupiter swap and LP-pull exits | Solana research/feed stack including #52; current `safety/*`, `exec/environment.ts` | **BLOCKED EXECUTION**. Read-only quote/route sellability evidence is potential gap; no signed swaps or unsupported 100% liquidity protections. |
| MIA-ID-09 | Yield vault auto-sweep / recall | `portfolio/ledger.ts`, current risk and account contracts | **MISSING / FINANCIAL BLOCKER**. Do not add unsolicited transfers, vault credentials or JIT margin recall; protocol audit and account separation required. |
| MIA-ID-10 | Stocks/ETF Alpaca broker adapter | `market/coverage.ts`, existing execution contract | **BLOCKED PROVIDER & LIVE**. Equity prices/calendar/entitlements and broker adapter unavailable; review in isolated paper sandbox later, no real order path. |
| MIA-ID-11 | `TcaDatabase`, rolling 30-trade expectancy | `ditas/execution.ts`, `ditas/calibration.ts`, existing DB / PR #84 | **PARTIAL / DUPLICATE DATABASE**. Reuse immutable fills and DITAS analytics; research only. Do not auto-demote live trading from 30 unqualified samples. |
| MIA-ID-12 | `CanonicalPositionLedger` | `portfolio/ledger.ts`, `exec/oms.ts`, `db/*` | **DUPLICATE FINANCIAL AUTHORITY**. U-09 exact-unit journal, if authorized, is shadow-only and append-only. Never auto-heal live balances with incomplete snapshots. |
| MIA-ID-13 | Second `server/src/index.ts` boot/SSE server | Existing `server/src/index.ts`, `bot/bot.ts`, `ops/lease.ts`, `api/sse.ts` | **REJECT REPLACEMENT**. Preserve Fastify, leader fencing, owner auth, and LIVE execution lock. |
| MIA-ID-14 | Web telemetry types | `web/src/api.ts` and existing UI types | **PARTIAL**. Add only compatible projections; do not introduce a competing client API contract. |
| MIA-ID-15 | Execution telemetry panel | Existing dashboard, Trader Joe / live narration, `web/src/ui.tsx` | **PARTIAL**. Reuse existing UI and read-only SSE with authorization; never falsely display ACTIVE LIVE. |
| MIA-ID-16 | Multi-sleeve Vitest integration | `server/test/*` and shared helpers | **ADAPT TESTS**. Existing tests must remain authoritative. This PR adds five coverage cases, not a duplicate test harness. |
| MIA-ID-17 | TCA database tests | `server/test/ditas-execution*.test.ts`, existing DB suite | **ADAPT** to actual fills/account scopes, no second SQLite DB. |
| MIA-ID-18 | Double-entry ledger tests | `server/test/oms*.test.ts`, `server/test/ledger*.test.ts` as present | **ADAPT** to an independently reviewed exact-unit shadow migration; never alter current rows. |
| MIA-ID-19 | Macro and Solana scanner tests | Existing market/safety tests and unmerged #50/#67 | **ADAPT** after review; cryptographic signing fixture is not production permission. |

**Status semantics:** `DUPLICATE` means the proposed standalone authority must not be created. `MISSING` does not authorize live deployment. Unmerged PR work is present in a branch, **not** in `main` or automatically in PR #45.

## 3. High-risk PDF code (archive untouched, implementation blocked)

1. Three sleeves have `mode: 'LIVE'` in PDF's default budgets; this conflicts with `core/mode.ts` setting `LIVE_EXECUTION_AVAILABLE=false`. The PDF also proposes futures leverage 4, while MIA's accepted risk-policy type currently enforces leverage 1.
2. The proposed `SleeveRiskBudgetManager` calculates approval and sizing independently of `risk/gate.ts`. Never let this bypass last-moment policy/quality/owner gates.
3. The proposed `resetDailyCountersUtc()` resets both portfolio and sleeve circuit breakers at midnight. A timer must never clear an emergency or capital preservation halt.
4. `MacroCalendarVetoSkill` fabricates first-Friday NFP timing at a fixed UTC hour; daylight saving time and official schedule revisions make this unsafe. The fallback and earnings API assumptions are not verified.
5. `YieldVaultAdapter` introduces financial transfers, capital movements, depeg/TVL-triggered exits and untested JIT recall; no certified protocol account/bridge/ledger authority exists.
6. `SolanaTokenSafetyScanner` includes wallet-key and signing behavior; real signers must remain isolated and disabled. DEX pool liquidity or a RugCheck-style score is not proof that a token is sellable.
7. `StocksBrokerAdapter` assumes Alpaca bracket/stop semantics without authenticated calendar, account, precision, bracket acknowledgement and exchange evidence.
8. `TcaDatabase` and `CanonicalPositionLedger` create second `better-sqlite3`-backed financial state; MIA already uses `node:sqlite` and an account-scoped ledger. Keep one authoritative accounting system.
9. `server/src/index.ts` rewrites startup and HTTP/SSE, risking duplicate loop/process execution, authorization gaps and lease bypasses.
10. PDF extraction contains wrapped lines and U+200B characters: its text is **not** verified runnable TypeScript. Do not copy the self-contained bundle into a production source file.
11. Rolling 30-outcome expectancy thresholds (0.05R/-0.05R) and post-fill attribution are **research hypotheses**, not a validated authorization rule or predicted win percentage.
12. Missing or stale futures OI, depth, CVD or VPIN must be **UNKNOWN**; do not use hardcoded plausible values to establish a score or live trade.

## 4. Minimal code in this draft

**Canonical file modified:** `server/src/market/coverage.ts`.

The existing `GET /api/markets/coverage` now exposes a new **read-only** `sleeves` projection that ties the five PDF sleeve IDs to the existing market-coverage rows, reusing the provider health statuses already exposed in `markets`. No new provider registry, API route, SSE bridge, database, risk gate, OMS or scheduler is introduced.

Honest statuses in this branch:
- `spot`: `PAPER_IMPLEMENTED` only for the existing Binance spot PAPER path, conditional on fresh executable data and the risk gate.
- `memecoin`: `DISCOVERY_ONLY`; DEX pair discovery is not trade sellability.
- `futures`, `yield`, `stocks_etf`: `UNAVAILABLE` as operational PAPER trading sleeves.
- All five: `liveExecution='LOCKED'` from the existing canonical `LIVE_EXECUTION_AVAILABLE=false`. If a later build changes that constant, the projection still says `NOT_CERTIFIED`, not READY.

**Tests:** `server/test/multi-sleeve-coverage.test.ts` checks 5/5 IDs, market-source identity reuse, truthful PAPER limitations, locked LIVE, and preserved existing market clock/coverage behavior.

## 5. Proposed non-duplicating follow-ups (separate owner-reviewed draft PRs)

| Priority | Slice | Canonical owner / dependency | Safety gate |
| --- | --- | --- | --- |
| P1 | Complete five-sleeve market identity + provider/venue capability registry | `market/types.ts`, `market/coverage.ts`, JDR M5-U01 | No authorization, no invented provider entitlement |
| P2 | Research-only futures OI/funding/market-structure evidence | `features/indicators.ts`, `market/*`, `regime/*` | Verified point-in-time futures feeds, otherwise UNKNOWN |
| P3 | Read-only per-sleeve allocation and 30-trade expectancy diagnostics | `portfolio/stress.ts`, `ditas/calibration.ts` | Separate cohorts, out-of-sample provenance, no auto-sizing |
| P4 | Macro/earnings gate integration | PR #67 to canonical `risk/gate.ts` | Verified official calendar source + owner-approved policy; exits not blocked |
| P5 | Paper exit and markout experiments | PRs #82/#84 into canonical owners | Frozen-input regression and market-data provenance |
| P6 | Solana mint/route sellability research | stacked Solana PRs #50–#52, existing safety | Quote validity, mint/Token-2022 hazards, no signer |
| P7 | Exact-unit shadow ledger and broker reconciliation | JDR U-09 / #64 | Independent financial audit; no fabricated fills |
| P8 | Equity/ETF, futures, yield and broker qualification | Existing execution contract | Licensed quotes, scoped accounts, broker sandbox, owner certification |
| P9 | Dashboard/Trader Joe five-sleeve truth display | `web/src/api.ts`, existing UI | Authenticated, read-only, capability-aware |
| P10 | Real-money trading (separate future change) | Existing `exec/environment.ts`, release gates | **NOT AUTHORIZED** by this draft; explicit independent approval required |

No proposal supersedes the accepted code, financial history, migration ledger, local security invariants or prior file owners. Do not auto-merge any draft PR.
