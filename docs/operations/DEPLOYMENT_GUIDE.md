# Deployment & Operations Guide

## Deploy
- Build before deployment: `npm ci && npm run build`. This builds `web/dist` and compiles the server into `server/dist`.
- Start the compiled server with `NODE_ENV=production npm start`. Production startup requires both build outputs and does not depend on dev-only `tsx`/Vite packages. Local development can use `npm start` after `npm install`; the launcher falls back to `tsx` when no production build exists. Default bind is loopback on a desktop and `0.0.0.0` inside detected
  containers so forwarded ports work; override with `MIA_HOST`. Front it with a TLS reverse proxy if you expose it remotely.
- Paths (`data/`, `web/dist`) resolve from the repository location, not the shell's working directory. The session cookie is `HttpOnly; SameSite=Strict` and gains `Secure` only when `MIA_SECURE_COOKIE=1` (set it explicitly whenever MIA is served over HTTPS; `NODE_ENV` does not enable it); state-changing requests require the
  `x-mia-csrf` header.
- Secrets only via environment variables (`.env.example`). They never reach the browser, logs (redacted), or LLM prompts.

## Always-on (24/7) PAPER operation
Running the server unattended enables nothing live. It keeps scanning the market and monitoring paper positions with no browser open.
- **Supervisor:** run `npm run start:supervised`, which is `node server/scripts/supervise.mjs`.
  - It restarts the server after a crash, waiting 1 s, 2 s, 4 s and so on, up to 60 s.
  - A run that stays up for 2 min resets that wait.
  - After more than 8 crashes in 10 min it stops with exit code 1 instead of looping.
  - A clean exit (code 0) ends supervision.
  - Tuning variables: `MIA_SUPERVISE_MAX_CRASHES`, `MIA_SUPERVISE_WINDOW_MS`, `MIA_SUPERVISE_STABLE_MS`.
- **systemd:** `deploy/mia.service` runs the supervisor.
  - Its restart limits sit above the supervisor's own crash-loop cap.
  - It uses `KillMode=mixed`, so only the supervisor receives SIGTERM and forwards it once. A second signal would skip the drain.
  - Put optional secrets in `/etc/mia/mia.env` (mode 0600).
- **Single runner:** only the instance holding the `engine` lease runs the scanner and position lanes. The lease is in the `runtime_leases` table, migration v5.
  - A second copy on the same database becomes STANDBY. Its API works, but it does no market work.
  - It takes over only when the leader stops renewing, about 3 ticker intervals (≥ 45 s), or releases the lease on shutdown.
  - `GET /api/bot` and `GET /api/shell` (login required) show the bot `role` (`LEADER`/`STANDBY`).
- **Readiness:** `GET /api/ready` needs no login and returns states and ages only, never error text or balances.
  - It returns 200 when ready and 503 otherwise.
  - Checks: the database schema is current, the engine is running, and ticker and scanner freshness are within 3 intervals. A fresh start gets the same grace period.
  - Provider and risk-policy status are reported as information. A STANDBY instance is reported as ready, with idle lanes.
  - Point uptime monitors here.
- **Streaming order books (optional):** set `MIA_STREAMING=1` to keep sequence-checked Binance WebSocket books for open positions and the deep tier.
  - The host must allow outbound `wss://data-stream.binance.vision` (public market data, no API key).
  - REST polling remains the fallback. A symbol whose stream book is older than 2 s is refreshed by REST as before.
  - `GET /api/bot` shows `depthStream` (connected, synced symbols, resyncs, reconnects). It is `null` when streaming is off.
  - Details and test evidence: [`../engineering/BLUEPRINT_STATUS.md`](../engineering/BLUEPRINT_STATUS.md).
- **Stall alarm:** the leader sends one CRITICAL "Scanner stalled" notification when scans stop completing, and one INFO when they recover.
- **Graceful stop:** on SIGTERM/SIGINT no new lane starts and in-flight lanes finish (up to 20 s). Then the lease is released, HTTP is closed and SQLite is closed. A hard limit of 30 s applies, and a second signal exits immediately.

