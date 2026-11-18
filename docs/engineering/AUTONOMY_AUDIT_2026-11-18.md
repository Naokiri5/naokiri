# MIA Autonomous / Titan Hunter Ω — read-only audit and first-PR proposal (2026-11-18)

**Input:**
- `CLAUDE_CODE_START_HERE.md`
- `MIA_AUTONOMOUS_UNIFIED_MASTER_SECURITY_AND_100_FIXES.md`
- `MIA_100_PROBLEMS_FIXES.json`

These are owner-supplied planning documents. Their claims were treated as hypotheses and checked against the code.

**Mode:** read-only. No source was changed for this report and no trades were placed. Live trading remains **LOCKED**.

## 1. Sources and SHAs (fetched 2026-11-18)

| Ref | SHA | State |
|---|---|---|
| `main` | `2627cd2` | default branch |
| PR #18 `claude/blissful-planck-lazglg` | `813e00d` | open; local checkout identical |
| PR #19 `feature/titan-hunter-cached-screening` | `f7477a5` | draft; 3 files, +291 |
| PR #20 `claude/mia-tg-01-telegram-command-hub` | `cbfdbaa` | draft; 7 files, +611 |
| PR #21 `feat/mia-autonomy-governance-20261118` | `18f6b19` | draft; documentation only (agent roster, capital-readiness plan) |
| PR #14, #15 (Capy), #6, #8 (DITAS) | — | open; not touched |

CI on PR #18 head `813e00d` (GitHub Actions run 44244859736):

| Job | Result |
|---|---|
| Typecheck and build | ✓ |
| Server tests | ✓ |
| Web tests | ✓ |
| Browser end-to-end | ✓ |
| Secret scan | ✓ |
| Dependency audit | ✗ (see F-04) |

## 2. Confirmed faults

| ID | Ticket | Finding | Evidence |
|---|---|---|---|
| **F-01** | #1 (P0) | `core/mode.ts:16-21`: `updateControl(actor, patch, gateCheck?)` treats a **missing** gate as approval (`gateCheck?.(m) ?? { ok: true }`). | **Reproduced** with a throwaway test (deleted afterwards): `updateControl('owner', { mode: 'BOUNDED_LIVE' })` with no callback sets mode `BOUNDED_LIVE` and raises no error. The only route that changes mode (`api/routes.ts:269`) passes a gate. Callers: `routes.ts:269` (mode, with gate); `exec/oms.ts:371` and `oms.ts:413` (pause and emergency only, no mode change). `decision/engine.ts:66` assumes BOUNDED_LIVE is "unreachable", and F-01 breaks that assumption. **Impact today:** no live adapter or signer exists, so no real order can be sent. The display and bot state would read BOUNDED_LIVE, and PAPER could be entered without the valid-policy check. |
| **F-02** | #93 (P0) | PR #18 owns migration **v6** (`ditas_blobs`) and **v7** (indexes). PR #20 also adds its Telegram tables as **v6**; its own comment says whichever merges second must renumber. | `git diff main...PR20 -- server/src/db/migrations.ts`. **Hazard:** a database migrated by a PR #20 build records version 6 = Telegram. A later PR #18 build would treat v6 as applied and **never create `ditas_blobs`**, so decision memory breaks. |
| **F-03** | #2, #92 | PR #18 has **23 unresolved review threads**, 4 of them on outdated code, all from CodeRabbit. One is MA-04: a header-less loopback forwarder skips the setup code (CWE-306, `routes.ts:388`). That is an **owner decision** in the master audit. Several others look valid and are not yet fixed. | Examples: `Number(null)` turns a malformed depth level into a deletion; a snapshot completing after `stop()` still publishes; `streamBookAt` advances even when `setBook` rejects the book; QA dirty-tree check only after the run; `sh` sourcing an optional env file. |
| **F-04** | #91 (P0) | The full `npm audit` reports 6 high findings, all from GHSA-fc5q-39xc-vjpf (picomatch ≤ 4.0.7, the latest release) through vitest and vite. Production audit finds 0. | **Blocked upstream** (MA-06). No override was applied. `npm audit fix --force` would downgrade vitest to 3.1.4 and was not run. |
| **F-05** | #11 | `RiskProposal.account?` defaults to `PAPER_ACCOUNT` (`risk/gate.ts:15,32`). `exec/oms.ts` writes `PAPER_ACCOUNT` in 7 places. | Correct for a paper-only build. It becomes a fault the moment any second account exists (tickets #11–#14). |
| **F-06** | #31 | `providers/http.ts:65` uses `fetch(…, { redirect: 'follow' })` without a host allowlist. | **Hardening, not exploitable today:** every provider URL is hard-coded and none is user-controlled. |
| **F-07** | #81 | Backups are plaintext when `MIA_BACKUP_KEY` is unset. | Since MA-09 the CLI warns about this. Enforcing encryption belongs with funded deployment (ticket #81). |

