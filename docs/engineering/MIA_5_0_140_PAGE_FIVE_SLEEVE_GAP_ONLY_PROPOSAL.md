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

---

## Appendix — 2026-11-22 63-page Unified Architecture integration

**Source:** A distinct user-uploaded **63-page** “MIA 5.0 Unified Architecture Documentation, Master Prompt & TypeScript Catalog” (PDF SHA-256 `42fc0041a9e8741414ec49224e4b2cc3d4cc37254b904216dada421e9a6548cb`, 476,002 bytes). Its full **63-page parsed transcript** (2,746 searchable source lines) is preserved as the inert `sources/MIA_5_0_63_PAGE_UNIFIED_ARCHITECTURE_PDF_PARSED.txt`. Page markers were counted and the source PDF was not edited. This parsed text is not byte-identical to the original PDF and cannot be compiled or executed as-is.

This source proposes 19 new modules and four scripts, plus five portfolio sleeves with a proposed **$10,000 virtual allocation** (futures 30%, spot 25%, memecoin 10%, yield 20%, stocks/ETF 15%). **None of those allocations is a deposit, account balance, approved strategy or LIVE permission.** Avoid replacing existing financial state or inventing functional sleeves.

### 19 proposed module owners — NO parallel authority

| PDF module / responsibility | Real owner or dependency | Decision |
| --- | --- | --- |
| 01 `types/mia5.catalog.ts` | `market/types.ts`, `workers/types.ts`, `market/coverage.ts` | REUSE contracts; no competing canonical type system |
| 02 `NexusFabricRouter.ts` | `market/fabric.ts` and `market/quality.ts` | REUSE single feed + freshness engine |
| 03 `FeatureVectorBuilder.ts` | `features/indicators.ts`; separate Hive observation work in PR #91/#93 | NO duplicate indicator engine or 97-index interpretation; cross-check different PDF versions first |
| 04 `fastReflexWorker.ts` | `qhef/qhef.ts`, existing telemetry; PR #91/#93 | BLOCK unsupported <10ms claims and redundant worker |
| 05 `deepConfluenceWorker.ts` | QCI, decision / THINK work (stacked PRs) | REUSE; benchmark separately before any OOM-respawn authority |
| 06 `AgentRegistry.ts` | `workers/registry.ts` | REUSE exactly 100 canonical W-* workers; PDF AGT-* are design names, not independently executable agents |
| 07 `SwarmThreadPool.ts` | `workers/runtime.ts` | REUSE bounded dispatch; 4ms p95 end-to-end not certified |
| 08 `AdaptiveThinkingEngine.ts` | existing scanner, `decision/*`, THINK work | REUSE; avoid parallel order-decision entry points |
| 09 `DitasCalibrator.ts` | `ditas/calibration.ts`, passports, current decision evidence | REUSE calibration; unknown confidence is never 100% |
| 10 `UnifiedRiskGovernor.ts` | `risk/gate.ts`, `risk/policy.ts`, `portfolio/paperExpectancy.ts` | BLOCK second risk/promotion authority; existing 30-trade cohort is RESEARCH ONLY |
| 11 `CanonicalRiskGate.ts` | `risk/gate.ts`, `exec/oms.ts`, `db/db.ts` | REUSE synchronous canonical paper gate and transaction helper |
| 12 `MacroCalendarVetoSkill.ts` | existing risk inputs; macro research in PR #67 | DEFER official sourced calendars; no guessed FOMC/NFP times |
| 13 `CapitalAllocatorSkill.ts` | `risk/gate.ts` sizing, `risk/policy.ts` | No independent leverage/Kelly authority |
| 14 `TreasurySweepGuard.ts` | existing portfolio/ledger only | BLOCK vault transfers and recall until source/ledger/permissions and remote-finality proof |
| 15 `PaperOmsAdapter.ts` | `exec/oms.ts`, `portfolio/ledger.ts` | REUSE canonical paper OMS; no duplicate fills |
| 16 `LiveOmsRouter.ts` | `exec/environment.ts`, `core/mode.ts`, formal G01–G14 release gates | BLOCK unsupervised LIVE, futures, swaps, or Alpaca broker execution |
| 17 `PrivyAuthGuard.ts` | `security/privy.ts` and `api/auth.ts` | REUSE identity handling; a login token alone is not wallet signing authority |
| 18 `TcaDatabase.ts` / `SleeveTelemetryRepository.ts` | `db/db.ts`, `db/migrations.ts`, existing DITAS/portfolio reports | BLOCK extra financial DBs or writable TCA ledger; use established WAL database |
| 19 `telemetryStream.ts` / `SleeveMatrixPanel.tsx` | `api/sse.ts`, `web/src/api.ts`, current dashboard | EXTEND existing read-only stream and UI only with truthful coverage |

