# MIA 5.0 — Three Environments, One Intelligence and Risk Core

**Basis:** The uploaded 2026-11-21 MIA Live Trading Readiness Audit (185 lines).  
**Integration:** Draft PR #92, stacked on prior MIA5 PR #91, not merged or deployed.  
**Implementation status:** Binance Spot Testnet **preflight only**; no real exchange order or live exposure.

## Design rule

MIA must use ONE market-data fabric, scanner, FAST/DEEP decision pipeline, 100 existing deterministic workers, QCI, deterministic risk authority, owner policy, and audit governance.

It must have THREE explicitly separated execution environments:

| Environment | Account and funds | Execution | Current permission |
|---|---|---|---|
| PAPER | Existing paper-bot account | Existing simulated OMS with real market data | Existing PAPER/APPROVAL modes |
| TESTNET | Isolated Binance Spot Testnet virtual funds and server-only testnet API keys | Signed account/order diagnostics and order-test validation **only** in PR #92 | Actual exchange order placement LOCKED |
| LIVE | Separate production funds, account and signer | Not implemented in this build | LOCKED (G07, G08, G10, G12-G14 and all other release gates) |

Environment (PAPER, TESTNET, LIVE) is NOT the same concept as owner control mode (OBSERVE, PAPER, APPROVAL, BOUNDED_LIVE). Changing control mode is never a release of a new venue adapter.

## What this PR adds

- Existing server/src/exec/environment.ts extended to name TESTNET and return all three environments in the existing API. The original paper OMS is unchanged. TESTNET and LIVE execution entry and close remain locked.
- server/src/exec/venues/binanceTestnet.ts uses ONLY the fixed host https://testnet.binance.vision. Testnet credentials stay in backend environment variables. Implements HMAC SHA-256 signing, server-time synchronization, explicit API endpoint allow-list, virtual-account reads, query-order-by-client-ID, and bounded order validation against POST /api/v3/order/test only.
- Existing Fastify API routes provide GET /api/trading/testnet/status, GET /api/trading/testnet/account, GET /api/trading/testnet/order/:id and POST /api/trading/testnet/validate-order. All use existing owner-session auth; validation additionally requires CSRF and step-up passphrase.
- server/test/testnet-gateway.test.ts checks signing, endpoint isolation, no real orders, locked environment authority, malformed inputs, 5xx ambiguity, absence of keys and API auth.
- .env.example documents BINANCE_TESTNET_API_KEY and BINANCE_TESTNET_API_SECRET. Secrets must never be committed, pasted into chat, logged or exposed to the browser.

This release does NOT create exchange orders or positions, a signer service, a new data migration or a production adapter. Order-test validation verifies the request's acceptance conditions but does not reach Binance's matching engine.

## Sequence to fully operational TESTNET

1. Review and consolidate dependent branches and preserve baseline paper/risk/OMS authority.
2. Run all CI, security and offline integration tests. In an owner-approved environment add testnet-only keys from https://testnet.binance.vision.
3. Validate actual testnet account authentication, virtual balances, clock sync and non-executing order test; verify credentials never leak.
4. Introduce asynchronous execution adapter contracts without deleting the current synchronous paper implementation.
5. Add append-only account-scoped SQLite tables for durable order INTENT, reservations, venue acknowledgments, fills, protection incidents and reconciliation checkpoints. Unique key (environment, account_id, venue, client_order_id); never conflate testnet/paper/production funds.
6. Require decision+QCI+fresh canonical risk gate+new transaction firewall before allowing a testnet order. Firewall checks owner enrollment, venue/symbol allowlists, order size, notional/rate/exposure caps, fees, exchange precision, min notional and kill switch.
7. Persist order intent BEFORE sending. Actual external requests are not atomic with SQLite. On timeout, 5xx, crash or ambiguous response mark order UNKNOWN, freeze affected new entries and query by client order ID or user-data stream before any retry. No duplicate orders.
8. Consume exchange-confirmed execution reports; reconcile real testnet trades, partial fills, commission and virtual balances against isolated local order state. Never create a synthetic exchange fill based on quotes or optimistic HTTP responses.
9. Verify venue-managed protective orders when supported; explicitly handle unsupported stops or mismatched quantities, lost user-data streams, stale books and connection failure. Protection unverified means risk containment, not pretending a stop executed.
10. Validate testnet reset handling: Binance documents periodic account/order resets about monthly, without warning. Treat reset as a new account epoch and reconcile from exchange.
11. Add owner-visible operational state, cross-account exposure reconciliation, emergency cancellation procedure, and testnet-specific go/no-go. Only then consider autonomous virtual-fund tests.

## Sequence to fully operational LIVE

1. Read-only SHADOW production account integration with separate credentials, not permissions to trade.
2. Independently permissioned, reviewed, IP-restricted trade-only signer. Never grant withdrawals, transfers or key access to Trader Joe or worker logic.
3. Production venue adapter uses the same versioned order/decision/risk contracts but independently isolated balances, IDs, fills and protective orders. No testnet credentials or virtual ledger data may contaminate live accounting.
4. Transaction firewall enforces per-account allocation ceiling, per-order caps, daily loss and drawdown breaker, velocity and position limits, allowed symbols, verified stop protection, owner authorization and immutable logs.
5. Exhaustive venue-specific crash/timeout/restart/partial-fill/reconnection tests and real security review.
6. Confirm strategy evidence separately from execution certification. Existing small-sample built-in strategy tests were losing and not calibrated; operational capability does not prove profitability.
7. Satisfy every existing G01–G14 release gate, including G07 (isolated signing), G08 (independent security), G10 (30+ days / 50+ closed paper trades), G12 (live adapter/firewall), G13 (external release audit) and G14 (explicit owner approval). No boolean/config/PR alone can mark gates PASS.
8. Only after human go/no-go, run a separately approved, narrowly capped real-money pilot with rollback and venue/legal eligibility confirmation.

## Verification checklist for PR #92

- Typecheck server/web and build.
- Server full integration tests and isolated testnet signing tests; web and Playwright tests.
- Secret scan and fail-on-high dependency audit.
- Original PAPER execution path and risk gate remain unchanged.
- TESTNET still denies submitEntry and closePosition.
- LIVE still denies all orders and close requests even if an owner requests BOUNDED_LIVE.
- All testnet HTTP methods use https://testnet.binance.vision and exact endpoint allowlist; no production domain, order POST, cancellation or transfer.
- UI/API label testnet balances VIRTUAL and diagnostic validation as NOT PLACED.
- Real credentialed TESTNET connectivity remains unverified until the user supplies keys through their own secured server environment.

## Current caveats and sources

Binance reference: https://developers.binance.com/en/docs/products/spot/testnet/general-info  
Binance REST: https://developers.binance.com/en/docs/products/spot/testnet/rest-api

Official documentation confirms the Spot Testnet host and virtual assets, order/test never enters the matching engine, and periodic state resets. HTTP timeout and 5xx do not prove an actual order failed: a future executing adapter must reconcile UNKNOWN statuses instead of blindly retrying.

**No code from this PR should be represented as a certified LIVE gateway or profitable autonomous strategy. The owner's original scanner/QCI/risk/OMS and live lock remain authoritative.**
