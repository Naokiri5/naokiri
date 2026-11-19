# Omega PR-01 — review of the owner's Solana Hunter starter (Claude)

## Provenance
All 9 starter files were imported **byte-identical**. Each SHA-256 and byte size matches `docs/omega/sources/MIA_OMEGA_SOURCE_AUDIT_AND_IMPORT_MAP.md`.
- **Locations:** `server/src/solana/*`, `server/test/solana-hunter.test.ts`, `.claude/skills/solana-hunter/SKILL.md`, `docs/solana/SOLANA_HUNTER_INTEGRATION.md`. The README and patches are kept under `docs/solana/starter/`.
- **The patch:** `0001-add-solana-hunter-to-discover.patch` passed `git apply --check` and applied cleanly. `discover.ts` then matched the starter's review copy byte for byte.
- **Commit split:** the verbatim import is its own commit; MIA's review fixes follow in a second commit.

## What it is (and is not)
- **What it is:** a read-only, deterministic **watchlist** of Solana pairs from MIA's existing DEX Screener cache, shown on Discover → **Solana watchlist**.
- **Never a trade signal:**
  - every row is `tradingEligible: false`, and the block is `executionReady: false`;
  - there is no signer and no order route;
  - `safety.ts` (`eligibleForAutomation: false`) is unchanged.
- **The score:** `rankScore` only orders the list. It is **not** a probability, and the UI says so.
- **Built but not connected:** `mint-audit.ts` (Solana RPC) and `gmgn-read.ts` (GMGN) exist but are **not wired**. They need owner-configured credentials in later PRs (06 and 05).

## Review findings (fixed in the second commit)
Fixes 1–3 have regression tests that fail without the fix. Fix 3's test calls `discover(minVolume, nowMs)`, a parameter the starter's patch did not have, so it was checked by removing the fix rather than by running the original. Fix 4 is enforced by the existing import-boundary test.

1. **Crash on provider input.** `p.chainId?.toLowerCase()` throws if DEX Screener ever sends a non-string `chainId`. That would turn `/api/discover` into a 500. Non-string chain IDs and addresses are now skipped.
2. **Spoofable symbols.** Token symbols are attacker-controlled. Control and bidi-override characters (for example U+202E) could make one ticker render as another. They are now stripped, with a `?` fallback.
3. **Future-dated cache counted as fresh.** The patch's freshness check `Date.now() - dexFetchedAt <= 5 min` treats a future-dated fetch (after a clock jump) as fresh. Freshness now requires `0 ≤ age ≤ 5 min`, using one clock reading (`discover(minVolume, nowMs)`).
4. **Containment.** `server/src/solana/` was added to THINK's evidence roots in `test/import-boundaries.test.ts`, so it can never import `exec/`, `wallet/` or `portfolio/`.

## Second review: independent integration, security and duplication reviewers (third commit)
No CRITICAL, HIGH or MEDIUM findings. The LOW findings below were confirmed against the code and fixed. Every new test was checked by removing the source fix and watching it fail (8 of 8 failed, then passed with the fix).

| # | Finding | Fix | Test |
|---|---|---|---|
| 5 | A throw inside the ranker would turn the whole `/api/discover` response (all CEX lists too) into a 500. | `discover.ts` `solanaWatchlist()` catches it: only the Solana block empties, with `rankerFailed: true`. No logging, matching the module's convention of reporting state in the response. | `server/test/solana-hunter-isolation.test.ts` (ranker mocked to throw) |
| 6 | `asOf` was `0` before the first DEX fetch, while the web type says `number \| null`. | Server now sends `null` until the cache has loaded. | `solana-hunter-review.test.ts` |
| 7 | With no `solanaHunter` block (still loading, or an older server) the page claimed "No Solana pairs in the current DEX Screener sample." | The page now says "Loading…" or "This server does not report a Solana watchlist.", and shows a separate banner when the ranker failed. | `e2e/solana.spec.ts` (2 new tests) |
| 8 | The route test inherited a leftover `dexFetchedAt` from the previous test and asserted little. | Tests reset `dexFetchedAt` and assert the exact stale block. | `solana-hunter-review.test.ts` |
| 9 | Symbol cleaning missed invisible Hangul fillers, stacked combining marks and line separators, and `slice(0, 40)` could cut a surrogate pair. | `displayText` normalizes to NFC, strips those classes, and truncates by code point. A non-ASCII ticker gets a note: compare the mint, not the ticker. The UI now shows the full, selectable mint. | `solana-hunter-review.test.ts` |
| 10 | Fractional or huge trade counts (0.5, 1e300) were shown as-is. | Counts must be safe non-negative integers, otherwise `MALFORMED_MARKET_METRICS` (REJECT) and shown as 0. | `solana-hunter-review.test.ts` |
| 11 | The import-boundary test follows relative imports only, so a signer package such as `@solana/web3.js` in `solana/` would not be caught. | New guard: `solana/` may import no packages (empty allow-list; extending it needs review). | `import-boundaries.test.ts` |
| 12 | The project skill listed "Solana swap execution" as a reason to load it and phases F (testnet execution) and G (bounded live) as a plan, which a future agent could read as in scope. | The trigger is removed and a scope lock says F, G, signing and swaps are out of scope without the owner's explicit authorization in the conversation. | Documentation change (`.claude/skills/solana-hunter/SKILL.md`) |

