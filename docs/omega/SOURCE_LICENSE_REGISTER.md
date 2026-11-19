# SOURCE_LICENSE_REGISTER — Omega TASK-00 (2026-11-19)

| Source | License (as uploaded / documented) | Imported into MIA? | Decision |
|---|---|---|---|
| `mia-solana-hunter-starter` (owner upload, 9 files) | No license file. Owner-supplied code for this repository. | **Yes, verbatim.** All 9 SHA-256 hashes match the owner's manifest (`sources/MIA_OMEGA_SOURCE_AUDIT_AND_IMPORT_MAP.md`). | Integrated in PR-01. MIA's review fixes are in a separate commit. |
| `GMGNAI/gmgn-skills` (GitHub) | MIT (per owner audit) | No code copied. `server/src/solana/gmgn-read.ts` is the starter's own client following its documented routes. | Not wired. Needs `GMGN_API_KEY` and ToS/rate-limit review (PR-05). |
| `solana-py-master.zip` (+ byte-identical `(1)`) | MIT, v0.42.0 | No | Concepts only. No Python in the TypeScript hot path. |
| `lightweight-charts-master.zip` | Apache-2.0, v5.3.0 | No (already an npm dependency, `web/package.json`) | Reuse the npm package; do not vendor the source. |
| `raydium-sdk-V2-master.zip` | GPL-3.0, v0.2.85-alpha | **No** | Blocked pending an owner license decision (PR-08). |
| `whirlpools-main.zip` | Custom Orca License (after 2025-02-27) | **No** | Blocked pending legal review (PR-08). |
| Jupiter / Pump.fun official docs | Provider terms | No | Interfaces only after terms review (PR-07/08) |
| Cloudflare docs | — | No | Deployment plan only (PR-13). No DNS or credentials. |
