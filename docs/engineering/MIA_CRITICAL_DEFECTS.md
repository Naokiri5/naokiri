# MIA critical defect register (S0/S1) — 2026-11-18

**S0 (critical): none found.** Every squad looked for unauthorized trading, protective-exit failure, incorrect balances, ledger corruption, authentication bypass, duplicate execution and data corruption. None was found at `74fa093`:
- Squad E hand-computed a full paper lifecycle, and the code matched it to 2e-12 USD.
- Squad H fuzzed all 107 routes and found no 5xx and no authentication bypass.
- Squad I verified authentication, CSRF and leader election at runtime.

**S1 (high): none found in this audit.** The highest severity found was **S2**: 12 items, of which 11 are fixed and 1 is open.

| ID | Area | Status |
|---|---|---|
| B-01 | Frozen REST books looked fresh and executable | FIXED `319ec8f` |
| B-02 | A future-dated ticker blocked updates | FIXED `319ec8f` |
| B-03 | No provider back-off on 429/418 | FIXED `319ec8f` |
| C-01 | Mandatory worker flag not enforced | FIXED `9d95001` |
| C-02 | Correlated per-indicator dependency groups | **OPEN**: changes consensus weighting and needs a trading-risk review |
| C-03 / J-01 | Worker deadline never fired | FIXED `9d95001` |
| D-01 | QCI v3 regression: adverse evidence masked | FIXED `f5735ed` |
| D-06 | An unstored consensus could authorize | FIXED `f5735ed` |
| F-01 | PAPER promotion on 1 losing OOS trade | FIXED `2d7ce08` |
| G-01 | `INSERT OR REPLACE` rewrote immutable DITAS rows | FIXED `3fa973a` |
| G-02 | Forecasts, outcomes and twin runs not verified | PARTLY FIXED `9151e70`: twin runs are fixed; forecasts and outcomes are OPEN |

Items from earlier today, kept for history: MA-01/02/03 (HIGH) and SAFE-01 (P0). They are fixed and verified; see `MASTER_AUDIT_2026-11-18.md` and `AUTONOMY_AUDIT_2026-11-18.md`.

Full details for each item are in `MIA_ERROR_REGISTER.md`. The independent review of these repairs is in `MIA_100_AGENT_REPORT.md` (assignment 100).
