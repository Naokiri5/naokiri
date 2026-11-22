# MIA WIN-L01 — Whale Outcome Adaptive Learning Skill

**Status: DRAFT, research-only, NOT a production autonomous learning loop.**
**Owner:** existing `server/src/whales` WIN evidence reader and canonical `server/src/ditas/fingerprint.ts`. 
**Related open drafts:** WIN #109, Adaptive THINK #89, unified integration #45. Do not merge these independently without stack reconciliation.

## Objective

Convert **independently verified, finalized whale swaps** into carefully qualified **winning and losing setup observations** and relate them to the **market state actually available before entry**. Repeated historical losses can suggest `ABSTAIN_REVIEW`; similar wins can suggest `DEEP_REVIEW` and holdout research. This skill must never learn a trading permission from a win, override QCI or risk, or automatically force execution.

### Single authoritative data flow

1. **Source ingestion (missing):** authenticated RPC/venue adapter proves wallet custody and finalized swap activity, source timestamps, complete history, costs and unique evidence keys. Until this exists, the existing `win_whale_observations` table stays a non-empty-if-externally-fed **immutable** source, not a synthetic whale feed.
2. **Outcome reconstruction (implemented):** `winProfiler.ts` consumes verified swap observations once, tracks FIFO buy lots and matched sell portions. `closedLots` now includes immutable-source entry/exit IDs, timestamps, source snapshot IDs and gross whale PnL. Unsold inventory is never counted as a closed win. A gross profitable wallet sell **does not prove net whale profit**, and a wallet's hidden futures hedges are unknown.
3. **Follower counterfactual (research implementation):** historical quote records must be independently executable at the expected delayed follower time and have real fee estimates; the existing profiler returns `simulatedFollowerNetPnlUsd` **only** if both matched leg quotes satisfy its checks. These are still hypothetical follower outcomes, not real fills. No verified historical quote feed or continuous provider is connected.
4. **Pre-entry setup evidence (adapter implemented, coverage unavailable):** `winRegistry.ts` can join an outcome to an **immutable DITAS** snapshot of the same instrument captured within the previous five minutes, checks its SHA-256 and ID, and refuses snapshots captured after the whale entered. This reuses existing `ditas_snapshots`; **no second memory DB, mutation or migration**.
5. **Adaptive analysis (implemented pure skill):** `winLearning.ts` compares the canonical `MarketFingerprint` through `compareFingerprints`. It filters for validated closed outcomes, available-at time, signal freshness (90 days), same timeframe/regime, sufficient shared features, historical similarity >= 0.85 (research threshold), unique entries, at most 4 entries from one wallet, at least 6 matching closed outcomes and at least 3 distinct wallets. A >=70% loss fraction and negative mean *simulated follower* PnL means `AVOID_SIMILAR_LOSS_PATTERN_RESEARCH`; >=70% win fraction and positive mean means `STUDY_SIMILAR_WIN_PATTERN_RESEARCH`; otherwise insufficient/mixed.
6. **Memory and refresh (partial):** source swap observations and historical DITAS snapshots already persist immutably. The read-only learning report is derived from them; new certified observations would be incorporated on the next assessment without adding a duplicate `learning_memory` table. It is **not** a separate autonomous background trainer, verified complete history or proven profitable policy. Existing `GET /api/copy/learning` reports current available evidence and blockers.
7. **Adaptive THINK integration (NOT IMPLEMENTED):** `assessWinLearningForCandidate()` is a bounded, read-only adapter for future canonical THINK decision data. Only after independent out-of-sample, delay-cost, market-drift, and safety certification should a separately reviewed THINK integration use `ABSTAIN_REVIEW` as **a risk-reducing abstain-only request**, never a new order permission. `DEEP_REVIEW` is research; winning patterns never generate trades by themselves.

## Truth and safety

- **No promises** of avoiding every losing setup, guaranteed winning trades, whale identity inferred from CEX prints, memecoin sellability or exact entry zones.
- **No survivor-bias shortcut:** independently counted full wallet histories and **failed/dead-bag positions** must be modeled. Do not train on cherry-picked profitable whales or only matched sells and call that a complete profitable history.
- **No label leakage:** use observation availability and DITAS pre-entry snapshot time; no future candle, close price, model/strategy outcome, quote or filing can enter an earlier setup fingerprint.
- **No sample inflation:** duplicate signatures, repeated entry IDs, split sells and one-wallet concentration must not be counted as independent evidence.
- **No wallet/venue authority:** no signer, broker adapter, Solana trade execution, extra scheduler, new SQL ledger, new risk governor or altered `LIVE_EXECUTION_AVAILABLE`.
- **No live model self-modification:** release/promotion is owner-approved only. Loss-pattern abstention needs independent evaluation of false-veto cost, so it cannot silently quarantine every future trade.
- The existing MIA `risk/gate.ts`, `decision/*`, 100-worker QCI and `exec/oms.ts` remain authoritative. All risk constraints must apply to paper/live in any future certified venue path.

## Scope and file ownership

| File | Change |
| --- | --- |
| `server/src/whales/winProfiler.ts` | Emits source-linked closed FIFO-lot observations from already verified historical events; no duplicate FIFO engine |
| `server/src/whales/winLearning.ts` | Pure adaptive pattern research over canonical DITAS DNA; no IO or execution privileges |
| `server/src/whales/winRegistry.ts` | Bounded read-only join to immutable DITAS snapshots; future advisory adapter and readiness report |
| `server/src/api/routes.ts` | Owner-authenticated `GET /api/copy/learning` under existing session/rate-limit gate |
| `server/test/win-learning.test.ts` | Loss, win, holdout, incomplete evidence, duplicates, regime shifts, lookahead and wallet diversity |
| `server/test/win-profiler.test.ts`, `win-api.test.ts` | FIFO provenance and authenticated read-only status |

## Acceptance gates before promoting beyond research

1. Verified complete wallet history, source credentials and chain reorg/finality tests.
2. Actual historical executable bid/ask and independent fees for the proposed follower trade size and latency.
3. Real pre-entry per-instrument DITAS fingerprints; no post-entry reconstruction or forward-filled snapshots.
4. Independent holdout across wallets, market regimes and calendar periods. Correct for multiple testing and survivor selection; compare against no-trade and random baselines.
5. Backtest and shadow replay showing lower false-entry and drawdown **without** disabling protective exits; no assumption that every win should be copied.
6. Measured bounded inference cost, worker isolation, broker recovery, idempotent reconciliation, rate limits, audit traceability and production source monitoring.
7. Exact-head typecheck, server/web unit tests, build, Playwright, secret scan, dependency audit and independent security/trading-risk review.
8. Resolve WIN PR #109 migration-v6 overlap with PR #106 and dependencies with THINK PR #89 before any merge. Keep LIVE locked absent explicit owner approval and all G01–G14 gates.

## Verification commands

```bash
npm ci
npm run typecheck
npm run test -w server -- win-learning.test.ts win-profiler.test.ts win-api.test.ts
npm test
npm run build
npm run test:e2e
npm run scan:secrets
npm audit --audit-level=high
```

**Release verdict: NO-GO / KEEP DRAFT.** The code introduces a real causal learning evaluator and evidence API, but source ingestion, costed training labels, independent validation and runtime THINK wiring are incomplete.
