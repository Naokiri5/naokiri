# MIA Solana Hunter — read-only integration starter

This is source code to apply to the GitHub project `Naokiri5/naokiri`, not a preinstalled plugin or live-trading deployment. It contains **original TypeScript** adapted from documented concepts in the user's five uploaded archives and official public integration docs.

## What is implemented
- `server/src/solana/hunting.ts`: Solana-only, de-duplicated DEX Screener watchlist scoring; rejects weak/liquidity-starved/no-sell/malformed candidates, never authorizes trading.
- `server/src/solana/mint-audit.ts`: fail-closed mint/freeze-authority and Token-2022 extension audit, optional read-only JSON-RPC `getAccountInfo` with timeout.
- `server/src/solana/gmgn-read.ts`: documented authenticated GMGN OpenAPI read-only calls (market rank, security, info, top holders, smart-money), returns untrusted unknown types; **not automatically called until server credentials are configured and service wired**.
- `server/test/solana-hunter.test.ts`: deterministic Vitest unit tests; no network calls.
- `.claude/skills/solana-hunter/SKILL.md`: reusable coding/QA/architecture instructions for Claude.
- `patches/0001-add-solana-hunter-to-discover.patch`: optional additive integration into the existing `discover()` JSON response (`solanaHunter`) from the cached DEX Screener feed. An unchanged reference copy is supplied as `discover.ts.review-copy` for review only.
- `docs/solana/SOLANA_HUNTER_INTEGRATION.md`: source audit, API dependencies, safety requirements, licensing and implementation roadmap.

## Apply to a local clone
At the root of `naokiri`:

```bash
cp -R /path/to/mia-solana-hunter/server/src/solana server/src/
cp /path/to/mia-solana-hunter/server/test/solana-hunter.test.ts server/test/
mkdir -p .claude/skills/solana-hunter docs/solana
cp /path/to/mia-solana-hunter/.claude/skills/solana-hunter/SKILL.md .claude/skills/solana-hunter/
cp /path/to/mia-solana-hunter/docs/solana/SOLANA_HUNTER_INTEGRATION.md docs/solana/
git apply --check /path/to/mia-solana-hunter/patches/0001-add-solana-hunter-to-discover.patch
git apply /path/to/mia-solana-hunter/patches/0001-add-solana-hunter-to-discover.patch
npm run typecheck
npm test -w server -- --run test/solana-hunter.test.ts
```

Do not run if the local `discover.ts` no longer matches the reviewed `main` branch; reconcile overlapping PR changes first.

## Limits and required follow-up
- **No live trade route and no signer.** MIA's existing live release gate remains locked.
- The read-only GMGN API requires the owner's key and host access; there are no live API calls in the delivered tests.
- DEX Screener token profiles are not a complete real-time Pump.fun launch feed. For actual launch sniping, add a verified on-chain event stream and slot/clock-aware backlog.
- TradingView Lightweight Charts **already appears as `lightweight-charts` in MIA `web/package.json`**. Reuse it; do not vendor the uploaded repository.
- Raydium archive is GPL-3.0 and Orca archive is custom-licensed; do not copy/paste their source into MIA without reviewing obligations.
- Tests compiled the three standalone TS modules and passed offline smoke assertions; the complete MIA test suite could not be run without a local repository clone/dependencies or a CI run.
