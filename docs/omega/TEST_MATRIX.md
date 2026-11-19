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
| UI | Watchlist banner "not a trade signal", candidate and full mint shown, no button or trade link in the card; stale banner; ranker-failure banner; "server does not report" message | `e2e/solana.spec.ts` | 4/4 pass |
| Second review 5 | A ranker throw empties only the Solana block (`rankerFailed`); the other Discover lists are still served | `server/test/solana-hunter-isolation.test.ts` | 2/2 pass; fail without the fix |
| Second review 6, 8 | `asOf` is `null` before the first DEX fetch; tests reset the DEX clock; route asserts the exact stale block | `server/test/solana-hunter-review.test.ts` | pass; fail without the fix |
| Second review 9 | Hangul fillers, stacked marks and separators stripped; NFC kept; code-point truncation; non-ASCII ticker note | same | pass; fail without the fix |
| Second review 10 | Fractional or huge trade counts are malformed (REJECT) and shown as 0 | same | pass; fails without the fix |
| Second review 11 | `solana/` imports no npm packages (signer SDKs blocked) | `server/test/import-boundaries.test.ts` | pass |
| Follow-up 13 | Only SOL/USDC/USDT-quoted pools are ranked (by mint, not symbol); others are skipped and counted | `server/test/solana-hunter-review.test.ts` | pass; fails without the fix |
| Follow-up 14 | DEX Screener symbols, names and `dexId` are cleaned at ingestion; quote address kept only if well-formed | `server/test/untrusted-provider-text.test.ts` | pass; fails without the fix |

Full-suite results for this branch are recorded in the PR description.

## PR-06: read-only Solana mint checks

| Area | Test | File | Result (local, this branch) |
|---|---|---|---|
| Size cap | `fetchProvider` `maxBytes` refuses an oversized Content-Length and a body that streams past the cap; a small body parses as before | `server/test/solana-rpc.test.ts` | pass; fails without the cap |
| Transport | URL only from `MIA_SOLANA_RPC_URL` (https, no credentials or fragment); exactly one `getMultipleAccounts`; redirects refused; bad input sends nothing; malformed or error replies rejected, node text not echoed | same | pass; fails if redirects are followed |
| Mint checks | Trusted-quote Solana mints only (deduplicated, at most 100); pass, block and missing account recorded with the slot in one request; TTL; dropped mints; error codes without the URL; stale pass becomes "not checked"; block always stands; no request without the setting; one request at a time | same | pass; fails if a stale pass still counts |
| Watchlist join | A block turns WATCH into REJECT (sorted last); a pass adds a note; nothing becomes tradable; `/api/discover` never contains the RPC URL or key | same | pass; fails without the join |
| UI | Mint check column; "authorities revoked" and "blocked" badges; failed-check banner; no buttons | `e2e/solana.spec.ts` | pass |
| Live (opt-in) | wSOL passes and USDC blocks on real chain data | `server/test/live.providers.test.ts` | **not run**: the sandbox network refuses the Solana host |

## Not run (no credentials or network; recorded honestly)
- **GMGN:** live API calls (no key).
- **Solana RPC:** the owner chose `https://api.mainnet.solana.com` (PR-06). The live test is written but not run here, because this sandbox's network policy refuses the host. It needs to run on the server. Real Token-2022 accounts with every extension type are not covered yet.
- **DEX Screener:** live fetch (the sandbox has no outbound access to it).
- **Latency:** the subsecond scorecard (requirement 006). Not measured.
