# MIA final engineering assessment — 2026-11-18

## Verdict: **READY FOR CONTROLLED PAPER TESTING**
This is not "extended paper operation" or "independent release review", and **never live trading**: this build is paper-only and live is locked.

**Reasons:**
- No S0 or S1 defect was found, whether by 10 squad reviews, runtime probes or the independent principal review.
- Every S2 except C-02, and the G-02 remainder (forecast and outcome hashes), is fixed with regression tests.
- The accounting was hand-verified to 2e-12 USD.

**Why not higher:**
- C-02 (correlated worker groups) and the G-02 remainder are open.
- Backup authentication and restore tooling (I-02, I-05) are missing.
- No 24 h / 7-day hosted soak has been run (R-01 blueprint, blocked on a host).
- The strategies have no demonstrated out-of-sample edge.

## Final verification
Commit `fea0fe9212ffc12b69b645aefa52e9c23b5b3dc9`, run 2026-11-18 11:04–11:07 UTC from a clean `npm ci`.

| Command | Result | Exit |
|---|---|---|
| `npm ci` | installed from lockfile | 0 |
| `npm run typecheck` | 0 errors | 0 |
| `npm run build` | web + compiled server | 0 |
| `npx vitest run` (server) | **654 passed, 3 skipped** (67 files; the 3 skipped are opt-in live-provider tests, not passes) | 0 |
| `npm test -w web` | 21 passed | 0 |
| `npm run test:e2e` | **76 passed** | 0 |
| `npm run scan:secrets` | clean (337 files) | 0 |
| `npm audit --omit=dev --audit-level=high` | 0 vulnerabilities | 0 |
| `npm audit --audit-level=high` | **6 high**: GHSA-fc5q-39xc-vjpf (picomatch ≤ 4.0.7, dev tools only; no patched release) | 1 (kept visible, not suppressed) |
| `npm run qa -w server` | exit 0; QA record bound to commit `fea0fe9…`, `dirty: false` | 0 |

Compared with the baseline `74fa093` (616 server tests, 76 e2e): 38 new regression tests, and none removed or weakened. Four existing expectations were updated for intended contract changes; each is explained in its commit.

## Definition-of-done checklist
| Item | Status |
|---|---|
| 100 assignments accounted for, executed-agent count reported | ✓ (11 agents; see `MIA_100_AGENT_REPORT.md`) |
| All tracked files inventoried | ✓ 331 (`MIA_FILE_INVENTORY.csv`) |
| Every executable source file has an audit status | ✓ (direct-test evidence or not, plus findings) |
| All discovered errors registered | ✓ 100 IDs (`MIA_ERROR_REGISTER.md`) |
| S0 fixed or escalated | ✓ none found |
| S1 fixed or escalated | ✓ none found |
| Financial accounting independently verified | ✓ hand lifecycle 2e-12 USD; fee drift Δ 2.4e-13; reconcile hardened (E-01, R-01) |
| Protective exits verified | ✓ book-only exits, combined depth, compare-and-set, close-all isolation, TIME/STOP complete (E-02) |
| OMS lifecycle tested | ✓ crash-injection suite, duplicate entry, in-transaction re-check, expiry fails closed |
| QCI voting rules verified | ✓ adversarial and v2/v3 comparison (D); fixes D-01, D-03, D-06, C-01, R-02 |
| Market-data integrity verified | ✓ B-01–B-04 fixed; B-05–B-08 and B-10 open |
| Worker responsibilities inspected | ✓ all 100 (C); deadline fixed; C-02 open |
| Backtesting correctness verified | ✓ no look-ahead; metrics hand-checked (F) |
| Out-of-sample validation | ⚠ mechanism verified, promotion gate tightened (F-01); **edge not demonstrated** |
| DITAS history and integrity verified | ⚠ immutability fixed (G-01); verification extended; forecast and outcome hashes open |
| Security boundaries tested | ✓ 107 routes fuzzed; auth, CSRF and lease verified at runtime; I-01 fixed; MA-04 is an owner decision |
| Backups and restoration tested | ⚠ create, verify and encrypted restore drills done (I); no restore command; manifest unauthenticated (I-02) |
| Duplicate-code candidates investigated | ✓ `MIA_DUPLICATION_AUDIT.md`; 2 consolidated, costR needs review |
| Broken and unused files classified | ✓ 0 orphans; unused exports listed (A-06) |
| Frontend and backend integration tested | ✓ contract check and e2e 76; UI gaps H-01/H-03/H-05 open |
| Performance measurements recorded | ✓ start-up, shutdown, event loop, RSS, backup verify 230 → 9 ms, book 1.67 → 0.039 ms |
| Regression tests implemented | ✓ 38 new |
| Independent review completed | ✓ assignment 100; its S2/S3 findings fixed in `fea0fe9` |
| Final test evidence linked to the exact commit | ✓ above, plus the QA record |
| Known dependency vulnerabilities documented | ✓ picomatch (upstream) |
| No real-money execution enabled | ✓ `LIVE_EXECUTION_AVAILABLE = false`; BOUNDED_LIVE refused in the core (SAFE-01) |

## Performance (measured, offline)
| Measure | Before | After |
|---|---|---|
| Start-up to `/api/health` | — | 0.8–1.6 s |
| SIGTERM to exit | — | 13–29 ms |
| Idle event loop | — | p99 ≤ 3.1 ms |
| RSS (65 s idle) | — | flat at 102 MB |
| Backup verify, longest event-loop gap (40k rows) | 230 ms | 9 ms (MA-14) |
| Stream book update (20k levels) | 1.67 ms | 0.039 ms (MA-19) |
| `createBackup` blocking at 150 MB | 1.1 s | still 1.1 s (I-04, open) |

## Remaining blockers
- **Upstream:** picomatch.
- **Infrastructure:** hosted 24 h / 7-day soak; a systemd start on a real host; live-provider tests (network).
- **Owner decisions:** MA-04, MA-13/G-04, C-08, I-06, I-02 key management, sign-off on the stricter consensus.
