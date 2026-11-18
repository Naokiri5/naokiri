# Privy sign-in

Status: **implemented and offline-tested; not yet tried with a real Privy app.** Server tests sign tokens with a locally generated key and run the same checks used for real Privy tokens. A live sign-in needs your Privy App ID and a browser where you complete Privy's login.

## What you get

| Privy feature | In MIA |
|---|---|
| Sign in with email, phone, Google, Apple, passkey, wallet and any other method enabled in your Privy dashboard | **Yes.** "Sign in with Privy" appears on the login screen once you have linked your Privy account. |
| Add or link more sign-in methods to your Privy account | **Yes.** Security Center → Privy account. |
| See the wallets linked to your Privy account | **Yes, view only.** |
| Connect an external wallet (MetaMask, WalletConnect, …) | **Yes, identity only.** It proves you own the address; it never moves funds. |
| Create an embedded (Privy-held) wallet | **Optional, off by default.** With `MIA_PRIVY_EMBEDDED_WALLETS=1`, the owner can press **Create a Privy embedded wallet** in Security Center. Privy secures the key; MIA only shows the address. Nothing is ever created automatically (`createOnLogin: 'off'`). |
| Sign or send transactions, delegated signing, fund a wallet, export keys | **LOCKED.** MIA is paper trading only; Live stays locked. A CI test fails if MIA's Privy code ever uses these Privy APIs. |

## How it stays safe

- **Privy proves who you are; MIA decides what you may do.** The server verifies every Privy token:
  - signature (ES256);
  - issuer `privy.io`;
  - audience = your App ID;
  - expiry;
  - subject format (`did:privy:...`).
- **Only your linked account can sign in.** Privy can open a MIA session only for the one Privy user you linked while signed in with your passphrase, and the link itself needs your passphrase again.
- **Sensitive actions still need your passphrase.** Mode changes, risk policy, withdrawals and similar actions ask for it even after a Privy sign-in.
- **Failed Privy sign-ins count toward lockout,** sharing the same brute-force limit as wrong passphrases.
- **No Privy secret on the server.** It uses only the public App ID and Privy's public verification key.
- **The browser security policy (CSP) only opens up when Privy is on.** It stays strict unless `MIA_PRIVY_APP_ID` is set. Then only these hosts are allowed:
  - Privy (`auth.privy.io`);
  - Cloudflare's bot check;
  - the WalletConnect relay and verify hosts.
- **Privy code loads only when Privy is enabled.** It is in a separate bundle, not the main one.
- **A Privy failure stays contained.** A bad App ID or a blocked network breaks only the Privy card, never the passphrase login.

## Turning it on

1. Create an app at dashboard.privy.io. Copy the **App ID** (25 characters). It is public, not a secret.
2. In the Privy dashboard, add your MIA address (e.g. `https://mia.example.com`, or `http://localhost:8787`) to **Allowed origins**.
3. Privy requires **HTTPS**, except on `localhost`. For a free HTTPS address, follow `TAILSCALE_FUNNEL.md`; for your own server see `DEPLOYMENT_GUIDE.md`.
4. Set these in the **server** environment and restart MIA:
   - `MIA_PRIVY_APP_ID=<your app id>` (required).
   - Optional: `MIA_PRIVY_VERIFICATION_KEY` set to the PEM public key from the dashboard. Without it, MIA fetches Privy's public key set from `auth.privy.io`, so the server must be able to reach that host.
5. Sign in with your passphrase. Go to **Security Center → Privy account → Connect a Privy account**. Enter your passphrase and press **Use this Privy account to sign in to MIA**.
6. Sign out. The login screen now offers **Sign in with Privy**.

An App ID that is not 25 characters leaves Privy off, and the server log says why.

## Known issue

`@privy-io/react-auth` pulls in wallet libraries that depend on an old `zod` 3.x with a high-severity advisory (memory exhaustion on oversized input). `npm audit --audit-level=high` reports it, and the CI audit job fails, until Privy ships an update. The audit was not weakened.
