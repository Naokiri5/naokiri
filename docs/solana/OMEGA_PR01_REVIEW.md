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

## Review findings (fixed in the second commit, each with a test that fails on the starter's original code)
1. **Crash on provider input.** `p.chainId?.toLowerCase()` throws if DEX Screener ever sends a non-string `chainId`. That would turn `/api/discover` into a 500. Non-string chain IDs and addresses are now skipped.
2. **Spoofable symbols.** Token symbols are attacker-controlled. Control and bidi-override characters (for example U+202E) could make one ticker render as another. They are now stripped, with a `?` fallback.
3. **Future-dated cache counted as fresh.** The patch's freshness check `Date.now() - dexFetchedAt <= 5 min` treats a future-dated fetch (after a clock jump) as fresh. Freshness now requires `0 ≤ age ≤ 5 min`, using one clock reading (`discover(minVolume, nowMs)`).
4. **Containment.** `server/src/solana/` was added to THINK's evidence roots in `test/import-boundaries.test.ts`, so it can never import `exec/`, `wallet/` or `portfolio/`.

## Noted for later PRs (not changed now)
- `gmgn-read.ts` uses `fetch` directly. When it is wired (PR-05), route it through `providers/http.ts`: shared rate limits, backoff, credential-safe redirects and `ProviderError`. Add typed normalizers. Fractional fields mean `0.1783 = 17.83%`.
- `mint-audit.ts` reads the whole JSON-RPC response. When it is wired (PR-06), cap the response size, and test against real Token-2022 mints (for example ones with `mintCloseAuthority` or `interestBearingConfig`, which correctly stay UNKNOWN today).
- The base58 regex is format-only. Mint ownership is proven only by the RPC owner check (starter SKILL rule 5).
