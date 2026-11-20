# MIA documentation

MIA is a **paper-trading only** market-intelligence app. Real-money execution, signing and withdrawals are locked in this build. This page is the map to every document, grouped by what you want to do.

## Start here
| Document | Read it to… |
|---|---|
| [`../README.md`](../README.md) | install, start the app, run the tests |
| [`operations/SETUP_GUIDE_BEGINNER.md`](operations/SETUP_GUIDE_BEGINNER.md) | set up MIA step by step |
| [`operations/TAILSCALE_FUNNEL.md`](operations/TAILSCALE_FUNNEL.md) | give MIA a free HTTPS address (e.g. for your phone or Privy) with Tailscale Funnel |
| [`operations/PRIVY_SIGN_IN.md`](operations/PRIVY_SIGN_IN.md) | turn on Privy sign-in for the owner (wallet actions stay locked) |
| [`research/INTEGRATIONS_OVERVIEW.md`](research/INTEGRATIONS_OVERVIEW.md) | see every integration (Privy, CCXT, Vike, DefiLlama, Aave, NautilusTrader, Freqtrade), its status, settings, owner actions and what stays locked |
| [`research/PYTHON_RESEARCH_LABS.md`](research/PYTHON_RESEARCH_LABS.md) | set up the isolated NautilusTrader and Freqtrade research labs (dry-run/simulated only) |
| [`research/DEFI_RESEARCH.md`](research/DEFI_RESEARCH.md) | read DefiLlama yields/TVL and Aave V3 flash-loan facts (read-only, never executable) |
| [`research/CCXT_RESEARCH.md`](research/CCXT_RESEARCH.md) | use CCXT for read-only exchange research (keyless, GET-only, optional sandbox) |
| [`research/PREDICTION_MARKETS.md`](research/PREDICTION_MARKETS.md) | Polymarket/Kalshi research: books, arbitrage checks, reward estimates, replay; what was reused from the uploaded bots and what was not |
| [`research/VIKE_INTEGRATION.md`](research/VIKE_INTEGRATION.md) | turn on Vike on-chain research (research only) and see how Live stays locked |
| [`engineering/MIA_FINAL_ENGINEERING_ASSESSMENT.md`](engineering/MIA_FINAL_ENGINEERING_ASSESSMENT.md) | see the **current** engineering verdict, final test evidence and blockers (100-agent audit, 2026-11-18); details in `MIA_ERROR_REGISTER.md` and `MIA_MASTER_REPAIR_TRACKER.md` |
| [`engineering/DEBUG_AUDIT_2026-11-17.md`](engineering/DEBUG_AUDIT_2026-11-17.md) | see the **current** bug register, test results, performance baseline and go/no-go |
| [`engineering/MIA_QUANT_VALIDATION.md`](engineering/MIA_QUANT_VALIDATION.md) | **Canonical quantitative-intelligence master:** merged owner 100-feature blueprint, the existing verified validation report, branch-aware reconciliation, shared PAPER/LIVE rules and acceptance gates |
| [`engineering/MIA_QUANT_FEATURE_CATALOG_100.json`](engineering/MIA_QUANT_FEATURE_CATALOG_100.json) | Machine-readable MIA-Q001…MIA-Q100 catalog with original requirements preserved and incremental code/PR evidence; task agents read only relevant IDs |
| [`engineering/BLUEPRINT_STATUS.md`](engineering/BLUEPRINT_STATUS.md) | see where each item of the architecture blueprint stands, with test evidence |
| [`engineering/AUTOPILOT_100_INVENTORY.md`](engineering/AUTOPILOT_100_INVENTORY.md) | see what each of the 100 autopilot upgrades has: done, partial, missing or locked |
| [`CHANGELOG.md`](CHANGELOG.md) | see what changed, newest first |

## Run and operate
| Document | Contents |
|---|---|
| [`operations/DEPLOYMENT_GUIDE.md`](operations/DEPLOYMENT_GUIDE.md) | always-on operation: supervisor, systemd, readiness, backups and restore, incidents |
| [`operations/QHEF_LATENCY_BASELINE.md`](operations/QHEF_LATENCY_BASELINE.md) | measured per-stage latency targets |
| [`engineering/PHASE1_SOAK.md`](engineering/PHASE1_SOAK.md) | headless soak record (crash, restart, standby, handover) |
| [`API_INTEGRATIONS.md`](API_INTEGRATIONS.md) | market-data providers, licences and which need credentials |

