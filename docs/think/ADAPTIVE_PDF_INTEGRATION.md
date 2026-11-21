# MIA Adaptive Thinking — PDF Integration Audit and Safe Implementation

**Source:** User-provided 135-page `Now combine it all idea generate a typescript and....pdf`, Parts I–V.  
**Integration base:** `claude/mia-think-05-horizons` (stacked THINK development work, NOT current `main`).  
**Status:** Review implementation, shadow by default; separate PR, not merged or deployed.  
**Version:** `mia-think-observer-v1`.  
**Core rule:** Preserve the existing scanner, 100 workers, 50 indicator specialists, QCI, central decision engine, independent risk gate, OMS, journal, ledger, DITAS and market fabric. Retain the live-execution lock.

## 1. Source-to-code audit

The PDF proposes modules 1–14 plus tests and operations. Many of its suggested file paths already exist and contain functional implementations. Copying those modules verbatim would replace existing code and introduce duplicate authorities. The PDF is an architectural input, not a drop-in patch.

| PDF module / requested outcome | Existing canonical MIA owner | Integration decision |
|---|---|---|
| 1. `think-router.ts` | `decision/engine.ts` central authority | **Added** a pure routing helper with NO_TRADE, FAST, DEEP; cannot authorize |
| 2. `think-adapter.ts` | `WorkerContext`, QCI, quality, safety | **Added** typed adaptation of *actual* record shapes, fail-closed |
| 3. `think-policy.ts` | Existing auth, mode, release-gate modules | **Integrated** limited config reader into `think-router.ts`; no new mode/venue authority |
| 4. `profitLab.ts` | Already present on THINK #33 | **Reused**; no second profit calculator |
| 5. `qci/challenge.ts` | Already present on THINK #36 | **Reused** the existing critical contradiction and horizon checker |
| 6. `ditas/calibration.ts` | Existing DITAS calibration | Not duplicated; real settled OOS cohorts still needed |
| 7. `ditas/shadow-evaluator.ts` | DITAS evidence and existing decision rows | **Partially addressed** by persisted `report.thinking`; no new financial ledger |
| 8. `ditas/replay.ts` | Already present on THINK #35 | Reused via separate PR; no duplicate replay engine |
| 9. `market/fabric.ts` | Canonical market fabric, optional stream in THINK branch | Preserve existing stream-gap and polling logic; no duplicate order-book store |
| 10. `market/quality.ts` | Existing fail-closed data quality | Reused its quality checks; no fake WS sequence numbers |
| 11. `qhef/qhef.ts` | Existing latency ring buffers | Added `think.review` record using existing metrics |
| 12. `think-presenter.ts` | Existing decisions API and React intelligence pages | **Partial:** authenticated JSON at `GET /api/think`; full visual dashboard future PR |
| 13. `decision/engine.ts` | Canonical decision engine | **Minimally extended** to persist diagnostics and optional abstention, never a second engine |
| 14. `bot/bot.ts` | Existing leases, monitoring, and OMS dispatch | **Unchanged**; no new 50ms protection timer or duplicate scheduler |
| Part IV CI/fault tests | Existing Vitest, E2E, architecture CI | **Added** tests; must pass branch CI before promotion |
| Part V runbook | Existing `docs/operations/`, release gates | Documented safe settings below; no unsafe LIVE toggle |

## 2. Runtime behavior and authority

The existing pipeline remains:

```text
market fabric -> scanner -> 100 workers + QCI -> decide()
    -> deterministic risk gate -> original permission checks -> paper OMS
```

One non-authoritative, deterministic review is embedded **inside `decide()` after QCI and the normal decision logic**, without new network or LLM calls:

```text
WorkerContext + QCI + market-data quality + existing portfolio correlation
    -> think-adapter.ts -> think-router.ts
         FAST: evidence summary only
         DEEP: reuse horizonAlignment() + Profit Lab scenarioTable()
         NO_TRADE: advisory abstention
    -> report.thinking (stored in existing decisions.report and DITAS memory)
```

