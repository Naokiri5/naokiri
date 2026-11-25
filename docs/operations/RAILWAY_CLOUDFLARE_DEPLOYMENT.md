# Production hosting: Railway + Cloudflare + Privy

**Decision (2026-11-25):** MIA AI runs as **one Railway service** (Fastify API, SSE stream, public landing page and the
protected terminal from the same origin) with SQLite on a Railway volume. **Cloudflare** provides DNS, TLS at the edge,
WAF and caching rules. **Privy** remains the only sign-in. **Vercel is retired**: a static Vercel site cannot reach the
SQLite-backed API, sessions or SSE, so it is not part of the architecture any more.

This guide is the operator runbook. Nothing in it was executed against real Railway or Cloudflare accounts from the
repository; the release checks at the end must be completed on the real host before calling it live.

```
browser ──HTTPS──▶ Cloudflare (DNS · WAF · edge TLS, SSL mode "Full")
                      │  proxied CNAME (orange cloud)
                      ▼
               Railway edge (TLS, *.up.railway.app)
                      │  PORT
                      ▼
      MIA container: Fastify (API + SSE + web/dist) ── /data (Railway volume: mia.db, evidence.key, backups)
```

## Files in the repository

| File | Purpose |
|---|---|
| `Dockerfile` | Two-stage build: `npm ci` + `npm run build`, then a runtime with only the server's production dependencies, `server/dist` and `web/dist`. |
| `scripts/docker-entrypoint.sh` | Prepares the volume (Railway mounts volumes as root), then drops to the unprivileged `node` user and starts MIA. |
| `railway.json` | Config as code: Dockerfile builder, healthcheck `/api/health`, restart on failure. |
| `.dockerignore` | Keeps `.git`, `node_modules`, local data and `.env` files out of the image. |

