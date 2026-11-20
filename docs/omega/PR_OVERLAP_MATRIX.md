# PR_OVERLAP_MATRIX — Omega TASK-00 (2026-11-19)

**Open-PR picture.** All open work is combined in **#45** (`claude/mia-unified-01` → `main`, not merged). The PRs below stay open as history.
- #20 was closed as superseded: Codex's #22 rebuilt the Telegram hub as migration v8.
- #42 was closed as a duplicate of #41/#43.

| Spec-named PR | What it is | Where it is now | Omega relevance |
|---|---|---|---|
| #18 | Safety features, WebSocket local books, repairs | In #45 | Requirement 001 (validated WS books). Omega PR-02 "streaming consolidation" is effectively this. |
| #19 | TITAN HUNTER read-only 1,000-token screening | In #45 | The starter's SKILL rule 1 says not to duplicate it. The Solana watchlist reuses the DEX Screener cache, not the hunter's ingestion. |
| #23 | Codex Telegram integration (→ main) | In #45 via #22/#24/#25 | None directly |
| #26 | Codex chart intelligence, coverage, SEC, paper stress | In #45 (with #27) | UI/chart requirements 087 and 089 |
| #35 | THINK decision replay | In #45 (THINK 1–5) | Requirements 084 and 098 (evidence replay) |
| #41 / #42 | NEXUS N1 event contracts | In #45 (#42 closed) | Omega PR-04 durable event contracts |
| #43 | NEXUS N2 transactional outbox (DITAS outcomes only) | In #45 | PR-04. Order/fill events are not yet durable. |
| #44 | Trader Joe Live read-only story feed | In #45 | Requirements 081–083; Omega PR-12 must reuse it |

## Migration ownership (append-only, single sequence)

| Version | Owner | Content |
|---|---|---|
| v1–v5 | `main` | Base schema … engine lease |
| v6–v7 | #18 | Safety tables, hot-filter indexes |
| v8–v9 | Codex #22/#25 | Telegram tables and account replies |
| v10 | NEXUS N2 (#43) | `fabric_outbox`, `fabric_inbox` |
| v11+ | **next Omega PR that needs schema** | Must append after v10 on top of #45. Never reuse a number. |

PR-01 adds **no migration**.

## Single-owner files (spec §11.3): no parallel edits
`server/src/exec/oms.ts`, `server/src/risk/gate.ts`, `server/src/market/scanner.ts`, `server/src/db/migrations.ts`, `server/src/api/routes.ts`, `server/src/portfolio/ledger.ts`.
- **PR-01** touched none of them except reading the existing `/api/discover` route (unchanged).
- **Changed by PR-01:** `server/src/market/discover.ts` (additive `solanaHunter` block plus a `nowMs` parameter) and `web/src/pages/Phase1.tsx` (one tab).
