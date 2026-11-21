# MASTER PROMPT — MIA PRIVY WALLET-FIRST SIGN-IN INTEGRATION

Repository: https://github.com/Naokiri5/naokiri
Task: Replace the MIA 4.1 Passphrase sign-in screenshot with real Privy wallet authentication, reusing existing implementation. Master prompt FIRST; implementation and deployment only in separately reviewed steps.
Audited main commit: 6476391f4d7e8f8884c76ac4e31bb3779c444d77 (21 November 2026).
Documentation branch: docs/mia-privy-wallet-first-master-20261121.
SAFETY: Real-money LIVE remains hard LOCKED. Wallet login is not authorization to trade or move assets.

## 1. ROLE AND GOAL

Act as a team of senior React/TypeScript, Privy, wallet-authentication, Fastify, identity-security, CI, Vercel and Cloudflare engineers.

Replace the user-visible passphrase login with a beautiful accessible "Connect Wallet" screen using the CURRENT Privy SDK. Support only wallets and chains actually supported by the installed SDK and Privy dashboard (e.g. eligible EVM wallets via injected providers/WalletConnect and supported Solana wallets). The user completes a genuine Privy wallet-login challenge. A connected address alone never authenticates a MIA user.

Preserve existing sessions, role ownership, paper trading, risk controls, account data, audit history, emergency switches, and G01–G14 live release gates. Never install a second auth service, separate session database, wallet engine, or signer. Do not copy entire older mega branches. Do not create fake wallet connection with a redirect to dashboard.

A legitimate user can connect a wallet to view their linked wallet in the existing Wallet/Connections page. Only a pre-approved MIA owner may access the current single-owner dashboard. Other verified Privy accounts are not automatically administrators. The wallet is displayed READ-ONLY and must not be used automatically by MIA's autonomous trading logic.

## 2. SOURCE-VERIFIED REUSE AND NO-DUPLICATION INVENTORY

READ these existing files and compare exact exports, tests, dependencies and commit SHAs before modifying code:

| Feature | Current implementation | Status | Decision |
|---|---|---|---|
| Passphrase sign-in screenshot | web/src/App.tsx on main, Login component | ACTIVE IN MAIN | Replace visible default production login after secure Privy cutover |
| Password hash, sessions | server/src/api/auth.ts on main | ACTIVE IN MAIN | Reuse existing session hashing and HttpOnly mia_session cookie; retire remote password paths in wallet-only production |
| Fastify authentication, CSRF and event stream | server/src/api/routes.ts on main | ACTIVE IN MAIN | Preserve one matched-route auth gate, CSRF and SSE protections |
| Security headers and CSP | server/src/index.ts on main | ACTIVE IN MAIN | Extend only the existing CSP to allow necessary Privy/WalletConnect origins |
| Read-only wallet/address book | server/src/wallet/wallet.ts and web/src/pages/Wallet.tsx | ACTIVE IN MAIN | Extend existing Wallet UI, never replace bookkeeping/custody boundaries |
| Privy token verification, owner bind, identity roles | PR #38, claude/mia-int-05-privy-login, server/src/security/privy.ts | UNMERGED | Review, test and selectively port, avoid duplicate verifier |
| TOTP and high-risk owner step-up | PR #38, server/src/security/stepUp.ts and totp.ts | UNMERGED | Reuse and harden instead of implementing independent step-up |
| Privy browser login/session recovery | PR #54, codex/fix-privy-sign-in, web/src/privy/browserSession.ts | UNMERGED | Reuse race, logout and recoverability safeguards |
| Privy wallet view-only integration | PR #29, claude/mia-int-01-privy-wallets | UNMERGED | Reuse relevant wallet connection and display, keep signing locked |
| Direct Google owner sign-in | PR #25, codex/google-owner-login | UNMERGED | Do not add a second login provider in wallet-only production |
| @privy-io/react-auth | present in Privy PR branches, absent from main web/package.json | UNMERGED | Pin compatible audited SDK + lockfile; verify SDK configuration against current docs |
| Canonical risk gate, PAPER OMS, LIVE lock, G01–G14 | server/src/risk, exec, core/mode.ts, qa/gates.ts | EXISTING / DRAFT | Preserve entirely; neither login nor wallet connection confers trade authority |

