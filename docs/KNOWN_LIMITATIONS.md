# Known Limitations

Updated 2026-11-16 (end of Phase 1). Each item says whether it is **fixable now** or **blocked** on something external.

## Trading & strategies
- **The 3 built-in strategies lost money out-of-sample** on the last ~4 months of real data, with tiny samples (2–9 trades
  each). They are research starting points, not proven strategies. The bot will not trade a strategy until you promote it.
- Scores, consensus thresholds and domain weights are **not calibrated** (needs paper-trading outcomes).
- Paper fills walk the live order book but don't model queue position or latency. Stops are monitored by MIA (every ~15 s)
  rather than resting on the exchange, so a fast move can fill worse than the stop price.
- Spot only. No shorting, leverage or derivatives.

## Markets & data
- Crypto spot (Binance + cross-checks) is live. Forex is ECB **daily reference rates** only (not tradeable). **Stocks,
  commodities and derivatives are not connected** (blocked: licensed feeds / network host).
- Data arrives by polling every 15–60 s, not live streaming (streaming hosts not allow-listed; fixable with approval).
- Google News RSS is licensed for **personal, non-commercial use only**.
- Some Binance listings are tokenized stocks (CoinGecko labels them "bStocks Tokenized Stock", e.g. NVDAB, SPCXB); MIA still classifies them as crypto spot.

## Intelligence
- 12 of the 100 workers always abstain: 3 are fixable now, 9 need provider keys (see traceability).
- No historical replay engine, strategy arena, forecasting model or liquidity heatmap yet (fixable).
- 15 QA roles are not yet represented as roles (fixable).

## Accounts, wallets, assistant
- Trader Joe's conversational mode has never run (needs an Anthropic API key). Command mode works.
- No external wallet or exchange balances (read-only keys needed). Withdrawals are preview-only by design.
- Whale tracking is limited to large exchange trades; wallet-level tracking, copy trading and holder maps need on-chain data.
- Telegram alerts need a bot token; no native phone push.

## Operations
- Runs locally or in this cloud session only; not yet hosted. The 30-day paper evaluation (release gate) hasn't started.
- No automated backups yet: back up `data/mia.db` **and `data/evidence.key`** together (see `SECURITY.md`). API rate limits exist since the repair branch; CI since Phase 1.
- Occasional event-loop stalls up to ~220 ms observed (QHEF page); harmless for paper trading, scheduled for Phase 6.
- Single owner account; no password reset.
