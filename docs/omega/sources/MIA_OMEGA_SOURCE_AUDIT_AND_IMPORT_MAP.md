# MIA Ω — Source Review & Import Register

Snapshot date: 2026-11-19. This is a **read-only audit**; no GitHub writes, Cloudflare DNS changes or live trades were performed.

## Original source preservation

- User original: `Pasted text(20261119-110003).txt`, 747 lines, 27962 characters. Preserved verbatim in master Appendix A, plus raw copy in handoff.
- Starter: `mia-solana-hunter-starter (1).zip`, 9 text source files, copied verbatim in master Appendix B and extracted to `starter/` in ZIP.
- Reference code was reviewed by file and license; reference archives were not blindly imported.

## Verified main repository findings

- `Naokiri5/naokiri` Node >=22.13, `@mia/server` Fastify/TypeScript with native `node:sqlite`, `@mia/web` Vite/React.
- `docs/QHEF_LATENCY_BASELINE.md`: internal candidate→decision 37 ms (one sample), OMS paper submit 1.6 ms (one sample), provider Binance REST p95 1319 ms, book p50 863 ms. Network feed and polling dominate.
- `server/src/providers/dexscreener.ts`, `server/src/market/discover.ts`: pair/profile discovery exists; not full Solana event launch feed.
- `server/src/safety/safety.ts`: Solana DEX monitoring `eligibleForAutomation: false` until RPC/contract and sellability checks.
- `server/src/providers/pending.ts`: Solana RPC and real venue still pending.
- `server/src/core/mode.ts`, OMS/release gates: `BOUNDED_LIVE` is intentionally locked.
- Relevant open PRs: #18 streaming and repairs, #19 1000-token screening, #23 broad integration, #26 chart enhancements, #35 THINK replay, #41/#42 NEXUS contracts, #43 transactional outbox, #44 Trader Joe event projection. Verify actual latest states before any PR merge.

## Uploaded dependency/source audit

| Archive | Evidence | Reuse decision |
|---|---|---|
| `lightweight-charts-master.zip` | v5.3.0, Apache-2.0; already declared in MIA web/package.json | Reuse existing dependency; do not vendor source |
| `solana-py-master.zip` | v0.42.0, MIT | Read RPC semantics; implement native TS adapter for MIA fast path |
| `solana-py-master (1).zip` | Byte-identical to previous | Skip duplicate |
| `raydium-sdk-V2-master.zip` | v0.2.85-alpha, GPL-3.0 | Review compatibility/licensing before dependency/internals; no blind code copy |
| `whirlpools-main.zip` | Custom Orca License after 2025-02-27 | Review legal terms and SDK use before copying |
| `GMGNAI/gmgn-skills` (GitHub) | MIT official CLI/skills, authenticates market/token reads with X-APIKEY | Use read-only research endpoint concepts; protect API key; never import signer into research |

## Starter extraction manifest

| Relative path | Bytes | SHA256 |
|---|---:|---|
| `README.md` | 3266 | `60781c2ecd55c20cd8ea2ffddd94ccd748932f8fda68e050ba9f3345c0eda0c9` |
| `server/src/solana/hunting.ts` | 5863 | `4f7d7d392f8615d210d96d999fc743378fc8abbc8ddd330b80e3410e96fc8df1` |
| `server/src/solana/mint-audit.ts` | 5322 | `06e72032a19b66adb1d357614ebeb2fc21e91898f5f4fd36a4f087c318aa973c` |
| `server/src/solana/gmgn-read.ts` | 2926 | `f4c24c46309fa39fef4bd3966cd8ff59c2598599d7186d3d5d3a11b25af09d12` |
| `server/test/solana-hunter.test.ts` | 4831 | `3c3d32594b9c3aa2fd8263f6a6664c7f6ef33d0a9975f0e2e3f77b5596d38b2d` |
| `.claude/skills/solana-hunter/SKILL.md` | 3812 | `4131c03faf09e53d90d67d96c7f53a5570096e1cb668e581d16812286fefef2a` |
| `patches/discover.ts.review-copy` | 2592 | `79d4ee1ccc7025d4d7866863d711eafc0bf3a71a7af1dc49de8bbd4cef87dc66` |
| `patches/0001-add-solana-hunter-to-discover.patch` | 1624 | `dc11ca0a149d77c63518f0f87848d38b26f2cf5bc6ed9775d0b29d6095e74000` |
| `docs/solana/SOLANA_HUNTER_INTEGRATION.md` | 6556 | `fe2b286b18efd4af9b27488b4d5d0b366c605d94ccdd75ae4a711c7674bb5058` |

## Identified follow-up risks

- Runtime data freshness: snapshot/pair rates do not guarantee subsecond discovery; separately certify official launch streaming.
- Solana parsed RPC mint extension format must be tested against actual valid Token-2022 accounts; incomplete extensions must remain UNKNOWN.
- Regex-only Solana base58 format check is not proof of valid mint ownership.
- The starter `rankScore` is an *opportunity ordering*, not win probability and not trade permission.
- The starter GMGN adapter returns untrusted `unknown` fields. Type/check fields before risk use.
- The integration guide's test invocation has a variant path. Use `npm test -w server -- --run test/solana-hunter.test.ts` from monorepo root after source installed, then verify with `npm test`.
- The source `SOLANA_HUNTER_INTEGRATION.md` includes an illustrative `solanaHunt` object; use the supplied actual `0001` patch's canonical `solanaHunter` name unless reconciled with newest repo contracts.
- Some sources' licensing prevents indiscriminate copying. This pack **does not** include those upstream source trees.
- No domain name, Cloudflare API token or public hosting status was supplied. No deployment was performed.
