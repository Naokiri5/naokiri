# MASTER ENGINEERING PROMPT — MIA Whale Intelligence Network (WIN-01..WIN-06)

> **REVIEW-ONLY VERSION:** This prompt accompanies a design package. Do not execute it in GitHub until the owner separately approves the design and explicitly requests implementation. There is no authority to merge, deploy or unlock live money merely because this prompt exists.

**Repository:** `https://github.com/Naokiri5/naokiri`  
**Goal:** Create a one-whale Solana memecoin follow system (`WIN-FAST / Whale Reflex`) and a multi-market chart-and-large-player-footprint strategy reconstruction system (`WIN-DEEP / Whale Architect`), scalable to millions of indexed public addresses/evidence items; connect both to MIA's existing intelligence, decision, risk, OMS, account and DITAS infrastructure. Preserve all existing business, trading, security, authentication, accounting and release behavior. Avoid duplicate functions/modules, speculative 100% performance claims and any accidental real-money execution.

## 0. Inputs, their precedence, and source fidelity

Read and inventory the package first:
1. `MIA_WIN_UNIFIED_ENGINEERING_SPEC.md` — revised integration design, conflicts, acceptance tests and staged plan.
2. `MIA_WIN_SOURCE_TYPESCRIPT_CATALOG.ts` — **faithful declaration-only transcription** of PDF source document 2; not implementations.
3. `MIA_WIN_SAFE_FOUNDATION.ts` — compiling non-executing illustrative TypeScript evidence evaluator; not production authority and not a drop-in PR.
4. `MIA_WIN_FEATURE_CATALOG.csv` — capability and dependency catalog.
5. `sources/ORIGINAL_WIN_SOURCE_SPECIFICATION.pdf` — authoritative original PDF, all four source documents, unchanged.
6. `sources/ORIGINAL_WIN_IDEA_AND_ARCHITECTURE.txt` — original user-provided conceptual document, unchanged.

**Source conflict precedence:** Owner's explicit current request and security rules > verified current repository implementation and tests > validated contract/design decision > source PDF proposal, with conflicts recorded, not silently removed. Never claim an unmerged PR is already present on `main`. Preserve source files byte-identical in docs provenance if implementation is later approved.

## 1. Scope guardrails

- Before any write, inspect repository `main`, all directly relevant PR bases, the latest commit and CI runs; prepare a file-level source-of-truth and duplication matrix. Do not make repo changes unless the owner has approved the design and requested actual implementation.
- Inspect `AGENTS.md`, `.github`, source formatting/typecheck/test scripts and current Open PR dependencies. Follow repository conventions; do not create competing `risk`, `qci`, `ledger`, `oms`, authentication or WebSocket transport cores.
- Specifically verify current owners: `server/src/whales/prints.ts`, `server/src/api/routes.ts`, `server/src/market/discover.ts`, `server/src/safety/safety.ts`, `server/src/workers/registry.ts`, `server/src/qci/coordinator.ts`, `server/src/decision/engine.ts`, `server/src/risk/gate.ts`, `server/src/exec/oms.ts`, `server/src/portfolio/ledger.ts`, `server/src/core/mode.ts`, `server/src/qa/gates.ts`, `server/src/db/migrations.ts`, `server/src/index.ts`, `web/src/App.tsx`, `server/src/ditas/*`.
- Reserve ownership in advance: WIN is candidate evidence / research / optional configuration. **Canonical risk and OMS decide all financial actions.** Only the existing portfolio/OMS writers can touch financial rows. No parallel execution tables or hidden signing path.
- LIVE remains blocked at the current baseline. Never create a flag, direct SQL update, `BOUNDED_LIVE` alias, testnet-to-live shortcut, mock credential or silent API substitution that can bypass G01–G14, owner authorization and actual broker certification.
- A portfolio must contain the user's **own** independently executed positions, not someone else's historical whale fill or fabricated entry price.
- No `src` module may hardcode secrets, log an API key, return wallet private keys, or fetch untrusted URLs supplied by a token metadata feed.
- All patient source evidence must be immutable, provenance-linked and timestamped. Anonymous CEX prints, aggregated futures positioning and institutional filings cannot be labeled as specific verified whale entries.
- Maintain parity of core risk checks for PAPER and future LIVE; LIVE may require additional, stricter signing and broker protections.

## 2. Reconcile existing open work BEFORE importing WIN