Current open PRs are not shipped to main: PR #38, #54, #29. Main still renders the passphrase screenshot. Fix the actual branch-to-deployment mismatch, do NOT pretend the existing Privy branch is already live.

## 3. IMPORTANT FINDINGS REQUIRING CODE CORRECTIONS

A. In PR #54, web/src/App.tsx normalizeAuthState currently treats a missing/older auth response as mode "passphrase". In strict wallet-only production, missing or malformed mode must FAIL CLOSED and show a recoverable configuration error, never show a password form.

B. In PR #54, server/src/security/stepUp.ts selects the old passphrase as sensitive-action step-up when the owner record exists but TOTP is absent. In production Privy mode, make TOTP or independently verified hardware-backed passkey/security-key step-up mandatory; without enrollment, deny risk-increasing actions. No remote passphrase fallback. Preserve physically/admin-controlled local recovery CLI and backup/rollback until safely migrated.

C. Existing Privy UI allows email, Google and passkey login based on dashboard configuration. The user specifically requests WALLET sign-in, so configure supported wallet login method(s) using the selected SDK version and align Privy dashboard options and MIA backend wallet-login policy. An email-only Privy user must not meet a wallet-only policy. Verify wallet ownership with server-trusted Privy identity/linked-account evidence and, if required, a nonce-bound authenticated SIWE/SIWS challenge. Never trust client-linked account JSON.

D. PR #38/#54 verifies Privy tokens with jose and public keys. Re-check official algorithm, issuer, audience, expiration, subject, verification key format, JWKS endpoint/key rotation, and current supported server SDK. Do not blindly accept older assumptions or skip cryptographic checks.

E. The browser screenshot contains no verifiable Vercel project ID or domain. Inspect actual deployment branch/SHA, Vercel rewrite, backend host, Privy allowed origins and Cloudflare DNS before claiming the screenshot is fixed.

## 4. REQUIRED WALLET-LOGIN FLOW

1. Browser requests the same existing GET /api/auth/state. Treat missing/malformed authentication configuration as an error, not an authenticated state or passphrase fallback.
2. Show "Connect Wallet with Privy" (no passphrase input, create owner form, seed phrase, login fallback).
3. User chooses a Privy-supported external wallet and completes Privy's actual wallet-login challenge on the correct origin, network and chain.
4. Browser obtains an authentic Privy access token from the SDK only after successful authentication.
5. POST /api/auth/privy/login with the token through the existing API client. Never put token in URL, local app logs, analytics or error messages.
6. Backend verifies token signature, issuer, audience, expiration, session and subject against current official Privy requirements. If wallet-only policy is mandatory, validate the wallet authentication/link from server-trusted data and use nonce/domain/chain/expiry checks when additional signed-wallet proof is required.
7. MIA looks up pre-provisioned owner DID and approved linked wallet(s). A random authenticated Privy user is not MIA owner. No first-visitor automatic enrollment.
8. Recheck owner binding atomically when creating MIA session. Issue the existing Secure HttpOnly SameSite-protected mia_session cookie, preserve CSRF headers and same-origin enforcement.
9. Existing protected dashboard loads with current paper data, risk policy and Trader Joe. Wallet panel displays wallet address and chain READ-ONLY.
10. Logout revokes server session and attempts browser Privy logout. Show truthful failure if either step fails. Switching account requires fresh authentication and owner re-evaluation.

## 5. PRIVILEGE MODEL AND WALLET SAFETY

Wallet connection != Privy authentication != MIA owner role != LIVE trading authority.

An approved owner DID and server-verified wallet authentication grants access to MIA UI only. It does not authorize a real-money order, withdrawal, signing, wallet delegation, funding or exchange key management. Preserve all existing PAPER/TESTNET/LIVE isolation and existing release gate requirements.

Allow no public registration of the first owner. Provision MIA_PRIVY_OWNER_ID using a trusted server-side owner operation. Once a database binding is established, refuse a changed environment variable that disagrees with the bound DID; require physically controlled owner recovery CLI or verified step-up for re-binding. On re-bind, revoke sessions, pending enrollment/recovery grants and sensitive permits, log audit events, and back up the original database first.

Do not use the connected browser wallet as the bot's automated trading signer. Leave all useSendTransaction, sign/send, private keys, embedded-wallet auto-creation, export, fund, delegation and transfers disabled in this authentication task. No AI agent or Trader Joe command can sign or move funds by virtue of a wallet login.

