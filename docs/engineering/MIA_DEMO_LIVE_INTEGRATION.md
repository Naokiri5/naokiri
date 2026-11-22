# MIA 5.x — Demo / Live parity integration record

**Baseline:** `main@6476391f4d7e8f8884c76ac4e31bb3779c444d77` (2026-11-21)
**Branch:** `codex/mia-unified-demo-live-parity-20261121`
**Scope:** Additive contracts, identification manifest, owner-authenticated readiness view, tests and master prompt. **No real-money trading, signer, credential, schema migration or deployment.**

## Canonical ownership (do not duplicate)

| Responsibility | Sole current owner | Integration rule |
|---|---|---|
| Market data and quality | `server/src/market/{fabric,quality,store}.ts` | Reuse and extend; no second ticker/cache authority |
| Indicator calculations | `server/src/features/indicators.ts` | Workers interpret canonical features |
| QCI and decision | `server/src/qci/`, `server/src/decision/engine.ts` | No new decision engine |
| Risk and policy | `server/src/risk/{gate,policy}.ts` | **Both modes** must call canonical `evaluateRisk()` |
| Runtime mode | `server/src/core/mode.ts` | Alias types, never define a second mode authority |
| Paper OMS and exits | `server/src/exec/oms.ts` | No change to financial state or order paths in this PR |
| Accounting | `server/src/portfolio/ledger.ts` | Keep `paper-bot` separate from future live accounts |
| Evidence/release | `server/src/qa/gates.ts` | G01–G14 remains the only release-gate authority |

## Files introduced

- `server/src/ops/featureIdentification.ts`: commit-scoped snapshot of 28 known features with source location, original PR candidate, owner and action. Existing status is *source ownership*, not live capability certification.
- `server/src/exec/demoLiveParity.ts`: dependency-injected, **not yet connected to the running OMS**, fail-closed orchestration contract. Canonical `Mode` and `DecisionState` are imported rather than redefined. Ports explicitly require the existing risk authority, mode, G01–G14 release evidence and durable reservation before a future certified venue can be used. Risk quantity and notional are rechecked after reservation.
- `GET /api/trading/parity`: working **authenticated read-only** view backed by `getControl()`, `currentPolicy()` and `releaseGates()`. Reports paper mode and exactly why LIVE is not executable, including failed gates. Never activates a mode or places orders.
- `server/test/demoLiveParity.test.ts`: synthetic ports only; tests idempotency, risk rerun, release evidence, unknown outcomes and emergency lock.
- `server/test/api.test.ts`: authenticated status-route checks.
- `docs/engineering/MIA_UNIFIED_DEMO_LIVE_MASTER_PROMPT.md`: full implementation plan and 100-point **verification inventory** (not 100 verified bugs).

## Open PR stack reconciliation (review in this order; do not bulk merge)

| PR | Topic | Branch / state at audit | Next step |
|---|---|---|---|
| #41 | NEXUS versioned event contract | Stacked on older base | Compare types and topic IDs; do **not** create a competing event envelope |
| #43 | Durable outbox for DITAS outcomes only | Stacked on Telegram base | Rebase after dependency review; do not assume order/fill outbox exists |
| #92 | PAPER/TESTNET/LIVE environment sketch | Draft, stacked on #91 | Adapt **TESTNET preflight** separately; it is not an order-placement adapter |
| #97 | Readiness witness + pure venue order reducer | Draft, stacked on #95 | Prefer `venueOrderState.ts` when later building persistent order lifecycle; reconcile read-only route rather than duplicate it |
| #98 | Big live-order stack | Non-mergeable versus current main | Split into reviewable, dependency-scoped PRs |
| #103 | Privy owner login | Draft versus main | Authenticate/authorize separately from a financial signer; do not tie wallet login to real-money trading |

The stacked PRs are **not merged by this PR**; this avoids pulling unrelated changes across older merge bases. The integration manifest identifies candidates, not production implementations. Review their source and tests before any future cherry-pick.

## Invariants and limitations

1. Current demo execution continues through the original `bot/bot.ts → exec/oms.ts → risk/gate.ts → portfolio/ledger.ts` path. This change does **not** replace the OMS or alter financial writes.
2. The guarded TypeScript `routeEntry()` is **prototype-level** until adapters are wired to an atomic persisted reservation and real broker reconciliation. Do not call it from the bot without that work.
3. `LIVE` and `BOUNDED_LIVE` remain **locked**. A TypeScript interface is not a certified signer, external protective stop or executable brokerage connection.
4. Never blindly retry a live venue call with an unknown outcome; reconcile against its stable client order ID first.
5. Extend schema with explicit environment and account scopes before any real venue implementation; keep simulated and real funds separate.
6. Any change to financial state requires CI green, crash injection, restore/recovery, browser checks, owner-authorized release, security review and independent venue testing.
7. A READY frontend or test-runner does not mean the long-running Fastify bot is deployed. MIA needs persistent backend compute and backed-up storage.

