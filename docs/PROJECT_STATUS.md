# Project Status

**Last updated:** 2026-11-16 — **Phase 1 (foundation hardening) complete. Waiting for your approval to start Phase 2.**

## In one paragraph
MIA 4.1 already runs. It watches live crypto markets, analyses them with 100 rule-based "workers" and 50 indicator
specialists, combines their opinions (QCI), checks every idea with a strict risk engine, and can **paper trade** (simulated
money, real live prices). Real-money trading is switched off and cannot be switched on. About a third of the
specification is fully done, half is partly done, and the rest is either quick to add or waiting on accounts and keys
that only you can provide.

## Where things are
| Item | Value |
|---|---|
| GitHub repository | `Naokiri5/naokiri` (read and write access verified) |
| Default branch | `main` (contains everything so far; PR #1 merged) |
| Development branch | `claude/blissful-planck-lazglg` (restarted from `main` after the merge) |
| Phase 0 changes | Documentation only; committed and pushed |
| Phase 1 changes | Code + tests + CI; committed, pushed, and opened as a pull request for your review |
| How to open the app | `npm install` then `npm start`, then http://localhost:8787/ (see `SETUP_GUIDE_BEGINNER.md`) |

## Phase 0 deliverables
| Deliverable | File |
|---|---|
| Architecture report + technology assessment | `ARCHITECTURE.md` |
| Requirements traceability (Parts 1–33) + feature, missing and mocked inventories | `REQUIREMENTS_TRACEABILITY.md` |
| Dependency inventory | `ARCHITECTURE.md` § Dependencies |
| Security audit | `SECURITY.md` |
| Roadmap + prioritized backlog | `IMPLEMENTATION_ROADMAP.md` |
| Test evidence | `TEST_REPORT.md` |
| Integrations & what needs credentials | `API_INTEGRATIONS.md` |
| Limitations | `KNOWN_LIMITATIONS.md` |
| Setup for beginners | `SETUP_GUIDE_BEGINNER.md` |
| Deployment & operations | `DEPLOYMENT_GUIDE.md` |
| History | `CHANGELOG.md` |

## Requirement status (74 rows)
| | IMPLEMENTED | PARTIAL | MISSING | BLOCKED | MOCKED |
|---|---|---|---|---|---|
| After Phase 0 | 27 | 34 | 4 | 9 | 0 |
| After Phase 1 | 28 | 33 | 4 | 9 | 0 |

## Phase 1: what was built
| Item | Result |
|---|---|
| Security fix SEC-01 (high) | `@fastify/static` 8 → 10.1.11; `npm audit`: **0 vulnerabilities**; path-traversal tests added |
| Automatic checks on GitHub (CI) | every push/PR runs: secret scan, dependency audit, typecheck, 54 tests, 32 browser checks |
| Browser test suite in the repo | `e2e/app.spec.ts`: setup → risk policy → funding → paper mode → all 25 pages → palette → CSV → mobile |
| New pages | Asset Discovery, QHEF Performance, Security Center, Copy Trading (honest "needs connection" state), Trading History (filters + CSV export) |
| Command palette | Ctrl/⌘+K: jump to any page, open any asset, run risk-*reducing* actions |
| Request tracing | every response has an `x-request-id` that matches the server log |
| Bugs found & fixed during testing | Market Terminal crashed when market data wasn't loaded yet; CSV export didn't neutralise spreadsheet formulas in quoted cells; event-loop metric included its own sampling interval |

## What needs you (none of this is urgent for Phase 1)
| Need | Unlocks | When |
|---|---|---|
| Review & merge the Phase 1 pull request | puts Phase 1 on `main` | now |
| Approve Phase 2 | live streaming, derivatives data, provider failover | now |
| Approve 3 extra network hosts (Binance streams + futures data) | live streaming, derivatives | Phase 2 |
| Anthropic API key (entered through the secure form, not chat) | conversational Trader Joe | any time |
| Market-data key for stocks/commodities (e.g. Alpaca, free tier) | stocks scanner | Phase 2 |
| On-chain data key (e.g. Alchemy / Helius) | honeypot checks, whale wallets, copy trading, holder map | Phase 2–4 |
| Telegram bot token | phone alerts | any time |
| Hosting account | always-on app + 30-day paper evaluation | Phase 8 |

## Tests at this point
54 automated tests + 32 browser checks pass (browser suite run 3× in a row to rule out flakiness); live checks of the new pages
against real market data passed with 0 browser errors. See `TEST_REPORT.md`.
