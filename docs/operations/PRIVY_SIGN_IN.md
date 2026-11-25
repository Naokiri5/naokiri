# MIA — Privy wallet authentication (PR #103)

> **Release status (2026-11-21):** implemented on a **draft pull request** and tested with locally signed Privy tokens. **Not merged, deployed, or proven with a real wallet on the production domain.** This document supersedes the older integration-branch instructions; do not merge two parallel Privy auth implementations.

## Canonical code path

- Frontend: `web/src/privy/WalletLogin.tsx`, `browserSession.ts`, `web/src/App.tsx`.
- Backend: `server/src/security/privy.ts`, `stepUp.ts`, `totp.ts`, `server/src/api/auth.ts`, `routes.ts`.
- Sessions: existing MIA HttpOnly, SameSite=Strict session cookie, hashed session record, and matched-route authentication/CSRF guard. The logout endpoint requires `x-mia-csrf: 1`; old setup/login clients retain their historical header compatibility, but are disabled in production Privy mode.
- Owner: pre-approved `did:privy:...` from server configuration or administrator command; *never* automatically bind the first visitor. Once linked, the database binding has precedence over an environment change.
- Protected actions: existing TOTP step-up and risk gates remain authoritative. Login is **not** permission to sign transactions, withdraw funds, or place live-money orders.
- Sign-in is **wallet-only in the React configuration** with embedded wallet auto-creation off; linked wallet addresses are displayed read-only.

## Server and Privy Dashboard prerequisites

1. Create a Privy app in the [Privy Dashboard](https://dashboard.privy.io/) and obtain its App ID. Enable **wallet** as the only permitted sign-in method in the Privy Dashboard as well as MIA's client. Do not enable email or Google login for this wallet-only release.
2. Register the **exact HTTPS frontend origin** in Privy's permitted origins. The browser must load over HTTPS on the real domain (localhost is only for development).
3. Provision the backend's environment **outside source control**:

   ```dotenv
   MIA_AUTH_MODE=privy
   MIA_PRIVY_APP_ID=<public Privy App ID>
   MIA_PRIVY_OWNER_ID=did:privy:<your approved owner DID>
   MIA_SECURE_COOKIE=1
   MIA_PRIVY_EMBEDDED_WALLETS=0
   ```

   Optionally supply `MIA_PRIVY_VERIFICATION_KEY` with the public key from your app; without it, the backend fetches Privy's public JWKS over HTTPS. Never place app secrets, trading keys, passphrases or private keys in frontend `VITE_*` variables or GitHub.
4. Ensure `/api/*` on the frontend's HTTPS origin reaches the **same persistent Fastify backend** that owns the MIA SQLite data and session database. Keep a durable volume for `MIA_DATA_DIR` and an independently verified backup. Production uses one Railway service (API, SSE and UI on the same origin) with a volume for `MIA_DATA_DIR`; see `docs/operations/RAILWAY_CLOUDFLARE_DEPLOYMENT.md`. Vercel has been retired. Do not move the Fastify/SQLite service into ephemeral serverless processes without a tested persistence and streaming design.
5. Place the domain's DNS and HTTPS routing under operator control (Cloudflare can provide DNS/proxy). Confirm cookies, `/api/auth/state`, and authenticated API/SSE requests work through the production HTTPS origin. Never allow cache/CDN storage for `/api/*` responses.

## Owner enrollment

- The approved owner ID is a **Privy user DID**, not an Ethereum/Solana wallet address.
- If the DID is not yet known, complete Privy login on a **private staging instance** to read the returned user DID, then pre-provision the correct ID on the server. A failed first authorization must not create an owner.
- Before first owner binding, MIA creates and verifies a database backup. Set `MIA_BACKUP_KEY` in the backend environment for online or production setups. Backup or verification failure aborts owner binding.
- After wallet login, enroll the MIA authenticator in Security Center using the setup code displayed on the server console. Sensitive actions remain blocked until 2FA enrollment is completed.
- Existing data and paper trading remain in their original database. Avoid switching to public passphrase fallback.

## Security limitation requiring sign-off

**Privy's access-token JWT identifies an authenticated user DID, not which login method was used on that occasion.** MIA verifies the JWT signature, issuer, audience and expiry and requires the server-approved owner. That alone is **not independent cryptographic proof of wallet possession for each session**.

Until an independently reviewed wallet-method/possession attestation is implemented and tested, wallet-only configuration in the Privy Dashboard is an operational requirement and a **release-review blocker**, not a claim of server-enforced wallet-only proof. Do not substitute a client-supplied address, boolean `connected`, or claimed login method as proof.

## Release checks — must all pass

- [ ] Current PR head: CI typecheck, build, security scan, unit tests and Playwright tests pass.
- [ ] A real wallet signs in through Privy on the staging HTTPS origin and receives a server-issued MIA session.
- [ ] Invalid token, wrong audience, wrong owner, replay after logout and missing configuration all fail closed.
- [ ] Signing in through an unintended Privy login method cannot authorize a MIA session (dashboard settings reviewed and possession/method proof decision recorded).
- [ ] Cross-site/missing-CSRF logout cannot revoke an owner session. Genuine sign-out revokes MIA session and Privy browser session.
- [ ] Authenticator enrollment and protected-action step-up pass; missing/incorrect OTP cannot unlock risk increases.
- [ ] Session cookie has `HttpOnly; SameSite=Strict; Secure` on HTTPS.
- [ ] Backend, database, server logs, API proxy, streaming, restore procedure and rollback are tested on the actual host.
- [ ] Operator approves final PR merge and release. **LIVE execution and withdrawals stay locked.**

## Verification commands

From the repository root on a Node.js version supported by `package.json`:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run test:e2e
npm run scan:secrets
npm audit --audit-level=high
```

The unit/Playwright fixtures **do not** count as a real-world Privy wallet sign-in. A successful Railway build or GitHub Actions run is not a real-world sign-in test; complete the release checks in `docs/operations/RAILWAY_CLOUDFLARE_DEPLOYMENT.md` on the production origin.

## Rollback / incident handling

Keep PR #103 as **draft** while any release check fails. Roll back the frontend and backend together, and preserve the same database and backups. Revoke sessions and rotate affected credentials through administrator-approved processes if account compromise is suspected. The offline recovery mode (`MIA_OFFLINE=1` with `MIA_AUTH_MODE=passphrase`) is for a controlled private server only, **never** a production fallback. Do not turn on signing, funding, withdrawals or live trading to test authentication.
