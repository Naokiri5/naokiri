# MIA BrainOS 7.0 — Cognitive Memory Foundation (internal)

**Status:** Implemented research-only foundation; NOT execution certification.  
**Existing owner:** `server/src/knowledge`, with canonical worker, QCI, decision, risk, OMS, ledger and DITAS services unchanged.  
**Target PR:** #135, draft; do not merge before comprehensive safety and release review.

## Architecture rule

Knowledge **references** executable engines; it never moves an order placement method, signer,
risk-policy mutation, ledger write, or exit supervisor into an LLM or skill prompt. Memory is evidence,
not a second controller. This increment adds no user-facing Quant Academy or extra 100-bot control screen.

## Reuse instead of duplication

| Concern | Canonical owner | New integration |
| --- | --- | --- |
| 100 market specialists | `workers/registry.ts` and `workers/runtime.ts` | `knowledge/cognitive/registry.ts` mirrors real IDs as ROLE-001... with required sources |
| 50 indicator specialists | `workers/indicators.ts` | Kept separate from new internal skill manifest |
| 50 cognitive skill contracts | Existing owners listed in manifest, or `UNIMPLEMENTED` | `knowledge/cognitive/registry.ts` with explicit readiness status |
| Book ingestion, citations, hybrid search | `knowledge/store.ts`, `knowledge/search.ts`, existing kb tables | `knowledge/cognitive/books.ts`: actual counts and page/hash backed passages |
| Point-in-time chart intelligence | `chart/analysis.ts`, `choice/dualResearch.ts` | `knowledge/cognitive/deepCycle.ts`: frozen inputs and advisory only |
| Consensus | `qci/coordinator.ts` | No replacement; future handoff requires QCI evidence |
| Strategies and real backtests | `lab/strategies.ts`, `lab/backtest.ts`, `knowledge/research.ts` | `knowledge/cognitive/genomes.ts`: 1,000 RESEARCH GENOMES and an evaluator-hook funnel |
| Outcome and calibration | `ditas/*` | Cognitive claims only reference existing evidence, never create PnL or probabilities |
| Orders, finance and position recovery | `risk/*`, `exec/*`, `portfolio/*` | Explicitly **not imported** by cognitive modules |

## Implemented

1. **Contracts** (`contracts.ts`): versioned role, skill, evidence, claim and genome types; `financialAuthority:false` and `executionAuthority:false`.
2. **Readiness** (`readiness.ts`): required observations need `verified:true`, non-future timestamps, source freshness, venue and supported timeframe. Stale REQUIRED sources block dispatch. Partial optional evidence degrades explanations.
3. **Worker/skill registry** (`registry.ts`): one role per existing worker, one 50-entry skill manifest. A placeholder remains BLOCKED, not READY by virtue of being listed.
4. **Book evidence** (`books.ts`): runs against existing `kb_documents`, `kb_catalog`, and `kb_chunks`. Only indexed passages with a genuine page reference and stored chunk hash become unverified retrieved claims. The configured target is 100; actual indexed count is measured from data. The 100 physical books have NOT been supplied or fully indexed as part of this PR.
5. **Contradictions** (`claims.ts`): ranks claims for retrieval with provenance-checked drift, reverses high trust when contradicted. Its weight is not a calibrated probability.
6. **Genome research** (`genomes.ts`): up to 1,000 deterministic configurations (10 family x 5 regime x 5 timeframe x 4 entry/exit variant). Candidate IDs and signatures are stable; duplicate and infeasible work rejects. Walk-forward and holdout hooks require actual independent evidence (data/holdout hash, sample count, cost/Sharpe/calibration/drift metrics) before classification as `OUT_OF_SAMPLE_VERIFIED`. No automatic PAPER/LIVE promotion.
7. **Cold lane** (`coldLane.ts`): bounded batch size, time budget, cancellation and continuation cursor; cooperative, not a hard CPU/container sandbox. Do not run expensive untrusted code on event loop threads.
8. **DEEP cycle** (`deepCycle.ts`): immutable point-in-time snapshot, source/role filtering, weighted book retrieval, optional critical specialist analysis, futures mark/index/funding/OI/depth/margin/liquidation requirements, cost-aware NO_TRADE, and context/audit with no financial authority. A caller-provided calibration claim is NOT sufficient for LIVE execution; the existing QCI and canonical Risk must independently validate.
9. **Existing API bridge**: `knowledge/brain.ts` reports cognitive registry metadata in `brainOverview`; `knowledge/memory.ts` reports real book inventory in existing `memoryOverview`. No new page or independent memory database.

