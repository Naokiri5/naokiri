# Master repair audit — Batch 0 (baseline and defect register), 2026-11-18

**Read-only.** No source code has been changed in this batch. This register lists the confirmed defects and states what is still unproven. Paper-only: nothing here enables live trading.

## 1. Baseline

| Item | Value |
|---|---|
| Branch / commit reviewed | `claude/blissful-planck-lazglg` @ `21892ff` (PR #18, open, not merged) |
| Default branch | `main` @ `2627cd2`; this branch is 25 commits ahead |
| Working tree | clean; no stash |
| Other open PRs | #19 draft (Titan hunter, not reviewed here), #15 and #14 (Capy, separate), #8 and #6 (DITAS drafts) |
| Closed without merge | #10 (backups) and #11 (lease), both superseded by the canonical `ops/backup.ts` and `ops/lease.ts` |
| Merged | #1–#5, #7, #9, #12, #13, #16; #17 (into this branch) |
| CI on PR #18 | `checks` job **fails** at `npm audit`, and `e2e` is **skipped** (depends on `checks`) |

Local baseline at `21892ff`. The commands ran in this order, from a clean `npm ci`:

| Command | Result |
|---|---|
| `npm ci` | ✓ (the lockfile installs reproducibly) |
| `npm run typecheck` | ✓ (0 errors) |
| `npm run build` | ✓ |
| `npx vitest run` (server) | 571 passed, 3 skipped (opt-in live-provider tests) |
| `npm test -w web` | 21 passed |
| `npm run test:e2e` | 76 passed |
| `npm run scan:secrets` | ✓ (310 files) |
| `npm audit --audit-level=high` | **6 high** (one advisory, see MA-06) |
| `npm audit --omit=dev` | 0 vulnerabilities (reproduced) |

The project has no lint script, so lint was not run. Migrations have no standalone test; they are exercised by `ops-readiness`, `ditas-*` and the lease tests.

## 2. Method

Four read-only reviews ran in parallel: security, trading/OMS risk, QCI with a duplication map, and performance. The lead engineer then re-checked every HIGH item against the code.

- MA-01, MA-02 and MA-03 were **reproduced** with a throwaway test. The test was deleted afterwards and is not committed. Its output:
  ```
  QCI liquidity (packets: liquidity ABSTAIN + execution SUPPORT in group 'cross') → {"support":1,"oppose":0,"score":1}
  feeRate missing  → position still OPEN after the stop price was hit
  feeRate null     → CLOSED, exit fees 0
  feeRate -0.001   → CLOSED, exit fees -1.30 (a fee credited to the account)
  ```
- **"Code-confirmed"** means the reviewer and the lead engineer both traced the defect in the code, but it was not executed.
- **"Not verified"** means the defect depends on an environment this session cannot run, such as systemd.

## 3. Defect register

### HIGH
| ID | Area | Status | Evidence | Root cause → proposed fix | Regression test |
|---|---|---|---|---|---|
| MA-01 | Risk/OMS | **Reproduced** | `risk/policy.ts:51` returns the raw stored row when validation fails. `exec/oms.ts:25,289,296,300` then compute a fee with `undefined`, giving NaN, and `orders.fees NOT NULL` throws. The stop exit rolls back on every pass. `closeAllPositions` (`oms.ts:376`) aborts on the first throw. | Invalid configuration is used for exit accounting. → Add one `exitFeeRate()` that falls back to the last valid version or the default when the policy is `invalid`. Require a finite fee ≥ 0 before writing. Make close-all handle each position on its own. New entries stay denied (`gate.ts:31`). | A stored policy with no `feeRate` and a stop hit: the position closes with a finite fee and entries are still denied. Close-all continues past a failing position. |
| MA-02 | Risk/OMS | **Reproduced** | Same path as MA-01. A `null` fee rate gives fee 0 and overstated PnL. A negative rate credits the ledger. An out-of-range value is applied as-is. | Same root cause and fix as MA-01. | null, negative and out-of-range values each give the safe fallback fee. |
| MA-03 | QCI | **Reproduced** (regression from R-12, my commit `6256fca`) | `qci/coordinator.ts:45-52` re-buckets every packet of a dependency group into the group's first domain. Coverage at `:97` counts whatever landed in that bucket, so an execution worker's SUPPORT satisfies the required **liquidity** domain. An ABSTAIN-only packet can claim a group. | Domain attribution is mixed up with vote de-duplication. → Keep one vote per group, scored only from packets of the domain the vote is credited to. Compute required-domain coverage from each domain's **own** non-abstaining data-driven packets. Bump the coordinator to `domain-capped-weighted-v3`. **This changes consensus outcomes**, so it needs trading-risk sign-off. | (a) A `cross` group with liquidity ABSTAIN and execution SUPPORT: liquidity is missing. (b) A `book` group with liquidity OPPOSE and flow SUPPORT: no cross-domain averaging. (c) A four-domain group still casts 1 vote. (d) An ABSTAIN-only domain does not claim a group. (e) `runConsensus` with no book returns NO_QUORUM. |
| MA-04 | Auth/setup | **Code-confirmed, conditional** | `api/routes.ts:379-385`: `isDirectLocal = loopback && no proxy headers`. A header-less TCP forwarder (`ssh -L`, socat, `kubectl port-forward`, nginx with a bare `proxy_pass`) looks exactly like a direct client. First-owner setup then skips the one-time code (`:129`, `:138`). `trustProxy` is correctly off, so forged XFF cannot fake loopback. | The trust decision depends on headers being absent. → Always require the console setup code, with an explicit `MIA_ALLOW_LOCAL_SETUP=1` opt-out. **Owner decision**: setup at the machine would also need the code. | A loopback request with no headers to `/api/auth/setup` without a code gets 403. |
| MA-05 | CI | **Confirmed** (CI run on PR #18) | `.github/workflows/ci.yml:25-34`: the audit step runs before typecheck, build and tests in one job, and `e2e` `needs: checks`. A new advisory therefore hides every correctness result. | → Split into parallel jobs: security audit, secret scan, typecheck+build, server tests, web tests, e2e. The audit stays a **required** failing check. It must not be suppressed. | The CI run shows tests executed while the audit is still red. |
| MA-06 | Dependencies | **BLOCKED (upstream)** | GHSA-fc5q-39xc-vjpf (CVSS 7.5) affects picomatch ≤ 4.0.7, and 4.0.7 is the latest release. Paths: `vitest@5.1.0 → picomatch` and `→ tinyglobby → fdir → picomatch`; `vite@8.3.8 → picomatch`. Dev and build tools only; `--omit=dev` finds 0. `npm audit fix --force` would downgrade vitest to 3.1.4, a major breaking change. | No patched version exists. → Wait for upstream, or the **owner** grants a time-limited exception. No override was applied. | Re-run `npm audit` when picomatch publishes a fix. |

### MODERATE
| ID | Area | Status | Evidence | Fix |
|---|---|---|---|---|
| MA-07 | Auth (SEC-14 gap) | Code-confirmed | `routes.ts:63` and `core/ratelimit.ts:42-53` key the per-client budget by `req.ip`. Behind a proxy or container gateway every client shares that key, so one attacker's 5 bad logins block the owner's close-all and revoke-others step-up. | For risk-reducing step-up from an authenticated session, key the budget on a hash of the session token. |
| MA-08 | Deploy | Not verified (no systemd here) | `deploy/mia.service:35-37`: `ProtectSystem=strict` and `ReadWritePaths=/var/lib/mia` with no `StateDirectory=`. If the directory is missing, a fresh install fails with 226/NAMESPACE. No doc creates it or the `mia` user. | Add `StateDirectory=mia` and `StateDirectoryMode=0700`, and document creating the user. An existing directory is kept. |
| MA-09 | Backup | Code-confirmed | `DEPLOYMENT_GUIDE.md:45,58-62`: the manual `npm run backup -- create` without `MIA_DATA_DIR` resolves `/opt/mia/data`. `getDb()` creates **a new empty database** and a new `evidence.key`, verification passes, and it exits 0. A shell does not load `/etc/mia/mia.env`, so the backup is written **in plaintext**. Running it as root leaves `backups/` owned by root. | The backup CLI refuses when `mia.db` does not already exist. Document the exact `sudo -u mia … MIA_DATA_DIR=/var/lib/mia` command, or ship a wrapper. |
| MA-10 | Streaming (off by default) | Code-confirmed | `market/depthStream.ts:151`: after a failed snapshot, **every** buffered event (~100 ms) starts another one, with no per-symbol backoff. `attempt=0` resets on `onopen` (`:141`), so a server that accepts and then closes causes reconnect storms of up to 200 snapshots each. | Per-symbol `nextSnapshotAt` with exponential backoff. Reset `attempt` only after the first valid event. Cap concurrent snapshots. **Must be fixed before anyone sets `MIA_STREAMING=1`.** |
| MA-11 | Determinism | Code-confirmed | `oms.ts:111,113,139-144,360` and `risk/gate.ts:52` mix `Date.now()` with the injected `nowTs`. In replays and tests, risk freshness and fill freshness can disagree. | Pass `nowTs` through every one of these calls. |
| MA-12 | QCI | Code-confirmed (same root cause as MA-03) | `coordinator.ts:66` averages a group across domains. In `book`, liquidity OPPOSE plus flow SUPPORT scores 0, so liquidity's adverse signal is lost. Vetoes are unaffected. | Fixed together with MA-03. |
| MA-13 | DITAS growth | Code-confirmed; needs an owner decision | `db/migrations.ts:64-66,122-123` add immutable-delete triggers and no retention exists. Every scan writes a snapshot even for NO_SIGNAL and REJECTED (`market/scanner.ts:89-101`). Growth is ~13× slower since v6, but still linear and unbounded. | Tiered storage through a new migration: slim snapshots without a book blob for NO_SIGNAL and REJECTED, with full evidence kept for decisions. Choosing what may be dropped is an **owner** call. |
| MA-14 | Backup | Code-confirmed (cost not measured) | `ops/backup.ts:111-114` hashes all rows of `audit_log`, `ditas_events` and `ditas_snapshots` synchronously on the event loop during `backgroundLane`. | Verify from a stored checkpoint (seq and hash), or verify in chunks. Measure with `monitorEventLoopDelay`. |
| MA-15 | DB | Code-confirmed | `routes.ts:181` runs `COUNT(*) … WHERE read=0` every 15 s with no index. `security.ts:17,19` filters `audit_log` by action and ts with no index. | New migration: a partial index on notifications for unread rows, an index on `audit_log(action, ts)`, and retention for read notifications. |
| MA-16 | Release gate | Code-confirmed | `qa/gates.ts:190` (G11) and `routes.ts:265` show an **invalid** stored policy as accepted. A failed safety check is displayed as a pass. The relational rules (`policy.ts:58-60`) apply only when a policy is accepted, not when it is read. | One `validatePolicy` for both paths. G11 requires that the policy is not invalid. |

### LOW
| ID | Status | Summary |
|---|---|---|
| MA-17 | Code-confirmed | After a monitor exit commits, a throwing journal, autopsy or bus callback opens a false "exit failed" incident (`oms.ts:258,267`). Fix: isolate each post-commit callback. |
| MA-18 | Code-confirmed | Stream books are stamped with local receive time and the provider lag (`received - E`) is never checked. A sequence gap clears the internal book but not the copy already published to `market.deep`; it ages out under the normal 60 s execution limit. There is no silent-socket watchdog. |
| MA-19 | Hypothesis | A stream restart on any change of symbol set means 200 new snapshots. `BookSync.book()` sorts the full book on every event; benchmark this before streaming 200 symbols. |
| MA-20 | Theoretical | `DUPLICATE_INSTRUMENT_POSITION` is checked outside the entry transaction and no unique index enforces it. Safe within one process. Fix: re-check inside the transaction, or add a partial unique index through a new migration. |
| MA-21 | Code-confirmed | `claude.yml` does not check `author_association` and its actions are pinned by tag, not by SHA. The job has `contents: write`. |
| MA-22 | Code-confirmed | `.env.example:4` sets `MIA_DATA_DIR=./data`, which resolves to `server/data` under `run.mjs` and can split the database. |
| MA-23 | Confirmed | Fixed sleeps in e2e: `app.spec.ts:103`, `auth.spec.ts:41`, `autopilot.spec.ts:138`, `request-races.spec.ts:65,82,91`. The 2 s window at `app.spec.ts:260` deliberately counts requests and is intentional. |
| MA-24 | Code-confirmed | DITAS dashboard queries scan `json_extract` rows (`ditas/service.ts:38,65`), and `ditas_events.parent_event_id` has no index. |

### INFORMATIONAL: duplication map
- No second backup engine, lease system or fetch layer exists. `ops/backup.ts`, `ops/lease.ts` and `web/src/api.ts` are the canonical ones; the backup code from #10 and the lease code from #11 never landed.
- The local clock timers in `StatusRibbon` and `MiniCockpit` are intentionally separate from `useApi` polling.
- The `costR` round-trip cost formula in `workers/registry.ts:126` is evidence only. It must not be merged with the OMS or gate fee maths without a trading-risk review.
- Not examined: market-data normalization and duplicate Zod schemas.

## 4. Historical items verified as fixed
- S-01 (step-up for any suspension lift), L-01 (in-transaction write fence plus a two-process test) and Q-01 (commit-bound fresh QA evidence).
- O-01: the monitor compare-and-set includes mfe and mae, with `changes()===1`.
- No double T1 or stop exit is possible: a deterministic exit id with a unique `client_order_id` inside an IMMEDIATE transaction (`crash.oms.test.ts`).
- No fills from a ticker fallback (`oms.ts:295`).
- Stale, future-dated or non-finite books and marks fail closed. NaN sizing is denied. A zero stop distance is rejected.
- SEC-13: a setup code is required for remote clients that carry headers; MA-04 remains open.
- `trustProxy` is off. Sessions use random tokens stored as hashes with server-side expiry. Cookies are HttpOnly and SameSite=Strict, and CSRF needs a custom header.
- CI uses `permissions: contents: read`, `npm ci` and no `pull_request_target`.

## 5. Proposed repair plan (awaiting owner approval)

Each item lands as its own commit with a regression test that fails on the old code.

- **Batch 1:**
  - MA-01 and MA-02: exit fee safety and per-position close-all.
  - MA-16: one validator, and G11 shows invalid policies as failed.
  - MA-07: session-keyed step-up budget.
  - MA-09: backup CLI refuses a missing database; documentation.
- **Batch 2:** MA-05, splitting CI into parallel jobs with the audit kept required and red. MA-06 stays BLOCKED.
- **Batch 3:**
  - MA-03 and MA-12: QCI attribution (needs trading-risk sign-off).
  - MA-11: clocks.
  - MA-17: post-commit isolation.
  - MA-10 and MA-18: stream backoff, lag check and invalidation on gap.
- **Batch 4:** MA-08 (`StateDirectory`), MA-22, MA-15 and MA-24 (index migrations).
- **Batch 5 onwards:** MA-23 (state-based waits), MA-21, MA-14, MA-13 (after an owner decision), MA-19 and MA-20.

**Owner decisions needed:**
1. MA-04: require the setup code even at the machine?
2. MA-06: wait for upstream, or a time-limited exception?
3. MA-13: what may be stored slim or dropped?
4. MA-03: accept a consensus-rule change that makes quorum stricter?
5. Permission to push each batch to PR #18.

## 6. Repair results (batches 1–4, same day)

The owner said "Continue". Items that only tighten safety were repaired. Items that change the owner's own flow or data are left for owner decisions. Each fix has a regression test, and each test was run against the old code (stashed) to confirm it fails there unless noted.

| ID | Final status | Commit | Evidence |
|---|---|---|---|
| MA-01 | **VERIFIED** | `f1ae3b0` | `policy-exit-safety.test.ts`: with a stored policy missing `feeRate`, a stopped-out position closes with a finite fee. Fails on the old code. |
| MA-02 | **VERIFIED** | `f1ae3b0` | Same test file: null, negative and out-of-range fee rates book the last valid fee. Fails on the old code. |
| MA-16 | **VERIFIED** | `f1ae3b0` | One `validatePolicy` for accepted and stored policies. G11 shows an invalid policy as FAIL. The PAPER mode switch refuses an invalid policy. |
| MA-07 | **VERIFIED** | `ec06b49` | `auth-lockout.test.ts` "behind a proxy …": close-all and revoke-others work while the shared IP is locked. Fails on the old code. |
| MA-09 | **VERIFIED** | `d567934` | `backup-cli-wrong-dir.test.ts` spawns the CLI against an empty directory: exit 1, no database, no backup. Fails on the old code. Guide updated. |
| MA-05 | **FIXED, NOT YET VERIFIED in CI** | `5c1d68b` | `ci.yml` split into 6 independent jobs. The audit is unchanged and still required. Needs a completed GitHub run. |
| MA-21 | **FIXED, NOT YET VERIFIED in CI** | `5c1d68b` | `claude.yml` requires OWNER, MEMBER or COLLABORATOR. Actions are still pinned by tag, not SHA (open, low). |
| MA-03, MA-12 | **VERIFIED** | `f7abfb1` | QCI v3 (coordinator 1.2.0). `qci-vote-counting.test.ts`: 4 tests fail on the old code. `qci.test.ts`: with no book the result is NO_QUORUM or VETOED. **Consensus is stricter; trading-risk sign-off is still requested from the owner.** |
| MA-11 | **VERIFIED** | `af6b0ed` | `oms-clock-callbacks.test.ts`: an entry at an injected stale time is denied, and rows carry the evaluation time. Fails on the old code. |
| MA-17 | **VERIFIED** | `af6b0ed` | Same file: a throwing listener no longer creates a false "exit failed" incident. Fails on the old code. |
| MA-10 | **VERIFIED (offline)** | `38971c2` | `depth-stream.test.ts`: 50 events lead to 1 snapshot call (was 50), then backoff of about 1 s and 2 s. Fails on the old code. Streaming is still off by default. |
| MA-18 | **VERIFIED (offline)** | `38971c2` | A lagging book is not published. A gap or disconnect invalidates the book. A silent socket is closed. The fabric gap hands the symbol back to REST. Fails on the old code. |
| MA-19 | **VERIFIED** | `185b9ed` | Benchmark after 20,000 level-adding updates: 1.67 ms per event becomes 0.039 ms, with about 200 levels per side. Covered by a test. |
| MA-15, MA-24 | **VERIFIED** | `a86b1a7` | Migration v7 (indexes only). An upgrade test from v6 with data passes, and EXPLAIN QUERY PLAN uses each index. |
| MA-08 | **FIXED, PARTLY VERIFIED** | `358c873` | `systemd-analyze verify` is clean. It also showed that `StartLimit*` was ignored in `[Service]`; this is fixed. A real `systemctl start` on a fresh host was not run. |
| MA-22 | **VERIFIED (doc/config)** | `358c873` | `.env.example` no longer suggests a relative data directory. |
| MA-23 | **VERIFIED** | `283d3fc` | Three sleeps were replaced with state-based waits. Four remain as commented windows that prove no extra request is made. e2e: 76 passed. |
| MA-04 | **OPEN, owner decision** | — | Always requiring the setup code would change the owner's first-run flow and 15 test setups. |
| MA-06 | **BLOCKED (upstream)** | — | picomatch has no patched release. No override and no exception were applied. |
| MA-13 | **OPEN, owner decision** | — | DITAS retention. |
| MA-14 | **OPEN** | — | Verifying a full backup on the event loop has not been measured on a large database. |
| MA-20 | **OPEN (theoretical)** | — | The duplicate-instrument re-check inside the transaction is not added. It is safe within one process. |

**Final local verification at `185b9ed`:**

| Check | Result |
|---|---|
| typecheck | 0 errors |
| build | ✓ |
| server tests | 597 passed, 3 skipped (opt-in live-provider tests) |
| web tests | 21 passed |
| e2e | 76 passed |
| secret scan | ✓ (315 files) |
| `npm audit --omit=dev` | 0 |
| `npm audit --audit-level=high` | 6 high (MA-06) |
