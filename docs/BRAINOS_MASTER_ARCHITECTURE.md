# MIA BrainOS — Master Architecture and Pending-Work Register

**Status of this document:** authoritative master for the BrainOS specification ("One Brain. Two Trading Modes. One
Autonomous System."). Dated increment logs stay in `docs/engineering/MIA8_HOTPATH_RECONCILIATION.md`; trust boundaries
of the 4.1 core stay in `docs/ARCHITECTURE.md`. When those disagree with this document, verify against code and update
the one that is wrong. Do not add another master specification.

**Last verified:** 2026-11-25, on branch `naokiri/fervent-dijkstra-46ctbr`, stacked on PR #137 head `b98d0d1`.
**Execution authority:** PAPER only. LIVE is locked. FAST and DEEP are research-only pathways.

## 1. Central authorities

Each authority below has exactly one implementation. New work must extend it, not add a competitor.

| Authority | Module | Status | Evidence |
|---|---|---|---|
| Session and mandate | `server/src/ops/durableSession.ts`, `ops/paperSpotEntry.ts`, `ops/tradingMandate.ts` | Verified (paper spot lane) | `test/durable-session.test.ts`, `test/trading-mandate.test.ts`, `test/brainos-paper-flow.test.ts` |
| Readiness and preflight | `server/src/ops/sessionPreflight.ts` | Verified | `test/session-preflight.test.ts`, `test/api.test.ts` |
| Execution lease | `server/src/ops/lease.ts` | Verified | `test/ops-lease*.test.ts`, process takeover tests |
| Risk | `server/src/risk/gate.ts` | Verified | Imported only by `exec/oms.ts` and `decision/engine.ts`; `test/risk*.test.ts` |
| OMS | `server/src/exec/oms.ts` (`VENUE = 'binance-paper'`) | Verified for paper; no live path exists | `test/oms.test.ts` |
| Ledger | `server/src/portfolio/ledger.ts` | Verified | 19 in-tree importers; `reconcile()` checks in OMS and preflight |
| Scheduler | `server/src/bot/bot.ts` (lease-fenced lanes) | Verified | `test/ops-lease.test.ts`, `test/ops-lease-hardening.test.ts`, `test/durable-session.test.ts` |
| Strategy lifecycle | `server/src/lab/strategies.ts` (`STRATEGIES`, versioned) | Partial | Versions are bound into each mandate |
| Learning | `server/src/ditas/` | Partial (connected) | Imported by `bot.ts` (`memory`, `service`, `forecastVerifier`) and `decision/engine.ts` |

## 2. Subsystem classification (Phase 1 audit)

Classes: **verified** (tested and reachable at runtime), **partial**, **research-only** (runs, but has no execution
authority), **disconnected** (no runtime importer), **missing**, **unverified** (not audited in this increment),
**blocked** (needs an external dependency or owner decision).

| Subsystem (spec §5) | Class | Evidence |
|---|---|---|
| `decision/think-router.ts` | Partial | Only importer is `decision/engine.ts`; behavior not re-audited here |
| `choice/dualRuntime.ts` | Research-only | Scheduled from `bot.ts`; FAST/DEEP preflight `execution-lane` is always `BLOCKED` |
| `choice/dualResearch.ts` | Research-only | Imported by `dualRuntime`, `sessionPreflight`, `routes` |
| `knowledge/cognitive/deepCycle.ts` | Disconnected | Zero importers in `server/src`; exercised only by `test/brainos7-deep.test.ts` |
| `market/flinQueue.ts` | Research-only | Imported only by `dualRuntime`; candidate states are `QUARANTINED` or `REJECTED` |
| `ops/durableSession.ts` | Verified | Durable checkpoint plus event log; lease-fenced recovery |
| `ops/sessionPreflight.ts` | Verified | `canRun` is false for FAST and DEEP; the spot lane has real checks |
| `risk/gate.ts`, `exec/oms.ts`, `portfolio/ledger.ts` | Verified (paper) | See section 1 |
| `bot/bot.ts` | Verified | Lanes: hot, protection, books, research; mandate expiry runs in the protection lane |
| `ditas/` | Partial | Connected; calibration and holdout claims not re-verified here |
| `lab/eventReplay.ts`, `lab/tape-reader.ts` | Research-only | No runtime importer; `test/historical-replay.test.ts`; not a portfolio backtester |
| `web/src/pages/AutopilotSession.tsx` | Verified | `e2e/app.spec.ts` (65 Chromium tests passing) |
| FAST execution (Token-2022, sell-route simulation, holders) | Missing / blocked | `providers/pending.ts` lists `solana_rpc` and `evm_rpc` as pending credentials |
| DEEP execution (margin, liquidation, reduce-only, funding) | Missing | No futures OMS or margin ledger exists |
| Affect layer (spec §14) | Missing | Not started |
| Trader Joe (`joe/joe.ts`) | Partial | Reads the real preflight; tool allowlist has no order, limit, mode or withdraw tools (`test/api.test.ts`) |
| Railway runtime | Partial, in PR #138 | `Dockerfile`, `railway.json`, `PORT` fallback in `config.ts`, `test/deploy-config.test.ts`; not deployed or verified here |
| Vercel decommissioning | Unverified | No `vercel.json` in the repository; Vercel checks fail on #137 (`TS2688`); live project inventory not performed |
| Privy identity | Partial | Production sign-in is Privy; step-up uses TOTP (`security/stepUp.ts`) |
| Cloudflare edge | Unverified | Documented in PR #138 (`docs/operations/RAILWAY_CLOUDFLARE_DEPLOYMENT.md`) |
| Landing page | **Owner-designed in PR #138: authoritative** | See section 9 |

## 3. Trading mandate model (spec §6)

A mandate is persisted with the session (migration 7, append-only) and can only **narrow** what the risk gate and OMS
already allow. It never sizes a position, never authorizes an entry by itself and never unlocks LIVE.

| Field | Column | Source |
|---|---|---|
| Session identifier, version, state | `session_id`, `version`, `state` | Existing checkpoint (migration 6) |
| Trading mode | `mind` (`SPOT_PAPER`, `FAST`, `DEEP`) | Run Session |
| Execution environment | `environment` | Always `PAPER` from Run Session |
| Market and instrument scope | `market_scope` | Derived from the lane: `BINANCE_SPOT`, `SOLANA_MEMECOIN`, `FUTURES` |
| Authorized capital ceiling | `capital_ceiling` | Owner input; must be at most paper cash plus open cost basis |
| Risk policy version | `risk_policy_version` | Accepted policy at authorization |
| Strategy configuration version | `strategy_config_version` | `id@version` list from `STRATEGIES` |
| Owner identity | `authorized_by` | `owner:<step-up method>` |
| Authorization and expiry | `authorized_at`, `expires_at` | Owner-selected duration, 1–720 hours |
| Canonical lease identity | `lease_holder`, `lease_acquired_at`, `fence_epoch` | Engine lease at authorization |
| Recovery status | `state`, `suspend_reason` | Recovery always lands in a suspended state |
| Audit snapshot | `brainos_session_events.mandate_json` | Written on every transition |

**Enforcement points**, all inside the OMS write transaction:

1. `paperSpotEntryDenial()` → `mandateEntryDenial()`: environment must be `PAPER`; the mandate must be complete, in scope
   for its lane, unexpired, and bound to the current risk policy and strategy set. The entry's classified scope must
   match the mandate scope (`MARKET_OUTSIDE_SESSION_MANDATE`), and its strategy version must be in the authorized set.
2. `paperSpotCapitalDenial()`: open paper cost basis plus the actual fill notional and fees must not exceed
   `capital_ceiling` (`MANDATE_CAPITAL_CEILING`). The check runs under the same SQLite write lock as the fill.
3. Sessions upgraded from migration 6 have no mandate. They fail closed with `SESSION_MANDATE_MISSING`, and the owner
   must close and re-authorize them.

Installations with no session checkpoint keep their prior owner-configured paper controls (unchanged behavior).

## 4. Session state transitions

```
CLOSED ──Run Session (step-up + preflight + lease + mandate)──▶ RUNNING
RUNNING ──Close Session / mandate expiry──▶ CLOSING_DRAINING_ENTRIES ──all positions closed, ledger reconciled──▶ CLOSED
RUNNING ──risk halt / owner pause──▶ ENTRY_SUSPENDED_RISK_HALT ──Close Session──▶ CLOSING_DRAINING_ENTRIES
any ──emergency stop──▶ EMERGENCY_KILL_SWITCH ──owner clears stop, then Close Session──▶ CLOSING_DRAINING_ENTRIES
RUNNING / CLOSING ──lease takeover──▶ RECOVERING_ON_BOOT ──▶ ENTRY_SUSPENDED_RISK_HALT (never re-authorizes entries)
```

Mode switching is close-then-authorize. There is no hot switch, and no automatic PAPER↔LIVE switch. Protective exits and
ledger reconciliation continue in every state except `CLOSED`.

## 5. FAST and DEEP pathways

FAST (Solana memecoins) and DEEP (futures) currently produce research evidence only. Their preflight reports
`execution-lane: BLOCKED`, `openDurablePaperSession` refuses them (`SESSION_EXECUTION_LANE_NOT_CERTIFIED`), and the spot
OMS denies any entry from a FAST or DEEP session (`SESSION_NOT_SPOT_PAPER`). The only executable lane is Binance spot
paper. The Autopilot cards say "Research only" from server checks, never from client assumptions.

## 6. Financial authority boundaries

Only `exec/oms.ts` writes orders, fills, positions and ledger rows. Trader Joe, cognitive memory, DITAS, research and the
planned affect layer have no write path to those tables. A mandate adds denials only.

## 7. Emotional intelligence boundaries (planned, spec §14)

The affect layer must live inside existing memory, be grounded in observed events, and be read only by presentation
(mascot expression and tone). It must never be an input to `risk/gate.ts`, sizing, leverage, policy, wallet permissions
or strategy promotion. Required test before merge: an affect state change leaves `evaluateRisk` and `submitEntry`
outputs identical.

## 8. Deployment topology

Target: Railway as the single runtime, holding one volume-backed engine lease; Cloudflare at the edge; Privy for
identity. The Railway foundation is in PR #138 (`Dockerfile`, `railway.json`, `PORT` fallback). Vercel decommissioning
needs a live inventory, a staged Railway PAPER soak, and explicit owner cutover approval. Do not delete Vercel projects
or required checks before that.

## 9. Interface design system

- **Landing page:** the owner's redesign in PR #138 (`web/src/landing/**`, `Landing.tsx`, `landing.css`, `styles.css`,
  `App.tsx`, `AppShell.tsx`) is authoritative. PR #137 also changes `Landing.tsx`, `landing.css`, `App.tsx`,
  `styles.css`, `index.html`, `Markets.tsx`, `WalletLogin.tsx`, `README.md`, `docs/DEPLOYMENT_GUIDE.md`,
  `e2e/landing.spec.ts` and `package-lock.json`. When the two merge, resolve landing conflicts in favor of #138.
