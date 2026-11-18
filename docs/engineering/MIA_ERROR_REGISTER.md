# MIA error register — 100-agent audit (2026-11-18)

**Scope and baseline:**
- Baseline: branch `claude/blissful-planck-lazglg` @ `74fa093` (2026-11-18 07:27 UTC). Repairs: `319ec8f` … `9151e70`.
- Paper-only build. No finding involves live execution, which is locked: `LIVE_EXECUTION_AVAILABLE = false`, release gates G07, G08 and G12–G14 never pass.

**Evidence levels:**
- **REPRODUCED:** executed and the failure was observed.
- **CODE-CONFIRMED:** traced in code but not executed.
- **SUSPECTED:** plausible, not confirmed.

**Status:**
- **FIXED:** a regression test was written and run against the old code. Each FIXED item's test failed on the old code, except where a guard is noted.
- **OPEN:** not yet repaired.
- **OWNER:** needs an owner decision.
- **BLOCKED:** depends on something outside the repository.

Severity: S0 critical … S4 informational. **No S0 defect was found.** Earlier findings MA-01…MA-24 and SAFE-01…03 are in `MASTER_AUDIT_2026-11-18.md` and `AUTONOMY_AUDIT_2026-11-18.md`; their history is preserved there.

## A — Repository, architecture, documentation (Squad A)
| ID | Sev | Evidence | Where | Error | Status |
|---|---|---|---|---|---|
| A-01 | S3 | REPRODUCED | `.env.example`, `knowledge/extract.ts:12` | Inline `#` comments are kept in the value by a systemd EnvironmentFile. `MIA_KB_MAX_UPLOAD_MB` became NaN, so route registration failed (FST_ERR_ROUTE_BODY_LIMIT_OPTION_NOT_INT). | FIXED `3fa973a` |
| A-02 | S3 | CODE-CONFIRMED | `.env.example` | `MIA_BACKUP_KEY` and 9 other settings were missing from the template. | FIXED `3fa973a` |
| A-03 | S3 | CODE-CONFIRMED | `docs/ARCHITECTURE.md` | Stale identifiers (the live lock, Joe tools, signing location), a table list of 18 against the real 39, and `pdfjs-dist` missing. | OPEN (documentation) |
| A-04 | S4 | CODE-CONFIRMED | `README.md` | Stale test counts and error text; the newest audits are not linked. | OPEN |
| A-05 | S4 | REPRODUCED | `docs/engineering/audit-files.json`, `inventory.json` | Generated snapshots that are out of date. Superseded by `MIA_FILE_INVENTORY.csv`. | OPEN |
| A-06 | S4 | CODE-CONFIRMED | e.g. `whales/prints.ts _injectPrintsForTest` | Unused exports. | OPEN |
| A-07 | S4 | CODE-CONFIRMED | 7 routes, e.g. `/api/ditas/verify` | Not called by the web app and untested. `/api/ditas/verify` is now exercised through `verifyMemory` tests. | OPEN |

## B — Market data (Squad B)
| ID | Sev | Evidence | Where | Error | Status |
|---|---|---|---|---|---|
| B-01 | S2 | REPRODUCED | `market/fabric.ts setBook` | A REST book re-fetched with the same `lastUpdateId` was re-stamped as fresh, so frozen depth stayed executable. | FIXED `319ec8f` |
| B-02 | S2 | REPRODUCED | `market/fabric.ts refreshTickers` | One future-dated `closeTime` blocked every later ticker update until restart. | FIXED `319ec8f` |
| B-03 | S2 | REPRODUCED | `providers/http.ts`, `fabric.ensureRules` | No 429/418/Retry-After back-off. The first failing `exchangeInfo` was retried on every tick. | FIXED `319ec8f` |
| B-04 | S3 | REPRODUCED | `providers/binance.ts depth`, `store.price` | An unsorted or crossed REST book fed marks and sizing. | FIXED `319ec8f` |
| B-05 | S3 | CODE-CONFIRMED | `market/quality.ts walkBook` | No `validBook` guard. All callers check freshness first. | OPEN |
| B-06 | S3 | REPRODUCED | `providers/http.ts` | A provider is marked LIVE before its payload is validated. | OPEN |
| B-07 | S3 | REPRODUCED | Google News parser | A missing pubDate becomes "now"; a future pubDate is accepted. | OPEN |
| B-08 | S3 | CODE-CONFIRMED | `market/fabric.ts refreshRules` | Halted or delisted symbols are never removed. B-01 now makes their frozen books age out. | OPEN |
| B-09 | S4 | REPRODUCED | `exec/oms.ts`, `risk/gate.ts` | `floorStep` rounded up (`0.0029999999999` → `0.003`). There were two copies. | FIXED `319ec8f` (one canonical `floorToStep`) |
| B-10 | S4 | REPRODUCED | coingecko, frankfurter, dexscreener, kraken | Small validation gaps (null price, zero FX rate, never-refreshed caches). | OPEN |

