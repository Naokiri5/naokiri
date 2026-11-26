# MIA BrainOS — Master Architecture and Pending-Work Register

**Status of this document:** authoritative master for the BrainOS specification ("One Brain. Two Trading Modes. One
Autonomous System."). Dated increment logs stay in `docs/engineering/MIA8_HOTPATH_RECONCILIATION.md`; trust boundaries
of the 4.1 core stay in `docs/ARCHITECTURE.md`. When those disagree with this document, verify against code and update
the one that is wrong. Do not add another master specification.

**Last verified:** 2026-11-25, on branch `naokiri/fervent-dijkstra-46ctbr`, stacked on PR #137 head `b98d0d1`.
**Execution authority:** PAPER only. LIVE is locked. FAST and DEEP are research-only pathways.

The 64-responsibility verification matrix, weakness register, data-flow owner map and prioritized backlog are in
[`BRAINOS_V2_COMPONENT_INVENTORY.md`](BRAINOS_V2_COMPONENT_INVENTORY.md).

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
| Authorized capital ceiling | `capital_ceiling` | Owner input; must be at most paper cash plus open cost basis. Bounds open cost basis **plus** net losses (fees included) realized by positions opened under the mandate |
| Risk policy version | `risk_policy_version` | Accepted policy at authorization |
| Strategy configuration version | `strategy_config_version` | `id@version` list from `STRATEGIES` |
| Owner identity | `authorized_by` | `owner:<step-up method>` |
| Authorization and expiry | `authorized_at`, `expires_at` | Owner-selected duration, 1–720 hours |
| Canonical lease identity | `lease_holder`, `lease_acquired_at`, `fence_epoch` | Engine lease at authorization |
| Recovery status | `state`, `suspend_reason` | Recovery always lands in a suspended state |
| Audit snapshot | `brainos_session_events.mandate_json` | Written on every transition |

**Enforcement points**, all inside the OMS write transaction:

1. `paperSpotEntryDenial()` → `mandateEntryDenial()`: environment must be `PAPER`; the mandate must be complete, bound to
   the session it was granted with (`authorized_at = started_at`, so a reopen by any code version, including a rolled-back
   binary, cannot reuse it: `SESSION_MANDATE_NOT_BOUND`), in scope for its lane, unexpired, and bound to the current risk
   policy and strategy set. An entry without a strategy identity is denied. The entry's classified scope must
   match the mandate scope (`MARKET_OUTSIDE_SESSION_MANDATE`), and its strategy version must be in the authorized set.
2. `paperSpotCapitalDenial()`: open paper cost basis, plus net realized loss of positions opened since authorization,
   plus the actual fill notional and fees, must not exceed `capital_ceiling` (`MANDATE_CAPITAL_CEILING`). Gains offset
   losses. The ceiling bounds the capital that positions opened under this mandate can use; a loss on a position
   carried into the session is not counted, so this is not a total session-loss limit (that is tracked as W12, not
   implemented). The check runs under the same SQLite write lock as
   the fill. Policy-level daily, weekly and drawdown limits still apply independently.
   FAST and DEEP sessions never inherit a previous mandate, and `durableEntryPermission` also checks it.
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
| V2-1.2 | Trade-built bars: exact fixed point, late/reorg/gap handling, bounded memory | `market/tradeBars.ts` | P1 | — | **Done** (V2 increment) | `test/trade-bars.test.ts`, benchmark and soak |
| V2-1.3a | FAST volume-authenticity detector (candidate trigger only) | `market/volumeSpike.ts` | P1 | V2-1.2 | **Done** (V2 increment) | `test/volume-spike.test.ts` |
| V2-0.2 | Lab replay of trades through the live builder and detector | `lab/tape-reader.ts`, `lab/eventReplay.ts` | P0 | V2-1.2 | **Done** (V2 increment) | `test/historical-replay.test.ts` (parity digest) |
| V2-1.2b | Live Solana trade feed into `TradeBarBuilder` | `providers/`, `choice/dualRuntime.ts` | P1 | Feed entitlement (Helius, Vike or GMGN) | Blocked | Opt-in provider test; no feed, no wiring |
| V2-1.3b | Wire volume verdicts into FLIN candidate evidence | `market/flinQueue.ts` | P1 | V2-1.2b | Pending | Spike never changes a candidate to executable |
| V2-1.4 | DEEP futures contract, margin and liquidation model; reduce-only closes | `portfolio/`, `exec/` | P1 | — | Missing | Margin invariants, liquidation buffer tests |
| V2-1.5 | Position Supervisor dynamic exits (liquidity collapse, momentum exhaustion) | `exec/oms.ts` exit capsule | P1 | V2-1.2b, V2-1.4 | Pending | Exit persistence across partial and rejected fills |
| V2-0.3 | External write-ahead reservations and authenticated reconciliation | `exec/` | P0 for LIVE | A real venue adapter | Blocked | See section 14 |

## 11. Release blockers

LIVE: no venue adapter, signer, certification or owner LIVE approval. Release gates fail closed (`G07` and others are
unmet). Production: no verified Railway deployment, and no prospective unattended PAPER soak.

## 12. Rollback

Migration 7 only adds nullable columns. Reverting the code leaves the columns unused: older code neither reads nor
requires them, and its upsert leaves them untouched. Never edit migration 7 (or any released migration) in place; correct it with the next new append-only migration.

## 13. Evidence for this increment (2026-11-25)

| Command | Result |
|---|---|
| `npm run typecheck` | Pass (server and web) |
| `npm test` (server) | 62 files passed, 1 skipped; 817 tests passed, 3 opt-in skipped |
| `npm test` (web) | 44 tests passed |
| `npm run build` | Pass |
| `npm run scan:secrets` | Clean (365 tracked files) |
| `npm audit --audit-level=high` | 0 vulnerabilities |
| Independent trading-risk review | No blockers; the should-fix findings (loss-aware ceiling, session binding, required strategy identity, contained expiry drain) are fixed in this increment |
| `npm run test:e2e -- --trace off` | 65 passed (Chromium, offline fixtures) |
| Visual check | No horizontal overflow at 1440/1024/768/390 in dark and light themes |

Not run: live provider tests (opt-in, need external connectivity), Railway deployment, and prospective unattended PAPER
soak. GitHub Actions results for this branch are not yet available.

## 14. BrainOS V2 roadmap disposition (owner PDF, 26 Nov 2026)

The roadmap was checked against the repository before any code was written. Each item is either adopted in its
owning module, already present, rejected because it would weaken the architecture, or blocked on a real dependency.

| Roadmap item | Disposition | Reason and evidence |
|---|---|---|
| §2 one intelligence, one risk authority, one OMS | **Kept** | Matches sections 1 and 6. No second engine was added. |
| §3 trade-built charts, late events, reorgs, gaps, bounded queues | **Adopted** (V2-1.2) | `market/tradeBars.ts`: exact 1e9 fixed point; watermark finalization; late, duplicate, future and malformed trades quarantined; retraction rebuilds non-final bars exactly or invalidates final ones; empty bars are never fabricated; time-bounded dedupe. Final bars feed the canonical `FeatureEngine` through `tradeBarCandle`. |
| §4 volume-spike detector | **Adopted** (V2-1.3a) | `market/volumeSpike.ts`: velocity, acceleration, median/MAD z-score, imbalance, persistence across 1s/5s/15s, participant concentration, two-sided churn, liquidity and depth flags. Returns `tradingAuthority: false` and `CANDIDATE_TRIGGER_ONLY`. Thresholds are a versioned research policy, not calibrated truth. |
| §4 hard token-safety gates, ranking by net EV, bundles | **Blocked** | Needs authenticated Solana RPC, Jupiter route quotes and an execution adapter (F1, F2). |
| §5 DEEP probabilistic futures intelligence, margin | **Not started** (V2-1.4) | No futures margin ledger exists; spot sizing must not be reused for futures. |
| §6 illustrative PAPER risk envelope (0.25 %, 1 %, 3 %, 2x) | **Not imported** | Risk limits change only through the owner-accepted policy in `risk/policy.ts`. Hardcoding roadmap numbers would bypass owner approval. |
| §7 CanonicalOMS drafts (S2/S3) | **Rejected as written** | Same conclusion as #137: a parallel OMS or ledger, BigInt→Number conversions and release on a missing order are unsafe. PAPER fills are synchronous and atomic in the canonical OMS; write-ahead reservations are needed only with an external venue adapter. |
| §8 continuous learning and audit | **Partial** (existing DITAS) | Health-gated adaptation remains open; nothing self-promotes. |
| §9 latency budgets | **Measured for the new stages** | `scripts/benchmark-trade-bars.mjs`: ingest including finalization p95 0.038 ms, p99 0.070 ms; volume assessment p95 0.026 ms (1,000 tokens, 10,000 events/s synthetic burst, 80k events/s single-process throughput). The budget is 7 ms p95. A 30-minute soak at 2,000 events/s (`--soak`) kept the post-GC heap between 132 and 265 MB. The slow rise matches
the 15s, 1m and 5m rings filling toward their fixed cap of 120 bars, roughly 250 MB for 1,000 saturated tokens. These are synthetic, single-process figures, not venue or chain latency. |
| §10 streaming replay, determinism gate | **Already present** for book probes; **extended** to trades | Tape reader already streamed with bounded buffers (the S4 "collect into array" caveat no longer applies). `TRADE_TICK` events and `replayTradeEvidence` add trade replay through the same live code, with a parity digest test. |
| §10 profitability gates (≥100 trades, bootstrap CI, PF > 1.2) | **Pending** | Needs authentic trade histories; no dataset was supplied. Synthetic tapes never promote a strategy. |
| §12 operational release checklist | **Unchanged** | LIVE stays locked; Railway soak and deployment remain unverified. |

**Architecture impact:** additive and contained. Two new market-evidence modules in `market/`, one tape event type and
one replay function in `lab/`, and one benchmark script. No change to risk, OMS, ledger, session authority, schema or
API. Nothing in this increment can place, size or authorize an order.
