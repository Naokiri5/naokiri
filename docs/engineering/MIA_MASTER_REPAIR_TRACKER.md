# MIA master repair tracker

Use this file to continue work in a later session without starting from zero. Older trackers are kept for history: `MASTER_AUDIT_2026-11-18.md` (MA-xx) and `AUTONOMY_AUDIT_2026-11-18.md` (SAFE-xx).

## 2026-11-18: 100-agent directive

**Baseline:** `74fa093`

| Check | Result |
|---|---|
| typecheck | 0 errors |
| build | ✓ |
| server tests | 616 passed, 3 skipped |
| web tests | 21 passed |
| e2e | 76 passed |
| secret scan | ✓ |
| `npm audit --omit=dev` | 0 |
| `npm audit` (all) | 6 high (picomatch; known) |

### Repair commits, in order
Each fix's regression test was run against the old code and failed there, except where noted.

| Commit | Findings | Lifecycle |
|---|---|---|
| `319ec8f` | B-01, B-02, B-03, B-04, B-09 | VERIFIED (6 tests fail on old code) |
| `f5735ed` | D-01, D-03, D-06 | VERIFIED (3/3 fail on old code) |
| `7bad7a6` | E-01, E-02, E-03 | VERIFIED |
| `2d7ce08` | F-01, I-01, I-03 | VERIFIED |
| `9d95001` | C-03/J-01, C-01, C-04, C-06, C-07 | VERIFIED (C-01 test is a guard) |
| `3fa973a` | J-04, G-01, A-01, A-02, H-04, H-08 | VERIFIED |
| `9151e70` | G-02 (twin runs), G-03 (missing snapshot), J-02 | VERIFIED |

The independent review (assignment 100) of all repair commits is recorded in `MIA_100_AGENT_REPORT.md`.

### Next work, in priority order
1. **C-02 / J-05 (S2/S3):** consensus weighting by input source, and one costR. Needs a trading-risk review because it changes consensus outcomes.
2. **G-02 remainder (S2):** hash forecasts and outcomes in a new append-only table. Anchor the DITAS chain head in the audit log (G-03 tail).
3. **I-02, I-04, I-05 (S3):**
   - authenticate backup manifests (HMAC);
   - move `createBackup` off the event loop;
   - add a `restore` command that also handles `evidence.key`.
4. **B-05 to B-08, B-10:** provider and market-data validation gaps.
5. **D-02, D-04, D-07:** bind packets to registry workers; packet freshness; store policy and weight versions in reports.
6. **F-02 to F-06:** lab evidence hygiene (trial count, TIME slippage, cutoff time, contiguity, uncertainty shown in the UI).
7. **H-01 to H-03, H-05 to H-07, H-09 to H-13:** UI empty and loading states, accessibility, 404 status codes.
8. **J-03, J-06 to J-10:** G10 window, day bucketing, schemas, typed DB rows, e2e typecheck.
9. **A-03 to A-07:** documentation refresh (ARCHITECTURE, README, generated inventories, unused exports).

### Owner decisions pending
- **MA-04:** require the setup code even at the machine.
- **MA-13 / G-04:** DITAS retention or archive policy.
- **C-08:** abstain on WARN data quality.
- **I-06:** step-up for paper deposits and order approval.
- **I-02:** backup authentication key management.
- **QCI v3 + D-01 + C-01:** sign-off on the stricter consensus.

### Blocked
- **MA-06:** picomatch advisory, upstream.
- **R-01:** a 24 h or 7-day hosted soak needs an always-on host.
- **Live provider tests:** need network access.
- **systemd start on a real host:** needs a host.