## Verification

Run against the complete repository:

```bash
npm ci
npm run scan:secrets
npm audit --audit-level=high
npm run typecheck
npm run build
npm test -w server
npm test -w web
npm run test:e2e
```

Offline standalone parity-package compile/tests passed before the import, but **that does not certify the full repository or external exchange integration**. Review the PR's GitHub Actions outcome.

## Next safe coding milestone

Create a small PR to adapt the current **paper OMS** to the shared intent metadata without changing paper fills, stops or ledger results. Then add atomic environment/account-scoped reservation, fencing and an order reducer **by adapting PR #97**, followed by TESTNET-only venue protocol tests using PR #92. Enable real-money trading only after G01–G14, independent review, owner reauthorization, native protection and recoverable financial accounting.


## 2026-11-23 — live gap inventory (review-only Phase A)

**Compared:** \`main@a39ddaa597172619d8c897e49464910ebad6681f\`, existing manifest, running paper decision/OMS call sites, the authenticated parity API, and relevant draft PR descriptions. **Scope:** one source-derived feature gap inventory added to the existing parity endpoint, plus deterministic tests. No execution, policy, mode, account, ledger, schema, signer, or order lifecycle changes.

### Evidence-backed architecture ownership

| Concern | Main call-path evidence | DEMO | LIVE | Next owner |
| --- | --- | --- | --- | --- |
| Market ingestion and evidence | \`market/fabric.ts\`, \`quality.ts\`, indicators, worker registry, QCI | Shared source | Shared analysis source only | Market/decision |
| Entry decisions | \`bot/bot.ts:onDecision\` handles \`PAPER_TRADE\` and calls \`oms.submitEntry\` | Paper path connected | No operational live dispatch | Existing decision/OMS |
| Risk and safety | \`risk/gate.ts:evaluateRisk\`, \`core/mode.ts\` | Evaluated at paper entry | Live account and venue integration unverified | Canonical risk/mode |
| Entries/partial exits/stops | \`exec/oms.ts\` simulates order book fills and monitors paper positions | Paper execution path exists | No certified venue acknowledgment or protective order | Existing OMS; future venue adapter |
| Ledger | \`portfolio/ledger.ts\` with \`PAPER_ACCOUNT\` | Paper cash, positions, P&L | No certified live fill-to-account reconciliation | Existing ledger |
| Parity contract | \`exec/demoLiveParity.ts\` has dependency-injected \`routeEntry\` | Synthetic tests | Synthetic tests only; NOT production-wired | Existing OMS and durable order ownership |
| Release authority | \`qa/gates.ts\` G01–G14 | Paper can be eligible | G12 not implemented, G13 uncertified, G14 pending | Release auditor and owner |

The full critical-path inventory is **now available** under \`capabilityAudit.features\` on authenticated \`GET /api/trading/parity\`; source IDs, canonical owners and candidate PR numbers derive from the **existing** \`ops/featureIdentification.ts\` manifest. \`capabilityAudit.liveGaps\` filters items with \`UNVERIFIED\`, \`PROPOSAL_ONLY\`, or \`NOT_OPERATIONAL\` live status. These are **source and integration classifications**, not independently tested production claims. The endpoint stays read-only, owner-authenticated and no-store.

### Priority defect / missing-capability register

| Priority | Finding | Evidence / impact | Safe next action |
| --- | --- | --- | --- |
| P0 | Direct LIVE mode-change hardening is not in inspected \`main\` | \`core/mode.ts\` has optional \`gateCheck\`; draft #117 repairs this | Independently review #117, reconcile #45, merge only after exact-head CI and review |
| P0 | Paper OMS concurrency and execution price risk fixes remain drafts | #118 → #119 → #121 are stacked; executed-fill/transaction protections remain unmerged | Review stacked diffs and tests, then merge in dependency order after approval |
| P0 | Live order path, isolated signer and native protective execution absent | Main \`bot/bot.ts\` dispatches PAPER only; G12–G14 are incomplete | Maintain LIVE lock; do not add executable signer in parity-audit work |
| P1 | Parity contract is not production-wired | \`exec/demoLiveParity.ts\` explicitly disclaims production wiring | Design durable reservations and authoritative account/venue boundary before attaching |
| P1 | Exchange partial-fill, rejection, unknown order recovery not certified | #92 / #97 / #98 are overlapping draft proposals | Review minimal compatible order reducer and testnet protocol separately |
| P1 | DITAS live outcomes and FAST/DEEP parity unverified | Memory and intelligence sources exist, but no operational live fill linkage | Extend existing source, not duplicate memory/worker core |
| P1 | Production deployment evidence incomplete | Draft #123 CI passed, but separate deployment contexts were blocked | Check current exact-commit production backend readiness and independent release review |

### Checks and constraints for this focused PR

- Unit regression: feature IDs are unique and the parity projection uses the manifest's canonical owner/path/PR instead of re-declaring ownership.
- API regression: unauthenticated requests fail; the authenticated response is no-store and reports PAPER OMS as paper-wired and LIVE OMS/adapter as not operational.
- Existing parity contract simulation, production build, TypeScript checks, server/web tests, Playwright, secret scan, and dependency audit are required on the **exact final head**.
- A green CI does not prove provider-backed fills, financial account reconciliation, 30-day paper certification, deployment health, or production live permission.
- **Current state:** draft only; no merge, deployment, release-gate changes, transaction permissions or real-money trading authorization.

### Handoff for Phase B

1. Resolve draft #117's mode fail-closed invariant and related #45 overlap before touching live dispatch.
2. Reconcile #118 → #119 → #121 OMS safety fixes before adding an execution abstraction.
3. Reuse the original \`bot/bot.ts → exec/oms.ts → risk/gate.ts → portfolio/ledger.ts\` call path. Do not call the prototype \`routeEntry()\` from the bot without transactional reservations, account/environment isolation and crash reconciliation.
4. Build exact-snapshot parity regressions against the **real canonical** decision and risk services for controlled PAPER and non-executing LIVE evaluation. Distinguish a shared rule from an authorized, operational live path.
5. Leave any missing venue adapter, signer, native protection or unresolved release gate as a **hard LIVE blocker**.



## 2026-11-23 — Phase B: canonical risk parity + uncertified LIVE decision fail-closed

**Baseline:** stacked on draft PR #124, exact head \`4226c34e12b6043a7a5fd2fcd7fb7d02a6763e6d\`. Changes are intentionally limited to \`decision/engine.ts\`, canonical-mode parity tests and this document, not a new decision/risk or venue subsystem.

### Verified source-level gap

In the existing decision engine, any non-\`OBSERVE\` mode that reached the favorable-consensus and risk-ALLOW branch could be mapped to \`PAPER_TRADE\` unless the mode was \`APPROVAL\`. Consequently a legacy persisted \`BOUNDED_LIVE\` value could produce a paper-labeled positive decision even though the bot's paper OMS later refused it. This was misleading cross-layer permission evidence. This phase adds an explicit PAPER/APPROVAL allowlist in the canonical decision engine and marks the execution-permission pipeline step FAIL for other modes. Direct mode authority repair is **separately owned by draft #117**; do not duplicate, bypass or overwrite its control fix.

### Integration verification

- Test the actual existing \`risk/gate.ts:evaluateRisk()\` with one deterministic market snapshot in PAPER and APPROVAL modes. The financial account is \`PAPER_ACCOUNT\` in both cases; equality here is **paper-mode policy equivalence**, not proof of production LIVE account parity.
- Test a real \`scanner.buildContext()\` and \`qci.runConsensus()\` context with deterministically forced favorable consensus, so the decision-mode branch is exercised. Verify PAPER still produces \`PAPER_TRADE\`, while a deliberately injected legacy stored \`BOUNDED_LIVE\` value cannot emit \`PAPER_TRADE\`, an executable LIVE decision, or any sized entry.
- The QCI score and indicators must remain unchanged across modes for the same synthetic market snapshot. Tests are synthetic and use an intentionally favorable consensus fixture to isolate permission branching. They are not backtest outcomes, calibrated probabilities or venue evidence.
- Risk-reducing emergency controls must deny new risk in PAPER and APPROVAL.

### External dependencies and next phase

- Review and reconcile #117 (fail-closed mode authority) and #45 (large overlapping changes) independently.
- Reconcile OMS transaction and fill-price risk drafts #118 → #119 → #121 before modifying order/cash/position state. Avoid conflicting risk changes on the unmerged #121 stack.
- Only then develop a durable, account-isolated TESTNET execution boundary with full ack/partial-fill/cancel/unknown reconciliation and dedicated protective exit tests. PR #92/#97/#98 contain candidate contracts but **not certified LIVE capability**.
- Real-money LIVE remains disabled. No signer, credentials, live adapter, authorization gate, release evidence, or deployment change in this phase. A successfully verified test suite does not establish production readiness.
