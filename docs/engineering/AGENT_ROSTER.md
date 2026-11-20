# MIA engineering academy — 100 specialist-role registry

**Source of role names:** Owner's MIA 4.2 Super Engineering Master Directive, section 4. This is the implementation roster for the existing directive, not a new bot network.

**Status:** Logical development-role assignments only. These are NOT 100 running LLMs, certified human reviewers, or 100 market workers. The separate 100 trading-specialist workers remain in `server/src/workers/`.

## Coordination and scope
- Operate 6–12 task-specific engineering agent sessions at a time only when work is independent and the execution environment supports them; do not assert they ran without evidence.
- One person/agent owns a given file for each work package. Each squad lead owns integration coordination, not a new production service.
- All changes are assigned to the owning existing MIA module. No additional scanner, event bus, worker registry, decision authority, risk gate, ledger, OMS, wallet signer, or application shell.
- Retain repository `.claude/agents/`, `.claude/rules/`, and `.claude/skills/` as the canonical executable agent configuration. Role registry does not instantiate agents on its own.
- All tasks require exact commit SHA, changed-file map, prior-art/PR overlap, acceptance tests, security review, CI evidence, and a draft PR.
- Never enable trading permissions, transfer funds, accept keys in prompts, or modify live limits on the strength of a role definition.

| ID | Specialist role | Squad |
|---:|---|---|
| 001 | Chief architecture specialist | Architecture |
| 002 | Requirements analyst | Architecture |
| 003 | Domain architecture specialist | Architecture |
| 004 | Integration architect | Architecture |
| 005 | API contract specialist | Architecture |
| 006 | Data architecture specialist | Architecture |
| 007 | Dependency analyst | Architecture |
| 008 | Migration architect | Architecture |
| 009 | Architecture decision-record specialist | Architecture |
| 010 | Technical project manager | Architecture |
| 011 | TypeScript specialist | Backend |
| 012 | Fastify specialist | Backend |
| 013 | Database specialist | Backend |
| 014 | Database migration specialist | Backend |
| 015 | API engineering specialist | Backend |
| 016 | Authentication specialist | Backend |
| 017 | Background-job specialist | Backend |
| 018 | Event-bus specialist | Backend |
| 019 | Caching specialist | Backend |
| 020 | Backend observability specialist | Backend |
| 021 | Exchange API specialist | Market Data |
| 022 | WebSocket specialist | Market Data |
| 023 | Crypto data specialist | Market Data |
| 024 | Solana specialist | Market Data |
| 025 | EVM specialist | Market Data |
| 026 | Equities and ETF specialist | Market Data |
| 027 | Futures specialist | Market Data |
| 028 | Forex and commodities specialist | Market Data |
| 029 | Instrument normalization specialist | Market Data |
| 030 | Market data quality specialist | Market Data |
| 031 | Market microstructure specialist | Quantitative Research |
| 032 | Technical analysis specialist | Quantitative Research |
| 033 | Statistics specialist | Quantitative Research |
| 034 | Econometrics specialist | Quantitative Research |
| 035 | Backtesting specialist | Quantitative Research |
| 036 | Walk-forward validation specialist | Quantitative Research |
| 037 | Portfolio optimization specialist | Quantitative Research |
| 038 | Execution-cost specialist | Quantitative Research |
| 039 | Forecasting specialist | Quantitative Research |
| 040 | Strategy research specialist | Quantitative Research |
| 041 | Worker registry specialist | QCI and Workers |
| 042 | Task scheduling specialist | QCI and Workers |
| 043 | Candidate task-graph specialist | QCI and Workers |
| 044 | Evidence schema specialist | QCI and Workers |
| 045 | Evidence signature specialist | QCI and Workers |
| 046 | Dependency diversity specialist | QCI and Workers |
| 047 | Adversarial challenge specialist | QCI and Workers |
| 048 | Consensus specialist | QCI and Workers |
| 049 | Outcome calibration specialist | QCI and Workers |
| 050 | Worker health specialist | QCI and Workers |
| 051 | Document ingestion specialist | Knowledge and AI |
| 052 | PDF and OCR specialist | Knowledge and AI |
| 053 | EPUB processing specialist | Knowledge and AI |
| 054 | Metadata and copyright specialist | Knowledge and AI |
| 055 | Semantic chunking specialist | Knowledge and AI |
| 056 | Embedding specialist | Knowledge and AI |
| 057 | Retrieval specialist | Knowledge and AI |
| 058 | Knowledge taxonomy specialist | Knowledge and AI |
| 059 | Prompt-injection defense specialist | Knowledge and AI |
| 060 | LLM integration specialist | Knowledge and AI |
| 061 | Risk policy specialist | Risk and Security |
| 062 | Position sizing specialist | Risk and Security |
| 063 | Order-management specialist | Risk and Security |
| 064 | Idempotency specialist | Risk and Security |
| 065 | Reconciliation specialist | Risk and Security |
| 066 | Signer isolation specialist | Risk and Security |
| 067 | Permission control specialist | Risk and Security |
| 068 | Kill-switch specialist | Risk and Security |
| 069 | Threat modeling specialist | Risk and Security |
| 070 | Secrets management specialist | Risk and Security |
| 071 | React specialist | Frontend |
| 072 | Design-system specialist | Frontend |
| 073 | Dashboard specialist | Frontend |
| 074 | Chart visualization specialist | Frontend |
| 075 | Knowledge Academy interface specialist | Frontend |
| 076 | Operator controls specialist | Frontend |
| 077 | Accessibility specialist | Frontend |
| 078 | Responsive UI specialist | Frontend |
| 079 | API client specialist | Frontend |
| 080 | Browser testing specialist | Frontend |
| 081 | Build engineering specialist | Infrastructure |
| 082 | CI specialist | Infrastructure |
| 083 | Container specialist | Infrastructure |
| 084 | Backup and recovery specialist | Infrastructure |
| 085 | Metrics specialist | Infrastructure |
| 086 | Logging specialist | Infrastructure |
| 087 | Distributed tracing specialist | Infrastructure |
| 088 | Load testing specialist | Infrastructure |
| 089 | Chaos testing specialist | Infrastructure |
| 090 | Incident response specialist | Infrastructure |
| 091 | Unit testing specialist | QA and Release |
| 092 | Integration testing specialist | QA and Release |
| 093 | End-to-end testing specialist | QA and Release |
| 094 | Property-based testing specialist | QA and Release |
| 095 | Quantitative validation specialist | QA and Release |
| 096 | Security testing specialist | QA and Release |
| 097 | Performance regression specialist | QA and Release |
| 098 | Provider contract testing specialist | QA and Release |
| 099 | Release-gate auditor | QA and Release |
| 100 | Independent code reviewer | QA and Release |

