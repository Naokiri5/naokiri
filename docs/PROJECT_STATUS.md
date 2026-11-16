# Project Status

**Last updated:** 2026-11-16 — **Phase 0 (audit) complete, waiting for your approval to start Phase 1.**

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
| Phase 0 changes | Documentation only; committed and pushed to the development branch |
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

## Audit result (74 requirement rows)
| IMPLEMENTED | PARTIAL | MISSING | BLOCKED | MOCKED |
|---|---|---|---|---|
| 27 | 34 | 4 | 9 | 0 |

## What needs you (none of this is urgent for Phase 1)
| Need | Unlocks | When |
|---|---|---|
| Approve Phase 1 | Hardening, CI, missing pages | now |
| Approve 3 extra network hosts (Binance streams + futures data) | live streaming, derivatives | Phase 2 |
| Anthropic API key (entered through the secure form, not chat) | conversational Trader Joe | any time |
| Market-data key for stocks/commodities (e.g. Alpaca, free tier) | stocks scanner | Phase 2 |
| On-chain data key (e.g. Alchemy / Helius) | honeypot checks, whale wallets, copy trading, holder map | Phase 2–4 |
| Telegram bot token | phone alerts | any time |
| Hosting account | always-on app + 30-day paper evaluation | Phase 8 |

## Tests at this point
43 automated tests pass, plus live-provider and browser checks. See `TEST_REPORT.md`.
