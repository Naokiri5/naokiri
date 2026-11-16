# Test Report

Latest run: 2026-11-16, end of Phase 1, Node 22.23.4, Linux.

## Automated tests (`npm test`)

**Result: 54 passed, 0 failed, 2 skipped** (the 2 skipped are the opt-in live-network tests). Typecheck of server and web: **pass**.

| File | Covers | Tests |
|---|---|---|
| `features.test.ts` | Incremental indicators equal batch calculation; Wilder RSI reference values; duplicate and out-of-order candles; regime detection | 5 |
| `quality.test.ts` | Data-quality gate (fresh, stale, cross-venue deviation, missing); order-book impact; RSS parsing | 6 |
| `qci.test.ts` | All 100 workers produce schema-valid signed packets; forged, replayed and out-of-scope packets rejected; dependency groups not double-counted; consensus states; safety veto; stale data fails closed | 6 |
| `risk.test.ts` | Policy required; read-only mode; sizing; daily-loss breaker; deposits don't count as profit; stop direction; price deviation; pause; emergency; strategy promotion; fail-closed on errors; owner-only limits; non-owner can only reduce risk | 9 |
| `oms.test.ts` | Book-walk entry, protective stop, stop exit, reconciliation, calendar; partial take-profit and breakeven trail; expired consensus; approval flow; emergency stop semantics; audit chain | 5 |
| `lab.test.ts` | Stop-before-target and gap fills; trailing only tightens; time stop; backtester runs all strategies without look-ahead; Monte Carlo determinism | 4 |
| `wallet.test.ts` | Keccak-256 vectors; EIP-55 checksums; network mismatch; withdrawals blocked; bot and assistant have no path | 3 |
| `api.test.ts` | Auth, passphrase strength, CSRF, step-up, PAPER needs a policy, `BOUNDED_LIVE` locked, all GET endpoints, Trader Joe's tool allowlist | 5 |
| `static.test.ts` (Phase 1) | UI + assets + SPA routes served; unknown API paths stay JSON; **5 path-traversal attempts blocked**; security headers | 4 |
| `phase1.test.ts` (Phase 1) | Request IDs; QHEF budgets from real samples; Security Center never leaks secrets; revoke-other-sessions needs step-up; Discover; history input validation; CSV formula-injection; copy-trading honest state | 7 |

## Browser end-to-end (`npm run test:e2e`, Playwright, Phase 1)

**Result: 32 passed, 0 failed**, repeated 3 times in a row. It runs against a fresh, offline server so it is deterministic:
owner setup → risk policy with step-up → funding → PAPER mode → Bounded Live refused → all **25 pages** render with no API
error → command palette navigation and pause action → CSV download → **zero browser console errors** → mobile (390 px) has
no horizontal overflow on 5 key pages.

## CI (`.github/workflows/ci.yml`, Phase 1)
Secret scan (verified to catch a planted fake key) → `npm audit --audit-level=high` → typecheck → unit tests → browser suite.

## Live verification (recorded 2026-11-16, not part of `npm test`)

| Check | Result |
|---|---|
| `npm run test:live -w server`: 7 real providers return data | pass |
| Paper round trip against the real Binance BTCUSDT book | pass: filled at the live ask; $3.72 fees and spread on ~$1,860 |
| Engine ran a full live cycle; autonomous paper entry (SPCXBUSDT, trend pullback) | observed |
| Fresh clone → `npm install` → `npm start` (auto-builds UI) | pass |
| Browser (Playwright) through the forwarded address: owner setup, policy, funding, PAPER mode, all 25 pages | pass, 0 console errors |
| Mobile 390 px width: no horizontal overflow | pass |
| 22 authenticated API endpoints → 200; unauthenticated → 401; SSE stream emits ticker/scan/bot events | pass |
| `npm run dev`: Vite proxy to backend | pass |

## Gaps (to close in later phases)
- No frontend component (unit) tests; UI is covered by the browser suite instead.
- First CI run happens when this branch is pushed; results appear on the pull request.
- Trader Joe's conversational (Claude API) mode has **never been executed**: no API key is configured.
- No performance-regression or load tests (Part 33.22). The QHEF page measured event-loop spikes up to ~220 ms (likely parsing the large all-market ticker download) — Phase 6.
- Windows startup fixes verified by code review only.
- Node < 22.13 version guard verified by code review only.
