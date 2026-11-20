# MIA Ω — Claude Opus × Codex Joint Handoff

## Single source of truth
Use `MIA_OMEGA_UNIFIED_CLAUDE_OPUS_CODEX_MASTER_PROMPT.md`. Appendices A/B are the original user prompt and starter source bytes, not optional reading. Current GitHub branch may have changed; inspect again before editing.

## Claude Opus: plan and critique
- Read complete original and starter. Construct `REQUIREMENTS_TRACEABILITY_OMEGA.md` with no deletions.
- Audit current branch, PR graph, data fabric, QCI/risk/OMS, auth, deployment.
- Draft 15-stage plan, typed contracts, tests, security/licensing decisions.
- Review Codex implementation for requirements and missing edge cases.

## Codex: implement and prove
- Independently inspect actual source, preserve original.
- Implement in focused file-owned draft PRs; PR-01 read-only Solana Hunter first.
- Run typecheck/build/unit/E2E/security checks; measure latency only where test environment can produce genuine evidence.
- Review Claude's architecture and tests for races, data modeling and exact patch conflicts.

## Collaboration agreement
- No simultaneous edits on overlapping files or migrations.
- Each PR has unique owner, acceptance tests, rollback, actual test evidence, source attribution.
- Live remains locked, no signer or production deploy without owner approval.
- `YOUR_MIA_DOMAIN` is a placeholder. Configure actual domain only under the owner's Cloudflare authorization.

## First message to both agents

> Use the attached `MIA_OMEGA_UNIFIED_CLAUDE_OPUS_CODEX_MASTER_PROMPT.md` as the sole master specification. Preserve Appendix A verbatim and all Appendix B source files. Do not start with a redesign or mass rewrite. Reinspect `Naokiri5/naokiri` at current HEAD and every overlapping PR (#18, #19, #23, #26, #35, #41–44). Give a complete traceability audit, PR dependency and file ownership matrix, existing-vs-missing capability report and Phase-1 read-only Solana Hunter draft PR plan. Codex should write focused code and tests; Claude should own architecture, cross-check requirements and review; swap reviewers for each other's output. Keep existing risk gates and live signer locked. Plan deployment of the owner's already-created Cloudflare domain with Access+Tunnel to persistent Node Fastify; don't claim DNS or app deployed until proven. Ask for the exact domain and credentials only at authorized deployment time.
