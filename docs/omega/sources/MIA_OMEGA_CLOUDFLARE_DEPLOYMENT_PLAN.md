# MIA Ω — Deploy on Your Existing Cloudflare Domain

**Status:** The owner says they created a domain in Cloudflare. Actual hostname is not yet supplied. All names are placeholders. **Not deployed**.

## Recommended architecture (first release)

`https://app.YOUR_MIA_DOMAIN` → Cloudflare DNS/WAF/Access → Cloudflare Tunnel → private Linux VPS `127.0.0.1:8787` → persistent Node.js >=22.13 / Fastify app serving built React UI + `/api`; local protected SQLite WAL; outbound connections to licensed market providers. Signer remains private and absent until separate readiness approval.

Use same-origin UI and API first; the existing app serves `web/dist`. Cloudflare Pages for public marketing/docs is optional later. Do not deploy the current SQLite/persistent execution loop into Workers/Pages without a separate redesign and validation.

## Setup plan

1. Confirm the exact Cloudflare zone and owner-approved hostname (`app.YOUR_MIA_DOMAIN`), then set up Cloudflare account security/MFA.
2. Provision Linux host with encrypted persistent storage, patched OS, non-root `mia` user, Node >=22.13, stable time sync and outbound HTTPS/WSS/RPC. Keep MIA inbound port closed on public network.
3. Clone/pin a reviewed and approved MIA commit. Run `npm ci && npm run typecheck && npm run build && npm test && npm run test:e2e && npm run scan:secrets`. Record real results.
4. Configure `NODE_ENV=production MIA_HOST=127.0.0.1 MIA_PORT=8787 MIA_SECURE_COOKIE=1 MIA_DATA_DIR=/var/lib/mia` in a restricted deployment environment; verify Fastify cookie/CSRF behavior and which config options actually exist.
5. Supervise Node service using systemd or a reviewed container service. Do not rely on an open browser or PC being powered on. Configure consistent SQLite backups/restore tests.
6. Set up Cloudflare Tunnel on the host. Route `app.YOUR_MIA_DOMAIN` to `http://127.0.0.1:8787`; do not open port 8787 to the Internet. Ensure cloudflared token/file permissions and service recovery.
7. Make a Cloudflare Access self-hosted app for the hostname, default-deny identity policy for the owner, MFA and session timeouts. Keep MIA's own passphrase, secure HttpOnly Strict cookies and `x-mia-csrf`.
8. Configure HTTPS, WAF, rate limits, DDoS controls and bypass caching for authenticated API/HTML/streams. Test WebSockets and Cloudflare forwarded IP trust. Reject direct origin bypass and requests lacking Access credentials.
9. Deploy first in OBSERVE/PAPER only. Test `/api/ready` locally (externally behind Access), auth, E2E, host/Cloudflare restart, alerts, backups, emergency risk controls and rollback. Keep simulated and real balances separate.
10. For future live mode: isolate signer and use required independent testnet/venue/financial certification. Cloudflare cannot make an unsafe trading bot safe.

## Example safe non-secret environment

```ini
NODE_ENV=production
MIA_HOST=127.0.0.1
MIA_PORT=8787
MIA_SECURE_COOKIE=1
MIA_DATA_DIR=/var/lib/mia
```

**Important:** This template intentionally contains no DNS name or API key because the actual domain is not known, and Cloudflare DNS is configured in the Cloudflare dashboard rather than automatically by this file. `MIA_DATA_DIR` must exist, be writable by the service and have appropriate filesystem permissions. Keep LLM/chat and frontend separated from trade signing.

## Official documentation

- https://developers.cloudflare.com/tunnel/get-started/
- https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/
- https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/
- https://developers.cloudflare.com/workers/runtime-apis/nodejs/
- https://github.com/Naokiri5/naokiri/blob/main/docs/DEPLOYMENT_GUIDE.md
