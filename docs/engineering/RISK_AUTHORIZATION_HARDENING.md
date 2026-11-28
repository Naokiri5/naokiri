# Risk authorization hardening (gate -> paper OMS)

Owner milestone, 26 Nov 2026: close the three residual W11 findings before any LIVE consideration. Branch
`naokiri/jolly-wozniak-8q7ial` (PR #140). Paper-only; LIVE stays locked. An independent trading-risk design review ran
before the gate and OMS were edited; its two blockers and the applicable should-fix items are addressed below.

## What changed

| Issue | Change | Where |
|---|---|---|
| 01 Rounding margin | Exact lot-step floor in BigInt atomic units from the shortest decimal form of the quantity; never rounds up. Fails closed (`INSTRUMENT_RULES_INVALID`) on a zero, negative, NaN or non-decimal step and invalid minimums. Checks minQty, maxQty and minNotional after rounding; never raises a quantity to meet a minimum. | `server/src/risk/quantity.ts`, used by `risk/gate.ts` |
| 01 Venue metadata | Binance rules combine LOT_SIZE and MARKET_LOT_SIZE (stricter step and minQty, smallest non-zero maxQty). A missing or malformed filter value is NaN and refused, not 0. `maxQty` is carried onto `Instrument`. | `providers/binance.ts` `quantityRules`, `market/fabric.ts`, `market/types.ts` |
| 02 Default policy fallback | Entries no longer use `DEFAULT_POLICY`. The OMS refuses with `POLICY_UNAVAILABLE`, `POLICY_VERSION_MISMATCH` or `POLICY_INVALID` unless the policy in force is exactly the version the gate evaluated. The gate also re-validates the stored policy on every read. Exits and monitoring keep the fallback on purpose: a missing policy must never block a protective exit. | `exec/oms.ts`, `risk/gate.ts` |
| 03 Best-ask cost | Gate sizing now reports `limitPrice` (best ask + maxSlippageBps), `maxEntryFee` and `maxCost` (qty x limitPrice x (1 + feeRate)), and denies `INSUFFICIENT_BUYING_POWER` if maxCost exceeds cash. An entry needs a positive ask (`NO_ASK_QUOTE`); the last-price fallback is gone. `notional` and `estFees` keep their meaning (top-of-book estimates) so the API shape is unchanged. | `risk/gate.ts` |
| Binding | `issueEntryAuthorization` derives permission from the gate verdict itself (DENY never; NEEDS_REVIEW only for an owner-approved entry) and binds account, environment (paper modes only), instrument, side, qty, limit price, max cost, policy version, decision id and expiry. `entryExecutionDenial` checks the actual fill against it before any order, position or ledger row is written. | `exec/authorization.ts`, `exec/oms.ts` |

The session simulator uses the same exact floor (`floorToStep`) but keeps its own minimum rules, so existing simulator
reports are unchanged apart from the removed rounding epsilon.

## What the authorization is, and is not

Issue and verification run inside one synchronous SQLite write transaction against one market snapshot. In this build
the record is an invariant assertion: the booked order is exactly the order the gate sized. It is not a capability token
that survives across time or processes. A venue adapter would need its own enforcement (limit price or maximum spend on
the venue order); an estimate alone cannot bound a live market order.

## Tests

- `server/test/quantity.test.ts`: step boundary accepted, slightly above floored, below minimum rejected, float sums
  and exponent notation, max quantity, invalid rules, determinism.
- `server/test/risk-authorization.test.ts`: gate refusal, expired consensus, policy removed or changed after the gate,
  policy changed during execution, invalid stored policy, missing ask, invalid lot step, max quantity. Each refusal
  before execution asserts zero entry depth walks (the execution adapter) and nothing booked except the REJECTED order
  record. Also the authorization record's issue and verify rules (including fills exactly at the limit price and
  maximum cost), a second-lane entry sized from remaining cash, and Binance filter parsing.
- `server/test/oms-notional-backstop.test.ts`: the OMS notional backstop.
- Mutation checks run locally: restoring the default-policy fallback and removing post-fill verification each fail a test.

## Not in scope or not applicable

- TESTNET and LIVE adapters do not exist, so PAPER/TESTNET/LIVE parity cannot be tested. Every entry path uses the
  same gate, so the risk rules any future adapter receives are shared by construction.
- Capital reservations with `consumed + released = reserved` belong to roadmap P0.3. Entries are all-or-none, so partial
  entry fills cannot occur today.
- Concurrency: writes are serialized by `BEGIN IMMEDIATE`, the gate re-reads cash inside the transaction, and the lease
  fence guards across processes. Crash and race injection already lives in `crash.oms.test.ts`.
- Paper minimum-notional checks use the best ask. Binance MARKET orders check NOTIONAL against a 5-minute average price;
  that is a venue rule, not modeled here. NOTIONAL.maxNotional is not modeled; the gate's notional cap applies.
- Network and priority fees, currency conversion and margin do not apply to Binance spot paper entries. They must be
  added to `maxCost` before a venue that charges them is supported.
