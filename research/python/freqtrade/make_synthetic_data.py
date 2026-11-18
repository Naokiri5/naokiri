"""Write deterministic synthetic 1h OHLCV candles (fixed seed) in Freqtrade's feather format, so backtests need no download."""
import random
from pathlib import Path

import pandas as pd

SEED, N = 4242, 24 * 120  # 120 days of hourly candles
OUT = Path(__file__).parent / "user_data" / "data" / "kraken"


def candles(start_price: float, seed: int) -> pd.DataFrame:
    rng = random.Random(seed)
    price, rows = start_price, []
    dates = pd.date_range("2026-01-01", periods=N, freq="1h", tz="UTC")
    for d in dates:
        o = price
        c = max(1.0, o * (1 + rng.gauss(0, 0.006)))
        h = max(o, c) * (1 + abs(rng.gauss(0, 0.002)))
        lo = min(o, c) * (1 - abs(rng.gauss(0, 0.002)))
        rows.append((d, o, h, lo, c, rng.uniform(10, 100)))
        price = c
    return pd.DataFrame(rows, columns=["date", "open", "high", "low", "close", "volume"])


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for pair, px, seed in (("BTC_USD", 60_000.0, SEED), ("ETH_USD", 3_000.0, SEED + 1)):
        candles(px, seed).to_feather(OUT / f"{pair}-1h.feather")
    print(f"wrote synthetic candles to {OUT}")