### Four scripts: status and critical safety correction

1. `seedSqlite.ts`: **NOT INSTALLED**. The PDF's `--reset` removes database and WAL files. Never operate it against current data or create separate `mia_ledger.sqlite`/`mia_tca.sqlite`. Reuse migrations in `db/migrations.ts` and `db/db.ts`.
2. `expectancyGateAudit.test.ts`: **NOT INSTALLED AS WRITTEN**. It tests a hypothetical `UnifiedRiskGovernor` against a new schema, not the existing MIA system. Keep `portfolio/paperExpectancy.ts` plus `paper-expectancy.test.ts` as current read-only evidence; no simulated thirty-trade result can automatically grant LIVE authority.
3. `verifyPaperBurnIn.ts`: **NOT INSTALLED AS WRITTEN**. The reference demands non-existent five-sleeve execution/SSE, separate DBs and a 4ms SLA. Actual readiness remains `ops/readiness.ts` and the current health/test contracts; measured benchmarks need validated ingress clocks and real workloads.
4. `verifyEquitiesPremarket.ts`: **NOT INSTALLED AS WRITTEN**. Even an Alpaca *paper* bracket order placed far from the market is still a real order in the paper broker's matching environment and may fill. A safe check must be **read-only** using validated clock/session/calendar, account and SPY/QQQ feed observations; there is no certified broker trade lifecycle here. Monday 9:30 AM America/New_York is not sufficient to prove trading-session eligibility on market holidays.

### Implemented scope on this PR, without duplicating 30-trade research

- Added `AGENTS.md`, a concise Codex instruction entrypoint that defers to the existing `CLAUDE.md` and actual authoritative modules. It explicitly bans destructive PDF scripts, unapproved execution, and replacing the existing risk/OMS.
- Hardened `ditas/passports.ts` to restrict version-specific paper strategy diagnostics to `PAPER_ACCOUNT`, with stable newest-first ordering, finite per-R validation and a regression proving another account cannot corrupt paper evidence. The existing 30-trade cohort in `portfolio/paperExpectancy.ts` remains the sole *cohort-level* calculation; no second rolling evaluator or promotion gate was created.
- The new reference is stored without running any of its scripts. Existing TypeScript source, route signatures, migrations, risk limits and order execution are otherwise unchanged.

**Future autonomous behavior:** The default loop may monitor and self-recover *observational* components without user interaction. Production trading requires independent preauthorized risk envelopes, durable account-scoped intent and order reconciliation, certified protective orders, scoped identity and signing, independent human release and a fail-closed halt on uncertainty. An agent, UI, backtest or test fixture must never self-approve LIVE.

**Release status:** Source preserved and narrow code changes committed to the existing five-sleeve PR stack. The document does **not** claim successful end-to-end tests, ready-to-merge status, live trading, 30-trade performance certification or sub-4ms latency. Check exact-head GitHub Actions, resolve stacked PR conflicts, perform security/risk review and keep the branch DRAFT until verified.