## Why existing PDFs were adapted

- The supplied readiness draft allowed stale *required* sources to become `DEGRADED` and dispatchable. In the implementation they are `BLOCKED` for fail-closed analysis.
- The supplied SGE permitted a set of unverified metrics to qualify without a holdout data hash, window count or provenance. These are mandatory before research qualification. No result auto-promotes to the canonical strategy registry.
- The supplied DEEP orchestrator used agent confidence to derive a 'calibratedProbability'. Specialist scores are NOT calibrated forecast probabilities. Separate settled-forecast evidence is needed and the output is always non-executing.
- The proposed cold batch runner is cooperative. A timed-out synchronous CPU task cannot safely be preempted on the main thread; future heavy tasks must run in isolated workers with lease and cancellation fencing.
- The supplied static audit referenced hypothetical future broker classes that are absent from the actual repository. The current boundary test targets new cognitive modules and prohibits direct canonical financial-owner imports/calls without obstructing existing legitimate OMS callers.

## Validation

- New Vitest suites: `brainos7-cognitive.test.ts`, `brainos7-deep.test.ts` and `brainos7-authority.audit.test.ts`.
- Required CI: exact-head server/web typechecks, server/web Vitest, Playwright E2E, secret scan, npm audit and build; independent penetration and architectural review remain separate.
- No book ingestion is claimed without real uploaded source files. No strategy has been demonstrated to make money by generating 1,000 possibilities.

## Outstanding work / release blockers

1. **Real invocation**: a supervised warm/cold owner must call the cognitive research hook using canonical market snapshots and actual verified sources. This phase exposes contracts, source-aware retrieval, status and a testable orchestration function but does not yet activate an asynchronous autonomous DEEP trade planner in the live scheduler.
2. **Book verification**: ingest all 100 authorized sources, verify extracted content, pagination, OCR for unreadable scans, semantic retrieval quality, citations and contradictory claim reconciliation.
3. **Agent readiness**: audit exact canonical worker count and mappings, connect genuinely verified role evidence, and ensure redundant price workers do not count as independent trade confirmations.
4. **SGE backtest adapter**: create an isolated, budgeted wrapper around existing point-in-time backtesting and immutable `research_experiments`, using frozen datasets, purging/embargo and untouched holdout before any research promotion.
5. **DEEP futures**: verified venue-specific margin, hedge position mode, mark/index price, liquidation buffer, reduce-only exits, depth and fill reconciliation still missing. Keep NO_TRADE and LIVE locked.
6. **FAST memecoins**: certified Solana launch-event subscriptions, mint/holder authority checks, round-trip sell feasibility and live transaction confirmation missing.
7. **Operations**: multi-day paper soak, failover/fencing tests, monitoring, incident recovery, resource quotas, independent risk review and deployment checks required.
8. **PR readiness**: PR #135 is stacked on an unfinished dependency branch. Do not merge just because unit tests pass.

## Acceptance principle

More agents, skills and generated hypotheses do not inherently improve predictions or guarantee profits. Compare out-of-sample calibration, net post-cost expectancy, drawdown, opportunity abstention, reproducibility and reliability to a frozen baseline. The owner retains emergency stop, risk limits, account authorization, and release control.
