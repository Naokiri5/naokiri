# THINK slice 5: timeframe (horizon) conflict

- **Ticket:** MIA-THINK-037.
- **Owner:** `server/src/qci/challenge.ts` (existing CONTRARIAN reviewer; no new reviewer, no schema change).

## Rule

For each of 15m, 1h and 4h, the trend is:

- **UP:** price and EMA20 both above EMA50.
- **DOWN:** both below.
- **FLAT:** otherwise.
- **UNKNOWN:** features missing. Never guessed.

For a **long** candidate:

| Situation | Effect |
|---|---|
| Trend-following strategy (`trend_pullback`, `donchian_breakout`) **and** 1h DOWN **and** 4h DOWN | **Critical** challenge, so the consensus is VETOED, the decision rejected, and the certificate shows `HORIZON_CONFLICT`. |
| Any other horizon pointing DOWN | Listed as opposing evidence in the bear case; no veto. |
| `range_reversion` (buys dips by design) | Listed only, never vetoed by this check. |
| All aligned UP, or features missing | No finding. |

**It can only block trades, never add support.** It sits in the challenge panel, not the worker votes, so evidence replay (slice 4) is unaffected; this is tested.

## Tests

`server/test/think-horizons.test.ts`, 8 tests:

- pure classification and every rule above;
- the real pipeline on a market falling on every horizon: VETOED, then REJECT, then `HORIZON_CONFLICT`, and the replay is REPRODUCED;
- range-reversion on the same market is not horizon-vetoed;
- an aligned uptrend is unaffected.

## Not calibrated

The EMA20/EMA50 trend definition and the "1h and 4h both down" threshold are reasoned defaults, **not calibrated** on outcomes. Changing them needs out-of-sample evidence and a version note here.