## Squad ownership and deliverables

### Squad 1: Architecture
**Owner scope:** `docs/engineering, CLAUDE.md, API contracts, architecture decisions`.
**Deliverable:** Scope-restricted code/design review, testable PR-sized implementation contract, required regression tests and proof of no duplicate authority.
**Escalation:** Raise any cross-squad change affecting decision, risk, OMS, financial ledger, signing or migrations to the chief architecture specialist and the independent release auditor.

### Squad 2: Backend
**Owner scope:** `server/src/api, db, core, bot`.
**Deliverable:** Scope-restricted code/design review, testable PR-sized implementation contract, required regression tests and proof of no duplicate authority.
**Escalation:** Raise any cross-squad change affecting decision, risk, OMS, financial ledger, signing or migrations to the chief architecture specialist and the independent release auditor.

### Squad 3: Market Data
**Owner scope:** `server/src/providers, market, safety`.
**Deliverable:** Scope-restricted code/design review, testable PR-sized implementation contract, required regression tests and proof of no duplicate authority.
**Escalation:** Raise any cross-squad change affecting decision, risk, OMS, financial ledger, signing or migrations to the chief architecture specialist and the independent release auditor.

### Squad 4: Quantitative Research
**Owner scope:** `server/src/lab, features, portfolio`.
**Deliverable:** Scope-restricted code/design review, testable PR-sized implementation contract, required regression tests and proof of no duplicate authority.
**Escalation:** Raise any cross-squad change affecting decision, risk, OMS, financial ledger, signing or migrations to the chief architecture specialist and the independent release auditor.

### Squad 5: QCI and Workers
**Owner scope:** `server/src/workers, qci, decision evidence`.
**Deliverable:** Scope-restricted code/design review, testable PR-sized implementation contract, required regression tests and proof of no duplicate authority.
**Escalation:** Raise any cross-squad change affecting decision, risk, OMS, financial ledger, signing or migrations to the chief architecture specialist and the independent release auditor.

### Squad 6: Knowledge and AI
**Owner scope:** `server/src/knowledge, joe, academy`.
**Deliverable:** Scope-restricted code/design review, testable PR-sized implementation contract, required regression tests and proof of no duplicate authority.
**Escalation:** Raise any cross-squad change affecting decision, risk, OMS, financial ledger, signing or migrations to the chief architecture specialist and the independent release auditor.

### Squad 7: Risk and Security
**Owner scope:** `server/src/risk, exec, wallet, security`.
**Deliverable:** Scope-restricted code/design review, testable PR-sized implementation contract, required regression tests and proof of no duplicate authority.
**Escalation:** Raise any cross-squad change affecting decision, risk, OMS, financial ledger, signing or migrations to the chief architecture specialist and the independent release auditor.

### Squad 8: Frontend
**Owner scope:** `web/src, e2e browser`.
**Deliverable:** Scope-restricted code/design review, testable PR-sized implementation contract, required regression tests and proof of no duplicate authority.
**Escalation:** Raise any cross-squad change affecting decision, risk, OMS, financial ledger, signing or migrations to the chief architecture specialist and the independent release auditor.

### Squad 9: Infrastructure
**Owner scope:** `deploy, scripts, .github/workflows, ops, qhef`.
**Deliverable:** Scope-restricted code/design review, testable PR-sized implementation contract, required regression tests and proof of no duplicate authority.
**Escalation:** Raise any cross-squad change affecting decision, risk, OMS, financial ledger, signing or migrations to the chief architecture specialist and the independent release auditor.

### Squad 10: QA and Release
**Owner scope:** `server/test, e2e, docs test records, qa`.
**Deliverable:** Scope-restricted code/design review, testable PR-sized implementation contract, required regression tests and proof of no duplicate authority.
**Escalation:** Raise any cross-squad change affecting decision, risk, OMS, financial ledger, signing or migrations to the chief architecture specialist and the independent release auditor.

## Independent QA distinction
MIA 4.1 Part 12 already defines fifteen QA positions, but the later MIA 4.2 directive numbers its QA-01…QA-15 differently. Do **not** silently redefine existing QA identifiers. Maintain the existing Part 12 QA-role names as canonical until the owner approves a crosswalk, and map the later test capabilities to them in a separate review.

## Definition of done
No role, test, or implementation is "operational" because it appears in this roster. Require actual running evidence: committed code, reproducible build, tests, peer review, observability, accurate reports, and release gates.
