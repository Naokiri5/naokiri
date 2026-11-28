# MIA SECURE Omega: security evidence matrix

Evidence for the owner's *MIA SECURE Omega - Unified Security Architecture* (26 Nov 2026), 50 capabilities, on branch
`naokiri/jolly-wozniak-8q7ial` (PR #140). Extends `GUARDIAN_SHIELD_SECURITY_AUDIT.md`; it does not replace it. No new
security engine was added: GUARDIAN (risk gate, step-up, release gates, Security Center in `security/security.ts`)
remains the one security authority. Updated 2026-11-26.

Status: **Implemented** (code plus test or CI evidence), **Partial**, **Missing**, **Owner action** (configuration
outside the repository), **Not applicable** (the capability's subject does not exist in this build).

## Phase 0 audit: what already existed

Secret scan (`scripts/secret-scan.mjs`) and `npm audit --audit-level=high` in CI; TypeScript strict; an AST authority
audit for `knowledge/cognitive/` (`brainos7-authority.audit.test.ts`); HTTP boundary tests (`security-boundaries.test.ts`);
server-verified Privy sign-in and TOTP step-up (`security/privy.ts`, `stepUp.ts`, `totp.ts`); a read-only wallet with
no signer and withdrawals blocked by release gates (`wallet/wallet.ts`); AES-256-GCM backups (`ops/backup.ts`);
log redaction of cookies, tokens and passwords (`index.ts`); hash-chained audit log (`core/audit.ts`).

## Added in this increment

- **MIA-SEC custom rules as architecture tests** (`server/test/security-rules.test.ts`, helper `test/ast-scan.ts`).
  Each rule runs on the real tree (must be clean) and on a synthetic tree that breaks it (must be caught):
  - MIA-SEC-001: no signer identifiers or signing packages anywhere (server, web, dependencies).
  - MIA-SEC-002: Trader Joe imports only `listPositions` and the risk-reducing `pauseNewOrders` from the OMS and no other mutator.
  - MIA-SEC-003/005: `submitEntry` is referenced only by the gated bot lane and the OMS owner-approval path.
  - MIA-SEC-006: the browser bundle never imports server code, reads `process`, or reads non-public `import.meta.env` keys.
  - MIA-SEC-009: learning and evaluation modules import no strategy, policy, mode or money mutator.
  - MIA-SEC-010/011: workers and QCI import no mutator, no `exec/` module and not the risk gate.
  - MIA-SEC-012: providers and news cannot reach `exec/`, `decision/` or the risk gate, even transitively.
- **Dependabot** (`.github/dependabot.yml`): weekly npm and GitHub Actions update proposals; never auto-merged.

## The 50 capabilities

| # | Capability | Status | Evidence or remaining work |
|---|---|---|---|
| 01 | SAST | Partial | TS strict, AST rules above, authority audit. CodeQL/Semgrep not configured (CodeQL on private repos may need a licence). |
| 02 | SCA | Implemented | `npm audit` gate in CI; Dependabot. OSV-Scanner not added (needs a pinned third-party action; review first). |
| 03 | Secrets scanning | Implemented | CI secret scan; `.gitignore` rules tested. Gitleaks not added. |
| 04 | DAST | Missing | Needs a staging environment without real credentials (ZAP baseline). |
| 05 | IAST | Missing | Not planned before DAST. |
| 06 | SQL injection prevention | Implemented | Parameterized SQL; metadata-column allowlist test. |
| 07 | XSS prevention | Implemented | React escaping; CSP header test in `security-boundaries.test.ts`. |
| 08 | CSRF protection | Implemented | SameSite=Strict cookie plus required CSRF header (API tests). |
| 09 | SSRF prevention | Implemented | `providers/http.ts` `providerDestinationDenial`: HTTPS only, exact per-provider registered hosts, no credentials or port, every redirect hop re-checked (max 3); providers without hosts cannot fetch. `provider-destination.test.ts` (mutation-checked). |
| 10 | Request validation | Implemented | Zod on route bodies, queries and params; 256 KiB body limit. |
| 11 | Cloud posture monitoring | Owner action | Railway and Cloudflare settings are not readable from the repository. |
| 12 | IaC scanning | Not applicable | No infrastructure-as-code files in the repository. |
| 13 | Private networking | Owner action | Railway private networking for any future internal services. |
| 14 | Environment isolation | Partial | Single production service; no staging environment yet. |
| 15 | DDoS protection | Owner action | Cloudflare in front of the origin. |
| 16 | WAF | Owner action | Cloudflare WAF rules. |
| 17 | Rate limiting | Implemented | Login and step-up brute-force limiter (`core/ratelimit.ts`); per-route limits on expensive routes. |
| 18 | Origin protection | Owner action | Restrict the Railway origin to Cloudflare. |
| 19 | Configuration drift detection | Partial | `MIA_*` environment registry warns on unknown variables at startup (`config.ts`). |
| 20 | Secure backup and restore | Implemented (code) | AES-256-GCM, manifest hashes, restore check (`ops/backup.ts`). Owner must set `MIA_BACKUP_KEY` on Railway. |
| 21 | Privy authentication | Implemented | Server-side ES256 token verification (`security/privy.ts`). |
| 22 | Owner-only administration | Implemented | Single bound owner; API permission tests. |
| 23 | Multi-factor authentication | Implemented | TOTP step-up for risk-increasing actions; fails closed when unavailable. |
| 24 | Role-based authorization | Not applicable | Single-owner build; multi-user custody is an open owner decision. |
| 25 | Wallet ownership verification | Partial | Read-only verified addresses (EIP-55 checks); no on-chain signature proof. |
| 26 | Scoped trading permissions | Implemented (paper) | Trading mandate (capital ceiling, market scope, expiry) and entry authorization bound to account, instrument, quantity, max cost, policy version. |
| 27 | Withdrawal authorization | Implemented by absence | No withdrawal path; previews blocked by release gates; MIA-SEC-001. |
| 28 | Credential rotation | Owner action | Provider keys live in Railway variables. |
| 29 | Transaction replay prevention | Implemented (paper) | Idempotent client order ids; single-use TOTP steps. |
| 30 | Emergency revocation | Implemented | Emergency stop, pause, revoke all sessions. |
| 31 | Prompt-injection defense | Partial | News and tool output are labelled untrusted; MIA-SEC-012 keeps news away from decision/risk/execution; Trader Joe cannot mutate (MIA-SEC-002). No adversarial LLM test suite yet. |
| 32 | Memory-poisoning prevention | Implemented | DITAS records immutable (triggers) and hash-chained; outcome records hash-verified; altered records refused as evidence. |
| 33 | Market-feed integrity | Implemented | Freshness, cross-venue disagreement and data-quality gates in the risk gate. |
| 34 | Worker permission isolation | Implemented | MIA-SEC-011; QCI dependency groups. |
| 35 | Model provenance | Partial | Worker and coordinator versions recorded; no external model artifacts are used. |
| 36 | Strategy validation | Implemented | Strategy qualification (deflated Sharpe) required for PAPER promotion; owner approval required. |
| 37 | AI-generated output validation | Implemented | Zod validation of Trader Joe tool input; QCI packet schema validation. |
| 38 | Cross-user data isolation | Not applicable | Single-owner build. |
| 39 | Non-bypassable risk authorization | Implemented | Gate re-run inside the OMS transaction; entry authorization; MIA-SEC-003; zero-execution test on refusal. |
| 40 | Execution-boundary verification | Implemented (paper) | Authorization verified against the actual fill before any write; LIVE locked by release gates. |
| 41 | IDE security | Owner action | Workspace trust and local tooling are outside the repository. |
| 42 | Pre-commit protection | Missing | A Gitleaks pre-commit hook would need an approved dependency. |
| 43 | Branch protection | Owner action | Require CI and review on `main` in GitHub settings. |
| 44 | Dependency provenance | Partial | Lockfile with integrity hashes; `npm ci` in CI. |
| 45 | SBOM generation | Missing | CycloneDX in CI is a candidate. |
| 46 | Build artifact attestations | Missing | GitHub artifact attestations are a candidate. |
| 47 | Security regression testing | Implemented | Rules above, boundary tests, authorization and crash-injection suites in CI. |
| 48 | Independent penetration testing | Missing | Before any LIVE release. |
| 49 | Security audit evidence | Implemented | This matrix, `GUARDIAN_SHIELD_SECURITY_AUDIT.md`, hash-chained audit log. |
| 50 | Incident response and recovery | Partial | Protection incidents, emergency controls, backups; no written incident runbook. |

Totals (counted from the table): 25 implemented (one by absence of the capability's attack surface), 8 partial,
6 missing, 8 owner action, 3 not applicable. Two implemented rows also need an owner setting (20 backup key, 26 paper
scope only). Nothing here authorizes LIVE trading.
