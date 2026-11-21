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
