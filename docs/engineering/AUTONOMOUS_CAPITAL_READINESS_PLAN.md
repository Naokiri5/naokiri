# MIA — Funded Autonomy Readiness & Non-Duplication Implementation Program

**Created:** 2026-11-18. **Status:** architecture proposal / safe read-only engineering handoff. **Authoritative baseline:** main `2627cd276d2108c15a47ba41d60cdb54fddf10ff`. Recheck HEAD and all open PRs before changes.

## Goal and non-goal

Goal: an owner-managed, always-on system where preapproved and empirically validated strategies can execute through separately scoped broker trade-only permissions with capital limits, correct accounting, monitoring and recovery after independent certification.

Non-goals: **100% win rate**, guaranteed profit, unrestricted custody or withdrawals, automatic deposits, trading based solely on an LLM/book/headline, live execution enabled by this document, or all 100 roles running as heavyweight agents.

## Existing canonical services: REUSE, NEVER DUPLICATE

| Function | Canonical owner | Existing status / next work |
|---|---|---|
| Market data and scanner | `server/src/market/{fabric,store,quality,scanner,discover}.ts` | CEX spot coverage; add licensed feeds and freshness checks |
| Token Hunter | PR #19 `server/src/hunt/ranker.ts` | Read-only ranking; CI currently blocked by audit, reconcile before merging |
| Telegram interface | PR #20 `server/src/integrations/telegram/` | Owner-linked, read/pause-only; verify migration collision, CI and webhook tests |
| Book-depth streaming / lease fencing | PR #18 `depthStream.ts`, `ops/lease.ts`, OMS | Paper-only branch; CI and review findings must be closed |
| Indicators / regime | `server/src/features/indicators.ts`, `regime/` | Reuse |
| Market intelligence roles | `server/src/workers/` and `qci/` | 100 logical evaluators and a bounded pool, not 100 independent LLMs |
| Strategy / research / Academy | `server/src/lab/`, `knowledge/`, `chart/` | Books are evidence, not direct trade authority |
| Central decision | `server/src/decision/engine.ts` | Single decision authority |
| Deterministic risk | `server/src/risk/{gate,policy}.ts` | Independent final veto |
| Paper orders, accounts | `server/src/exec/oms.ts`, `portfolio/ledger.ts` | Spot paper-only; no real signer |
| Security / release | `server/src/qa/gates.ts`, `security/`, `ops/` | Human/technical release gates mandatory |
| Trader Joe | `server/src/joe/joe.ts` | Read/analyze/pause tools; never add unrestricted order, signer, fund or withdrawal tools |

## Current release blockers (recheck live statuses)

1. PR #18 at `56a34dc9fa424169444799f1d2db60b43c61327f`: CI run 44223619529 shows 596 server tests passed, 1 failed, 3 skipped; failure in `api.test.ts` expecting 400/404 for an overlong ID but got 414. Dependency audit failed on `picomatch` high-severity advisory. CodeRabbit review threads remain unresolved.
2. PR #19 and #20 latest checked workflow runs were blocked by dependency audit, so their code is not fully CI-certified.
3. PR #20 claims database migration v6, while PR #18 uses later migrations. Rebase and migrate version numbering with an upgrade regression test. Never copy conflicting migrations blindly.
4. No real-money venue adapter, no isolated signer, no read-only account reconciler, no demonstrated live order recovery, no audited credential storage, no independently certified live permissions.
5. Present strategies have not shown a reliable positive edge out of sample. `docs/KNOWN_LIMITATIONS.md` reports negative OOS performance on only 2–9 trades/strategy; do not promote based on an impressive QCI score.
6. `docs/engineering/PHASE1_SOAK.md` reports a ~6.6 minute headless soak without paper entries; it is not a 24-hour funded/trading certification.
7. Google News RSS is documented personal/noncommercial; X / Yahoo / other licensed sources require verified entitlements before commercialization.

## Target architecture

```text
AUTHORIZED DATA PROVIDERS → VALIDATION / FRESHNESS / CANONICAL MARKET FABRIC
→ TIERED SCANNER + PR #19 HUNTER + NEWS EVENT RESEARCH (no execution)
→ VERSIONED STRATEGIES / NEWS ALPHA + OUT-OF-SAMPLE EVIDENCE
→ 100 ANALYTICAL WORKERS (bounded) → QCI → SINGLE DECISION ENGINE
→ SMART ROUTE QUOTE (full cost, funded/eligible venue, quote TTL)
→ INDEPENDENT RISK GATE + OWNER-ENROLLED STRATEGY / MODE / LEASE
→ CANONICAL OMS → ORDER STATE RECONCILIATION → SINGLE LEDGER
→ PROTECTION / MONITORING / DITAS → TRADER JOE / ALERTS
```

