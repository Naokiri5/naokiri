# Implementation status and Claude handoff

This is the first reviewed increment of the owner's phased specification, not delivery of all 17 phases. Start here, read the audit and test report, then execute one acceptance-gated phase at a time. Preserve existing risk and execution boundaries. No production secrets belong in commits.

| Phase | Status after this increment | Dependency / next acceptance gate |
|---|---|---|
| 0 audit | COMPLETE for this increment | Re-audit changed baseline before extending |
| 1 charts | PARTIAL, implemented subset | Includes confirmed-pivot continuation and change of character, immediate breakout retests, and anchored VWAP. Zones, channels, named patterns, Fibonacci/pivots and volatility fixtures remain. |
| 2 indicators | PARTIAL existing | Correct per-indicator warm-up; independently verify formulas; add missing WMA, Keltner, Ichimoku, SAR, volume profile; retain one feature engine |
| 3 multi-timeframe | PARTIAL | Binance spot agreement across the 15m, 1h and 4h caches. Additional provider intervals require separate ingestion and validation. |
| 4 flow/liquidity | PARTIAL | Historical observed book/trade feed + provenance; separate inference from observation |
| 5 fundamentals | PARTIAL/BLOCKED | Licensed asset-specific point-in-time feeds, schema, freshness tests |
| 6 scanner | PARTIAL existing | Extend current capability registry/discovery; no duplicate scanner; outage/rate-limit tests |
| 7 research | MISSING | Licensed source registry, citations, timestamps, deduplication and sandboxed hypothesis ingestion |
| 8 strategy lab | PARTIAL existing | Rolling walk-forward, leakage controls, cost/stability/sample gates; no new engine |
| 9 specialists | PARTIAL existing deterministic QCI | Reuse packet schema/dependency caps; model output validation and budgets; no secret/model trading authority |
| 10 challenger | PARTIAL existing | Extend qci/challenge.ts with measurable failure checks and evidence; veto only |
| 11 risk | PARTIAL existing | Audit all requested limits; fail closed on critical missing inputs; OMS regression tests |
| 12 learning | PARTIAL existing | Persist predictions/outcomes/calibration; reviewed promotion; never auto-edit risk policy |
| 13 decision schema | PARTIAL existing | Extend central DecisionReport with versioned evidence provenance; backward compatibility |
| 14 dashboard | PARTIAL | Chart evidence integrated in existing terminal; remaining views depend on actual services |
| 15 performance | PARTIAL existing | Chart microbenchmark plus existing latency histograms; full load/recovery/resource-budget validation remains |
| 16 certification | PARTIAL | See test report; no live/OOS profitability certification |
| Replay recommendation | PARTIAL | Prefix cursor backend implemented; next: replay UI, immutable prediction journal, next-bar fills using existing backtester/exits, cost-aware scoring and walk-forward review |

## Files and use

- `server/src/chart/analysis.ts`: pure closed-candle validation + chart evidence.
- `server/src/chart/replay.ts`: pure prefix cursor; hidden candles never enter analysis.
- `GET /api/instrument/:symbol?interval=1h`: adds `chartIntelligence` using the existing closed-candle cache.
- `POST /api/chart/replay`: authenticated and CSRF-protected; `{instrument, timeframe, candles, visibleBars}`; maximum 2000 candles. Response contains visible prefix and its report. Owner supplies historical data; no network/model/order side effects.
- `web/src/pages/Markets.tsx`: terminal chart intelligence panel.
- `server/test/chart.test.ts`, `server/test/api.test.ts`: deterministic, no-look-ahead, validation and API boundary coverage.

Supported intervals remain 15m, 1h and 4h. Research replay does not infer market support or authenticate uploaded provenance. The API owner already supplies the full historical array; blindness means the analyzer sees only the selected prefix, not that the owner cannot inspect their own data. API schema validation validates shape for the full request; analytical validation uses the visible prefix only.

## MIA 4.2 chart research

- The timeframe agreement report compares confirmed swing trends from the latest completed 15m, 1h and 4h candles at one UTC timestamp. Opposed valid directions produce a conflict. Alignment requires all three valid readings in the same direction. Missing, stale or invalid data cannot vote.
- A structure break requires the first close through a swing level that was confirmed before the signal candle. Two rising highs and lows define bullish structure. Two falling highs and lows define bearish structure. A break against that sequence is a change of character.
- A breakout retest requires a close beyond a 20-bar range, then an immediate touch and close beyond the same boundary.
- Anchored VWAP uses the same typical-price and base-volume formula as rolling VWAP. It supports Binance spot UTC day, Monday UTC week and UTC month boundaries, plus the most recent confirmed swing. An anchor is unavailable when the cache lacks its first candle or the observed volume is zero. Earnings and event anchors need a verified event source.

These outputs are research evidence. They use the existing terminal and blind replay report and carry no QCI vote or execution authority.
