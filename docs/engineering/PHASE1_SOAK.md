# Phase 1 headless soak — 2026-11-17

**This is not the 24-hour soak (item 072).** It was a short run, about 6.6 minutes, inside the development container. It was planned for 15 minutes. It ended early because the operator, Claude, stopped the supervisor at 14:22:45, wrongly believing the recording loop had died. Samples recorded after that moment show the server as down (HTTP 000) because it had been stopped on purpose; they are excluded below. It proves the lifecycle mechanics. It does not prove long-run stability, memory behaviour over hours, or uptime on a hosted server. Nothing was deployed.

## Setup
- Built server (`npm run build -w server`) started with `node server/scripts/supervise.mjs`. Settings: `NODE_ENV=production`, `MIA_HOST=127.0.0.1`, port 8799, a fresh `MIA_DATA_DIR`, and `MIA_BACKUP_INTERVAL_H=1`.
- **No browser and no UI client were connected.** Live public market data came through the container's proxy.
- The risk policy was **not accepted** in the fresh data directory. So the run exercised scanning, tickers, books, monitoring, the lease, backups and recovery, but **no paper entries were possible**. Order-flow behaviour under the soak is not covered here.
- A shell loop sampled `GET /api/ready` and the server's RSS every 15 s. The script is kept in the session scratchpad and is not committed.

## Timeline (UTC)
| t | Event | Observed |
|---|---|---|
| 14:16:07 | Supervisor starts the server | `/api/ready` returned 200, role LEADER, from the first sample (15 s). Journal: `Engine lease acquired by vm:2493:…` |
| 14:16:24 | Scheduled backup by the leader | Journal: `Backup mia-20261117T141624Z.db written (not encrypted); restore check passed` |
| +121 s | Second copy started on the **same database** (port 8800) | Its `/api/ready` returned `role: STANDBY`, with the engine check "standby: another instance holds the engine lease". It did no market work. The first copy stayed LEADER. |
| +211 s | Second copy sent SIGTERM | "Stopped cleanly". The leader was unaffected. |
| +301 s | Leader **SIGKILLed** (forced crash) | Supervisor: `crashed (code 1) after 301 s; restart 1/8 in 1000 ms`, then `started` 1 s later. |
| +316 to +346 s | Restarted copy | 200, role **STANDBY**: the killed copy's lease had not yet expired (45 s TTL), so the new copy did not overlap it. |
| ≈ +360 s | Lease expired | Journal: `Engine lease acquired by vm:3860:…`. `/api/ready` was LEADER with fresh tickers and scanner. |
| 14:22:45 | Supervisor sent SIGTERM | Server: "draining engine lanes… Stopped cleanly". Supervisor: `stopped (0)`. `runtime_leases` was empty afterwards (lease released). |

## Numbers
- **Readiness samples while the server was up:** 27 (t = 0–391 s). 26 returned HTTP 200. The one non-200 was the sample taken before the server had bound its port at t=0. No sample reported `ready:false`.
- **Readiness check failures:** none (no stale ticker or scanner).
- **Restarts:** 1, the forced one. No unplanned crashes.
- **RSS, first process:** 168–226 MB over 20 samples. That is too short to judge leaks.
- **RSS, restarted process:** 88–212 MB over 5 samples while it warmed up.
- **Missed jobs:** none detected by readiness. Lane freshness stayed within 3 intervals while a process was LEADER. During the deliberate ~45 s standby gap no lanes ran, which is by design. Positions would have stayed unmonitored for that gap, bounded by the lease TTL.

## Not covered (still open)
- A 24 h run on an owner-approved always-on host (items 011, 072).
- Event-loop lag over time (QHEF needs a login; it was not sampled).
- Paper order flow during the soak (risk policy not accepted).
- External uptime monitoring and alert delivery (item 017).