Image defaults: `NODE_ENV=production`, `MIA_HOST=0.0.0.0`, `MIA_DATA_DIR=/data`, `MIA_SECURE_COOKIE=1`. MIA listens on
`MIA_PORT` when set, otherwise on the `PORT` that Railway injects (also used for Railway's healthcheck).

## 1. Railway service

1. Create a project → **Deploy from GitHub repo** → `Naokiri5/naokiri`, production branch `main`. Railway detects
   `railway.json` and builds the `Dockerfile`.
2. **Volume:** add one volume to the service, mount path **`/data`**. Railway allows one volume per service and **no
   replicas with a volume**; keep the service at a single instance (MIA's engine lease and SQLite expect one writer).
   Redeploys of a volume-backed service have a short downtime window by design (Railway never mounts the volume
   into two deployments at once).
3. **Variables** (Service → Variables). Never commit these; never put them in a `VITE_*` variable.

   | Variable | Value | Notes |
   |---|---|---|
   | `MIA_AUTH_MODE` | `privy` | Production sign-in. |
   | `MIA_PRIVY_APP_ID` | your Privy App ID | Public identifier, still configured server-side. |
   | `MIA_PRIVY_OWNER_ID` | `did:privy:…` | The approved owner DID (not a wallet address). |
   | `MIA_BACKUP_KEY` | 32-byte key, 64 hex chars | Required before the first owner binding; keep an offline copy. |
   | `MIA_EVIDENCE_KEY` | optional, 64+ hex chars | If unset, MIA creates `/data/evidence.key` on the volume. Back it up. |
   | `MIA_TRUST_PROXY` | `2` behind Cloudflare → Railway (`1` for Railway only) | See §4 before relying on it. |
   | `MIA_PRIVY_EMBEDDED_WALLETS` | `0` | Wallet actions stay locked. |
   | `ANTHROPIC_API_KEY` | optional | Trader Joe conversational mode only. |

   Do **not** set `MIA_OFFLINE`, `MIA_ALLOW_REMOTE_SETUP` or `MIA_AUTH_MODE=passphrase` in production.
4. **Networking:** generate the Railway domain first and confirm `https://<service>.up.railway.app/api/health` returns
   `{"ok":true,...}` and the landing page loads. Then add the custom domain (§2).
5. **Healthcheck:** `railway.json` sets `/api/health` with a 120 s timeout. Railway calls it from
   `healthcheck.railway.app`; MIA does not filter hostnames, so no allow-list change is needed.

## 2. Cloudflare (DNS, TLS, protection)

1. In Railway → Service → Settings → Networking → **+ Custom Domain**, enter the domain (apex `example.com` or a
   first-level subdomain like `app.example.com`). Railway shows a **CNAME target** and a **TXT verification record**;
   both are required (without the TXT the domain returns 404).
2. In Cloudflare → DNS: add the CNAME (Cloudflare flattens it at the apex; delete any placeholder `A`/`AAAA` on the
   same name first) and the TXT record.
3. **SSL/TLS → Overview → `Full`.** Not *Flexible* (redirect loop) and not *Full (strict)* (Railway documents that it
   will not work as intended through the proxy). If the certificate is stuck on "validating", switch the record to
   DNS-only (grey cloud) until Railway shows the certificate active, then turn the proxy back on.
4. Proxied domains deeper than one level (`a.b.example.com`) need Cloudflare Advanced Certificate Manager; otherwise
   use DNS-only for them.
5. Recommended settings once the site works over HTTPS:
   - **Always Use HTTPS:** on. **HSTS:** enable only after everything works on HTTPS (start with a short max-age).
   - **Cache Rules:** *Bypass cache* for `URI Path starts with /api/` (MIA also sends `cache-control: no-store`).
     Optional: *Eligible for cache, edge TTL 1 year* for `URI Path starts with /assets/` (Vite file names are hashed).
     Never cache `/`, `/app` or other HTML routes at the edge.
   - **Rocket Loader:** off. **Email Address Obfuscation:** off. Both inject scripts that MIA's Content-Security-Policy
     (`script-src 'self'`) blocks.
   - **WAF rate limiting:** one rule on `URI Path starts with /api/auth/` (for example 30 requests / minute / IP,
     action *Block* for 1 minute). Do **not** put a Managed Challenge on `/api/*`: XHR/SSE clients cannot solve it.
   - **SSE:** `/api/stream` works through the proxy; MIA writes a keep-alive every 20 s, inside Cloudflare's 100 s idle
     timeout.
6. Privy's own Cloudflare Turnstile challenge (`challenges.cloudflare.com`) is already allowed by MIA's CSP when
   Privy is enabled.

## 3. Privy dashboard

- Login methods: **wallet only** (operational requirement; see `docs/operations/PRIVY_SIGN_IN.md` for why this is a
  release-review item).
- **Allowed origins:** add the exact production origin (`https://example.com`, and `https://www.example.com` if used).
  Add `https://<service>.up.railway.app` only for a private staging check, then remove it.
- The landing page never opens Privy by itself: only an explicit **Enter MIA** click routes to `/app`, where the
  existing `WalletLogin` runs, followed by server-side owner verification and two-factor enrollment.

## 4. Client IP and `MIA_TRUST_PROXY`

Login rate limits are keyed by client IP. Behind proxies, the socket address is the proxy, so without trust every
visitor shares one bucket. `MIA_TRUST_PROXY=N` trusts exactly **N** hops from the right of `X-Forwarded-For`
(spoofed left-most values are ignored; covered by `server/test/deploy-config.test.ts`).

Verify on the real host before relying on it: sign-in requests are logged with `remoteAddress`; with the right `N` it
shows **your** public IP. If it shows a Cloudflare or Railway address, `N` is too low; if it shows a value you can
choose by sending your own `X-Forwarded-For` header, `N` is too high. Leave it unset when in doubt (safe, just coarser).

## 5. Retiring Vercel

1. Vercel → the MIA project → **Settings → General → Pause** (reversible) or delete it once Railway is verified.
2. Remove the Vercel Git integration for the repository so pushes stop creating Vercel builds.
3. In Cloudflare DNS, delete records that pointed at Vercel (`cname.vercel-dns.com` or `76.76.21.21`) and replace
   them with the Railway CNAME + TXT from §2.

## 6. Release checks (must pass on the real host)

- [ ] `https://<domain>/api/health` returns `ok: true`; the landing page and `/app` load over HTTPS with no console CSP errors.
- [ ] Response headers show `content-security-policy`, `x-frame-options: DENY` and, on `/api/*`, `cache-control: no-store` (not `cf-cache-status: HIT`).
- [ ] Real wallet sign-in through Privy creates a MIA session; the session cookie is `HttpOnly; SameSite=Strict; Secure`.
- [ ] `/api/stream` stays connected for more than two minutes through Cloudflare.
- [ ] Data persists across a redeploy (volume mounted at `/data`); `npm run backup -- create` / `verify` work with `MIA_BACKUP_KEY`.
- [ ] `MIA_TRUST_PROXY` verified as in §4, or left unset.
- [ ] Vercel paused or deleted and its DNS records removed.
- [ ] LIVE execution, withdrawals and wallet actions remain locked (Release Gates page).

## Rollback

Railway → Deployments → previous deployment → **Rollback**. The volume and database are unchanged by a code rollback;
schema migrations are append-only, so roll back code only together with a pre-upgrade backup if a migration ran.
