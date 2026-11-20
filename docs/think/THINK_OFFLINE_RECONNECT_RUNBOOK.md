# THINK runbook: offline, outage, reconnect and rollback

This describes what MIA **actually does today**, checked against the code on 2026-11-18. It also says what it does **not** do. Paper trading only; Live is LOCKED.

## 1. What "offline" means

| Mode | How | What MIA does | What MIA cannot do |
|---|---|---|---|
| **Offline research** | `MIA_OFFLINE=1` | No market polling. `/api/ready` reports role `OFFLINE` and skips the engine checks. Stored decisions, certificates, **evidence replay** (`GET /api/decisions/:id/replay`), DITAS memory and verification, Strategy Lab history, and Academy all work on local data. | See live prices, trades or news; open, monitor or protect positions against new prices; receive any exchange acknowledgement. |
| **Online, feeds degrading** | Normal mode, a provider failing | Data-quality and risk gates fail closed (section 2). | Treat stale data as live. |
| **No connectivity at all** | Network down | Same as above, plus the readiness probe fails. | Exit or protect positions on new prices. In this paper build there is no exchange-resident stop (MIA-THINK-078 is BLOCKED until a certified Live venue exists). |

The decision engine and workers are deterministic and need **no cloud AI**. Trader Joe's conversational mode needs Anthropic; without it, Joe falls back to command mode.

## 2. Stale or missing data fails closed (verified in code and tests)

| Condition | Threshold (`market/quality.ts` `QUALITY_LIMITS`) | Effect |
|---|---|---|
| Quote too old | > 60 s | Data quality `FAIL`, so the decision is `INSUFFICIENT_DATA`; the certificate shows `STALE_OR_MISSING_MARKET_DATA`. |
| Order book too old for decisions | > 180 s | Quality degrades; liquidity and impact workers abstain. |
| Order book too old for execution | > 60 s (`MIA_MAX_EXEC_BOOK_AGE_MS`) | Risk gate `DENY ORDER_BOOK_STALE`. |
| Price anchor for a fill | > 120 s, or future-dated | Not usable (`quoteAgeOk`); no fill is invented from a ticker fallback. |
| An open position cannot be marked | Its quote or book stops updating | Risk gate `DENY POSITION_MARKS_MISSING` for **all** new entries. |
| Unprotectable open position | Protection incident open | `DENY PROTECTION_INCIDENT_OPEN` for that instrument. |
| Scanner stops completing | Watchdog (`ops/readiness.ts`) | One CRITICAL notification "Scanner stalled", and another on recovery. A stall never opens positions or relaxes risk. |
| Position monitor failing | Latest pass threw, or none within the ticker window | `/api/ready` `monitor: fail`. |
| Provider 429/418/503 with Retry-After | Per provider | That provider is blocked until the time given; its evidence goes missing (never zero). |

## 3. Reconnect checklist (owner)

1. **Readiness:** wait until `GET /api/ready` is `ready: true`. Tickers, monitor and scanner lanes must all pass.
2. **Status ribbon:** DATA must show LIVE, not STALE or OFFLINE.
3. **Positions:** Portfolio must show no `POSITION_MARKS_MISSING` or open protection incidents. Resolve incidents first; new entries stay blocked until then.
4. **Ledger:** check the **Reconciliation** badge on the Portfolio page. It comes from `portfolio/calendar.ts` `reconcile`, returned by `GET /api/portfolio` as `reconciliation`, and must show PASS.
5. **Memory integrity:** `GET /api/ditas/verify` must be `ok: true`, proving the hash chain and snapshots are intact.
6. **Evidence replay:** spot-check a few recent decisions with `GET /api/decisions/:id/replay`. Expect `REPRODUCED`. A `DIVERGED` or `NOT_REPLAYABLE` result is an incident: investigate before resuming.
7. **Resume:** if new orders were paused, resume from the Risk Center. This needs a passphrase step-up.

### Gaps (not built; see the ticket audit)

- **Durable source cursors** and exactly-once ingestion across restarts (MIA-THINK-076).
- **Automatic backfill** of missed bars, and a gap-recovery gate that blocks trading until backfill completes (MIA-THINK-077). Today, stale-data gates block entries until fresh data arrives, but gaps are not backfilled.
- **UI badges** that name the `OFFLINE_REPLAY` and `VENUE_UNKNOWN` states (MIA-THINK-080). Today the ribbon shows DATA LIVE / STALE / OFFLINE.

## 4. Rollback plan

| What | How to roll back | Data impact |
|---|---|---|
| THINK slice 1 (certificate, profit lab), PR #33 | Revert `82cc55b` | None (computed on read) |
| THINK slice 2 (boundary and fault tests), PR #34 | Revert `f7c239f` | None (tests only) |
| THINK slice 3 (risk-gate tests), branch `claude/mia-think-03-risk` | Revert `8216bfd` | None (tests only) |
| THINK slice 4 (evidence replay, evaluation clock) | Revert the slice-4 commit | New snapshots keep the extra `context.asOf` / `context.breadth` fields, which older code ignores. No migration. |
| Integration PRs #29–#32 (Privy wallets, CCXT, DeFi, Python labs) | Revert each PR's commit (listed in each PR) | None |
| Privy sign-in or wallets at runtime | Unset `MIA_PRIVY_APP_ID` / `MIA_PRIVY_EMBEDDED_WALLETS` and restart | Linked Privy id stays stored and becomes unused |
| Any runtime incident | Emergency stop (Risk Center) or pause new orders. Both are risk-reducing and available to Trader Joe (pause) and the owner. | None |
| Database | Restore from an encrypted, verified backup (`docs/operations/DEPLOYMENT_GUIDE.md` → Backup & restore). Migrations are append-only. | Restores to the backup point |

**No THINK slice adds a database migration.** Every slice can be reverted independently, in reverse order (4 → 1).
