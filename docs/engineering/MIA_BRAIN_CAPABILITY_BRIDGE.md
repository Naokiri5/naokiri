# MIA BrainOS — Internal Capability Bridge (Phase 1)

## Goal

The Autopilot tools formerly exposed as 11 separate user destinations should be **capabilities used by MIA**, not 11 independently controlled trading bots. The owner ultimately operates FAST/DEEP and PAPER/LIVE through an explicit, safe session lifecycle. Routine market evidence gathering should happen in MIA's existing engine lanes.

## What this PR implements

- `server/src/knowledge/brain.ts`: A single, strictly read-only inventory of the 11 current tool roles and a deterministic current-evidence view built from canonical market, scanner, news and large-print data.
- `server/src/bot/bot.ts`: The existing leader-owned background pass refreshes that view automatically. No new timers, schedulers, scanners or execution authority.
- `server/src/knowledge/memory.ts`: The existing authenticated `GET /api/academy/memory` response includes `internalIntelligence`, referencing the new capability registry and most recently refreshed view. The six A–F memory categories and data ownership remain unchanged.
- `server/test/brain-capabilities.test.ts`: Pure tests of missing/future-dated data, evidence availability, blocked wallet functions and trading-authority isolation.

## Important limitations

This bridge makes existing intelligence **discoverable and automatically observable from inside the backend**. It does **not** turn a UI screen into a new strategy, create a multi-market provider, install wallet holder analytics or activate copy trading.

- Holder mapping and copy trading remain BLOCKED pending verified on-chain data and independent safety testing.
- The whale monitor is PARTIAL: large CEX prints are not identified whale wallets, and DEX profiles alone do not establish genuine new-token event ingestion.
- Bot account is PAPER_ONLY: no live venue adapter, isolated signer or real-money trade authority is added.
- The current central bot keeps its existing automatic startup; a user-triggered durable FAST/DEEP session lifecycle is separate follow-on work.
- This snapshot is a **transient read model**, not a new persistent memory database. Decision, research, outcome and policy memory stay in their existing DB tables. No snapshot grants or alters order permissions.
- No primary navigation has been deleted yet; removing it before verified backend integration would conceal incomplete functionality.

## Next implementation milestones (separate reviewable changes)

1. Audit all installed/merged features and unmerged PRs. Classify each as active automatic, derived read-only, blocked by credentials, or missing.
2. Connect FAST and DEEP to a durable session coordinator and dependency-aware capability scheduling, reusing `bot/bot.ts`, the market fabric, risk, OMS, ledger and DITAS.
3. Route on-chain new-token/holder/copy-trading evidence through verified provider adapters; do not grant trading authority from memory or external social text.
4. Promote Choice Management from shadow-only to active PAPER only after frozen-candidate arbitration, durable capital reservations and safety gates are certified.
5. Refactor navigation to Autopilot / Portfolio / Trader Joe / Settings only after diagnostic and escape-hatch access is preserved.
6. Maintain owner authority over funding, permitted instruments, risk limits, live activation, withdrawals and emergency shutdown.

## Release gates

- Run `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`, `npm run scan:secrets`, and the applicable dependency audit on the exact PR head.
- Verify the existing scanner, paper OMS, ledger, DITAS decision chain and protective monitor are unchanged.
- Check source timestamp handling and blocked-status truthfulness under empty and stale data.
- Do not merge until independent architecture/safety review and owner approval.

**Deployment claim:** Not automatically deployed, not live-tradable, and not a completed autonomous FAST/DEEP engine.