## C — Indicators and workers (Squad C)
The indicator maths matched independent reference implementations exactly (max abs error 0) for EMA, MACD, RSI, ATR, ADX, Bollinger, Stochastic, %R, CCI, MFI, OBV, VWAP, realized vol, Donchian and ROC.

| ID | Sev | Evidence | Where | Error | Status |
|---|---|---|---|---|---|
| C-01 | S2 | CODE-CONFIRMED | `workers/registry.ts`, `qci/coordinator.ts` | The `mandatory` flag was never enforced. | FIXED `9d95001` (test is a guard: the v3 coverage rule already blocked the no-book case) |
| C-02 | S2 | REPRODUCED | `workers/registry.ts` | Dependency groups are per indicator, not per input: 21 groups come from one 1h kline series. | OPEN (changes consensus weighting; trading-risk review) |
| C-03 / J-01 | S2 | REPRODUCED | `workers/runtime.ts`, `core/util.ts withDeadline` | The 250 ms deadline never fired, because `evaluate()` is synchronous. | FIXED `9d95001` |
| C-04 | S3 | REPRODUCED | `workers/registry.ts` (W-STR-10, W-LIQ-09) | Throws on missing targets or safety checks, leading to global quarantine. | FIXED `9d95001` |
| C-05 | S3 | REPRODUCED | `features/indicators.ts` | No warm-up guard: %B, Stoch, CCI and others are computed from 2–3 bars. | OPEN |
| C-06 | S3 | REPRODUCED | `workers/registry.ts` (impact) | An unfillable book abstained instead of opposing with a veto. | FIXED `9d95001` |
| C-07 | S3 | REPRODUCED | `workers/registry.ts` (cost) | Supported a stop above entry (negative costR). | FIXED `9d95001` |
| C-08 | S3 | REPRODUCED | `workers/registry.ts` (quality) | Supports a WARN data-quality state. | OWNER/OPEN (with C-01 this would block most candidates) |
| C-09…C-12 | S3–S4 | mixed | `workers/registry.ts`, `features/indicators.ts` | Misclassified capability, redundant workers, flat-series signals, `Date.now()` in a worker, ±Infinity swings. | OPEN |

## D — QCI and decision engine (Squad D)
| ID | Sev | Evidence | Where | Error | Status |
|---|---|---|---|---|---|
| D-01 | S2 | REPRODUCED | `qci/coordinator.ts aggregate` | **A regression from QCI v3:** adverse packets of a domain whose group vote went elsewhere vanished (weighted opposition 0). | FIXED `f5735ed` |
| D-02 | S3 | REPRODUCED | `qci/coordinator.ts validatePacket` | The packet is not bound to the registry definition of its worker (domain, group, `canVeto`). Needs the in-process key to exploit. | OPEN |
| D-03 | S3 | REPRODUCED | `qci/coordinator.ts` | Duplicate packets from one worker inflated the response ratio to 5. | FIXED `f5735ed` |
| D-04 | S3 | REPRODUCED | `qci/coordinator.ts`, `challenge.ts` | No packet freshness check; the replay set is fully cleared at 200k entries. | OPEN |
| D-05 | S4 | REPRODUCED | `qci/challenge.ts` | "No crowding detected" when nothing was evaluated; a negative costR is not critical. | OPEN |
| D-06 | S2 | CODE-CONFIRMED (repro by test) | `qci/coordinator.ts:140` | A failed consensus INSERT was swallowed, so a decision could reference a missing record. | FIXED `f5735ed` |
| D-07 | S3 | CODE-CONFIRMED | `decision/engine.ts` | Policy version, weights and required domains are not stored on WAIT/MONITOR paths. | OPEN |
| D-08 | S3 | SUSPECTED | `market/scanner.ts:146` | Manual analyze uses `correlatedOpen=0`. | OPEN |

