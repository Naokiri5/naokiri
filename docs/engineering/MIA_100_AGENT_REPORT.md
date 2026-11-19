# MIA 100-agent investigation report — 2026-11-18

## How the 100 assignments were run (honest accounting)
| Metric | Actual |
|---|---|
| Specialist assignments defined | **100** (Squads A–J, 001–100, exactly as in the directive) |
| Independent agents actually executed | **11**. One read-only agent per squad covered that squad's 10 assignments, plus one separate independent reviewer for assignment 100. |
| Assignments completed | 100. Each squad agent returned a report covering its 10 assignments, and assignment 100 ran last, on the repairs. |
| Interrupted runs | 8 squad agents hit an account usage limit and were **resumed** from their saved state, not restarted. |
| Files inventoried | 331 tracked files (`MIA_FILE_INVENTORY.csv`) |
| Findings registered | 100 unique IDs: A 7, B 10, C 12, D 8, E 7, F 10, G 8, H 13, I 6, J 9 (J-01 = C-03), R 10 |
| Reproduced (executed) | 46. The rest are code-confirmed or suspected; see the register. |
| Repairs completed | 33 findings fixed (2 of them partially), each with a regression test |

This is **not** 100 independently executed agents. One agent per squad did that squad's 10 assignments in sequence. Squad agents were read-only, scratch files went outside the repo, and there were no parallel edits. All repairs were made by the lead orchestrator, one batch per commit. One squad agent wrote a scratch file into the repo by mistake; it removed the file itself and nothing was committed.

## Per-squad result
| Squad | Assignments | Files inspected (by the agent) | Key result | Highest finding |
|---|---|---|---|---|
| A Repository and architecture | 001–010 | all 325 → 331 tracked (import graph, routes, docs) | 0 runtime cycles, 0 true orphans, all 107 routes registered | S3 (A-01 config crash, fixed) |
| B Market data | 011–020 | `providers/*` (9), `market/*` (8) | Frozen books, future tickers, no back-off | S2 ×3 (fixed) |
| C Indicators and workers | 021–030 | `features`, `workers/*`, qci | Indicator maths exact (error 0); deadline never fired | S2 ×3 (2 fixed, C-02 open) |
| D QCI and decision | 031–040 | qci, decision, signing, scanner | **Found a regression in my QCI v3** (D-01); unstored consensus | S2 ×2 (fixed) |
| E Risk, OMS, accounting | 041–050 | risk, exec, portfolio, quality | **No S0–S2.** Hand lifecycle matched to 2e-12 USD | S3 (E-01, fixed) |
| F Backtesting | 051–060 | lab, research, features, replay | No look-ahead; metrics hand-verified; promotion too lax | S2 (F-01, fixed) |
| G DITAS | 061–070 | `ditas/*`, migrations, backup verify | REPLACE bypassed immutability; incomplete verification | S2 ×2 (G-01 fixed, G-02 partial) |
| H API and frontend | 071–080 | 107 routes fuzzed, 10 pages | No 5xx or leaks; contracts match; UI and accessibility gaps | S3 (mostly open UI items) |
| I Security and ops | 081–090 | auth, backup, process, lease (runtime) | Auth, CSRF and lease verified at runtime; backup gaps | S3 (2 fixed, 3 open) |
| J QA and release | 091–099 | coverage map, types, gates, fault injection | Deadline bug (same as C-03); fail-open expiry; vacuous gates | S2/S3 (fixed) |
| **100** Independent principal | 100 | `74fa093..HEAD` diff, 13 test files run | **Conditional GO.** Found R-01 (S2) and R-02, R-03, R-04 in my repairs | S2 (fixed in `fea0fe9`) |

## Disagreements and how they were resolved (by evidence, not vote)
- **B-09 vs R-04 (rounding).** B-09 said "never round up". R-04 showed that strict rule loses a lot to float noise. Resolution: step down only for an overshoot larger than 1e-6 of a lot. Both cases are tested.
- **D-01 vs R-02 (adverse evidence).** D-01 said adverse evidence vanished. R-02 showed the fix could double-count it above 1. Resolution: count it once per domain, with each domain bounded by its weight.
- **C-08 (WARN data quality should abstain).** Not applied. Together with C-01's mandatory enforcement it would block most candidates, which is a policy change, so it went to the owner.
- **C-01 test.** Squad C's no-book scenario turned out to be vetoed earlier, so the test did not reach the new code (R-03). It was replaced with a regime-unknown scenario that does.

## Remaining questions for the owner
See `MIA_MASTER_REPAIR_TRACKER.md`, section "Owner decisions pending".
