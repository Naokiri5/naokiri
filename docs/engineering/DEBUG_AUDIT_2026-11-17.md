# MIA 4.1 debug and crash-hunt audit — Batch A (2026-11-17)

Work order: `MIA_4_1_50_Agent_Debug_Crash_Hunt_Master_Prompt.md`. The 50 "specialists" are review disciplines worked through by one agent (Claude Code), **not** 50 independently running agents. Paper-only: nothing was deployed, `main` was not modified, and live execution, signing and withdrawals stay locked.

## 1. Executive summary

| Item | Value |
|---|---|
| Audited base | `main` @ `f1d174a` (PR #7 and Capy's PR #9 merged) |
| Review branch | `claude/blissful-planck-lazglg` (`main` merged in; earlier Phase 1 commits included) |
| Runtime | Node 22.23, Linux cloud container, isolated temp `MIA_DATA_DIR`s, offline providers for regression tests |
| Top-three risks | **SEC-SETUP** reproduced and fixed with tests. **SEC-LOCKOUT** reproduced and left open for an owner decision. **CERT-EVIDENCE** reproduced; the fix is in Capy's open PR #13 (review notes in §5). |
| New confirmed defect | **MIA-WEB-001**: sign-out that fails on the network showed the sign-in screen while the server session stayed valid. Reproduced in a real browser and fixed with a browser test. |
| Batch B | 32 reviewer findings checked, plus 1 found while verifying them; 19 fixed (16 with a regression test). See §8. |
| Overall | Suitable to continue **PAPER-only** development. Not certified for unattended hosted use until SEC-LOCKOUT is decided, PR #13 is completed and a 24 h hosted soak is run. **Real-money execution remains disabled.** |

## 2. Coverage (honest)
- **Tracked files:** 248 (`git ls-files`). Every TypeScript source file under `server/src` and `web/src` was **pattern-scanned** for `TODO`/`FIXME` (0), empty `catch` (7), `as any` (26), `: any` (212), `process.exit` (9) and `setInterval` (6). Scan hits are review candidates, not bugs.
- **Read line by line in this audit:** `api/auth.ts`, `core/ratelimit.ts`, `api/routes.ts` (auth, setup, emergency and step-up sections), `config.ts` (container detection), `qa/gates.ts` (main and PR #13), `web/src/App.tsx`, `web/src/api.ts`, `main.ts`, `bot/bot.ts`, `ops/*`. Many other modules were read and changed in earlier sessions on this branch (OMS, incidents, knowledge, dashboard, navigation) but were **not re-read for this audit**.
- **NOT_REVIEWED in this batch:** the remaining `server/src` modules (workers, QCI, DITAS internals, providers, lab, knowledge parsers), `web/src/pages/*`, `.claude/**` and docs other than those edited. A full per-file audit is **not** claimed.
- **Branches and PRs** at audit time:
  - Open: #12, #13, #14 (Capy), #6 and #8 (drafts, stacked DITAS).
  - Merged: #7, #9.
  - Closed without merging: #10, #11, which duplicated work already merged.

## 3. CI truth
- **Executed by this agent** on the review branch: `npm run typecheck` ✓, `npm test` (server **350 passed, 3 skipped**; web **18 passed**), `npm run build` ✓, `npm run test:e2e` **53 passed**, `npm run scan:secrets` ✓, `npm audit --audit-level=high` 0 vulnerabilities.
- **Skipped on purpose:** the 3 skipped server tests are opt-in live-provider tests (`MIA_LIVE_TESTS=1`). They need network access and are not evidence for G02.
- **Reported by the owner, not re-checked here:** green `main` CI run `44102924649` at `f1d174a`.
- **DEP0169 `url.parse()` warning:** not reproduced locally with `--trace-deprecation` (API and auth suites, e2e auth spec). It most likely comes from CI tooling. It is a warning, not a crash; origin not confirmed.
- **`TypeError` at `repair.test.ts`:** intentionally raised by a test route to check HTTP 500 handling. Not a production crash.

## 4. Bug register

```
ID: MIA-SEC-SETUP-001 (SEC-13)
Priority: P1   Status: FIXED_VERIFIED (review branch, not merged)
Path: server/src/api/routes.ts (setup route), server/src/config.ts inContainer()
Symptom: a remote visitor could create the first owner on a fresh MIA running in Docker, Codespaces or a cloud session.
Reproduction: fresh DB, CODESPACES=true, POST /api/auth/setup from 203.0.113.9 → 200 and owner created. In this cloud session
  (CLAUDE_CODE_REMOTE set) the same happened with no extra variable.
Root cause: `!isLoopback(ip) && !inContainer()`: being in a container opened setup to every source address.
Fix: setup is open only to a direct loopback connection without proxy headers, or with MIA_ALLOW_REMOTE_SETUP=1.
  Everyone else needs a one-time code printed to the server console:
  - ~100 bits of entropy, compared in constant time
  - printed at startup and on first creation only (no log flooding)
  - single use; rejections are audited
  The UI shows a "Setup code" field when the server requires one.
Regression tests: server/test/auth-setup.test.ts (7 tests: rejects without or with a wrong code, proxy headers count as
  remote, operator can finish with the code, local unchanged, explicit opt-in kept, print throttling). Five fail on the old
  route code (checked by restoring it). e2e/auth.spec.ts (2 UI tests).
Risk / rollback: container users must now copy the code from the terminal or log (documented in README, .env.example,
  SECURITY.md). Revert = restore the previous setup condition.
Owner approval required? yes, before merge (changes onboarding).
```

```
ID: MIA-SEC-LOCKOUT-001 (SEC-14)
Priority: P1   Status: CONFIRMED_REPRODUCED (open; owner decision)
Path: server/src/core/ratelimit.ts failureGate (GLOBAL = 20 per 15 min); server/src/api/auth.ts verifyPassphrase
Reproduction: owner logged in, then 20 wrong passwords from 198.51.100.0–19:
  - login with the CORRECT passphrase → 429 "wait 15 minutes"
  - close-all (step-up) with the correct passphrase → 429
  - emergency stop (no step-up) → 200 (still works)
Impact: an unauthenticated attacker can keep the owner out indefinitely by re-sending 20 guesses every 15 minutes. The owner
  cannot log in from a new device or close positions. Pausing and emergency stop still work for an existing session.
Options (choose one; not implemented):
  A. Exempt risk-REDUCING step-up actions (close-all, freeze withdrawals) from the global budget; keep it for login.
     Smallest change; does not help an owner with no session.
  B. Global budget counts only per-client-locked sources, plus an owner "recovery code" generated at setup that bypasses the
     global gate (still per-client limited). Strong, but adds a credential to store.
  C. Console/local override: a direct loopback request is never globally locked (per-client limit only). Works with the
     setup-code model; does not help a remote-only owner.
  Recommendation: A + C now, B later. Every option keeps per-client exponential backoff.
Owner approval required? yes (authentication policy).
```

```
ID: MIA-CERT-EVIDENCE-001
Priority: P1   Status: CONFIRMED_REPRODUCED. Fix proposed in Capy PR #13 (not verified here).
Path: server/src/qa/gates.ts on main
Reproduction: a results file with 0 tests, startTime 2020-01-01 and no commit → G01, G02, G03, G04 and G09 all PASS.
  G04 cites joe.test.ts, which does not exist.
Live trading stayed LOCKED (G07, G08, G12, G13 and G14 never pass), so this is false evidence, not a live unlock.
Dependencies: PR #13; see §5 for what it still misses.
```

```
ID: MIA-WEB-001
Priority: P2   Status: FIXED_VERIFIED (review branch)
Path: web/src/App.tsx sign-out button
Reproduction (Playwright, built app, offline temp server): abort POST /api/auth/logout, click Sign out →
  UI showed the sign-in form, GET /api/auth/state → authenticated:true, reload → signed in again.
Root cause: `.catch(() => {})` followed by an unconditional onLogout(); the session cookie is HttpOnly, so only the server can
  end it.
Fix: switch to the sign-in screen only after the server confirms. On failure, show an alert banner saying the session is
  still active.
Regression test: e2e/app.spec.ts "sign-out that fails on the network keeps the session and says so" (also checks that a
  successful sign-out survives a reload).
```

```
ID: MIA-WEB-002
Priority: P3   Status: STATIC_CODE_RISK
Path: web/src/api.ts useApi(): the 600 ms debounce timer started by a stream event is not cleared on unmount.
Effect: at most one extra GET after leaving a page, and a state update on an unmounted component. No data corruption.
Fix (not applied; needs a hook test environment, jsdom, which the web workspace does not have): clear timer.current in an
  unmount effect.
```

```
ID: MIA-OPS-001
Priority: P2   Status: CONFIRMED (observed in the Phase 1 soak, by design)
Symptom: after a hard crash the restarted engine waits on STANDBY until the dead holder's lease expires (≤ 45 s). During that
  gap no lane runs, so open paper positions are not monitored.
Dependencies: Capy PR #12 (lease hardening) touches the same area. Shortening the gap safely needs a liveness proof of the
  old holder; do not just lower the TTL.
```

Smaller review candidates, not defects:
- `notify.ts` swallows Telegram delivery errors (`.catch(() => {})`). Delivery failure is invisible apart from provider health.
- `BACKUP-POLICY`: plaintext backups when `MIA_BACKUP_KEY` is unset (documented). Capy PR #14 hardens staging. Hosted use should require a key.

## 5. Review notes for Capy PR #13 (release-gate evidence)
PR #13 already does a lot:
- Gates require specific, named assertions to have passed.
- Counters must be consistent.
- Skipped live tests do not count.
- G01, G03 and G04 are forced to PENDING with honest reasons.
- The missing `joe.test.ts` citation is replaced.

Against §6 of the work order it still lacks:
1. **Commit binding.** A report produced by an older commit still satisfies the gates. Record `git rev-parse HEAD` in the QA report (or beside it) and require it to equal the running build's commit; otherwise PENDING.
2. **Expiry.** There is no maximum evidence age. Suggest PENDING after N days or on any new commit.
3. **G09.** It can still PASS from unit tests alone. The work order requires recovery drills, such as the supervisor crash and restart test, `ops-lease`/`ops-supervise`, or a recorded drill, as separate evidence.

## 6. Crash and fault matrix (CR-01 … CR-20)

| Case | Status | Evidence |
|---|---|---|
| CR-01 kill during scan | PARTIAL | Soak: SIGKILL → restart in 1 s, lease handover. No assertion of "no duplicate candidate actions". |
| CR-02 kill after intent | TEST_GAP | Paper fills are synchronous in one transaction, so there is no external ambiguous state. No crash-injection test. |
| CR-03 stale book exit | COVERED | `oms.test.ts`, `incidents.test.ts`: no synthetic fill; persistent incident. |
| CR-04 future quote | COVERED | `quality.test.ts` (future-dated and stale inputs fail closed); OMS `quoteAgeOk` rejects negative age. |
| CR-05 feed down 60 s | PARTIAL | Data-quality gate blocks entries; ribbon and stale banner (e2e offline). No timed disconnect test. |
| CR-06 HTTP 429 provider | TEST_GAP | No provider-side 429 simulation or budget (inventory item 022/074). |
| CR-07 SQLite locked / disk full | TEST_GAP | busy_timeout 5 s and 500 mapping exist; untested. |
| CR-08 corrupt backup | COVERED | `ops-backup.test.ts` tamper, checksum, audit-chain and wrong-key tests. |
| CR-09 SIGTERM in flight | PARTIAL | Drain implemented; `ops-lease` drain test and soak clean stop. No in-flight-lane SIGTERM test. |
| CR-10 two instances | COVERED | `ops-lease.test.ts`; soak with a second OS process on the same DB stayed STANDBY. |
| CR-11 clock jumps | PARTIAL | Injectable `nowTs` in most domain functions; UTC day keys. No clock-jump suite. |
| CR-12 rapid repeat submit | COVERED | Repeated submit is idempotent (`oms.test.ts` "duplicate submit is idempotent"); the risk gate denies a reused `client_order_id` (`DUPLICATE_REQUEST`). Not load-tested concurrently. |
| CR-13 SSE reconnect | PARTIAL | Ribbon link/stale states (`web/src/status.test.ts`, Capy). No listener-leak test. |
| CR-14 mobile + chat race | TEST_GAP | Mobile layout e2e only. |
| CR-15 10k events perf | TEST_GAP | QHEF measures latency; no fixed-load benchmark recorded. |
| CR-16 injected content | PARTIAL | Knowledge and DITAS tests treat documents as untrusted; Joe has no order tools (`api.test.ts`). |
| CR-17 remote first owner | **FIXED_VERIFIED** | `auth-setup.test.ts`, `e2e/auth.spec.ts`. |
| CR-18 20 invalid logins | **CONFIRMED_REPRODUCED** | Open: MIA-SEC-LOCKOUT-001. |
| CR-19 logout fails | **FIXED_VERIFIED** | `e2e/app.spec.ts` (MIA-WEB-001). |
| CR-20 stale/skipped evidence | CONFIRMED_REPRODUCED | Fix pending in PR #13, plus the notes in §5. |

## 7. Go / no-go
- **Go:** continue PAPER-only development and local use. Remote first-owner claim is closed on this branch once merged.
- **No-go for unattended hosted use until:**
  - SEC-LOCKOUT is decided
  - PR #13 adds commit binding and expiry
  - backups are encrypted by policy on hosts
  - a 24 h hosted soak is recorded
- **Real-money execution: disabled.** No signer exists, withdrawals are locked, and G07, G08, G12, G13 and G14 cannot pass.

## 8. Batch B: full read-through and verified fixes (2026-11-17, later the same day)

Four read-only reviewers (subagents) each read one area line by line: trading core; API, security and knowledge; DITAS, ops and bot; web. They reported **32 candidate findings** (trading 8, security 6, ops 10, web 8). The lead (Claude Code) reproduced or traced every finding before fixing it.

**Rules for every fix below:**
- It has a regression test, and that test was run against the old code and **failed**. The exceptions are noted.
- Files that Capy's open PRs #12, #13 and #14 are changing were left to those PRs. Their findings are listed as review notes instead.

### 8.1 Fixed and verified on `claude/blissful-planck-lazglg` (not merged)
| ID | Pri | What was wrong | Evidence | Test |
|---|---|---|---|---|
| MIA-RISK-001 | P1 | The ledger trusted any non-null mark regardless of age. A frozen feed on an open position kept equity, the loss breakers and open risk on stale data, and the gate **failed open** for other instruments (breaks invariant #3). Stale, future-dated and non-positive marks now count as missing, so the gate denies `POSITION_MARKS_MISSING`. | traced and reproduced in a test | `risk.test.ts` (2) |
| MIA-OMS-003 | P2 | A target fill that closed a small position (sub-lot remainder snapped) followed by a TIME fill in the same pass threw. The transaction rolled back on every pass: the position could never exit and a false incident was raised. | reproduced | `oms.test.ts` |
| MIA-RISK-006 | P3 | The stored policy was not re-validated on read. A missing field made checks such as `costR > undefined` silently pass. It now denies `POLICY_INVALID` until the owner re-accepts. | reproduced | `risk.test.ts` |
| MIA-KB-001 | P2 | An EPUB spine repeating one chapter was inflated once per reference: a 2 KB upload produced 65 MB of text, 1.4 s of blocking and a 200 MB heap. Each file is now read once and the size budget is enforced as it accumulates. Measured after the fix: 39 ms, 18 MB. | measured | `knowledge.test.ts` |
| MIA-SEC-004 | P3 | CoinGecko symbols went into `RegExp` unescaped. `"USD+("` threw and broke the whole news refresh. | reproduced | `untrusted-provider-text.test.ts` |
| MIA-SEC-006 | P3 | RSS and DEX Screener links were stored unchecked. Only `http(s)` links are kept now. The CSP already mitigated this. | unit test | same file |
| MIA-SEC-001 | P2 | Trader Joe's pause tool depended on the model obeying the prompt, so an injected headline could pause trading. Code now allows the pause only when the owner's own message asks for it. | unit-tested gate (no live LLM call) | `joe-gate.test.ts` |
| MIA-SEC-002 | P3 | One Joe message could run unlimited `analyze_instrument` calls, bypassing the `/api/analyze` limit. Now capped at 3 analyses and 16 tool calls per message. | unit test | `joe-gate.test.ts` |
| MIA-SEC-003 | P3 | Academy experiments and strategy comparison had no rate limit (backtests were limited to 6/min). Now limited to 6/min (burst 2) and 2/min (burst 1). | HTTP test | `research-limits.test.ts` (not run against the old code) |
| MIA-OPS-003 | P2 | `mia.db` was created 0644 in a 0755 directory, so any local account could read the passphrase hash, sessions and ledger. The file is now 0600 and a new data dir is 0700. | `stat` | `db-permissions.test.ts` |
| MIA-OPS-007 | P2 | **Found by the lead while checking a reviewer claim.** One open browser tab (SSE stream) made every graceful stop hang until the 30 s hard limit, exit 1 and skip `closeDb`. Streams now end on `preClose`. Measured: 32 s → 1.1 s, clean exit. | timed with curl + SIGTERM | `shutdown-sse.test.ts` (old code: 8 s timeout) |
| MIA-OPS-008 | P3 | Shutdown released the engine lease before HTTP stopped. It now drains lanes, closes HTTP, then releases the lease and closes the DB. An undrained stop keeps the lease and exits 1. | code + live SIGTERM run | covered by the measured stop above |
| MIA-OPS-004 | P3 | The supervisor treated a spawn failure (ENOENT) as idle and exited 0, which systemd reads as a clean stop. It now counts as a crash, so the crash-loop cap applies and the exit code is 1. | reproduced | `ops-supervise.test.ts` |
| MIA-WEB-011 | P1 (UX) | A failed Joe send wiped both the error and the typed text. The text now returns to the box and the error stays visible. | browser | `e2e/app.spec.ts` |
| MIA-WEB-013 | P2 | After an in-app switch, the Terminal kept showing the previous symbol's chart and book under the new URL. `useApi` now resets on a path change, and pages remount per route. Either change alone fixes it. | browser | `e2e/app.spec.ts` |
| MIA-WEB-014 | P2 | An empty book side threw, and there was no error boundary, so the whole app went blank including the emergency banner. The book is guarded and a page-level boundary keeps the header and banners up. | code | no dedicated test (no DOM unit-test setup) |
| MIA-WEB-012 | P2 | A missing quote or book age was shown as a fresh "0s". It now shows "missing". | code | none |
| MIA-WEB-016 | P3 | An older asset-search response could overwrite newer results (header search and palette). Stale responses are now ignored. | code | none |
| MIA-WEB-002 | P3 | The debounced stream refresh timer was not cleared on unmount. | code | none |

### 8.2 Left to Capy's open PRs (review notes, no duplicate code)
**PR #13 (control, strategy promote, Trading.tsx):**
- **MIA-WEB-010 (P1):** each strategy row sends the whole `disabledStrategies` list from its own stale fetch. Revoking B can re-send a list without A and silently re-enable A while a passphrase is typed. PR #13's passphrase clearing turns this into a confusing failure but does not fix it. Fix: explicit `{disable|enable: id}` operations on the server.
- **MIA-SEC-005 / MIA-WEB-015** (promote without step-up): already addressed by PR #13.
- **MIA-WEB-017:** do not render "Switch" for BOUNDED_LIVE.

**PR #12 (bot.ts, readiness.ts):**
- **MIA-BOT-001 (P2):** `hotLane` and `backgroundLane` use try/finally without catch, and `holdEngine` journals and notifies outside a try. A DB error becomes an unhandled rejection and Node exits. The supervisor restarts it, but the lanes should catch.
- **MIA-BOT-002:** already addressed by PR #12's `stillLeader()`.
- **MIA-OPS-006:** a wedged STANDBY still reports ready. Add a lease-check heartbeat.

**PR #14 (backup.ts):**
- **MIA-OPS-001b:** `MIA_BACKUP_INTERVAL_H=` (blank) silently disables backups (`Number('')` = 0).
- **MIA-OPS-002:** a failed restore check blocks retries for 24 h. PR #14's last-good retention partly addresses this.
- **MIA-OPS-005:** orphan and `.verify-*` files are never pruned.
- **Plaintext `.db` backups are written 0644.** `chmod 0600` them.

### 8.3 Open: owner decision or larger change
- **SEC-14:** global login lockout. Unchanged; options are in §4.
- **MIA-QCI-002 (P2):** dependency groups are de-duplicated only within a domain, so one input (e.g. `ticker.24h`) votes in up to four domains. Abstentions count toward quorum, and constant-rule workers always cover the required domains. This is evidence only and the gate stays authoritative. It is the same owner decision as R-12.
- **MIA-DITAS-001 (P1, estimated, not measured):** every NO_SIGNAL/REJECTED event stores a full snapshot (candles + book). There is no dedupe or retention because the tables are append-only by design. The reviewer estimates ~250 MB/day. `verifyMemory` loads every snapshot into memory. Changing the snapshot policy changes the immutable-evidence design, so it needs an owner decision and a migration plan; measure growth first.
- **MIA-PORT-005 (P3):** the start-of-day baseline is captured lazily. Losses between 00:00 UTC and the first full-mark evaluation after a restart can vanish from the daily breaker.
- **MIA-OMS-004, MIA-RISK-007, MIA-SCAN-008 (P3):**
  - a lot-sized residual after all targets
  - existing-position open risk excludes the stop buffer
  - a manual analyze suppresses the scheduled evaluation
- **MIA-WHALE-001 (P3):** large-print paging misses trades on busy symbols. Evidence only.
- **MIA-WEB-018 (P3):** clickable table rows and calendar days are not keyboard-operable.
- **Ingestion crash loop:** a document that crashes ingestion is re-queued at every start. Less likely after MIA-KB-001.

### 8.4 Coverage after Batch B (`docs/engineering/audit-files.json`, generated by `scripts/audit-inventory.mjs`)
| Status | Files |
|---|---|
| Total tracked | 260 |
| Read in full | 112 (all of server/src except the items below; 14 core web files; scripts; deploy unit; manifests) |
| Partial | 7 (`db/*`, `knowledge/taxonomy.ts` data, `.github`, `.env.example`) |
| Not reviewed | 38 (6 provider adapters, `safety/safety.ts`, 5 web pages: Academy, Account, Ditas, Overview, Phase1; `styles.css`; `.claude/agents` and `.claude/skills`; tool configs) |
| Docs / test code (not audited as product code) | 58 / 44 |
| Generated | 1 |

### 8.5 Checks after Batch B (run by the lead)
- `npm run typecheck` ✓
- `npm test`: server **367 passed, 3 skipped**; web **18 passed**
- `npm run build` ✓
- `npm run test:e2e`: **55 passed** on two consecutive full runs. One earlier run had a single timeout in `navigation.spec.ts` (palette synonyms, 1 min, during a slow run); that test then passed alone and in both full runs.
- `npm run scan:secrets` ✓
- `npm audit --audit-level=high`: 0 vulnerabilities

### 8.6 Draft PRs #6 and #8
Every file in them is already on `main` with newer fixes on top. They are superseded, and closing them is the owner's decision.
