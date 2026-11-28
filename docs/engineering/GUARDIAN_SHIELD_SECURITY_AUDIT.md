# Guardian Shield — security audit of the 40 measures (2026-11-26)

Scope: this repository on branch `naokiri/jolly-wozniak-8q7ial` (PR #137 stack plus this branch's work). Railway,
Cloudflare and Privy dashboards were **not** accessible, so their settings are listed as unverified rather than
assumed. Security stays in the existing modules (`security/`, `api/auth.ts`, `api/routes.ts` hooks, `core/ratelimit.ts`,
`qa/gates.ts`); no parallel "Guardian Shield" engine was added.

Status: **V** implemented with tests · **P** partial · **N/A** not applicable to this build · **U** outside the
repository, unverified · **Fixed** changed in this increment.

## 1. The 19 baseline measures

| # | Measure | Status | Evidence |
|---|---|---|---|
| 1 | Row-level security | N/A | The database is SQLite (`db/db.ts`, `node:sqlite`), single owner. RLS is a PostgreSQL feature; isolation comes from the single-owner auth boundary and account scoping (`PAPER_ACCOUNT`). Required if PostgreSQL or multiple users are introduced. |
| 2 | Tight CORS | V (**test added**) | No CORS plugin is registered, so browsers get no `Access-Control-Allow-*` headers for any origin. `security-boundaries.test.ts` asserts this for simple and preflighted requests. |
| 3 | Parameterized SQL | V (**Fixed**) | All values use `?` parameters. The one interpolated identifier (`knowledge/store.ts` metadata column) was only allowlisted in the route schema; the domain function now enforces its own allowlist. The other interpolation is a numeric constant `PRAGMA`. |
| 4 | Verified owner identity | V | `security/privy.ts` `verifyPrivyAccessToken`: ES256, issuer, audience and expiry checked server-side; owner bound to `MIA_PRIVY_OWNER_ID` (`privy-wallet-login.test.ts`). |
| 5 | Tokens out of local storage | V / U | MIA's session is an HttpOnly, SameSite=Strict cookie (`api/routes.ts`), Secure when `MIA_SECURE_COOKIE=1`. `localStorage` holds only theme and motion preferences. Privy's own SDK token storage is configured in the Privy dashboard (U). |
| 6 | Hide `.env` from Git | V (**Fixed**) | `.gitignore` covered only `.env`; it now also covers `.env.*` (except `.env.example`), `*.pem`, `*.key`, `*.p12`, `*.pfx`, `secrets/`, `credentials/`, `wallet-backups/`. History contains only `.env.example` with empty placeholders. `npm run scan:secrets` runs in CI. |
| 7 | Input validation | V | Zod `.strict()` schemas on request bodies, queries and params throughout `api/routes.ts`; risk policy schema `risk/policy.ts`. |
| 8 | Protected admin routes | V | Global auth hook in `api/routes.ts`; risk-increasing actions require step-up (`security/stepUp.ts`); emergency and Run Session tested in `api.test.ts`. |
| 9 | No production debugging | V | The error handler returns `internal server error` plus a request id for 5xx and never a stack (`index.ts`). No debug routes exist. |
| 10 | Server-side secrets | V / U | Keys are read from environment only (`config.ts`, `.env.example` placeholders); Railway sealed variables are a deployment setting (U). |
| 11 | AI security review in CI | P | CI runs typecheck, tests, `npm audit`, secret scan and the AST authority audit (`brainos7-authority.audit.test.ts`); GitHub advanced security runs on PRs. A Claude Code security-review workflow is not configured. |
| 12 | Rate limiting | V / U | `core/ratelimit.ts` (`limiter`, global `failureGate` for auth failures) and per-session budgets for expensive routes (`api/routes.ts`); stream connections capped at 20. Cloudflare perimeter limits (U). |
| 13 | Upload validation | V | Only `POST /api/academy/documents` accepts binary, in a scoped parser with `LIMITS.maxUploadBytes`; global body limit 256 KB (`index.ts`, `knowledge/routes.ts`). |
| 14 | Sensitive data out of logs | V | Logger redacts cookie and authorization headers and `password`, `current`, `next`, `otp`, `accessToken`, `consoleCode` bodies; bodies are not logged by default. The two-factor enrollment console code is printed to the server console **by design** (out-of-band proof, 15-minute TTL); on Railway, anyone with log access can read it while valid. |
| 15 | Password hashing | V | scrypt with a per-owner random salt and constant-time comparison (`api/auth.ts`). Argon2id is not required: scrypt is memory-hard and built into Node; switching would add a native dependency and a hash migration. Production Privy mode disables passphrase sign-in. |
| 16 | Webhook signatures | N/A | MIA receives no inbound webhooks. Required before any provider webhook is added. |
| 17 | Server-side permissions | V | Auth hook on all `/api/*` except sign-in; mode and risk changes owner-only (`core/mode.ts`); Trader Joe tools read-only plus risk-reducing commands (`joe/joe.ts`). |
| 18 | XSS | V | CSP without `unsafe-inline` scripts (`security/privy.ts` `contentSecurityPolicy`), `frame-ancestors 'none'`, React escaping. |
| 19 | Dependency updates | V | Lockfile, `npm ci`, `npm audit --audit-level=high` in CI (0 vulnerabilities at this commit). |
| — | HSTS | **Fixed** | `Strict-Transport-Security` is now sent when MIA runs behind HTTPS (`MIA_SECURE_COOKIE=1`). |

## 2. The 21 MIA-specific measures

| # | Measure | Status | Evidence |
|---|---|---|---|
| 20 | Two-factor authentication | V | TOTP enrollment and step-up (`security/totp.ts`, `security/stepUp.ts`). |
| 21–23 | Wallet signing restrictions, sweeper protection, withdrawal restrictions | V (by absence) | No signer, private key or withdrawal path exists; withdrawals stop at `BLOCKED_BY_RELEASE_GATE`; Privy wallet actions are `LOCKED` (`privyPublicConfig`). Must be re-audited before any signer is added. |
| 24 | Transaction simulation | N/A | No on-chain execution. Required for FAST LIVE (Jupiter sell-route simulation). |
| 25 | Maximum capital authorization | V | Trading mandate capital ceiling enforced in the OMS transaction (`ops/tradingMandate.ts`). |
| 26 | Daily loss breaker | V | `risk/gate.ts` daily, weekly and drawdown breakers. A session-level unrealized loss limit is open (W12). |
| 27 | Emergency kill switch | V | `/api/emergency/stop`, session `EMERGENCY_KILL_SWITCH`; protection continues. |
| 28 | Duplicate order protection | V | Unique `client_order_id`, approval CAS, fenced writes (`exec/oms.ts`). |
| 29 | Replay protection | V | CSRF header on state changes; worker evidence HMAC plus replay cache (`workers/runtime.ts`); TOTP code reuse prevention. |
| 30 | MEV and sandwich protection | N/A | No on-chain execution. |
| 31 | Malicious contract detection | P | `safety/safety.ts` heuristics; on-chain authority checks blocked on Solana RPC credentials (inventory W2). |
| 32 | Credential rotation | P | Session revocation and passphrase change exist; provider key rotation is an operational procedure (U). |
| 33 | Service-to-service authentication | N/A | Single process today. Required if Railway services are split. |
| 34 | Memory poisoning protection | V | Hash-chained audit log and decision memory verified at engine takeover (`ops/integrity.ts`); learning is review-only with no automatic promotion. |
| 35 | Prompt injection protection | V | Trader Joe's system prompt treats tool results as untrusted data; tools are allowlisted and cannot change limits or modes (`joe/joe.ts`). |
| 36 | AST boundary isolation | V | `brainos7-authority.audit.test.ts` traverses the TypeScript AST to reject forbidden authority paths. |
| 37 | Market data integrity | V | `market/quality.ts` freshness, future-dated, depth and cross-venue checks; trade bars quarantine bad events. |
| 38 | Tamper-evident decision certificates | V | Decision reports persisted with consensus expiry; audit and memory hash chains. |
| 39 | Crash recovery and reconciliation | V | Lease takeover integrity, unresolved-order quarantine, SIGKILL tests; reconciliation is now indexed (migration 8). |
| 40 | LIVE release gate | V | `qa/gates.ts` G01–G14 and the hard `BOUNDED_LIVE` lock. |

## 3. Release-checklist status (spec §9)

Verified in code and tests:
- authentication of private routes;
- owner-only route rejection;
- no secrets in Git (scan plus history check);
- log redaction;
- duplicate-order rejection;
- BrainOS cannot change its own limits;
- PAPER-only identical rules;
- crash reconciliation;
- browser-independent sessions;
- emergency stop.

Not verifiable here:
- Cloudflare origin-bypass prevention (Tunnel or IP allowlisting);
- Railway private networking and sealed variables;
- Privy dashboard token storage and allowed origins.

Wallet-signing restrictions remain N/A until a signer exists.

## 4. Changes in this increment

- `.gitignore`: secret and key-material patterns.
- `index.ts`: HSTS over HTTPS.
- `knowledge/store.ts`: domain-level SQL identifier allowlist.
- `server/test/security-boundaries.test.ts`: CORS denial, hardening and HSTS headers, API no-store, identifier
  allowlist, and `.gitignore` coverage of secret files.

## 5. Next security work, in order

1. Before deployment: verify Cloudflare Tunnel or origin allowlisting, Railway sealed variables and private networking, and Privy allowed origins and cookie mode, with the owner's dashboard access.
2. Before any signer: a dedicated review of signing scope, withdrawal impossibility, transaction simulation and key custody.
3. Add the Claude Code security-review GitHub workflow (measure 11), pinned by commit SHA.
4. Move the two-factor console code to an owner-only channel if Railway log access is shared.

## 6. GitHub and runtime hardening follow-up

The existing CI scans the complete Git history reachable from the tested commit with checksum-pinned Gitleaks. CI pins GitHub Actions to immutable revisions and keeps the checkout credential scan, `npm ci`, vulnerability audit, authority tests, builds and browser checks. Gitleaks runs before dependency installation. `node scripts/create-review-snapshot.mjs --commit HEAD --base origin/main` produces a local JSON file manifest from committed Git objects with paths, hashes, sizes and related tests. It emits no file contents and makes no network requests.

Use the existing Autopilot **Run Session** flow to authorize online PAPER entries. The OMS requires a running, fenced PAPER spot session and rechecks the risk policy version for approvals that recorded one. The same OMS continues to handle protective exits. Trader Joe accepts the standalone authenticated `pause` command directly. External text and model tools can contribute evidence. On-demand decisions are marked as analysis and cannot satisfy an automated candle's evaluation or authorize an order.

The server checks the owner session before replaying or sending SSE events, closes expired sessions, and bounds per-frame and queued bytes. Startup validates the configured storage directory and the ownership, permissions and links of SQLite files and the persisted evidence key. Existing volume-directory modes are preserved. Verify the Railway runtime's ownership and staging volume isolation before rolling out the startup checks. A leftover SQLite sidecar without its database or a staging link left by an interruption during the first evidence-key publication requires operator recovery.

Railway deployment, Cloudflare ingress, Privy production settings, recovery drills on a separate staging volume and any additional scanner adoption require their own validation.