Trader Joe is the conversational research and supervisory UI. He is **not** the final execution authority. Neither a book, Telegram post, whale signal nor headline is an order instruction.

## Funding and execution trust boundaries

**Phase A — read-only account linking:** read-only exchange scopes, source-of-truth balances and positions, permission audit, account ID mapping and no trading credentials. No sensitive keys or seed phrases in ChatGPT, Claude, git, tests or logs.

**Phase B — canonical paper trading:** owner accepts policy and enrolls a strategy; trade signals run unattended in PAPER only, with 24h+ hosted failure drills and longer prospective paper outcome evidence.

**Phase C — separately approved limited live pilot:** only after independent legal/security approval and all actual release gates pass. Connect an exchange-account-specific TRADE permission, **not withdrawal or internal transfers**, restricted source IPs, isolated key service, dedicated subaccount, hard notional ceiling and verifiable revocation; keep owner capital separate. The exchange, not Joe, retains custody.

**Phase D — scale:** require real trade reconciliation, independent risk limits, 24/7 monitoring, tested incident playbooks and renewed statistical edge review. Never let funding or an LLM silently switch modes. No auto-withdrawal.

### Live execution state machine to implement later (not enabled here)

`INTENT_RECORDED → RISK_RESERVED → ROUTE_QUOTED → PREFLIGHT_OK → SUBMITTING → ACKNOWLEDGED / REJECTED / UNKNOWN → PARTIAL / FILLED / CANCELLED → RECONCILED`.

Unknown timeout states MUST query the authoritative exchange/client-order-ID before retrying. Every write requires active leader fencing, idempotency and cash/risk reservation; preserve audit/version metadata. Stop orders need native-exchange protection when supported; protection failures halt new risk and alert. Protective exits must remain available even in pause states.

## Research reliability and fee control

- Use point-in-time event replay including scanner → workers → QCI → decision → gate → OMS, with realistic commissions, spread-inclusive VWAP shortfall, funding, DEX gas, queue/no-fill risk and adverse selection. Do not add spread and VWAP shortfall twice.
- Score candidates using measured net expectancy, uncertainty, drawdown, sample size and regime stability. No calibrated probability claims without a holdout.
- Sentiment is evidence: bullish → potential LONG; bearish → potential SHORT **only when a separately tested paper-short venue and risk/accounting exist**. Current spot path cannot short.
- Automated strategy suspension on loss/cost/quality failures; per-strategy and portfolio exposure ceilings; reject no-edge candidates.
- Read-only news/X/Yahoo access must be licensed and source verified before global deployment.

## Release stages and acceptance

**P0 — Reconcile/repair:** close CI failures and P0 security/OMS findings on PRs #18–20; resolve the migration collision, backup review PR #14 and critical-alert PR #15; freeze one baseline. No new money.

**P1 — Historical proof:** build strategy event replay and walk-forward evaluation. Fail if current strategy remains nonprofitable net of costs; never promote on win rate alone.

**P2 — Autonomous paper:** accepted owner policy, explicit strategy enrollment and a 24-hour hosted run with real paper entries. Reconcile each fill and account balance after stop/crash/restart; then a longer prospective paper trial.

**P3 — Funded execution design:** legal/venue review; commercial data rights; read-only accounts; hardened signer/key custody design; independent audit and exchange sandbox test before any trade-only credential is considered.

**P4 — Limited real pilot (new approval required):** minimal explicit capital ceiling, cash-only supported spot market, per-order preflight, drift checking, hard risk breakers, independent shutoff and real venue recovery. No derivatives or 24/7 live by default.

**P5 — Global distribution:** tenant isolation, compliance by jurisdiction, exchange/regulatory approvals, commercial data contracts, privacy, monitoring, support and operational rollback. No guarantee of profit.

## Claude implementation instruction

1. Start with the exact current Git commit, tree, all open PRs and CI artifacts; produce a path-by-path implementation status and semantic duplication map.
2. Reuse the 100 logical development roles in `AGENT_ROSTER.md` and `AGENT_ROSTER.yaml`; assign 6–12 active independent specialists by file scope. Do not claim all 100 ran.
3. Repair PR #18 CI before introducing new money features; independently review PRs #19/#20 and PR #20 migration conflict.
4. Create small, reversible, audited feature branches. Require negative safety tests, property-based ledger tests and provider contract tests. Never weaken `qa/gates.ts`, `core/mode.ts`, `risk/gate.ts`.
5. Report tests actually run, outstanding blockers and next owner actions. Never merge, deploy or trade funds automatically.
