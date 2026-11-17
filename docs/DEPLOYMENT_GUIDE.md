# Deployment & Operations Guide

## Deploy
- Single process: `npm start` (entry `server/src/main.ts` via the cross-platform launcher `server/scripts/run.mjs`;
  `prestart` builds the UI if `web/dist` is missing). Default bind is loopback on a desktop and `0.0.0.0` inside detected
  containers so forwarded ports work; override with `MIA_HOST`. Front it with a TLS reverse proxy if you expose it remotely.
- Paths (`data/`, `web/dist`) resolve from the repository location, not the shell's working directory. The session cookie is `HttpOnly; SameSite=Strict`; state-changing requests require the
  `x-mia-csrf` header.
- Secrets only via environment variables (`.env.example`). They never reach the browser, logs (redacted), or LLM prompts.

## Supervision & readiness
- Run MIA under a supervisor that restarts it: systemd `Restart=always` (with `RestartSec=5`), or Docker
  `restart: unless-stopped` plus `HEALTHCHECK CMD curl -fsS http://127.0.0.1:8787/api/ready || exit 1`. The engine runs
  headless: no browser needs to be open.
- `GET /api/ready` (no login, `Cache-Control: no-store`) returns 200 only when this process owns the engine lease, startup
  checks passed, the position monitor ran recently and market data is fresh; otherwise 503 with `reasons`. Ready grants no
  execution permission and says nothing about live eligibility. Not ready means open paper positions may be unmonitored.
  `/api/health` stays a static liveness probe.
- Startup checks (DB integrity, schema version, audit chain, ledger reconciliation, one matching protective stop per open
  position) run once at boot. On any failure the server still serves the UI so you can read why, but the engine never
  starts and `/api/ready` stays 503. Nothing is auto-repaired.
- Two processes on one data dir is safe: a DB lease (`engine.lease`, TTL `MIA_LEASE_TTL_MS`, default 15 s) lets exactly
  one schedule; the other idles in STANDBY and serves the UI. A clean stop releases the lease at once; after a hard kill
  (`kill -9`, power loss) the standby waits up to one TTL of observed silence before taking over.

## Backup & restore
- Data lives in `$MIA_DATA_DIR/mia.db` (SQLite WAL). Back up with `sqlite3 data/mia.db ".backup data/backup-$(date +%F).db"`
  while running. Restore by stopping the server and replacing `mia.db` (delete `-wal`/`-shm`).
- Migrations are append-only (`server/src/db/migrations.ts`). Roll back code by redeploying the previous commit together
  with a pre-upgrade backup.

## Incidents
| Signal | Meaning | Response |
|---|---|---|
| Red "stale data" banner | ticker feed > 60 s old | New entries auto-blocked by the data-quality gate. Check Connections Hub. |
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