## 6. IMPLEMENTATION MODULES — EXTEND EXACTLY THESE OWNERS

FRONTEND:
- web/src/App.tsx: change default auth gate from Login passphrase to reused PrivyLoginScreen. Preserve routes, Shell, SSE and logout. FAIL CLOSED if auth mode is missing in wallet-only prod.
- web/src/auth/LoginScreen.tsx: reuse existing welcome and error components. Replace notes and action with real "Connect Wallet" wording and wallet-only SDK operation. No fake UI success.
- web/src/privy/PrivyPanels.tsx + browserSession.ts: one PrivyProvider, one login exchange, one logout handler. Use wallet-only login methods verified against the pinned SDK and dashboard. Do not auto-create embedded wallets.
- web/src/pages/Wallet.tsx: display authenticated address/chain/verified identity read-only, preserve address book.
- web/src/api.ts: existing API client and 401 event behavior; no secret storage in a new client state manager.
- web/package.json / package-lock.json: audited pinned SDK; no duplicate Privy packages.

BACKEND:
- server/src/security/privy.ts: one cryptographic verifier and explicit server-owned DID/wallet authorization; key rotation and failed-verification handling.
- server/src/api/auth.ts: reuse hashed owner session creation/revocation; preserve DB contents.
- server/src/security/stepUp.ts and totp.ts: independent sensitive-operation proof, no production password fallback.
- server/src/api/routes.ts: reuse one protected Fastify gate and the Privy login endpoint; preserve matched route CSRF and owner step-up.
- server/src/index.ts: minimal CSP allowlist for selected SDK; strict error redaction, no CORS wildcard.
- server/src/wallet/wallet.ts: read-only identity link is NOT wallet custody; keep withdrawal freeze unchanged.
- server/src/db/migrations.ts: use additive migrations only if actually needed, after schema audit and restore test.
- server/src/qa/gates.ts and core/mode.ts: do NOT modify live trading authorization.

Never drop a complete branch's routes.ts or App.tsx over main without reconciling changed imports, tests, security assumptions and sibling features.

## 7. ENROLLMENT, TWO-FACTOR, RECOVERY

New install: ADMIN binds owner DID using server environment/secure CLI, requiring local administrative control, database backup and an audit trail. Public first visitor cannot bind.

Existing install with passphrase: while still in a secure maintenance phase, establish authenticated owner DID and independent authenticator step-up. Verify both actually work before switching public UI and APIs to wallet-only. In production Privy mode, remote passphrase setup/login/step-up/password-change must be refused, not merely hidden.

Recovery: retain server-local, audited, backed-up admin recovery and invalidate all sessions on identity/2FA resets. This is not an internet-facing password bypass. After successful migration, make the plan to retire the legacy password hash explicit rather than silently destroying it at first deployment.

Sensitive operations needing fresh independent step-up: increase risk/mode, resume after emergency, promote or reenable a strategy, modify owner wallet binding, verify withdrawal address, withdrawal preview, lift freeze, reset 2FA, and later signer authorization. A risk-reducing pause may remain available to the authenticated owner.

## 8. PRODUCTION DEPLOYMENT — VERCEL / CLOUDFLARE / PRIVY

- Verify Vercel project's source branch and build SHA, frontend/backend routing, environment scopes and origin actually served; screenshot alone does not prove deployment SHA.
- Set Privy App ID and owner DID securely in backend config. Public App ID may appear in the browser where required; App Secret, exchange keys, signer credentials and recovery tokens must NEVER be in VITE_* env or frontend bundles.
- Register the precise HTTPS custom domain and preview domain used by users in Privy allowed origins; register localhost for local development only.
- Preserve same-origin HTTPS calls to /api/auth/state, /api/auth/privy/login and logout and SSE. Do not point the page to an unrelated/stale backend.
- In Cloudflare enforce TLS, appropriate WAF/rate limits, no caching of auth cookies/tokens or authenticated API data; ensure legitimate Privy and WalletConnect requests are not blocked.
- Review Fastify CSP to allow only required verified Privy/WalletConnect hosts, challenge frames and WebSocket endpoints. No blanket wildcard or unsafe-eval shortcut.
- If the current server uses SQLite owner/session data, ensure persistent authoritative storage and deployment topology; never deploy it into isolated ephemeral Vercel lambda instances and assume all sessions/owner records are shared.
- Stage before production; perform REAL wallet-login smoke test with the actual owner account, verify signed-out/wrong owner states, and record rollback plan. No deployment until separately verified and approved.