## Backup & restore
- Data lives in `$MIA_DATA_DIR/mia.db` (SQLite WAL).
- **Automatic:** the engine leader writes a backup every `MIA_BACKUP_INTERVAL_H` hours (default 24; `0` disables it) and checks it can be restored.
  - Backups go to `MIA_BACKUP_DIR` (default `$MIA_DATA_DIR/backups`). The newest `MIA_BACKUP_KEEP` (default 14) are kept.
  - Failures raise a WARNING at most hourly.
- **Manual (safe while running):** `npm run backup -- create`, `npm run backup -- list`, `npm run backup -- verify <file>`.
- **Encryption:** set `MIA_BACKUP_KEY` to 32 random bytes, e.g. `openssl rand -hex 32`, in the environment or `/etc/mia/mia.env`.
  - Never pass it on a command line, and never commit it.
  - Backups are then AES-256-GCM (`.db.enc`).
  - An invalid key fails the backup rather than writing plaintext.
  - **Keep the key somewhere other than the backups.** Without it they cannot be restored.
- **Restore check** (`verify`) works on the backup only and never touches the live database. It checks:
  - the manifest sha256
  - authenticated decryption
  - `PRAGMA integrity_check`
  - the schema version
  - the audit-log hash chain
  - the DITAS decision-memory chain
- **Restore:**
  1. Stop the server.
  2. Run `verify` on the backup.
  3. Decrypt it if needed. `verify` proves the key works; decrypt with the same format in `server/src/ops/backup.ts`.
  4. Replace `mia.db` and delete `mia.db-wal`/`mia.db-shm`.
  5. Start the server.
- Migrations are append-only (`server/src/db/migrations.ts`). Roll back code by redeploying the previous commit together with a pre-upgrade backup.

## Incidents
| Signal | Meaning | Response |
|---|---|---|
| Red "stale data" banner | ticker feed > 60 s old | New entries auto-blocked by the data-quality gate. Check Connections Hub. |
| CRITICAL "Engine stopped: integrity check failed" | a takeover found a failed check (quick_check, schema, audit or decision-memory chain, ledger reconcile, protective stops); the engine released its lease and stopped, `/api/ready` stays 503 | Read the failed checks in the journal entry and `lastError` on the Autopilot page. Preserve the database and investigate before restarting; restarting alone re-runs the same checks and alerts again. |
| `/api/ready` check `monitor` failing | the leader's last position-monitor pass threw, or none completed within three ticker intervals | Open positions are not being evaluated. Check `lastError`, then Risk Center → Verify/protect. |
| CRITICAL "Protection unverified" | an open position has no fresh price | Risk Center → Verify/protect. Consider Close if the venue is unreliable. |
| Daily/weekly/drawdown breaker | loss limit reached | Entries blocked until the next boundary or review. Do not raise limits to bypass. |
| Strategy auto-suspended | paper expectancy decayed | Review in Strategy Lab; re-promote only after revalidation. |
| `/api/ready` 503 | database, engine or lane freshness check failed | Read the failing check; the supervisor restarts crashes, not stalls. |
| CRITICAL "Scanner stalled" | scanner has not completed for 3 intervals | Check provider health; restart the service if it does not recover. |
| WARNING "Backup failed" | scheduled backup or its restore check failed | Check disk space and `MIA_BACKUP_KEY`; run `npm run backup -- create` to see the error. |
| Audit gate FAIL | hash chain broken | Treat as tampering: stop the server, preserve the DB, investigate. |

Emergency actions (Risk Center) are distinct: pause new orders · cancel pending entries · verify protection ·
emergency stop (pause + cancel + verify, **no auto-close**) · close all (step-up + typed confirmation).

## Going live (not available in this build)
Requires every gate on the Release Gates page: 30-day paper evaluation, independent security review, an isolated signer
and transaction firewall (Part 24), a live venue adapter, the Independent Release Auditor sign-off, then explicit owner
authorization.
