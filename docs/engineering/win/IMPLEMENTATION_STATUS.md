# MIA Whale Intelligence Network — GitHub implementation status

**Branch:** feat/mia-win-whale-intelligence-foundation-20261122
**Base:** main @ 7ecda93c6b5e74077d1ab87c3faf5b899cb28535
**Safety status:** READ_ONLY evidence and owner watchlist only. No live or paper Solana order execution.
**Merge policy:** DRAFT; DO NOT MERGE until full CI, trading-risk/security review, and source stack reconciliation.

## WIN-L01 — adaptive whale learning follow-up (2026-11-22)

**Committed to this same draft PR:** `server/src/whales/winLearning.ts`, `winProfiler.ts`, `winRegistry.ts`, owner-authenticated `GET /api/copy/learning`, focused tests, and [WIN_ADAPTIVE_LEARNING_SKILL.md](WIN_ADAPTIVE_LEARNING_SKILL.md).

- **Working code / bounded research:** FIFO closed-lot outcome attribution; historical delayed follower **simulation** when quotes are supplied; pre-entry source-hashed DITAS Market DNA lookup, causal similarity matching, deduplication, 4-samples-per-wallet concentration cap, 6-lot/3-wallet independent evidence minimum, loss-pattern abstain-review and winning-pattern DEEP-review suggestions.
- **Safety:** source histories below independently established 85% coverage, quarantined records, unknown quote costs, future snapshots, partial exits and one-wallet clusters never certify a learning rule. This is read-only memory derived from existing durable evidence, with no extra database/migration and no live execution authority.
- **Not operational yet:** WIN has no connected continuous authenticated whale-history feed, complete-history denominator, stored historical follower quote stream, broad DEX Market DNA coverage, or Adaptive THINK runtime gate. The current `GET /api/copy/learning` therefore reports `AWAITING_VERIFIED_LEARNING_INPUTS` rather than manufacturing a winning model. PR #89's Adaptive THINK remains separate and unmerged. No feedback-driven strategy deployment, automatic order veto, QCI vote modification or trade copying is wired.
- **Go/no-go:** **NO-GO** until exact final-head CI, source provenance, holdout studies, stack reconciliation and independent financial/security review pass. LIVE remains locked.

## Provenance

- Original owner idea/text, full updated unified engineering specification, exact declaration catalog, 50-row feature catalog and Codex master prompt are under reference/.
- A machine-extracted text reference of the original 26-page PDF is supplied. It is NOT byte-for-byte identical to the PDF and may lose page layout; the owner-provided PDF is authoritative.
- The pure server/src/whales/winEvidence.ts derives from the reviewed safe foundation. It generates research candidates, not executable MIA decisions.

## Implemented in this PR

- WIN-00: documents and scope/PR boundary inventory.
- WIN-01: canonical migration v6 adds one-wallet-per-account READ_ONLY follow config and immutable, uniquely identified finalized whale observations. Store is non-public and only usable by a future authenticated RPC ingestion adapter. No fabricated wallet history.
- WIN-01: owner-authenticated/CSRF-protected POST /api/copy/follow and DELETE /api/copy/follow. Existing GET /api/copy remains BLOCKED for automatic trading and gains additive win status. GET /api/copy/observations never exposes unverified trades as confirmed.
- WIN-01 partial net-balance normalization: `server/src/whales/winSolanaNormalize.ts` aggregates wallet-owned SPL balances with BigInt and refuses ambiguous transactions, untrusted quote mints, malformed signatures, failed/future/unfinalized evidence and missing verified DEX-program proof. Pure function only; no active RPC ingestion or production proof chain. 8 negative/positive tests.
- WIN-02 research-only FIFO profiler: `server/src/whales/winProfiler.ts` reconstructs matched gross closed lots, independently marks unsold holdings using usable full-size sell quotes or zero-liquidity stress, flags orphan sells/duplicates/MEV-like holding times, and estimates delayed follower PnL only when all validated historical quotes are supplied. The resulting `automaticCopyEligible` is always `false`. No historical wallet-trading feed is connected.
- WIN-02 read-only `GET /api/copy/profile` from the existing authenticated API and dedicated research-only profile display in the existing `/copy` UI. The backend deliberately withholds history coverage, fees, follower PnL and accurate win probability when sources are absent.
- WIN-03 safety-only preview: pure FAST evaluator requires verified direct swap, finality, token/sell-route checks, fresh follower quote, drift and after-cost edge. It cannot reach the OMS.
- WIN-04 safe evidence: GET /api/whales/deep exposes only anonymous CEX print inference; deep hypothesis validator rejects future-available data and unvalidated models. It never identifies individual traders or executes trades.
- Both evaluations, migration behavior, route authorization, CSRF and LIVE lock have regression tests.
- WIN-06 partial UI: reuse existing /copy route and page; FAST read-only public address input/unfollow and DEEP inferred large-print display. Trading and live controls remain absent.

