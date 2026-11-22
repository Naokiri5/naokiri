# MIA Whale Intelligence Network — GitHub implementation status

**Branch:** feat/mia-win-whale-intelligence-foundation-20261122
**Base:** main @ 7ecda93c6b5e74077d1ab87c3faf5b899cb28535
**Safety status:** READ_ONLY evidence and owner watchlist only. No live or paper Solana order execution.
**Merge policy:** DRAFT; DO NOT MERGE until full CI, trading-risk/security review, and source stack reconciliation.

## Provenance

- Original owner idea/text, full updated unified engineering specification, exact declaration catalog, 50-row feature catalog and Codex master prompt are under reference/.
- A machine-extracted text reference of the original 26-page PDF is supplied. It is NOT byte-for-byte identical to the PDF and may lose page layout; the owner-provided PDF is authoritative.
- The pure server/src/whales/winEvidence.ts derives from the reviewed safe foundation. It generates research candidates, not executable MIA decisions.

## Implemented in this PR

- WIN-00: documents and scope/PR boundary inventory.
- WIN-01: canonical migration v6 adds one-wallet-per-account READ_ONLY follow config and immutable, uniquely identified finalized whale observations. Store is non-public and only usable by a future authenticated RPC ingestion adapter. No fabricated wallet history.
- WIN-01: owner-authenticated/CSRF-protected POST /api/copy/follow and DELETE /api/copy/follow. Existing GET /api/copy remains BLOCKED for automatic trading and gains additive win status. GET /api/copy/observations never exposes unverified trades as confirmed.
- WIN-03 safety-only preview: pure FAST evaluator requires verified direct swap, finality, token/sell-route checks, fresh follower quote, drift and after-cost edge. It cannot reach the OMS.
- WIN-04 safe evidence: GET /api/whales/deep exposes only anonymous CEX print inference; deep hypothesis validator rejects future-available data and unvalidated models. It never identifies individual traders or executes trades.
- Both evaluations, migration behavior, route authorization, CSRF and LIVE lock have regression tests.
- WIN-06 partial UI: reuse existing /copy route and page; FAST read-only public address input/unfollow and DEEP inferred large-print display. Trading and live controls remain absent.

## Not yet implemented, and why

- WIN-01 scalable indexed Solana wallet discovery, authenticated provider ingestion, balance-delta proofs, finality reorg tracking and RPC credentials.
- WIN-02 complete cost-basis / FIFO portfolio reconstruction, liquidity-adjusted dead-bag PnL, realistic follower PnL under delay, wallet quality ranking.
- WIN-03 Solana token safety verified end-to-end, owner wallet signing, Jupiter actual quote-to-fill reliability, a Solana PAPER OMS adapter, signed QCI connection, automatic memecoin entries/exits.
- WIN-04 licensed futures/forex/stock/ETF feeds, chart structure generation, point-in-time institutional filings, holdout and walk-forward calibrated performance, production multi-venue research.
- WIN-05 capital reservations, futures/options margin, broker/DEX order lifecycle and crash reconciliation under a canonical existing OMS.
- WIN-06 is PARTIAL: existing /copy page now offers FAST wallet selection, status, events and DEEP anonymous prints. A scaled index/store benchmark, full chaos/operations tests and release approval remain open.
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

**Current merge verdict: NO-GO** pending full integration tests, independent review and unmet WIN-02 through WIN-06 execution requirements.