## E — Risk, OMS and accounting (Squad E)
**Squad E found no S0, S1 or S2 defect.** A full hand-calculated lifecycle matched the code to 2e-12 USD (entry book-walk, fee, partial target, trail, stop, cash, equity, open risk), and 4,426 partial exits showed no fee drift.

| ID | Sev | Evidence | Where | Error | Status |
|---|---|---|---|---|---|
| E-01 | S3 | REPRODUCED | `portfolio/calendar.ts reconcile` | An orphan or edited ledger row still reconciled OK. This feeds the integrity check, gate G05 and the badge. | FIXED `7bad7a6` |
| E-02 | S4 | REPRODUCED | `exec/oms.ts` monitor | A TIME exit in the same pass as a target left a one-lot remainder. | FIXED `7bad7a6` |
| E-03 | S4 | REPRODUCED | `exec/oms.ts submitEntry` | Target fractions were not validated (−1, NaN, sums above 1). | FIXED `7bad7a6` |
| E-04 | S4 | CODE-CONFIRMED | `exec/oms.ts applyExit` | A remainder below `minNotional` is never snapped (matters for live parity). | OPEN |
| E-05 | S4 | REPRODUCED | `portfolio/ledger.ts` | A missing mark contributes zero open risk to the display. The gate still denies. | OPEN |
| E-06 | S4 | CODE-CONFIRMED | ledger, oms | Equity is marked at mid; `planned_risk` excludes the exit fee. | OPEN |
| E-07 | S4 | CODE-CONFIRMED | `portfolio/calendar.ts` | A zero-PnL trade counts as a loss in the calendar. | OPEN |

## F — Backtesting and strategies (Squad F)
No look-ahead (0 mismatches over 125 trades), the conservative stop-first rule, gap fills and every metric (win rate, expectancy, profit factor, max drawdown, Sharpe, Sortino) were verified by hand.

| ID | Sev | Evidence | Where | Error | Status |
|---|---|---|---|---|---|
| F-01 | S2 | REPRODUCED | `lab/lab.ts setStrategyStatus` | PAPER promotion accepted one losing out-of-sample trade. | FIXED `2d7ce08` (≥ 30 OOS trades and positive expectancy, or an audited OVERRIDE) |
| F-02 | S3 | CODE-CONFIRMED | `lab/lab.ts` | Lab OOS evidence can be cherry-picked; no trial count is kept. | OPEN |
| F-03 | S3 | REPRODUCED | `lab/exits.ts`, `backtest.ts` | TIME exits are not slipped. | OPEN |
| F-04 | S3 | CODE-CONFIRMED | `lab.ts:142`, `research.ts:37` | Closed-candle cutoff uses the response time. | OPEN |
| F-05 | S3 | CODE-CONFIRMED | `lab/backtest.ts` | No candle-contiguity check. | OPEN |
| F-06 | S3 | CODE-CONFIRMED | Lab UI | No uncertainty shown for OOS results. | OPEN |
| F-07…F-10 | S3–S4 | mixed | research, backtest | Population SD in Sharpe, empty-stats conventions, a weak look-ahead test, no minimum risk distance. | OPEN |

## G — DITAS decision memory (Squad G)
Immutability triggers, tamper detection on events, snapshots and blobs, exact store-once round trips, Decision Twin isolation, no outcome leakage, and calibration maths (hand-checked) were all verified.

| ID | Sev | Evidence | Where | Error | Status |
|---|---|---|---|---|---|
| G-01 | S2 | REPRODUCED | `db/db.ts` | `INSERT OR REPLACE` bypassed the DITAS delete triggers and silently rewrote immutable rows. | FIXED `3fa973a` (`recursive_triggers=ON`) |
| G-02 | S2 | REPRODUCED | `ditas/memory.ts verifyMemory` | Forecasts, outcomes and twin runs were not verified. | PARTLY FIXED `9151e70` (twin-run hashes). Forecasts and outcomes have no hash: OPEN (needs an append-only schema addition) |
| G-03 | S3 | REPRODUCED | `ditas/memory.ts` | A missing referenced snapshot verified OK; truncating the chain tail is undetected. | FIXED `9151e70` (missing snapshot). Tail anchor: OPEN |
| G-04 | S3 | CODE-CONFIRMED | migrations, scanner | No DITAS retention possible (same as MA-13). | OWNER |
| G-05 | S3 | CODE-CONFIRMED | `ditas/service.ts addOutcome` | Calibration outcomes are self-reported and never cross-checked against candles. | OPEN |
| G-06…G-08 | S4 | mixed | calibration, docs, scanner | Bin boundary float error at 100 bins, docs missing `ditas_blobs`, a shared dedupe key. | OPEN |

