# MIA 5.0 — Live OMS attachment: preservation and integration review

**Source:** user-provided 42-page ODT containing a 1,481-line \`LiveOmsAdapter\` and a separate 23-line \`startMiaDaemon\` wiring example. Original code has been preserved unchanged as text in the downloadable accompanying ChatGPT engineering package; the attachment is **not** production-compatible with this repository. This PR does not remove or modify any original MIA script.

**Baseline:** \`claude/mia-unified-01\` PR #45, compared with ongoing recovery PR #62 and Guardian PR #63. Re-evaluate ancestry before merge.

## Repository compatibility

| Original attachment | Existing canonical module | Instruction |
| --- | --- | --- |
| \`server/src/oms/LiveOmsAdapter.ts\` | \`server/src/exec/oms.ts\` | Do NOT introduce a second OMS |
| \`IOmsAdapter\` from \`oms/types.ts\` | \`exec/environment.ts\` / \`ExecutionAdapter\` | Future transport must stay behind current boundary |
| \`NexusSharedMemoryBus\` | \`market/store.ts\` and \`fabric/*\` | Reuse existing market state, contracts and durable outbox |
| \`startMiaDaemon\` / \`MIA_MODE=LIVE\` | \`index.ts\`, \`bot/bot.ts\`, \`core/mode.ts\` | Reject this wiring; live is locked |
| In-memory order journal | SQLite orders / \`portfolio/ledger.ts\` | Preserve immutable IDs and durable reconciliation |
| Dead-man heartbeat | No certified venue protection | Verify each venue capability, do not invent coverage |

## Review findings from the actual attached TypeScript

1. **P0: ACK timeout != venue REJECTED.** \`submitOrder\` emits a synthetic rejection on every thrown RPC; the exchange may have accepted and executed it. Future implementation must keep UNKNOWN, reconcile by client order ID, and forbid automatic re-submission without proof.
2. **P0: Cancel-all errors swallowed.** \`Promise.allSettled\` is not inspected. Report per-symbol failures and confirm final exchange order state.
3. **P0: Mode bypass.** Attachment instantiates LIVE from environment variables. Current MIA has \`LIVE_EXECUTION_AVAILABLE=false\` plus mandatory release gates; preserve them.
4. **P0: In-memory recovery fabricates provenance.** Original \`RECOVERED-...\` order IDs and \`ENTRY_SCALP\` fallback can corrupt strategy attribution. Use persistent mapping, immutable execution IDs and UNKNOWN where absent.
5. **P0: Dead-man claim is inaccurate.** Bybit DCP requires account eligibility, a private WS \`dcp\` subscription and valid documented product/time window; Binance Spot REST time ping is not server-side cancel-on-disconnect.
6. **P0: Connection OPEN does not mean authenticated.** Await and verify Bybit authentication and subscription ACK, then reconcile before READY.
7. **P0: Invalid quantity silently becomes zero.** \`formatDecimal(NaN)\` returns \`'0'\`; fixed 8-decimal formatting ignores exchange precision. Reject and use exact decimal metadata.
8. **P0: Spot balance is not a position cost basis.** Original derives positions from balance, uses market mark as entry price and always sets zero unrealized PnL. Keep balance, lots, transfer and strategy fill records separate.
9. **P1: Incomplete recovery.** Fixed \`limit=50\` / \`100\` without full pagination cannot prove all open orders and fills.
10. **P1: Unknown status as ACK.** Unrecognized venue statuses and missing RPC retCodes must fail validation, not default to success.
11. **P1: Stale sockets and duplicated fills.** Fence callbacks by connection generation, validate monotonic fill quantities and dedupe by immutable exchange execution ID.
12. **P1: Stale arrival touch masquerades as measured slippage.** Quote fallback to \`limitPrice\` is not best bid/ask.
13. **P1: Account/symbol collisions.** Scope keys by venue, account and instrument, not ticker alone.
14. **P1: Error leakage.** Do not log raw exchange response bodies, keys, signatures, listenKeys or private payloads.

## What this PR implements

- \`server/src/exec/venue-reconcile.ts\`: a **pure**, credential-free mismatch assessor with exact-decimal quantity checks, explicit incomplete coverage, stale/future timestamp detection, event ID collision checks, missing/unknown order detection and cumulative-fill/state comparisons.
- \`server/test/venue-reconcile.test.ts\`: deterministic negative/positive fixtures.
- No database migration, networking, credential handling, order commands, UI routes, mode changes, or live authorization.
- \`canSendOrders\` is **literally false** even for a CONSISTENT report. Do not treat it as certification.

## Future improvements for Claude/Codex, in dependency order

1. Venue capability registry + official protocol version matrix for Binance Spot/Futures and Bybit Spot/Linear, including DCP availability.
2. Strict runtime schema parsing for exchange order events and signed response metadata, fail-closed for unknown statuses.
3. Exact decimal symbol filters, tick/step-size, min/max lot, min notional and order-id namespace.
4. Durable intent journal and ambiguous-ACK resolution; transactionally deduplicated execution inbox.
5. Complete cursor-based REST recovery (orders, executions, balances) and generation-fenced WS lifecycle.
6. Protection/stop status separate from cancel-on-disconnect capability; log protection incidents through existing \`exec/incidents.ts\`.
7. Slippage, latency, maker/taker and multi-currency fee attribution as read-only metrics.
8. Reuse NEXUS outbox and Trader Joe for narration; preserve Guardian's risk-reducing-only authority and QCI risk vetoes.
9. Multi-account isolation, exact-unit shadow ledger and testnet fault injection with strictly allowlisted hosts.
10. Dashboard readiness remains LOCKED until separately reviewed owner certification; LIVE stays OFF.

## Merge/release gates

Do not merge to \`main\` or enable real orders automatically. Owner must approve after code review and CI. Run \`npm run typecheck\`, \`npm test\`, \`npm run build\`, \`npm run test:e2e\`, \`npm run scan:secrets\`, and \`npm audit --audit-level=high\` against the exact PR head. Compare PR #62 recovery changes and review import boundaries. Mark unavailable tests NOT VERIFIED. Paper trading must remain unchanged.

Official docs to consult before implementation:
- Binance Spot authenticated user stream: https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/ws-api/user-data-stream
- Bybit trade WS: https://bybit-exchange.github.io/docs/v5/websocket/trade/guideline
- Bybit DCP eligibility: https://bybit-exchange.github.io/docs/v5/order/dcp
