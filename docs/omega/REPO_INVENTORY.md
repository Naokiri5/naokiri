# REPO_INVENTORY — Omega TASK-00 (2026-11-19)

## Baseline
- `main`: `2627cd276d2108c15a47ba41d60cdb54fddf10ff`. This is the SHA the spec examined, and it is still current.
- **Combined branch:** `claude/mia-unified-01` (PR #45, open, not merged). It contains all 13 independent lines of open work, i.e. every open PR except the superseded #20 and the duplicate #42, which were closed.
- **This work:** `claude/mia-omega-01-solana-hunter`, stacked on #45, as the owner chose.
- **Runtime:** Node 22 LTS (≥22.16) or ≥24, npm workspaces, Fastify 5, zod 4, `node:sqlite` (WAL), React 19 + Vite, Vitest, Playwright.

## Spec path corrections
The spec lists document paths from before the repository was reorganized. All the documents still exist:

| Spec path | Actual path |
|---|---|
| `docs/REQUIREMENTS_TRACEABILITY.md` | `docs/planning/REQUIREMENTS_TRACEABILITY.md` |
| `docs/PROJECT_STATUS.md` | `docs/history/PROJECT_STATUS.md` |
| `docs/KNOWN_LIMITATIONS.md` | `docs/history/KNOWN_LIMITATIONS.md` |
| `docs/QHEF_LATENCY_BASELINE.md` | `docs/operations/QHEF_LATENCY_BASELINE.md` |
| `docs/CLAUDE_CODE_WORKFLOW.md` | `docs/engineering/CLAUDE_CODE_WORKFLOW.md` |
| `docs/REFACTORING_BACKLOG.md` | `docs/planning/REFACTORING_BACKLOG.md` |
| `docs/DEPLOYMENT_GUIDE.md` | `docs/operations/DEPLOYMENT_GUIDE.md` |

## Modules Omega builds on (verified with `git cat-file -e origin/main:<path>`)

| Area | Path | On `main` | In #45 |
|---|---|---|---|
| DEX Screener adapter | `server/src/providers/dexscreener.ts` | yes | yes |
| Discovery | `server/src/market/discover.ts` | yes, unchanged in #45 | yes (+ Solana watchlist in this PR) |
| DEX safety (`eligibleForAutomation: false`) | `server/src/safety/safety.ts` | yes | yes |
| Pending providers (`solana_rpc`, live venue) | `server/src/providers/pending.ts` | yes | yes |
| Paper OMS, risk gate, incidents | `server/src/exec/{oms,incidents}.ts`, `server/src/risk/gate.ts` | yes | yes (with combined rechecks under the lock) |
| Mode and live lock (`LIVE_EXECUTION_AVAILABLE=false`) | `server/src/core/mode.ts` | yes | yes |
| Latency ring buffers and QHEF | `server/src/core/latency.ts`, `server/src/qhef/qhef.ts` | yes | yes |
| Engine lease | `server/src/ops/lease.ts` | yes, without write fence | yes, with `withWriteFence`/`assertWriteFence` |
| WebSocket depth books | `server/src/market/depthStream.ts` | no | yes (#18) |
| NEXUS fabric contracts and outbox | `server/src/fabric/*` | no | yes (#41/#43) |
| Trader Joe Live projection | `server/src/joe/live/*` | no | yes (#44) |
| No-trade board | `server/src/decision/noTrade.ts` | no | yes (#15) |
| THINK certificate and replay | `server/src/decision/certificate.ts`, `server/src/ditas/replay.ts` | no | yes (#33–#37) |
| systemd unit | `deploy/mia.service` | no | yes (#18) |
| TITAN HUNTER ranker | `server/src/hunt/ranker.ts` | no | yes (#19) |
| Solana Hunter (starter) | `server/src/solana/*` | no | **this PR** |

Nothing for Pump.fun, PumpSwap, Raydium, Orca, Jupiter, Solana RPC streaming or GMGN existed anywhere in the repository before this PR. No Codex branch touched Solana either, so there is no duplicate work.
