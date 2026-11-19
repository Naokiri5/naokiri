# MIA quantitative validation — 2026-11-18

All checks ran offline against synthetic or seeded data. No profitability claim is made: the strategies remain research and paper candidates.

## Indicators (Squad C)
Independent reference implementations compared with the incremental FeatureEngine:
- 20 random-walk series, checked at prefixes and at every bar from 260 on;
- chunked versus batch ingest;
- reversed and duplicate input.

**Result:** maximum absolute error **0**, across 48 snapshot fields, for:
- EMA 9/20/50/200, MACD 12/26/9, RSI14, ATR14, +DI/−DI/ADX14;
- Bollinger 20/2, Stoch %K, Williams %R, CCI20, MFI14;
- OBV, VWAP20, realized vol 20, Donchian 20, ROC10.

Open: C-05, no warm-up guard on windowed features (values from 2–3 bars).

## Paper accounting (Squad E)
Scenario: deposit 10,000; book walk 2/3/0.7536 at about 233; T1 50%; trail to breakeven; trailing-stop exit.

**Result:** every quantity matched a hand calculation to within **2e-12 USD**:
- gate quantity 5.7536 and entry fill 233.10607491;
- fees 2.71368829;
- realized PnL 28.57637467;
- final cash = equity = 10,028.57637467;
- reconcile Δ 4.3e-14.

**Fee drift:** 4,426 partial exits → realized −4.63293819 against hand −4.63293819 (Δ 2.4e-13).

**Edge proposals:** each was denied by the gate (stop above price, zero stop, negative or NaN entry, cost-R above maximum).

## Backtester (Squad F)
- **No look-ahead:** 125 trades over full versus prefix runs, 0 mismatches. Entries fill at the next open × (1 + slip).
- **Same-bar stop and target:** the stop is assumed first (conservative). A gap through the stop fills at the open × (1 − slip).
- **Metrics:** hand versus code agree for win rate, expectancy, profit factor, max drawdown (additive and compounded), CAGR, Sharpe and Sortino (annualised).
- **Walk-forward** (research): non-overlapping windows with a 24-bar embargo; a supported verdict needs ≥ 30 trades and a CI lower bound > 0.
- **Monte Carlo:** seeded and reproducible.

**Promotion:**
- Never automatic, and LIVE_CANDIDATE is hard-blocked.
- PAPER now needs ≥ 30 out-of-sample trades with positive expectancy, or an audited owner OVERRIDE (F-01, fixed).

**Open:**
- F-02: the trial count is not tracked.
- F-03: TIME exits are not slipped.
- F-04: the closed-candle cutoff time.
- F-05: no contiguity check.
- F-06: no uncertainty shown in the Lab.
- F-07: Sharpe uses the population SD.

## Calibration (Squad G)
Brier score, log loss (eps 1e-15) and ECE matched hand calculations in 5 cases, including the clipping case. NaN probabilities are rejected.

Open:
- G-05: outcomes are owner-reported and not verified against candles.
- G-06: bin boundary error at 100 bins.

## Strategy edge
Not demonstrated. No walk-forward run on real data was performed in this offline session. Strategies stay research or paper candidates; see `docs/engineering/BLUEPRINT_STATUS.md` and the Academy walk-forward experiment.