## H — API and frontend (Squad H)
All 107 routes were fuzzed: no 5xx, no leaked internals, auth and CSRF enforced, and every response field the pages read exists.

| ID | Sev | Evidence | Where | Error | Status |
|---|---|---|---|---|---|
| H-01 | S3 | REPRODUCED | `web/src/pages/Markets.tsx:25` | An empty timeframe shows "Loading candles…" forever. | OPEN |
| H-02 | S3 | CODE-CONFIRMED | `Markets.tsx:79` | The chart computes its own EMA, which differs from the FeatureEngine. | OPEN |
| H-03 | S3 | CODE-CONFIRMED | `Trading.tsx:199` | A deep-tier backtest loop swallows 429s. | OPEN |
| H-04 | S3 | REPRODUCED | `knowledge/routes.ts:85` | The rate-limit token was spent before validation. | FIXED `3fa973a` |
| H-05, H-06, H-07 | S3–S4 | CODE-CONFIRMED | Intel, Trading, App, ui.tsx, Account | Keyboard access for clickable rows and modals; labels. | OPEN |
| H-08 | S4 | REPRODUCED | `api/routes.ts /api/control` | Unknown keys were accepted. | FIXED `3fa973a` |
| H-09…H-13 | S4 | mixed | various | Unbounded strings, 400/409 instead of 404, replay `t` bound, missing catch, read-only radios. | OPEN |

## I — Security, operations, performance (Squad I)
Measured: start-up 0.8–1.6 s; SIGTERM to exit 13–29 ms; leader/standby correct; takeover 2.0 s; idle event-loop p99 ≤ 3.1 ms; RSS flat at 102 MB over 65 s. No passphrase or cookie appeared in the logs.

| ID | Sev | Evidence | Where | Error | Status |
|---|---|---|---|---|---|
| I-01 | S3 | REPRODUCED | `api/routes.ts:153`, `auth.ts:77` | The passphrase change was rate-limited by IP, so a stranger behind a forwarder could block it. | FIXED `2d7ce08` (login keyed by IP is unchanged: see MA-04) |
| I-02 | S3 | REPRODUCED | `ops/backup.ts` | A tampered plaintext backup plus a recomputed manifest passes verification (unauthenticated manifest). | OPEN (key management, owner) |
| I-03 | S3 | REPRODUCED | `ops/backup.ts` | Plaintext backups were 0644. | FIXED `2d7ce08` |
| I-04 | S3 | REPRODUCED | `ops/backup.ts createBackup` | Creating a 150 MB backup blocks the event loop for 1.1 s (+145 MB). | OPEN |
| I-05 | S3 | CODE-CONFIRMED | `ops/backup-cli.ts` | No restore command; `evidence.key` is not backed up. | OPEN |
| I-06 | S4 | CODE-CONFIRMED | `api/routes.ts` | Paper DEPOSIT and approving an order need no step-up. | OWNER |

## J — QA, types, duplication (Squad J)
| ID | Sev | Evidence | Where | Error | Status |
|---|---|---|---|---|---|
| J-02 | S3 | CODE-CONFIRMED | `qa/gates.ts` | G05 and G06 reported PASS on an empty database. | FIXED `9151e70` |
| J-03 | S3 | CODE-CONFIRMED | `qa/gates.ts` G10 | The "30-day" evaluation counts from the first trade, so 1 old trade plus 49 today passes. | OPEN |
| J-04 | S3 | CODE-CONFIRMED (repro by test) | `exec/oms.ts`, `qci/coordinator.ts` | A garbage expiry was treated as not expired (fail-open); one bad approval stopped the expiry loop. | FIXED `3fa973a` |
| J-05 | S3 | CODE-CONFIRMED | gate, challenge, registry | Three costR copies with different maths and thresholds. | OPEN (consolidation needs trading-risk review) |
| J-06…J-10 | S3–S4 | CODE-CONFIRMED | ledger, calendar, schemas, db, e2e | Day bucketing, duplicated candle schemas, `any` at the DB boundary, e2e not typechecked, timers not unref'd. | OPEN |

## Non-defects that were checked
Every intended 401 (unauthenticated), 403 (no CSRF header or step-up), 413 (body limit) and 429 (rate limit) seen in fuzzing was correct behaviour, not a defect.