## Not yet implemented, and why

- WIN-01 scalable indexed Solana wallet discovery, authenticated provider ingestion, end-to-end verified swap proof, finality reorg tracking and RPC credentials. The isolated net SPL delta normalizer is implemented but is not an RPC decoder or identity attestation.
- WIN-02 verified complete wallet trade history, externally authenticated cost basis and fee/hedge reconciliation, executable liquidity quote feed, calibrated follower rankings and full latency/volume sweep. Pure FIFO, zero-liquidity stress, and delayed quote simulations are implemented as research-only partial capabilities.
- WIN-03 Solana token safety verified end-to-end, owner wallet signing, Jupiter actual quote-to-fill reliability, a Solana PAPER OMS adapter, signed QCI connection, automatic memecoin entries/exits.
- WIN-04 licensed futures/forex/stock/ETF feeds, chart structure generation, point-in-time institutional filings, holdout and walk-forward calibrated performance, production multi-venue research.
- WIN-05 capital reservations, futures/options margin, broker/DEX order lifecycle and crash reconciliation under a canonical existing OMS.
- WIN-06 is PARTIAL: existing /copy page now offers FAST wallet selection, evidence, research-only FIFO/stress profile and DEEP anonymous prints. A scaled index/store benchmark, full chaos/operations tests and release approval remain open.
- LIVE is locked by MIA's existing G01-G14 release gate. No live signer, order, withdrawal or certified profitability in this PR.

## Existing canonical ownership (must not duplicate)

| Owner | Current authority | WIN integration rule |
| --- | --- | --- |
| server/src/api/routes.ts | Auth/session/CSRF and endpoint registration | Extend existing /api/copy, never register another GET path |
| server/src/db/migrations.ts | Ordered DB migration array | Append migration only, reconcile v6 collisions before merge |
| server/src/market and features/indicators.ts | Instrument state and technical features | Reuse for product-specific data before deeper strategy |
| server/src/whales/prints.ts | Binance large prints (not identified wallet activity) | Keep as source, label as INFERRED_ENTITY |
| server/src/workers, qci/coordinator.ts | Signed consensus and quorum/veto | Evidence can enter ONLY through reviewed signed packet adapter |
| server/src/decision/engine.ts | Canonical decisions | A WIN CANDIDATE does not authorize an order |
| server/src/risk/gate.ts | Fail-closed trade sizing and permissions | Do not duplicate, replace or bypass |
| server/src/exec/oms.ts | Sole paper OMS for Binance spot | Never pretend it can route Solana DEX/futures/forex/ETF |
| server/src/portfolio/ledger.ts | Financial truth | No WIN ledger/fills/positions tables |
| server/src/qa/gates.ts | G01-G14 LIVE lock | Keep hard lock and independent approval |

## Branch and PR dependencies

- #45 -> #46 -> #50: the existing Solana Hunter/mint checking stack.
- #92 -> #95 -> #97: demo/testnet preflight, read-only market providers and later live-readiness proposals.
- #106: paper-bundle work currently also proposes migration v6, potential collision.
- #108: accuracy fixes for existing Strategy Lab before trusting WIN-DEEP backtests.
- Several PRs are draft, overlapping or nonmergeable. Do not bulk-merge them. Resolve individual code ownership and migration numbering in an independent reconciliation pass.

## Guardrails and remaining gates

1. Only publicly verified Solana wallet swaps may be assigned direct wallet attribution. Token balance changes alone do not prove swaps.
2. Distinguish confirmed, finalized and uncertain/reverted transactions. Future high-speed confirmed-time decisions require explicit handling of finality risk and rollback.
3. The source PDF's 25-trade threshold, 85% coverage, +2.5s delay, 180bps costs, 40/35/25 score and Brier<=0.235 are research defaults, NOT fixed execution rules.
4. SEC Form 13F, CFTC COT and anonymous prints cannot prove a named counterparty's exact real-time trade.
5. Any future paper/live path must recheck data freshness, existing signed QCI, canonical decision, deterministic risk, account scope, idempotent order and protective exit at the actual order boundary.
6. Never await an external RPC while holding a SQLite transaction. Resolve UNKNOWN venue order state before retry.
7. No 100% win-rate claim, no guaranteed exact-entry zones, and no synthetic wallet PnL marketed as verified.

## How to verify

From the actual integrated branch checkout:

- npm ci
- npm run typecheck
- npm test
- npm run build
- npm run test:e2e
- npm run scan:secrets
- npm audit --audit-level=high

Review the GitHub CI checks on the exact final PR SHA. This document does not assert they passed merely because code was committed.

**Current merge verdict: NO-GO** pending completed CI on latest head, independent trading-risk/security review, review of overlapping v6 migrations and real provider / OMS / QCI integrations. Browser regression for unfollow's missing JSON body was reproduced from Actions job 137053795547 and patched; verify the fix on a completed, non-cancelled run before marking it fixed.