**Observed base graph from 2026-11-22:**
- `#45` on `main` (open, nonmergeable at review); `#46` stacked on `#45`; `#50` stacked on `#46`.
- `#92` has another feature-base dependency; `#95` stacked on `#92`; `#97` stacked on `#95`.
- `#106` paper bundle OMS work may overlap migration and order lifecycle.
- `#108` Strategy Lab/backtest correctness changes may be prerequisite for reliable DEEP backtests.

The PDF's `#95 -> #46 -> #50` is a **capability-reconciliation intention**, not a safe literal merge order. Independently inspect actual ancestry and diffs. Do not merge entire broad PRs just to import a few utilities. Build a dependency/overlap matrix; reuse relevant code through targeted cherry-picks or clean adaptation only if provenance, licensing, branch conflicts and tests permit. If a PR is incomplete, unsafe, nonmergeable or CI-failing, **do not merge it**. Record blockers and request owner review.

## 3. Technical execution plan, only AFTER owner approval

### Phase WIN-00 — repository verification

Create a table of **source path -> existing implementation -> PR overlap -> new work -> tests -> owner**. Map API route ownership and all db migrations on the selected base (current `main` has `server/src/db/migrations.ts`, at v5 when inspected). Map account/environment statuses, QA G01–G14 and continuous hosting requirements. Capture baseline `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`, `npm run scan:secrets`, `npm audit --audit-level=high`; report actual results rather than inventing green checks.

### Phase WIN-01 — verified whale catalog

Extend `server/src/whales` with `registry`, `observations`, `index`/source adapters as needed. Adapt Solana RPC/Helius/Geyser ingestion from reviewed PR work; avoid duplicate transports. Normalize per signature and wallet, distinguish net token balance delta from proof of a swap, handle Token-2022 decimals/fees, native SOL lamports, rent, Jito tips and multi-route splits. Use atomic quantities, finality checks, stable dedupe keys and data freshness. Source PDF `normalizeSolanaSwapFromBalances` declaration should be used as requirements input; adjust precision and provenance types only with explicit compatibility note. Add immutable evidence tables to the canonical migration array, assign the next free migration version and independently test reapplication/upgrade.

### Phase WIN-02 — whale profitability *and follower replicability*

Retain PDF named baselines (`25` minimum verified trades; `0.85` coverage; `2500ms` lag; `180bps` round-trip cost; `3000ms` holding; score weights `40/35/25`) as versioned benchmark parameters **not fixed policy truths**. Reconstruct FIFO or reviewed lot accounting, mark all unsold holdings to conservative executable liquidity, detect missing swap history, model fills at the follower price after event delay and compute net PnL, drawdown and uncertainty. Quarantine addresses with unreliable attribution/coverage, MEV-like incompatible latency, creator/linked-wallet manipulation, or missing exit liquidity. Measure lag sweep across p50/p95/p99 and notional sizes. Avoid presenting a "win probability" without independent holdout calibration.

### Phase WIN-03 — FAST memecoin candidate then PAPER

Add a secure follow-rule API without registering a second `GET /api/copy`. Preserve owner auth, rate limits, CSRF, per-account one-wallet uniqueness and an explicit observe/PAPER control. For confirmed/finalized relevant buys: require direct wallet evidence, screened mint, supported sell route, safe liquidity, fresh obtainable quote, drift limit and expected after-cost edge. Produce candidate evidence for **existing signed QCI**. Adapt its domain weights if reviewed; **do not insert the PDF's naked `0.28` worker vote into existing authenticated weights**. Evaluate with canonical `decision/engine.ts` and `risk/gate.ts`. Only when existing strategy and OMS can model this Solana instrument, run paper execution using available follower liquidity. Current Binance spot OMS cannot be presumed to execute Solana memecoin pools without a new verified paper adapter under the same OMS authority. Seller events may become exit evidence for *held* positions; never blindly create a short/close another user's position.

### Phase WIN-04 — DEEP multi-market strategy DNA

Implement evidence interfaces and point-in-time availability for large prints, OI, funding, liquidation, COT, 13F and licensed market tape. Use real publication `availableAt`, not just date-of-market-data. Build zone hypotheses (range/sweep/VWAP/structure, trigger, invalidation, target, expiry, net modeled edge) using existing `features/indicators.ts` calculations; do not create a second indicator engine. Backtest with embargoed walk-forward, chronological state, contract roll/expiry, correct market sessions/holidays, commissions, spread, funding/rollover, risk costs, latency and closing protections. Original PDF's Brier `<=.235`, `n>=30`, Wilson 95%, 45-minute decay and 75/25 blend are **candidate baselines**. Compare Brier to a correct class-prevalence baseline and report uncertainty rather than output unsupported accuracy. Separate forex, equity, crypto perpetual and futures venue capabilities; no unverified live stock futures signer.

