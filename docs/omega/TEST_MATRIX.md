# TEST_MATRIX — Omega (2026-11-19)

## PR-01: read-only Solana Hunter

| Area | Test | File | Result (local, this branch) |
|---|---|---|---|
| Starter behaviour (owner's tests, unchanged) | 8 tests: Solana-only, mint dedup, rejects no-sell/under-liquid, unknown age, mint checks, Token-2022 risky/unknown extensions, read-only `getAccountInfo`, RPC outage, GMGN routes and no signature header | `server/test/solana-hunter.test.ts` | 8/8 pass |
| Review fix 1 | Non-string `chainId`/addresses skipped, never throws | `server/test/solana-hunter-review.test.ts` | pass; fails on the starter's original line (mutation-checked) |
| Review fix 2 | Control/bidi characters stripped from symbols | same | pass; fails without the fix |
| Review fix 3 | Future-dated DEX cache is stale, not fresh | same | pass; fails without the fix |
| Read-only invariant | Every row `tradingEligible:false`; `executionReady:false` | same | pass |
| No regression | `dexLaunches` unchanged; DEX safety still `eligibleForAutomation:false` | same | pass |
| Route | `/api/discover` needs a session (401) and returns the `solanaHunter` block | same | pass |
| Boundary | `solana/` cannot reach `exec/`, `wallet/`, `portfolio/` | `server/test/import-boundaries.test.ts` | pass |
| UI | Watchlist banner "not a trade signal", candidate shown, no button or trade link in the card; stale banner | `e2e/solana.spec.ts` | 2/2 pass |

Full-suite results for this branch are recorded in the PR description.

## Not run (no credentials or network; recorded honestly)
- **GMGN:** live API calls (no key).
- **Solana RPC:** `getAccountInfo` against real mints, including real Token-2022 accounts (no RPC URL).
- **DEX Screener:** live fetch (the sandbox has no outbound access to it).
- **Latency:** the subsecond scorecard (requirement 006). Not measured.
