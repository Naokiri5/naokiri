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