### Phase WIN-05 — durable bridge under CANONICAL core

Do not replace OMS with a parallel `DurableWhaleOmsBridge` financial authority. If one is useful, make it a thin adapter to the existing risk gate, canonical order/reservation state, account/venue and position ledger. Add a **short-transaction** durable intent record with unique idempotency key, execution epoch/fence and stable client order ID; **never await network I/O while holding an SQLite transaction**. On timeout, set `UNKNOWN` and query venue state before retry. Handle partial fills and protective exits, reject missing marks/margin/settlement or insufficient exchange order protection. Add account-scope, contract multiplier, margin and synchronized portfolio allocator in the existing risk ownership. LIVE still locked. No withdrawal capability in whale features.

### Phase WIN-06 — UI, operations, releases and chaos tests

Integrate Whale Intelligence into existing `web/src/App.tsx`; show FAST Wallet Follow and DEEP Strategy DNA. Keep wallet addresses and all data-provenance labels visible; show `DIRECT`, `INFERRED`, `INSUFFICIENT_EVIDENCE`, `PAPER`, and `LIVE LOCKED` truthfully. Route real error codes; never make an inert-looking toggle appear to execute. Add detailed telemetry for ingestion→validation→QCI→risk→paper intent and provider breakages. Test shutdown/crash/pending-order recovery, duplicate signatures, account separation, finality and no-lookahead. Expand existing `.github/workflows/ci.yml` or create a narrowly scoped workflow **after** verifying current branch conventions. Replace the PDF's string-presence CI guards with behavioral sandbox adapters that throw if any LIVE order is attempted under a lock.

## 4. Safety precedence and no regression rules

For every trade candidate, the effective decision is the intersection of: verified source availability, chain finality, asset and sell-route safety, fresh/obtainable market quote, strategy and evidence validity, QCI quorum and veto, allowed instrument and venue, calibrated net positive edge if required, current account loss/leverage/correlation limits, strategy promotion, existing risk decision, paper-mode authorization, stable idempotent transaction, and exit protection. If any required input is absent, halt and persist an inspectable reason. An LLM can explain or propose rules but cannot change risk policy, initiate signers or auto-promote an unvalidated strategy.

Do not claim exactly reproducible "whale profits" when the whale's portfolio and off-exchange hedges are unknown. Do not promise perfect entries or guaranteed profitability. Source PDF `maintenanceMarginRatio >= 0.75` and `forex spread >8 bps` are not venue-independent logic; validate definitions and thresholds before coding.

## 5. Mandatory test categories

Implement and prove all acceptance cases `WIN-T01..WIN-T22` in the unified spec, plus tests of API owner permissions, one-wallet rule, source spoofing, balance-delta transfer false positives, Token-2022 fee restrictions, whiplash entry drift, illiquid dead bags, replay leakage and actual instrument calendars. Add runnable proof that a locked LIVE environment cannot call an execution adapter, even if an attacker supplies a valid-looking approval ID. Re-run full existing CI to catch regressions in Privy, bot schedule, market data, charts, QCI, OMS and account ledger. For every issue, state a repro, root cause, proposed minimal fix, tests and affected canonical owner.

## 6. PR and merge discipline

Each implementation PR should be small and scoped to **one WIN phase**, unless directly related to an existing still-active PR; then reconcile the relevant existing code rather than duplicating a second feature. Describe the original file paths and signatures preserved, the deliberate changes and exactly why they were needed. Keep migrations append-only, no unrelated mass formatting, no duplicate API names. If a PR is stacked, record its exact base SHA and status. **Never auto-merge an unfinished PR.** After PR tests, require independent trading-risk, security and financial lifecycle review before merge. Deployment or live-money authorization is a separate explicit action and never follows automatically from a code merge.

## 7. Required report for owner review (before any implementation)

Return: (1) source fidelity map; (2) repo and PR dependency graph; (3) actual duplicate/extension matrix; (4) 6-phase file plan and migration numbering; (5) proposed types and API changes; (6) provider, terms and data license dependencies; (7) full security/financial threat model; (8) tests and results; (9) unverified assumptions; (10) live lock proof; (11) exact proposed diff boundaries; (12) go/no-go verdict for each phase.

**This is a spec to implement only after the owner reviews and asks for GitHub development. Until then, return designs and source files, not commits, PRs, merges, deployment or trading.**