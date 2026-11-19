# Trader Joe Live (V4): implementation status

Owner brief: `MIA_TRADER_JOE_LIVE_V4_ENGINEERING_MASTER_PROMPT.md`, from the owner's upload. The HTML concept is a visual reference only; its numbers are fictional. The source video was not supplied to this session, and nothing from it (branding, assets, text, figures) is used.

**Authority:** Trader Joe Live narrates committed PAPER records. It cannot place, change, approve or size anything, and it has no say in decisions or risk. Live trading, signing and withdrawals stay locked.

## Milestones

| Milestone | Scope | Status |
|---|---|---|
| J0 | Read-only audit of `main` (`2627cd2`) and open PRs | Done (in the M1 PR description) |
| **M1 (J1 + J2-lite)** | Typed lifecycle events, read-only projection, deterministic narrator, two owner-only endpoints | **Implemented in this PR** |
| M2 | Animated companion page: original SVG Trader Joe, checklist, timeline, cards, reduced motion, fallback | Not started (owner chose SVG first) |
| M3 | Live updates with catch-up, notification preferences, quiet hours | Not started |
| Durable order/fill events | Move order, fill and ledger events to the NEXUS fabric outbox (needs OMS transaction changes) | Not started; needs a trading-risk review |
| M4 | 3D avatar | Not started; deferred by owner choice |

## M1: what exists

| File | Role |
|---|---|
| `server/src/joe/live/events.ts` | Zod contract `JoeTradeEvent` (v1). Defines the 18 emittable kinds. `ORDER_PARTIAL` and `ORDER_UNKNOWN` are **reserved**, because the paper OMS fills all-or-nothing. `mode` is always `PAPER`. |
| `server/src/joe/live/projection.ts` | SELECT-only projection over committed rows; see the source table below. |
| `server/src/joe/live/narrator.ts` | Versioned fixed templates (`joe-live-templates@1`). No LLM. Provider symbols that are not plain tickers are masked. |
| `GET /api/joe/events?after=<cursor>&limit=<1..200>` | Without a cursor: the newest events, oldest first. With a cursor: events strictly after it. Returns `nextCursor`. Owner session required. |
| `GET /api/joe/events/by-position/:id` | Every event linked to one paper position. Owner session required. |

### Sources of truth

| Event | Read from |
|---|---|
| Decision recorded / no trade / waiting / risk denied | `decisions` (the decision state and the risk verdict with its reason codes) |
| Approval pending / rejected / cancelled / expired | `orders` (ENTRY rows) |
| SIMULATED PAPER entry / exit fill | `fills` + `orders`; cash from `ledger_entries` for that order |
| Stop monitoring started | `orders` (PROTECTIVE_STOP) + the position's initial stop; always says "not guaranteed" |
| Protection issue / recovered | `protection_incidents` |
| Position closed | Net P&L = sum of `ledger_entries` for the position's orders. It is cross-checked against `positions.realized_pnl` and flagged `reconciled: false` (with "review needed") if they differ by more than $0.01. |
| Trade review | `journal` AUTOPSY rows |
| Paused / emergency stop / resumed | Hash-chained `audit_log` `control.update` rows (other control changes are ignored) |

### Guarantees and limits

**Guarantees:**
- **Read-only.** A test checks that reading the story leaves every table's row count unchanged. A boundary test checks that the module imports only the DB read helper and zod, and contains no write SQL.
- **Idempotent.** Event ids are `<facet>:<record id>`, so the same records always give the same events in the same order.
- **Ordered paging.** Cursor paging returns every event once, oldest first.
- **Fail closed.** An event that does not pass the contract is dropped, never shown half-formed. Missing numbers read "unknown".

**Limits:**
- **Current-state projection.** M1 shows state as it is now. A pending approval is shown while pending and then replaced by its fill, rejection or expiry, so a filled order can never show as pending again. It is not yet a permanent per-event history: that comes with the outbox milestone.
- **Window size.** Each source contributes at most `limit + 50` rows per call. If more than 50 events share one millisecond at a page edge, some could be skipped; this is very unlikely at paper-trading rates.
- **Not yet built:** the UI, live SSE `joe_trade_event` updates, notification preferences, any LLM elaboration, and the avatar.

## Tests

`server/test/joe-live.test.ts` drives the real paper OMS rather than hand-made rows. It covers:
- a stop-out loss and a profitable close;
- a ledger/position mismatch;
- approval → fill, owner rejection and expiry;
- a risk denial and the other decision outcomes;
- a protection incident and its recovery;
- pause, emergency stop and resume;
- the contract, reserved kinds, duplicates, determinism and cursor paging;
- no writes, cursor validation and symbol masking;
- the import boundary, and route auth and validation.

Mutation checks (each makes a test fail):
- taking P&L from the position row instead of the ledger;
- an inclusive cursor boundary;
- treating "resume" as "pause".

## Rollback

M1 adds new files, two GET routes and no migration. To roll back, revert the PR. No data is written, so there is nothing to clean up.
