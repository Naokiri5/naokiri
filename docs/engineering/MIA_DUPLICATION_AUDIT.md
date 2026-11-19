# MIA duplication audit — 2026-11-18

Sources: Squad J (091–099) and Squad A (circular imports and unused exports). Each candidate's behaviour was compared before it was classified.

| Candidate | Copies | Behaviour equal? | Decision | Status |
|---|---|---|---|---|
| Lot rounding `floorStep` | `exec/oms.ts`, `risk/gate.ts` | Yes; both could round up | One canonical `floorToStep` in `core/util.ts` that rounds down with a floating-point tolerance of `step × 1e-6` | **DONE** `319ec8f` |
| Consensus expiry check | `oms.ts` ×2, `qci/coordinator.ts` | Yes; all failed open on a malformed date | One `expiredAt()` that fails closed | **DONE** `3fa973a` |
| Round-trip cost in R | `risk/gate.ts:112`, `qci/challenge.ts:37`, `workers/registry.ts:126` | **No**: different entry price, NaN handling and thresholds (0.25 / 0.3 / 0.1–0.25) | One pure function plus thresholds from policy | OPEN: changes consensus and challenge outcomes, so it needs a trading-risk review (J-05) |
| Candle zod schemas | `ditas/routes.ts:13`, `api/routes.ts:215` | No: int vs finite `t` | One exported `CandleInput` schema | OPEN (J-07) |
| Freshness checks | `market/quality.ts` (canonical); ad hoc in `api/routes.ts:183` and `bubbles.ts:12` | Display only | Keep the canonical one; replace the ad hoc ones | OPEN (low) |
| Chart EMA | `web/src/pages/Markets.tsx` vs `features/indicators.ts` | **No**: different seed and window | Plot server FeatureEngine values | OPEN (H-02) |
| Day bucketing | `portfolio/ledger.ts` (UTC) vs `portfolio/calendar.ts` (owner timezone) | No | Document, or share one timezone-aware key | OPEN (J-06) |
| Backup engine, lease system, fetch layer, OMS | — | — | Single canonical implementations confirmed: no second engine | OK |
| Fee term in gate (`fee×(entry+stopFill)`) vs ledger open risk (`fee×stopFill`) | 2 | Intentionally different: the entry fee is already paid | Keep | OK |

**Circular imports:** 0 runtime cycles. One type-only cycle, `decision/engine.ts` ↔ `ditas/memory.ts`, is erased at build.
