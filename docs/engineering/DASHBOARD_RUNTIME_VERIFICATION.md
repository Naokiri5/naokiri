# Dashboard & backend runtime verification

| | |
|---|---|
| Date | 2026-11-17 |
| Branch | `claude/blissful-planck-lazglg` (PR #7). `main` (`d7c6b0b`) is unchanged. |
| Data | An isolated temporary `MIA_DATA_DIR`. The owner's database was never touched. |
| Market data | Live (Binance, Coinbase, Kraken, CoinGecko, DexScreener, Frankfurter and Google News, through the session proxy) |

Status labels follow the master prompt:
- **VERIFIED_WORKING**: run in a real browser, or against the real API, with the result observed.
- **IMPLEMENTED_UNVERIFIED**: code and tests exist, but not observed live here.
- **PARTIAL**, **BLOCKED**, **BROKEN** and **MISSING** have their usual meanings.

## 1. Startup (production mode)

| Check | Command / evidence | Result |
|---|---|---|
| Toolchain | `node -v`, `npm -v` | 22.23.4 / 10.9.9 (≥ 22.13 required) |
| Build | `npm run build` | pass |
| Start | `npm start` (port 8790, isolated data dir) | Listening. The banner reports paper trading only. |
| Dev mode | `npm run dev` (isolated data dir, offline) | API on `:8787` returns `{"ok":true,"schema":4}`. Vite on `:5173` proxies `/api/health` to it with the same response and serves the UI. |
| Health | `curl -i /api/health` | `200` with `{"ok":true,"version":"4.1.0","schema":4,"offline":false}` and security headers (CSP, nosniff, DENY, no-store) |

## 2. Browser walkthrough (Playwright Chromium, logged-in owner)

The crawler did the following:
- Logged in.
- Read every link in the sidebar navigation.
- Opened each route, plus `/terminal/BTCUSDT`.
- Waited 3.5 s per page.
- Recorded console errors and warnings, page exceptions, every `/api/*` response with status ≥ 400, failed requests, and on-screen error banners (`role=alert`).

**Result: 28 routes, 0 issues.**

| Workspace | Status | Workspace | Status |
|---|---|---|---|
| Overview | VERIFIED_WORKING | Bot Account | VERIFIED_WORKING |
| DITAS Decision Intelligence | VERIFIED_WORKING | Risk Center | VERIFIED_WORKING |
| Market Terminal (`/terminal`, `/terminal/BTCUSDT`) | VERIFIED_WORKING | Portfolio | VERIFIED_WORKING |
| AI Scanner | VERIFIED_WORKING | Trading History | VERIFIED_WORKING |
| Asset Discovery | VERIFIED_WORKING | Trade Journal | VERIFIED_WORKING |
| AI Intelligence | VERIFIED_WORKING | Profit Calendar | VERIFIED_WORKING |
| Quant Academy | VERIFIED_WORKING | Strategy Lab | VERIFIED_WORKING |
| QHEF Performance | VERIFIED_WORKING | Wallet & Withdrawals | VERIFIED_WORKING (withdrawals locked by design) |
| Trader Joe | PARTIAL: command mode only; conversational mode needs `ANTHROPIC_API_KEY` | Security Center | VERIFIED_WORKING |
| Market Bubble Map | VERIFIED_WORKING | Connections Hub | VERIFIED_WORKING |
| Whale & Launch Monitor | PARTIAL: exchange large trades only; wallet-level data is BLOCKED (on-chain provider) | Notifications | VERIFIED_WORKING |
| Copy Trading | BLOCKED (on-chain provider; the page says so) | Release Gates | VERIFIED_WORKING (3/14 pass; live execution LOCKED) |
| Holder Map | BLOCKED (on-chain provider; the page says so) | Settings | VERIFIED_WORKING |
| News & Events | VERIFIED_WORKING (Google News RSS) | | |

The rows marked "VERIFIED_WORKING" mean the page rendered live data without errors. They do not certify every
control on each page.

## 3. API sweep (authenticated)

All 52 parameter-free `GET` routes were called with an owner session:
- 51 returned `200`, each in under 1 s.
- 1 returned `400` (`/api/academy/search` without `q`). That is correct validation.

## 4. Paper workflow against live data (API)

The workflow ran in order, and every step returned `200` with the expected state:
1. Accept the default risk policy with step-up → v1.
2. Fund $10,000.
3. Switch to PAPER mode with step-up.
4. Analyse BTC and ETH. Safety came back `eligibleForAutomation`, and quality was `OK` with fresh quote and book ages.
5. Run protection reconciliation → `CONFIRMED`.
6. Read `/api/risk` → mode PAPER, policy v1, equity 10,000, 0 incidents, live execution LOCKED.

## 5. Defects found and fixed in this increment

| ID | Severity | Defect | Root cause | Fix | Regression test |
|---|---|---|---|---|---|
| B-1 | P2 (information leak) | `/api/decisions?decision=a&decision=b` and `/api/journal?kind=a&kind=b` returned the internal SQLite error text (`Unknown named parameter '0'`) | Raw `req.query` values (arrays) were bound straight to SQL | Zod validation on every remaining raw route input (ids, query tokens, emergency action body, policy body, CSV export). Repeated keys are now rejected with a 400 validation message. | `api.test.ts` "repeated query keys…": fails on the old routes, passes now |
| B-2 | P3 (UX) | The Overview activity data could be flooded by one instrument rejected on every scan cycle | No de-duplication | Identical events collapse into one row with `×count since` | `dashboard.test.ts` |
| B-3 | P3 (honesty) | "0 / 86 productive workers" read as broken before any candidate existed | Workers run only when a strategy produces a candidate | The card shows "standing by" with that reason until workers have run | visual check (live) |

## 6. Overview dashboard (Section 6)

`GET /api/overview` is backed by `server/src/dashboard/overview.ts`, a read-only composition of state that other
modules own:
- **Paper account:**
  - equity, available cash and positions value
  - open positions against the policy maximum, and open risk
  - unrealized P&L, with a warning when marks are missing
  - realized P&L, closed trades and fees (from closed positions)
  - today and week returns, and drawdown
- **Market intelligence:** breadth, BTC regime, scanner recency (flagged STALE after 5 min) and worker/consensus status.
- **Risk monitor:**
  - operating mode, policy version and emergency/pause state
  - protection incidents
  - live-execution gate summary
  - limit meters for daily loss, weekly loss, drawdown, open risk and positions (shared `Meter` component, also used by the Risk Center)
- **Data sources:** status of every provider, last success, latency and last error. The FX source is labelled "daily reference (not executable)".
- **Activity:** decisions, paper fills, scanner rejections, alerts and protection incidents, newest first, de-duplicated.
- Trader Joe's daily briefing and critical alerts are kept.
- Emergency stops and open protection incidents raise a banner at the top.

The fields of the original `/api/overview` contract are unchanged. A missing policy gives `null` limits, and the UI
shows "Limits appear once a risk policy is accepted". No values are invented.

DITAS gains an **Execution quality** tab showing the PR #8 endpoint. It covers actual paper orders only.

Layout is verified at 1440×900 and 390×844, with no horizontal overflow and no console errors.

## 7. Not verified here

- Trader Joe conversational mode: no API key is configured.
- Long-running (multi-day) operation, load testing and backup/restore drills. See R-39 in `REQUIREMENTS_TRACEABILITY.csv`.