## 9. TEST MATRIX — MANDATORY

AUTH-01 Public wallet-only login has zero passphrase fields and no create-owner form.
AUTH-02 Wallet connect without Privy authentication cannot create a session.
AUTH-03 Forged JWT, incorrect issuer, audience, expiration, subject, or invalid signature => 401.
AUTH-04 Valid Privy DID without verified wallet/login evidence fails wallet-only requirements.
AUTH-05 First random wallet cannot become owner; approved pre-provisioned DID can.
AUTH-06 Server-down, Privy SDK timeout, verification service outage, bad App ID => clear error, no fallback.
AUTH-07 Login cookie HttpOnly/Secure/SameSite, protected routes deny anonymous.
AUTH-08 Wrong owner, changed wallet, rebind and revoked sessions fail closed.
AUTH-09 Protected POST/DELETE CSRF+Origin enforcement and rate limits unchanged or strengthened.
AUTH-10 Logout revokes MIA server session and Privy browser session; no phantom success.
AUTH-11 Owner account backup, paper positions, wallet addresses and audit ledger survive migration.
AUTH-12 Unconfigured TOTP/passkey => deny risk-increasing action; no legacy passphrase fallback.
AUTH-13 TOTP brute force, replay, stolen browser session and unauthorized reset fail.
AUTH-14 Session login, expired token refresh, multi-tab, switch account and reconnect test.
AUTH-15 No secret/OTP/token leaks in browser bundle, server logs, errors or telemetry.
AUTH-16 No wallet signer, send, export, delegate, fund, withdrawal or live-bot execution imports appear in the login code.
AUTH-17 EVM/Solana connector choices are genuine and tested, not hardcoded false claims.
AUTH-18 Real owner login/logout tested with Privy allowed origins through staging HTTPS custom domain.
AUTH-19 User interface mobile viewport, keyboard and screen-reader tests pass.
AUTH-20 Full server unit/regression, web unit, Playwright, TypeScript, build, dependency scan and secret scan pass at exact commit SHA.
AUTH-21 Default paper OMS, Guardian, risk and G01–G14 release tests remain green, LIVE still locked.
AUTH-22 No rollback to publicly accessible passphrase when Privy errors.

Tests that mock Privy prove only local contract behavior. They do not prove actual wallet login until a real Privy app and browser are used.

## 10. ACCEPTANCE / DONE

Only call the fix done when:
- Protected MIA page shows a real wallet-first Privy sign-in and does not show a passphrase.
- Privy wallet authentication is cryptographically verified SERVER-SIDE, and only the provisioned MIA owner enters.
- Existing secure MIA session + CSRF + SSE survive.
- Fresh independent TOTP/passkey step-up protects all risk-increasing actions, even for migrated owners.
- Wallet address/chain display is read-only; wallet signing, funding and withdrawals remain locked.
- No duplicate authentication/wallet system has been created.
- A true staging login test passes with the owner's connected Privy account and the exact domain.
- CI/secret/dependency/security checks pass on the release commit, a safe rollback exists, and the owner has approved deployment.

DELIVER: minimal-diff TypeScript PR, detailed file-by-file reuse map, version-locked dependencies and tests, migration and rollback instructions, real Privy staging results, deployment SHA and a truthful shipped/not-shipped status report.

## 11. REFERENCE SOURCES

Existing PR #38: https://github.com/Naokiri5/naokiri/pull/38
Existing PR #54: https://github.com/Naokiri5/naokiri/pull/54
Existing PR #29: https://github.com/Naokiri5/naokiri/pull/29
Privy Access Token docs: https://docs.privy.io/authentication/user-authentication/access-tokens
Privy Wallet Policies: https://docs.privy.io/security/wallet-infrastructure/policy-and-controls
Existing original documentation in PR #54: docs/operations/PRIVY_SIGN_IN.md

ACTION ORDER: Review and approve THIS MASTER PROMPT FIRST. Then selectively port audited Privy code into a separate small implementation PR based on current main (not the giant unified branch); validate and stage; separately authorize deployment. Do not delete current login before secure owner migration. Do not enable live trading.
