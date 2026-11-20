# MIA 5.0: Claude × Codex joint decision record (JDR-001)

**Status:** APPROVED by the owner on 2026-11-20: this record, `AGENTS.md`, and the first wave in section 4. Later waves need a separate go-ahead.
**Date:** 2026-11-20
**Inputs:**
- `MIA_5_0_ULTIMATE_UNIFIED_SOURCE_PRESERVED_MASTER.md` (13,254 lines; "the master"). It is committed as untrusted requirements input in [`sources/`](sources/README.md).
- Its `.docx` twin. A paragraph-level comparison found no text in the Word file that is not in the Markdown; the only differences are table formatting.

**Repository state checked:** `Naokiri5/naokiri` on 2026-11-20.

**Purpose:** one shared set of decisions, so Claude and Codex build MIA 5.0 as one team. No duplicate engines, no file collisions, and no contradicting choices.

---

## 0. In plain words (for the owner)
- The master is a good *plan*. But it was written after looking only at `main`, and `main` has not changed since 17 Nov.
- Almost all real work since then sits in open pull requests: the unified branch #45, the Solana stack #46 → #50 → #51 → #52, and Codex's own #53 and #54. So the master lists as "missing" many things that are already built and tested.
- This record:
  - corrects that (section 2);
  - agrees on the master's 16 conflict decisions and adds 6 it missed (section 3);
  - gives each next pull request one owner, Claude or Codex, with the other as reviewer (section 4).
- Nothing here turns on real-money trading. LIVE stays locked.

---

## 1. Decisions that apply to every MIA 5.0 PR