**SHADOW (default):** MIA stores the prospective THINK route and hypothetical DEEP scenarios; the actual original decision and OMS are unchanged.

**ENFORCED (opt-in, review only):** A negative THINK assessment may **downgrade** an eligible `PAPER_TRADE` or `APPROVED_FOR_USER_CONFIRMATION` to `WAIT_FOR_CONFIRMATION`. It can never upgrade an existing rejection, create a risk allowance, grant permission or emit an order. The risk gate and existing OMS remain authoritative. Do not deploy ENFORCED until tested on representative unseen market data.

**DISABLED:** No THINK report is added; original execution and decision path are preserved.

All trading environments use the same decision/risk/think code path, but current LIVE execution remains **LOCKED** by MIA's separate release gate. `MIA_THINK_MODE` cannot unlock it.

### Configuration

```bash
MIA_THINK_MODE=SHADOW
MIA_THINK_PREFERENCE=AUTO
```

Options: `MIA_THINK_MODE=DISABLED|SHADOW|ENFORCED` and `MIA_THINK_PREFERENCE=AUTO|FAST|DEEP`.

There is **no** `MIA_TRADING_ENV=LIVE` switch, `MIA_THINK_LIVE_OWNER_UNLOCK` shortcut or additional venue adapter: the PDF's proposal conflicts with existing MIA release controls. The existing central release gates determine what is available.

### Observation

`GET /api/think?limit=20` (existing authenticated owner session): mode/preference, recent deterministic route diagnostics, observed stage-latency samples. The existing `GET /api/decisions/:id` also includes optional `report.thinking`.

DEEP scenarios are **hypothetical**, not executable plans or profitability predictions. Until valid OOS forecasting data is available, calibration is `NO_VALID_FORECAST` and probability is not invented. Unlike the PDF's proposed second `ReasonToTradeCertificate`, MIA's existing THINK certificate remains canonical.

## 3. Known differences from the PDF and why

1. The PDF's `evaluateCandidateWithAdaptiveThinking()` creates **another** risk/OMS funnel, takes an `environment` from configuration and derives instrument from a snapshot string. That would duplicate MIA's real-authority path. **Not copied.**
2. The PDF's 50ms protection timer risks starving or duplicating `bot.ts` position supervision; actual priority/latency benchmarks are still required. **Not copied.**
3. The PDF assumes the presence of settled OOS calibration, source-independent feed counts and a uniform WebSocket certification contract; those assumptions are not universally true. **No fabricated data.**
4. The PDF's DEMO/LIVE promotion switch is not an approved execution interface. Current release gates and existing controls stay in place.
5. The PDF's proposed arbitrary veto/forecast thresholds are research defaults, not validated trade profitability. They are not secretly promoted to the live risk policy.
6. The PDF's long runnable-looking code includes proposed types and imports that do not match today's existing repository modules. Type-compatible MIA-specific integration was used instead.

## 4. Verification and review checklist

Run against this branch and report exact outcome:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run scan:secrets
npm audit --audit-level=high
```

Review tests, code ownership, network sources, active risk gates, permissions, strategy behavior, and QHEF p95/p99 under load. Compare SHADOW and DISABLED outcomes on the same historical snapshots. Validate that no order or risk verdict changes in SHADOW. Recheck the existing OMS last-moment book validation.

## 5. Rollback and later work

Rollback is a commit revert of the new helper modules, optional `thinking` property, the read-only GET route, tests and docs. No schema migration, new asset or independent trading state was created.

Separate future PRs should cover: settled OOS calibration with purged walk-forward testing; a source-lineage model; a bounded adversarial review loop with measured latencies; historical shadow comparison; alerts/drift; benchmarked priority isolation; more granular provider book-sequence handling; and the full frontend thinking dashboard.

**Approval:** Keep this as a draft PR until integration tests, security and trading-risk review are completed. Do not auto-merge onto main or directly merge the unrelated stacked THINK branches.
