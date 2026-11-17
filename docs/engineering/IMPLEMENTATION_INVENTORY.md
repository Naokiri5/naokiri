# MIA 4.2 — Implementation Inventory (Phase 0)

**Proposal document.** It awaits owner approval. It records what exists and what is proposed; it does not authorize
changes.

| | |
|---|---|
| Audited branch | `claude/blissful-planck-lazglg` (PR #7). Built on PR #7 head `c8747dc`, plus the PR #8 cherry-pick and this phase. |
| Machine-readable inventory | [`inventory.json`](inventory.json). Regenerate with `node scripts/inventory.mjs > docs/engineering/inventory.json`. |
| Requirements | [`REQUIREMENTS_TRACEABILITY.csv`](REQUIREMENTS_TRACEABILITY.csv): 40 rows, using only the allowed statuses |
| Source specifications | MIA 4.1 Parts 1–33 (spec SHA-256 prefix `e2a0a376e37aa47f`, available and byte-identical across uploads); MIA 4.2 Claude+Codex handoff; Academy directive |

## 1. Branch reconciliation

| Branch / PR | Relationship | Action taken |
|---|---|---|
| `main` | Production baseline | Untouched |
| PRs #3, #4, #5, #6 | Already merged into PR #7 with merge commits | No action |
| PR #7 `claude/blissful-planck-lazglg` | Candidate integration baseline. Unmerged; it needs owner approval. | Development continues here |
| PR #8 `feat/ditas-portfolio-execution` (`7ca3328`) | Stacked on PR #6. The base of PR #6 (`1929d8f`) is an ancestor of PR #7, so the commit applies cleanly. | Cherry-picked with `-x` (author kept). Its 4 files did not exist on PR #7, so nothing duplicated or conflicted. Its 2 tests pass. PR #8 can be closed once PR #7 is approved. |

## 2. Ownership map (one authority per concern)

| Concern | Single owner | Notes |
|---|---|---|
| Scanner and instrument registry | `server/src/market/` | — |
| Indicator engine | `server/src/features/indicators.ts` | `workers/indicators.ts` only maps snapshots |
| Workers, runtime and QCI evidence | `server/src/workers/`, `server/src/qci/` | `workers/effectiveness.ts` is new; it is read-only accounting |
| Decision authority | `server/src/decision/` | `knowledge.refs` is explanatory only |
| Risk authority | `server/src/risk/gate.ts` | New deny code: `PROTECTION_INCIDENT_OPEN` |
| Paper OMS and accounting | `server/src/exec/oms.ts`, `server/src/portfolio/ledger.ts` | `exec/incidents.ts` is new; it records incidents and never fills |
| Knowledge | `server/src/knowledge/` | Evidence only |
| DITAS, chart, Trader Joe | `server/src/ditas/`, `chart/`, `joe/` | Evidence and explanation; no order authority |

A code search (`grep` for `INSERT`/`UPDATE` statements) shows that only `exec/oms.ts` and `portfolio/ledger.ts` write
`orders`, `fills`, `positions` or `ledger_entries`. DITAS twin results are stored separately, in `ditas_twin_runs`.

## 3. Duplication report (function level)

| Candidate | Evidence | Verdict | Action |
|---|---|---|---|
| SHA-256 hex helpers | `core/util.ts:sha256`, `knowledge/research.ts:sha`, `knowledge/store.ts:sha` | **Exact duplicate**: same algorithm, same encoding | Fixed. Both now use `core/util.ts:sha256`, which was widened to accept a Buffer. |
| LCG random generators | `lab/backtest.ts` (float multiply), `knowledge/research.ts:rng` (`Math.imul`, uint32) | **Not a duplicate.** The float version loses precision past 2^53, so the sequences differ. Merging would change existing backtest results. | Keep both. Recorded here. |
| FTS query builders | `knowledge/search.ts:ftsQuery` (free text → quoted terms), `knowledge/concepts.ts:ftsQuery` (keyword phrases → quoted phrases) | **Different semantics** (phrase versus term) | Keep both |
| Chart prefix replay, strategy backtest, research walk-forward | `chart/replay.ts`, `lab/backtest.ts`, `knowledge/research.ts` | Different purposes. Research reuses `backtest()`; it does not re-implement it. | Keep. Full-pipeline replay (R-28) must reuse these and must not become a second trading engine. |
| Breadth calculation | `market/bubbles.ts` (Bubble Map) and the new breadth worker | Same logic | Extracted to `marketBreadth()` and shared by both |

## 4. Issues found (severity · root cause · reproduction)

| # | Severity | Issue | Root cause | Reproduction / test | Status |
|---|---|---|---|---|---|
| 1 | High | A future-dated quote could anchor an exit and could make a position report as "protected" | The age check covered stale quotes only | `repair.test.ts` R-PR7 | Fixed |
| 2 | High | Two targets hit in one pass could each fill against the same book depth | `applyExit` walks the same snapshot for each fill | `repair.test.ts` "combined book depth". It fails without the fix (verified). | Fixed |
| 3 | High | "Protected" was reported even when the book could not absorb the stop | Reconciliation checked the stop and ticker but not depth | `repair.test.ts` | Fixed |
| 4 | Medium | Nested transactions break on Node 22.13–22.15 | Relied on `DatabaseSync.isTransaction` (added in 22.16) | `repair.test.ts` nested tx | Fixed |
| 5 | Medium | An unexitable position produced an in-memory alert only. Its 10-minute repeat timer reset on restart, nothing persisted, and nothing stopped new entries on the instrument. | No durable incident model | `incidents.test.ts` (7 cases, including restart) | Fixed: migration v4 |
| 6 | Medium | The Market breadth worker always abstained even though the data existed | Not implemented | `workers-effectiveness.test.ts` | Fixed |
| 7 | Medium | Registered worker count presented as if all workers were productive | No capability or productivity accounting | `workers-effectiveness.test.ts` | Fixed (reporting). R-12 is open for a QCI policy decision. |
| 8 | Medium | Tiny take-profit slice below one lot is marked done without a sale | `stepExit` marks done before lot rounding | R-19 | Open: needs backtester parity tests |
| 9 | Medium | No automatic recovery after more than 400 missed candles | Fetch window is fixed | R-20 | Open (it fails closed) |
| 10 | Medium | DITAS cohort can mix forecasts with different remaining horizons | Cohort key lacks a horizon bucket | R-37 | Open |
| 11 | Security | First-run setup open in containers or behind a local proxy | Container exemption; no `trustProxy` | R-35 | **Owner decision** |
| 12 | Security | Unauthenticated users can trigger a 15-minute lockout that also blocks step-up | One global failure gate | R-36 | **Owner decision** |

## 5. Database and compatibility

- Migration **v4** adds `protection_incidents`, with a partial unique index that allows only one active incident per
  position. It is append-only; no existing table changes.
- Rollback: older builds ignore the table.
- New API routes:
  - `GET /api/risk/incidents`
  - `POST /api/risk/incidents/:id/ack` (owner session plus CSRF; a note is required)
  - `GET /api/ditas/execution` (from PR #8)
- New response fields:
  - `GET /api/risk` gains `incidents`.
  - `GET /api/intelligence` gains `effectiveness` and a per-worker `capability`.
  - Existing fields are unchanged.
- A behavioural change for review: the risk gate now denies new entries on an instrument while an incident is OPEN. It
  can only deny more often, never approve more often.
- Worker change: Market breadth is now version 1.1.0 and votes when there is enough fresh breadth data. This adds one
  data-driven vote to the regime domain.

## 6. Verification (commands run locally on this branch)

See the PR description for the exact counts at push time. The commands are:
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run test:e2e`
- `npm run scan:secrets`
- `npm audit --audit-level=high`

The 2 opt-in live-provider tests stay skipped offline. No live order was placed or possible.

## 7. Not done in this phase (next phases)

- **P1** full-pipeline replay with a virtual clock (R-28).
- **P1** worker-outcome linkage and calibration on a holdout (R-14).
- QCI treatment of constant-rule votes (R-12). This needs a trading-risk review.
- **P2:**
  - semantic embeddings, after a benchmark (R-30)
  - a benchmark of where original documents are stored (R-31)
  - a 15-role QA registry (R-38)
  - backup and restore drills (R-39)
- Security decisions R-35 and R-36 are the owner's to make.