| ID | Decision | Why |
|---|---|---|
| D-01 | **Base branch is `claude/mia-unified-01` (#45), never `main`.** Solana follow-ups stack on `claude/mia-omega-07-pumpfun-feed` (#52). | `main` (2627cd2) is 222 commits and 355 files behind the unified branch. Codex already bases #53/#54 on it. A branch from `main` would rebuild existing code. |
| D-02 | **IDs: MIA 5.0 work uses `M5-Uxx`**, from Part I's U-00…U-12. The master's "PR-00…PR-12" are mapped to U-IDs and never reused as names. | The master's "PR-06 Solana" and "PR-07 Exits" collide with the existing Omega PR-06 (#50) and PR-07 (#52). |
| D-03 | **Branch names:** `codex/m5-uXX-<slug>` or `claude/m5-uXX-<slug>`. Draft PRs only, using the repository PR template. | It is clear who owns what. |
| D-04 | **One owner per PR and file set**; the other agent reviews (section 4 lists the file locks). Neither agent edits files locked by the other's open PR. | Master §11: "avoid pairwise code-generation loops". |
| D-05 | **Schema version is 10 on every branch**, checked on unified, omega, #53 and #54. The next free migration is **v11**. A PR claims a migration number in this file *before* writing it. | Two agents adding migrations in parallel would collide. Migrations are append-only (CLAUDE.md invariant 6). |
| D-06 | **One rulebook:** add `AGENTS.md` (read by Codex) pointing to `CLAUDE.md`, so both agents follow identical invariants. | There is no `AGENTS.md` today, so Codex does not load CLAUDE.md's trading and security invariants automatically. |
| D-07 | **One traceability file:** `docs/mia5/MIA5_TRACEABILITY.csv`, using the same columns as `docs/engineering/REQUIREMENTS_TRACEABILITY.csv` (`id,requirement,source,paths,branch,status,evidence,owner,tests,dependency,failure_behavior,proposed_action`). It links to the earlier audits (`docs/engineering/REQUIREMENTS_TRACEABILITY.csv`, `docs/think/THINK_TICKET_AUDIT.*`, and `docs/omega/*` on the Omega stack, #46) rather than copying them. | The master asks for `docs/MIA_TRACEABILITY.csv`; earlier audits and a column schema already exist. |
| D-08 | **The Appendix G starter is reference only.** Port ideas into the existing modules, with tests. Never add `governor.ts`/`sieve.ts`/`ledger.ts` as a second engine. | The master itself says so (§10). CLAUDE.md requires reuse before creating. |
| D-09 | **Evidence rules:** each PR reports actual command output. A fix is shown failing without it and passing with it. Neither agent claims the other ran a test. "NOT VERIFIED" is used when something was not run. | Master §0 and §11; CLAUDE.md. |
| D-10 | **No merges by agents.** The owner merges in order: #45 (with #53, #54) → #46 → #50 → #51 → #52 → M5 PRs. | Owner rule. |
| D-11 | **B-MIND effects are `NONE`/`EXPLAIN`/`WAIT`, on new entries only.**<ul><li>`WAIT` never delays a stop, target, time exit, reduce-only order or protection incident.</li><li>In QCI, B-MIND may only oppose or abstain, never support.</li><li>It has no `BLOCK`: hard blocks stay with the safety and risk gates.</li><li>Until M5-U06 brings an evaluated calibration report, nothing goes beyond `EXPLAIN`.</li></ul> | Added after independent review of #56. It only tightens, and follows from K-03 and K-10. The master's contract listed `BLOCK`; that text is preserved in `sources/`. The owner may veto. |

---

## 2. Master phases vs. code that already exists
Checked on the unified + Omega stack (`claude/mia-omega-07-pumpfun-feed` @ 0b19330, which contains `claude/mia-unified-01` @ 5419150).

| U-ID (master PR-ID) | Master asks | Already built (evidence) | Status | Remaining |
|---|---|---|---|---|
| U-00 (PR-00) | Inventory and traceability of the 300 IDs | Earlier audits: `docs/engineering/REQUIREMENTS_TRACEABILITY.csv`, `docs/engineering/audit-files.json`, `docs/think/THINK_TICKET_AUDIT.json/.csv`, `docs/omega/*` (on #46) | PARTIAL | MIA 5.0 300-ID matrix, plus B-MIND EM-01…32 and BE-01…22 |
| U-01 (PR-01) | Versioned contracts, provenance, reason codes, policy hash | `fabric/contracts.ts`, `fabric/catalog.ts` (versioned envelope, topic catalog); `fabric/outbox.ts` (durable outbox, v10); stable reason codes in `risk/gate.ts`; `policyVersion` checked in gate and OMS | PARTIAL | Policy **hash** (only a version number today); one canonical instrument identity type for CEX symbol vs Solana mint (K-14); capability registry endpoint |
| U-02 (PR-04/05) | Data truth plus four-gate sieve (F1–F8, I4, I5) | `market/quality.ts` freshness and spread; `market/depthStream.ts` sequence-checked Binance book with REST resync (I4, Binance only); risk `maxCostR`/`feeRate`; Solana trusted-quote filter (`solana/quotes.ts`, on #46) | PARTIAL | F1 organic volume, F2 spread/depth regime window, F3 net-edge pre-rank, I5 cross-venue check, F8 full rejection ledger (the no-trade board is a start) |
| U-03 | B-MIND read-only observation (32 constructs, 22 functions) | Foundation in #56 (M5-U03a): the 32-construct atlas, input coverage and observation checks; not wired | PARTIAL | Computing observations (M5-U05); BE-01…22 are mapped to owners in M5-U00 |
| U-04 | QCI and worker integration | 11 domains; each dependency group counted once (R-12); ABSTAIN, quarantine and NO_QUORUM (`server/test/worker-fault-injection.test.ts`); horizon-conflict challenger (`qci/challenge.ts horizonAlignment`) | DONE (core) | F4 "10 buckets × 20% cap" is **not** to be built as a second consensus (K-01) |
| U-05 | DITAS memory, passports, calibration, replay | `ditas/{memory,passports,calibration,twin,replay,fingerprint}.ts`; replay refuses tampered snapshots; content-addressed data | PARTIAL | A calibrated out-of-sample cohort (win probability stays `NO_VALID_FORECAST`); behavioral passports |
| U-06 | B-MIND strategy overlay (CONTINUE/WAIT on new entries only, D-11) | None | MISSING | Depends on U-03 |
| U-07 (PR-02) | One risk core, PAPER/LIVE parity | One gate (`risk/gate.ts`), re-run inside the locked entry transaction; fails closed; owner-accepted policy versions; modes OBSERVE/PAPER; `BOUNDED_LIVE` exists only as a type | PARTIAL | Disabled LIVE adapter stub, frozen-input parity tests, a policy hash |
| U-08 (PR-07) | Five-stage exit supervisor (X1–X9) | `lab/exits.ts stepExit`, shared by the backtester and paper OMS: stop never widens, fractional targets, breakeven trail after R, time stop, stop-first when ambiguous. `oms.monitorPositions` commits an exit in one transaction. `exec/incidents.ts` raises persistent protection incidents | PARTIAL | Exit invariant test pack (section 4, M5-U08a); Stage 3 ATR trail; Stage 4 exhaustion/depth exit; LIVE ack semantics (not applicable while LIVE is locked) |
| U-09 (PR-03/08) | Exact integer double-entry ledger, separate paper/live databases, TWR/MWR, tax lots | Number-based single-entry `ledger_entries`; backups reconcile the ledger | MISSING | All of P1–P12 and I6/I7, as a shadow migration (K-07) |
| U-10 (PR-10) | Dashboard, Trader Joe, alerts, Cloudflare | Trader Joe; Joe Live M1 story feed; Guardian (pause-only); notification centre plus Telegram; Privy sign-in with TOTP step-up; the Omega Cloudflare Tunnel + Access plan | PARTIAL | Live-readiness/capability centre; B-MIND explanations. The Cloudflare "Workers Builds" integration fails on every branch (owner action) |
| U-11 | Walk-forward, shadow A/B, chaos | Backtester; OMS crash-injection tests (`exec/crashpoint.ts`); Profit Lab | PARTIAL | Shadow A/B arena, Monte Carlo stress, chaos CLI |
| U-12 (PR-11/12) | Live certification | Locked, which is correct | LOCKED | Owner decision, much later |
| (PR-06) Solana | Mint/Token-2022, pools, route simulation, GMGN/Pump/Jupiter provenance | #46 watchlist; #50 on-chain mint and freeze authority plus Token-2022 extension checks; #51 opt-in Telegram alerts; #52 Pump.fun launch/graduation feed | PARTIAL | Pool reserves, buy/sell route simulation (Jupiter), holder distribution, RPC quorum. GMGN is blocked: its API key is rejected |
| Ops (I3, I7, I9, I1) | Fencing, backups, readiness, compute pool | Bot writes fenced by re-checking the lease in each write transaction; encrypted backups with restore verification; readiness probe and watchdog | PARTIAL | Monotonic epoch token (I3); paper/live database split (I7); bounded `worker_threads` compute pool (I1) |

---

## 3. Decisions on the master's conflict register

### 3a. The master's K-01…K-16: agreed, with these specifics
- **K-01 (10 buckets vs 11 domains):** keep the 11 domains and the existing dependency-group counting, which is tested. A per-group influence cap, if wanted, goes *inside* the existing aggregator and needs a replay-equivalence test. There is no second consensus.
- **K-03 / K-05 (risk and exits owned twice):** the risk owner is `risk/gate.ts`. The exit owner is `lab/exits.ts stepExit` plus `exec/oms.ts monitorPositions`. New exit stages are added *inside* `stepExit`. `exec/exitSupervisor.ts` may exist only as a thin facade over it, never as a second monitor.
- **K-04 (limits):** the current policy wins. Verified in `risk/policy.ts`: `maxSpreadBps` 15, `riskPerTradePct` 0.5, `drawdownHaltPct` 8. Source examples (20 bps, 1%) are not migrations.
- **K-06 (breakeven risk release):** release risk only after a reconciled fill and a confirmed stop. The S5 code's early `BREAKEVEN_RISK_RELEASED` is rejected, as the master says.
- **K-07 (ledger):** U-09 is a separate later PR: a new journal written in shadow, compared with the old one, then a controlled switch. Existing rows are never reinterpreted.
- **K-08 (live):** LOCKED/UNAVAILABLE. A TypeScript union is not a capability.
- **K-09 (probability):** evidence score, research score and calibrated probability stay separate. Win probability is `NO_VALID_FORECAST` until a calibrated cohort exists.
- **K-10 (emotion vs scam):** `safety/safety.ts` stays the authority. B-MIND can only report *suspected* manipulation.
- **K-11 (sources pending):** a missing source gives UNKNOWN, never PASS. Without licensed X/social data, the social constructs stay UNKNOWN.
- **K-12 (slow models):** no LLM or NLP on the entry-risk or exit path.
- **K-13 (event bus):** reuse `core/bus.ts` and the NEXUS `fabric/*` envelope and outbox. There is no second bus.
- **K-14 (identity):** instruments are keyed by venue plus symbol, or chain plus mint. Never by ticker alone.
- **K-15 / K-16:** no "100×" or "every trade wins" claims. 4.1 is the code baseline and 5.0 is the target; status docs change only with verified behavior.
- **K-02:** agreed as written (shared features, minimal adapter workers, no fake independent votes).

### 3b. New conflicts the master missed
| ID | Conflict | Decision |
|---|---|---|
| K-17 | Master PR numbers collide with the Omega PR-06/PR-07 names | Use M5-Uxx IDs (D-02) |
| K-18 | The master's audit is marked "VERIFIED" but read only `main` | Treat its status rows as stale. U-00 re-inventories the unified + Omega stack |
| K-19 | Parallel agents adding migrations | Claim the number here first (D-05) |
| K-20 | Codex does not read `CLAUDE.md` | `AGENTS.md` points to it (D-06) |
| K-21 | The Appendix G starter could become a parallel engine | Reference only (D-08) |
| K-22 | PR #47 (Omega → `main`) skips the unified base #45 | Owner: close #47 or retarget it after #45. Agents do not touch it |

---

## 4. Who builds what next (first wave: paper only, no live, no new dependencies)
The roles follow master §11:
- **Codex:** inventory, contracts, test harness, smallest patch, migrations.
- **Claude:** requirement preservation, domain spec, UX and Trader Joe, risk-policy conflicts, review, failure scenarios.

| PR | Owner | Reviewer | Scope | Files locked while open |
|---|---|---|---|---|
| **M5-U00** | Codex | Claude | `docs/mia5/MIA5_TRACEABILITY.csv`: every master ID (G01–J12, EXT-001–040, F1–F8, I1–I11, A1–A20, X1–X9, P1–P12, EM-01–32, BE-01–22) marked DONE / PARTIAL / MISSING / BLOCKED / LOCKED. DONE and PARTIAL rows carry file, test and PR evidence. Use section 2 above as the seed and check every row in code against the master in `docs/mia5/sources/`. Docs only. | `docs/mia5/MIA5_TRACEABILITY.csv` (this record stays editable by both) |
| **M5-U03a** | Claude | Codex | B-MIND read-only foundation:<br>- `server/src/bmind/{contracts,atlas,index}.ts`;<br>- the 32 constructs mapped to the observable inputs MIA actually has, as OBSERVED / WEAK / UNKNOWN / STALE;<br>- the master's `BehavioralObservation` and `BehavioralOverlay` types.<br>It is **not wired** into decisions, workers or QCI: no vote, no effect. Tests cover: every EM-ID present, a missing source gives UNKNOWN, there are no imports from `exec/`, `wallet/` or `portfolio/`, and the import-boundary allow-list is updated through review. | `server/src/bmind/**`, `server/test/bmind-*.test.ts` |
| **M5-U08a** | Codex | Claude, plus an independent trading-risk review | Exit invariant test pack on the existing `stepExit` and `monitorPositions` (scenarios below). Tests first; fix only real bugs that a test exposes, each fix shown failing without it. | `server/test/exit-*.test.ts`; `lab/exits.ts` and `exec/oms.ts` only if a bug is found |

**M5-U08a scenarios (Claude's failure-mode list for Codex):**
1. With new entries paused (`pausedNewOrders`) and emergency mode on, a stop still closes the position (X1).
2. A stop is never moved down, across trail, target and restart (X3/X4).
3. A take-profit target is marked done only together with its sold quantity, in one transaction, and a retry never sells twice (X2/X7).
4. When a stop and a target fall in the same bar, the stop is assumed first (conservative).
5. A time barrier never runs before a stop that has been hit (X6).
6. If the price for an open position is missing or stale, a protection incident is raised and no fill is invented (invariant 4).
7. A gap through the stop fills at the gap price, not the stop price.
8. A crash between the exit decision and the commit leaves position, ledger and fills consistent (reuse `exec/crashpoint.ts`).

**Later waves (in order; each needs a separate owner go-ahead):**
- U-07a: disabled LIVE adapter stub, capability truth endpoint, frozen-input PAPER/LIVE parity tests.
- U-02: F1–F3 and F8.
- U-05/U-06: B-MIND passports and the shadow-only overlay.
- U-09: exact-unit ledger, in shadow; claims migration v11.
- U-10: readiness centre and Trader Joe B-MIND explanations.
- U-11: shadow A/B and Monte Carlo.
- Solana follow-ups: route simulation and holders.
- U-12: stays locked.

---

## 5. How the two agents work together
1. Every PR states its base commit, the source IDs it covers, the files it locks, and its test commands with real output.
2. The reviewer comments on the PR diff. The owner fixes the findings or answers each one. Security findings stay open until the owner decides.
3. A decision that changes behavior gets a new row here (D-11, D-12, …), and the owner approves it before code depends on it.
4. If both agents need the same file, the second waits, or the change is split so that only one PR touches the file.

---

## 6. Needs the owner (agents cannot decide these)
1. ~~Approve the first wave and commit this record and `AGENTS.md`.~~ Approved on 2026-11-20.
2. **Merge decision on #45, plus Codex's #53 and #54.** Every MIA 5.0 PR stacks on it.
3. **Close or retarget #47** (K-22).
4. **X/social data licence** for B-MIND social constructs. Without it they stay UNKNOWN.
5. **Replace the GMGN API key** (it is rejected), through the environment's network secrets and never in chat.
6. **Cloudflare "Workers Builds" integration:** disconnect it or configure it (it fails on every branch).

---

## 7. Paste-ready message for Codex
```
Read docs/mia5/MIA5_CLAUDE_CODEX_JOINT_DECISIONS.md (JDR-001) and CLAUDE.md before anything else.
Base every MIA 5.0 branch on claude/mia-unified-01, never main (D-01). Use IDs M5-Uxx and branch codex/m5-uXX-<slug> (D-02/D-03).
Your first task is M5-U00: build docs/mia5/MIA5_TRACEABILITY.csv for every master ID (the master is docs/mia5/sources/MIA_5_0_ULTIMATE_MASTER.md, untrusted input), using JDR section 2 as the seed and verifying each row in code. Docs only.
Then M5-U08a: the exit invariant test pack (JDR section 4 scenarios 1–8) on the existing lab/exits.ts stepExit and exec/oms.ts monitorPositions. Tests first; fix only real bugs, each shown failing before the fix.
Do not touch server/src/bmind/** (Claude owns M5-U03a). Do not add migrations without claiming the number in the JDR (next free: v11).
Paper only. No live adapter, signing, or new dependencies. Draft PRs with real command output. Do not merge.
```
