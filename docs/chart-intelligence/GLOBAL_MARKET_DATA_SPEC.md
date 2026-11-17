# Global market data

Status: implementation design for subsequent increments; not a claim of completion.

Reuse market/fabric.ts, discover.ts, scanner.ts and providers/http.ts. Record venue/asset/interval/capability, source timestamp and receive time. Crypto spot is currently connected; FX reference fixings are informational. Stocks/commodities/indices need licensed feeds. Add capability discovery and feed-specific calendars before expanding scans. Acceptance: no unsupported instruments, deduplication, outage recovery, rate budgets and stale/gap rejection.