Kept as is, with reasons:
- **Duplication.** No real duplication. `clamp` in `hunting.ts` is an exact copy of `core/util.ts` `clamp`, kept so the owner's starter stays close to its original bytes. The 5-minute DEX limit in `discover.ts` and `hunt/ranker.ts` stays separate: the hunt ranker checks per-observation timestamps with 2 s future skew, the watchlist checks the cache age with no future skew, and `market/` should not import from `hunt/`.

## Follow-ups closed in the same PR (fourth commit)
| # | Finding | Fix | Test |
|---|---|---|---|
| 13 | Quote-token liquidity (security review; the risk was unconfirmed but cheap to close). `liquidityUsd` depends on how DEX Screener values the pool's quote token, and the quote token was never checked, so a pool quoted against an attacker-minted token could carry a meaningless liquidity figure. | `mapPair` now records `quoteAddress` (only a well-formed address, otherwise empty). `solanaWatchlist()` ranks only Solana pools quoted in wrapped SOL, USDC or USDT (`server/src/solana/quotes.ts`, by mint address, never by symbol). Other pools are skipped and counted in `skippedUntrustedQuote`, and the tab says how many. A missing quote counts as untrusted. | `solana-hunter-review.test.ts` (a "USDC"-labelled pool with an unknown mint and huge liquidity is skipped) |
| 14 | The older "New DEX tokens" tab rendered raw `baseSymbol`/`baseName` (bidi spoofing possible; React already escaped HTML). | Token text is cleaned once, where it enters MIA: `mapPair` applies `displayText` (now in `core/util.ts`, the single implementation; the ranker imports it) to symbols, names and `dexId`. | `untrusted-provider-text.test.ts` (stubbed DEX Screener response through `search()`) |

Known limit, fail closed: `latestTokenPairs` still keeps the most liquid pool per token before anything else sees it. If that pool has an untrusted quote, the token is left out of the watchlist (counted as skipped) even when a SOL or USDC pool also exists. Preferring trusted-quote pools at ingestion would change the shared "New DEX tokens" data, so it is left for a separate, reviewed change.

## Noted for later PRs (not changed now)
- **Response size caps.** *Update (PR-06):* `fetchProvider` now has an opt-in `maxBytes`, used by the Solana RPC adapter. GMGN still needs it when it is wired (PR-05).
- *Original note:* `http.ts` reads whole provider bodies (10 s timeout, no size cap); add a cap before wiring GMGN or RPC.
- `gmgn-read.ts` uses `fetch` directly. When it is wired (PR-05), route it through `providers/http.ts`: shared rate limits, backoff, credential-safe redirects and `ProviderError`. Add typed normalizers. Fractional fields mean `0.1783 = 17.83%`.
- *Update (PR-06):* `mint-audit.ts` shipped an invalid Token-2022 program id, which the live test found. It is fixed in PR-06, and the RPC transport there caps responses at 2 MB.
- *Original note:* `mint-audit.ts` reads the whole JSON-RPC response. When it is wired (PR-06), cap the response size, and test against real Token-2022 mints (for example ones with `mintCloseAuthority` or `interestBearingConfig`, which correctly stay UNKNOWN today).
- The base58 regex is format-only. Mint ownership is proven only by the RPC owner check (starter SKILL rule 5).