- **Mandate accents** (`web/src/tokens.css`): FAST `--mia-fast #F48BB8`, DEEP `--mia-deep #A5D8FF`, plus `--mia-cream`
  and `--mia-graphite`. Text uses the `*-ink` variants: the raw accent in the dark theme (7.5:1 and 11.2:1 on the panel),
  and `#A3245F` / `#1B5E87` in the light theme (≥ 6.6:1). Raw pink on white is 2.3:1, so it is used only for fills,
  borders and shadows.
- **Motion:** transform and color transitions only; a 2px card lift on hover and a press on click; disabled by
  `prefers-reduced-motion` through the existing `.shell` rule.

## 10. Pending-work register

| ID | Item | Owner module | Priority | Depends on | Status | Verification required |
|---|---|---|---|---|---|---|
| M1 | Mandate for the spot paper lane | `ops/tradingMandate.ts` | P0 | — | **Done** (this increment) | `trading-mandate.test.ts`, `durable-session.test.ts` |
| M2 | Mandate-aware Autopilot UI | `web/src/pages/AutopilotSession.tsx` | P1 | M1 | **Done** (this increment) | e2e plus screenshots at 1440/1024/768/390 |
| M3 | Merge #137 and #138 with #138 landing preserved | integration | P0 | owner review | Pending | Exact-head CI on the merge candidate |
| D1 | Railway staging PAPER soak, restart and volume recovery | `Dockerfile`, `railway.json` (#138) | P0 | M3 | Pending | Process replacement, WAL recovery, lease fencing |
| D2 | Vercel inventory and staged decommission | ops | P1 | D1 + owner approval | Pending | Inventory, rollback plan, owner sign-off |
| F1 | FAST token-safety providers (mint and freeze authority, Token-2022, sell route) | `providers/`, `market/flinQueue.ts` | P1 | `solana_rpc` credentials | Blocked | Fixture plus opt-in live provider tests |
| F2 | FAST paper execution lane and OMS adapter | `exec/` | P1 | F1 | Missing | Mandate scope tests already cover denial |
| G1 | DEEP futures margin, liquidation and funding accounting | `portfolio/`, `exec/` | P1 | — | Missing | Margin invariants, reduce-only tests |
| G2 | Wire `knowledge/cognitive/deepCycle.ts` into a runtime lane or retire it | `bot/bot.ts` | P2 | — | Disconnected | Call-site proof |
| C1 | Affect layer inside memory (presentation only) | `knowledge/` | P2 | — | Missing | Invariance test (section 7) |
| C2 | Trader Joe mandate awareness (scope, capital, expiry) | `joe/joe.ts` | P2 | M1 | Pending | Joe reads `/api/session/paper-spot` mandate |
| H1 | Portfolio backtester (beyond execution-cost probes) | `lab/` | P2 | — | Missing | Walk-forward, out-of-sample |

## 11. Release blockers

LIVE: no venue adapter, signer, certification or owner LIVE approval. Release gates fail closed (`G07` and others are
unmet). Production: no verified Railway deployment, and no prospective unattended PAPER soak.

## 12. Rollback

Migration 7 only adds nullable columns. Reverting the code leaves the columns unused: older code neither reads nor
requires them, and its upsert leaves them untouched. Never edit migration 7 in place; correct it with migration 8.

## 13. Evidence for this increment (2026-11-25)

| Command | Result |
|---|---|
| `npm run typecheck` | Pass (server and web) |
| `npm test -w server` | 62 files passed, 1 skipped; 814 tests passed, 3 opt-in skipped |
| `npm run test:e2e -- --trace off` | 65 passed (Chromium, offline fixtures) |
| Visual check | No horizontal overflow at 1440/1024/768/390 in dark and light themes |

The full command list for the final commit is in the PR description.
