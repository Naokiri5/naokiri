# Deployment & Operations Guide

## Deploy
- Build before deployment: `npm ci && npm run build`. This builds `web/dist` and compiles the server into `server/dist`.
- Start the compiled server with `NODE_ENV=production npm start`. Production startup requires both build outputs and does not depend on dev-only `tsx`/Vite packages. Local development can use `npm start` after `npm install`; the launcher falls back to `tsx` when no production build exists. Default bind is loopback on a desktop and `0.0.0.0` inside detected
  containers so forwarded ports work; override with `MIA_HOST`. Front it with a TLS reverse proxy if you expose it remotely.
- Paths (`data/`, `web/dist`) resolve from the repository location, not the shell's working directory. The session cookie is `HttpOnly; SameSite=Strict` and gains `Secure` only when `MIA_SECURE_COOKIE=1` (set it explicitly whenever MIA is served over HTTPS; `NODE_ENV` does not enable it); state-changing requests require the
  `x-mia-csrf` header.
- Set `MIA_PUBLIC_ORIGIN` to the canonical HTTPS origin when a proxy rewrites the request's Host. Serve the UI and API on that origin and redirect alternate hostnames at the edge. Browser API requests with a foreign origin are refused. The app derives browser authority from this configuration or the request's Host and TLS settings. Origin-absent health and command-line requests still use the existing route access rules.
- Secrets only via environment variables (`.env.example`). They never reach the browser, logs (redacted), or LLM prompts.

## Hosting: Railway only (Vercel retired 2026-11-26)

MIA is one long-running Node process with a SQLite database on a persistent volume, so it runs on Railway, not on
serverless hosting. Owner decision 2026-11-26: do not deploy on Vercel.

State on 2026-11-26:
- Vercel: builds disabled on all three projects (`naokiri`, `miaai`, `naokiri-server`) with the ignored build step
  `exit 0`. Nothing was deleted; they stay as a rollback until Railway has run cleanly. Vercel held no environment
  variables, Edge Config or data to migrate. `miaai.trade` and `www.miaai.trade` are still attached to the Vercel
  `miaai` project; DNS is managed in Cloudflare.
- Railway: project `mia-privy-preview`, service `mia-web-api`, volume `mia-persistent-data` mounted at `/data`
  (database `mia.db` about 362 MB, plus an unidentified 77 MB file in `/data/backups`). `www.miaai.trade` is attached
  as a custom domain on port 8787. The service currently runs a maintenance stub, not MIA, and has no GitHub source.

Release verification requires a Railway staging deployment and restore test on isolated storage. GitHub reports application tests and deployment integrations as independent checks.

Cutover steps (in order):
1. Grant the Railway GitHub app access to `Naokiri5/naokiri` (GitHub settings, Applications, Railway, repository
   access), then connect the service to the branch to deploy (owner chose the PR #140 branch,
   `naokiri/jolly-wozniak-8q7ial`, until it merges).
2. Resize the volume in the Railway dashboard (5 GB suggested) so the database, its WAL, the migrations' new indexes
   and at least one backup fit. Take an off-volume copy first (SQLite backup API, or stop the service and copy
   `mia.db`, `mia.db-wal` and `mia.db-shm` together). Identify the 77 MB file before deleting anything.
3. Set `MIA_BACKUP_KEY` as a sealed variable and keep a protected copy elsewhere.
4. Replace the maintenance start command with `npm start` and the health check with `/api/health`; deploy and
   confirm `/api/ready` reports storage `pass`.
5. In Cloudflare, point `miaai.trade` and `www.miaai.trade` at Railway (add the apex as a Railway custom domain too),
   then remove both domains from the Vercel project.

## Backup & restore
- Data lives in `$MIA_DATA_DIR/mia.db` (SQLite WAL). Set `MIA_BACKUP_KEY` in the server environment before the first Privy owner binding and before creating online or production backups. Set a 32-byte key as hex or base64 and retain a protected copy separate from backup files.
- Run `npm run backup -- create` to create and verify an encrypted snapshot before retention. Run `npm run backup -- verify <snapshot>` with the original backup key to verify a stored snapshot. Verification checks SQLite structure and foreign-key consistency before accepting a snapshot. Legacy plaintext snapshots remain readable for recovery. The backup and data volumes must support hard links for atomic publication. Use a service-account-private temporary directory on protected storage for local snapshot and verification work files.
- Preserve the original evidence signing key separately. If you use `MIA_EVIDENCE_KEY`, restore that same value. Otherwise restore `$MIA_DATA_DIR/evidence.key` with the database before startup. MIA requires a usable persistent key when online or using an explicit data directory.
- Migrations are append-only (`server/src/db/migrations.ts`). Roll back code by redeploying the previous commit together
  with a pre-upgrade backup.

## Incidents
| Signal | Meaning | Response |
|---|---|---|
| Red "stale data" banner | ticker feed > 60 s old | New entries auto-blocked by the data-quality gate. Check Connections Hub. |
| CRITICAL "Engine stopped: integrity check failed" | a takeover found a failed check (quick_check, schema, audit or decision-memory chain, ledger reconcile, protective stops); the engine released its lease and stopped, `/api/ready` stays 503 | Read the failed checks in the journal entry and `lastError` on the Autopilot page. Preserve the database and investigate before restarting; restarting alone re-runs the same checks and alerts again. |
| `UNRECONCILED_PAPER_ORDERS` | A paper order in `NEW` or `PARTIALLY_FILLED` survived outside an atomic OMS transaction. New paper entries are blocked across strategies. | Preserve the database. Reconcile the order with its fills, position and ledger before resuming. The pending-approval cancel action leaves these orders available for investigation. |
| `monitor` or `position protection` fails in `/api/ready` | The first check tracks the independent protection schedule. The second tracks open incidents where a position lacks executable market data. | Inspect the protection incidents in the Risk Center and restore fresh, executable depth. The engine skips new automated entries while the monitor itself is stale or failing. |
| `/api/ready` check `monitor` failing | the leader's last position-monitor pass threw, or none completed within three ticker intervals | Open positions are not being evaluated. Check `lastError`, then Risk Center → Verify/protect. |
| CRITICAL "Protection unverified" | an open position has no fresh price | Risk Center → Verify/protect. Consider Close if the venue is unreliable. |
| Daily/weekly/drawdown breaker | loss limit reached | Entries blocked until the next boundary or review. Do not raise limits to bypass. |
| Strategy auto-suspended | paper expectancy decayed | Review in Strategy Lab; re-promote only after revalidation. |
| Audit gate FAIL | hash chain broken | Treat as tampering: stop the server, preserve the DB, investigate. |

Emergency actions (Risk Center) are distinct: pause new orders · cancel pending entries · verify protection ·
emergency stop (pause + cancel + verify, **no auto-close**) · close all (step-up + typed confirmation).

## Going live (not available in this build)
Requires every gate on the Release Gates page: 30-day paper evaluation, independent security review, an isolated signer
and transaction firewall (Part 24), a live venue adapter, the Independent Release Auditor sign-off, then explicit owner
authorization.