## Security and trading safety
| Document | Contents |
|---|---|
| [`SECURITY.md`](SECURITY.md) | security register (SEC-01 … SEC-14) and controls |
| [`architecture/MIA_NEXUS_CURRENT_VS_TARGET.md`](architecture/MIA_NEXUS_CURRENT_VS_TARGET.md) | MIA NEXUS N0 audit: baseline, open-PR graph, single-authority matrix, gaps and phase order |
| [`architecture/MIA_NEXUS_EVENT_CATALOG.md`](architecture/MIA_NEXUS_EVENT_CATALOG.md) | MIA NEXUS fabric topics: owners, priority, durability and honest status (generated from code) |
| [`architecture/MIA_NEXUS_DURABLE_LOG.md`](architecture/MIA_NEXUS_DURABLE_LOG.md) | MIA NEXUS N2: transactional outbox, inbox dedup, relay retry and dead letters (one research topic) |
| [`architecture/TRADER_JOE_LIVE.md`](architecture/TRADER_JOE_LIVE.md) | Trader Joe Live (V4): read-only trade-lifecycle story feed for Joe; milestones, sources of truth, limits |
| [`security/GUARDIAN_SHIELD.md`](security/GUARDIAN_SHIELD.md) | Guardian Shield: seven-layer posture, security events, opt-in pause, 100-ticket gap matrix and incident runbooks |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | design, trust boundaries, technology choices |

## Features
| Folder | Contents |
|---|---|
| [`academy/`](academy/) | Quant Academy: document library, retrieval, research lab (evidence only, no trading authority) |
| [`chart-intelligence/`](chart-intelligence/) | chart evidence, blind replay, test report and implementation status |
| [`ditas/`](ditas/) | decision memory, Decision Twin, calibration, execution quality |

## Engineering
| Document | Contents |
|---|---|
| [`engineering/CLAUDE_CODE_WORKFLOW.md`](engineering/CLAUDE_CODE_WORKFLOW.md) | AI-assisted development: agents, skills, review workflow |
| [`engineering/audit-files.json`](engineering/audit-files.json) | machine-readable list of every tracked file and its review status (`node scripts/audit-inventory.mjs`) |
| [`engineering/IMPLEMENTATION_INVENTORY.md`](engineering/IMPLEMENTATION_INVENTORY.md), [`engineering/REQUIREMENTS_TRACEABILITY.csv`](engineering/REQUIREMENTS_TRACEABILITY.csv) | spec-to-code inventory |
| [`engineering/NAVIGATION_PR_A.md`](engineering/NAVIGATION_PR_A.md), [`engineering/DASHBOARD_RUNTIME_VERIFICATION.md`](engineering/DASHBOARD_RUNTIME_VERIFICATION.md) | UI change records and runtime verification |

## Planning
| Document | Contents |
|---|---|
| [`planning/IMPLEMENTATION_ROADMAP.md`](planning/IMPLEMENTATION_ROADMAP.md) | phases and prioritized backlog |
| [`planning/REQUIREMENTS_TRACEABILITY.md`](planning/REQUIREMENTS_TRACEABILITY.md) | spec Parts 1–33 → code → status |
| [`planning/REFACTORING_BACKLOG.md`](planning/REFACTORING_BACKLOG.md) | evidence-based code-organization plan |

## History (dated, not re-verified)
These reports describe earlier phases. They are kept for the record and point to the current documents above.
- [`history/PROJECT_STATUS.md`](history/PROJECT_STATUS.md)
- [`history/KNOWN_LIMITATIONS.md`](history/KNOWN_LIMITATIONS.md)
- [`history/TEST_REPORT.md`](history/TEST_REPORT.md)

## Code layout (where things live)
| Path | What it is |
|---|---|
| `server/src/` | Fastify API and engine, one folder per area: `market`, `features`, `workers`, `qci`, `decision`, `risk`, `exec` (paper OMS), `portfolio`, `ditas`, `knowledge`, `ops` (lease, readiness, backups), `bot`, `api` … |
| `server/test/` | Vitest unit and integration tests (offline, deterministic) |
| `server/scripts/` | launcher (`run.mjs`), supervisor, QA run with recorded outcome (`qa.mjs`) |
| `web/src/` | React client: `api.ts` (requests, SSE, `useApi`), `ui.tsx` (shared components), `pages/` (screens) |
| `e2e/` | Playwright browser tests against an offline server |
| `scripts/` | repo tools: secret scan, inventory, chart benchmark, load baseline |
| `deploy/` | systemd unit for always-on PAPER operation |