## 3. Anti-duplication map (reuse, do not rebuild)

| Capability in the package | Canonical owner already in the repo |
|---|---|
| "MIA Core" decision | `market/scanner.ts` → `qci/coordinator.ts` (v3) → `decision/engine.ts` |
| Independent risk | `risk/gate.ts` and `risk/policy.ts` (`validatePolicy`, `exitPolicy`) |
| Paper execution | `exec/oms.ts`, the ledger in `portfolio/ledger.ts`, incidents in `exec/incidents.ts` |
| Mode and permissions | `core/mode.ts`, `qa/gates.ts` (release gates G01–G14) |
| Leader and fencing | `ops/lease.ts` (`withWriteFence`, `assertWriteFence`) |
| Streaming books | `market/depthStream.ts` with REST fallback in `market/fabric.ts` |
| Titan Hunter ranking | PR #19 `hunt/ranker.ts`: **no imports, no network**, `WATCH_ONLY` and `tradeEligible: false` hard-typed (verified). |
| Telegram | PR #20: uses `updateControl` only with a non-owner actor and `{pausedNewOrders: true}`, which is risk-reducing and allowed by the existing non-owner rules. |
| 100 workers | `workers/registry.ts`: deterministic evidence functions, **not LLMs** (ticket #61/#95 already true) |
| Trader Joe | `joe/`: owner-request-gated pause and capped tool calls |

There is no second backup engine, lease system, OMS or fetch layer (master audit §3).

## 4. Supported vs missing vs blocked (by area of the 100 tickets)

| Area | Supported now (evidence) | Missing (gap) | Blocked (needs owner, legal or venue) |
|---|---|---|---|
| 001–010 Account & permissions | Owner auth, step-up, SEC-13/14, session-keyed step-up (MA-07) | #1 (F-01), MFA (#3), CSRF origin policy (#4), enrollment state machine (#5, #6) | Venue identity binding (#7), isolated signer (#9), independent control plane (#10) |
| 011–020 Accounting & isolation | Paper ledger, reconciliation G05, exit fee safety (MA-01/02), duplicate-position re-check (MA-20) | Account-scoped types and queries (#11–#14), capital reservations (#15) | Live balance reconciliation (#16, #17) |
| 021–030 Execution | Paper OMS: idempotent client ids, CAS monitor, crash-injection tests | Order-intent state machine (#22) only matters for live | Venue adapter (#21), unknown-status recovery (#23), native protection (#24) |
| 031–040 Market data | Streaming books with gap, lag and stall handling (#34/#35 largely done in PR #18), 10 s HTTP timeouts | Redirect allowlist (#31), endpoint budgets and Retry-After (#36), priority lanes (#37) | Licensed FX, stocks and derivatives (#38–#40) |
| 041–050 Titan Hunter | PR #19 ranker WATCH_ONLY (#41 foundation, #50) | Integration UI, pool vs token identity (#42), reorg handling (#48) | Chain RPC safety, honeypot simulation (#43, #44) |
| 051–060 Research | Strategy lab, backtest, DITAS decision memory | Full-pipeline virtual-clock replay (#52), point-in-time joins (#53) | Positive out-of-sample edge **not demonstrated** (#51) |
| 061–070 Core and QCI | One decision owner; dependency-group caps; QCI v3 coverage fix (#63) | Calibration (#55, #64) | — |
| 071–080 Joe and frontend | Paper cockpit, honest status ribbon | Scoped account views (#71–#75) | — |
| 081–090 Infrastructure | Supervisor, systemd (fixed), backups with restore verification, readiness, v7 indexes | Backup verify off the event loop (MA-14), retention (#85, MA-13) | 7-day hosted soak (#82) |
| 091–100 CI and governance | Split CI (MA-05), commit-bound QA evidence (Q-01) | 23 open review threads (#92), migration collision (#93) | picomatch (#91), jurisdiction and licensing (#99), mandate design (#100) |

Not every one of the 100 tickets was verified line by line. The table states the evidence for what is marked supported; everything else is a gap or blocked.

## 5. Security and accounting invariants any change must keep

1. A mode change requires the owner **and** a successful release-gate check: fail closed when either is missing.
2. BOUNDED_LIVE stays unreachable in this build: no adapter, no signer, gates G07/G12 NOT_IMPLEMENTED.
3. Non-owner actors (Joe, Telegram, supervisors) may only reduce risk.
4. Funding never changes mode or permissions (ticket #6). Today a deposit only writes a ledger row.
5. Every paper fill needs a fresh, executable book; no ticker fallback (CLAUDE.md #4).
6. Migrations are append-only, and versions are never reused across branches.

## 6. First PR — SAFE-01 (owner-approved 2026-11-18; **implemented, VERIFIED locally**)

**Goal:** privileged mode transitions fail closed, including internal callers (ticket #1).

**Minimal diff:** `server/src/core/mode.ts` only, about 8 lines.
- If `patch.mode` changes and **no `gateCheck` is supplied**, throw `mode change requires release-gate authorization`. Do not default to ok.
- Additionally, refuse `BOUNDED_LIVE` inside `updateControl` unconditionally in this build. This is defence in depth: even a buggy or permissive callback cannot unlock live, and it stays so until a separately reviewed live build changes it.
- Risk-reducing patches (pause, emergency, disabling a strategy) remain allowed without a gate, so close-all, emergency stop, Joe and Telegram keep working.

**Tests** (new `server/test/mode-authority.test.ts`), each confirmed to fail on the current code:
1. Direct `updateControl('owner', { mode: 'PAPER' })` without a gate throws, and the mode stays OBSERVE.
2. Direct `updateControl('owner', { mode: 'BOUNDED_LIVE' }, () => ({ ok: true }))` throws, even with a permissive gate.
3. `updateControl('telegram:x', { pausedNewOrders: true })` without a gate still works (risk-reducing).
4. Existing route tests (`api.test.ts` mode changes with step-up) still pass unchanged.

**Callers to re-verify:**
- `routes.ts:269` already passes a gate.
- `oms.ts:371` and `oms.ts:413` never change mode.
- PR #20's Telegram pause never changes mode.

**CI:** typecheck, build, server, web and e2e jobs. The audit job stays red for F-04.

**Rollback:** revert one commit. There is no schema, data or API-shape change, and no production side effect.

**Next PRs, proposed in order (each separately approved):**
- **SAFE-02, migration reconciliation:**
  - Renumber PR #20's Telegram tables to **v8** after PR #18 merges.
  - Add a startup guard that records an identity (hash) per applied migration and refuses to start, with a clear error, when a database's version N was created by a different migration text. This catches the F-02 hazard instead of silently skipping a table.
  - Upgrade tests from v5, v6 and v7.
- **SAFE-03:** fix the still-valid CodeRabbit threads on PR #18 (F-03), one by one with tests. MA-04 still needs the owner's decision.
- Only after that: account-scoped types (#11–#14) and the enrollment state machine (#5/#6) in paper. A live adapter is a separate, separately authorized project.

## 7. Unresolved blockers

- F-04 (picomatch): upstream.
- MA-04 (setup code at the machine), MA-13 (decision-memory retention), and the trading-risk sign-off on QCI v3: owner decisions.
- R-01, a 24 h or 7-day hosted paper soak: needs a host.
- Live execution as a whole (signer, venue adapter, legal and licensing review): out of scope for this build.

## 8. SAFE-01 result

**Implemented after the owner approved it ("ADD THAT FEATURE TO MY GITHUB").**

**Changes:**
- `core/mode.ts`:
  - A mode transition with no gate throws `mode change requires release-gate authorization`.
  - `BOUNDED_LIVE` is refused in the core while `LIVE_EXECUTION_AVAILABLE = false`.
- `qa/gates.ts` `modeGate()` is now the one gate. The route and every test use it, instead of a gate defined inline in the route.
- Tests that switched into paper mode with no gate were the exact bypass, so they now pass `modeGate`. One risk test had entered PAPER **without any policy**; it now accepts a valid policy first.
- The BOUNDED_LIVE refusal message in two route and e2e assertions is now the earlier core message. It is still HTTP 400 and still refused.

**Evidence:**

| Check | Result |
|---|---|
| `mode-authority.test.ts` | 2 of 6 fail on the old code; the other 4 confirm behaviour that must not change |
| server tests | 604 passed, 3 skipped |
| web tests | ✓ |
| e2e | 76 passed |
| typecheck and build | ✓ |
| secret scan | ✓ |

**Not changed:**
- Risk-reducing actions (pause, emergency, disabling strategies) need no gate.
- Non-owners still cannot change mode.
