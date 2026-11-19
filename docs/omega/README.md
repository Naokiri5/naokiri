# MIA Ω (Omega) — work index

The specification is `sources/MIA_OMEGA_UNIFIED_CLAUDE_OPUS_CODEX_MASTER_PROMPT.md`. It is preserved verbatim, together with the owner's handoff, source audit and Cloudflare plan in `sources/`. The owner uploaded two copies of the master prompt; they were byte-identical, so one is kept. Treat these documents as specification, not as proof that anything has shipped.

| Document | Purpose |
|---|---|
| [REPO_INVENTORY.md](REPO_INVENTORY.md) | Baseline SHAs, branch topology, the modules Omega builds on, and spec path corrections |
| [PR_OVERLAP_MATRIX.md](PR_OVERLAP_MATRIX.md) | Open PRs, how they combine, migration ownership, single-owner files |
| [REQUIREMENTS_TRACEABILITY_OMEGA.md](REQUIREMENTS_TRACEABILITY_OMEGA.md) | All 100 Omega requirements and every Appendix A section, each with a verified status |
| [REQUIREMENTS_CONFLICT_REGISTER.md](REQUIREMENTS_CONFLICT_REGISTER.md) | Places where the original asks conflict with safety invariants, and the chosen interpretation |
| [SOURCE_LICENSE_REGISTER.md](SOURCE_LICENSE_REGISTER.md) | Every uploaded source, its license, and the reuse decision |
| [MIA_OMEGA_PHASE_1_PLAN.md](MIA_OMEGA_PHASE_1_PLAN.md) | PR sequence, file ownership, owner decisions needed |
| [TEST_MATRIX.md](TEST_MATRIX.md) | What is tested, with the exact commands and results |
| [LATENCY_BASELINE.json](LATENCY_BASELINE.json) | The existing measured baseline, copied with its sample counts (not re-measured) |

**State on 2026-11-19:**
- **TASK-00 (audit):** done.
- **PR-01 (read-only Solana Hunter):** implemented in the draft PR stacked on #45. See `docs/solana/OMEGA_PR01_REVIEW.md`.
- **Not done:** live trading, signers and Cloudflare deployment. Deployment needs the owner's domain and credentials at an authorized step.
