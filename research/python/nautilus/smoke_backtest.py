"""
NautilusTrader research smoke test (offline, deterministic, simulated venue ONLY).

Runs Nautilus's own EMACross example strategy on 2,000 synthetic 1-minute BTC/USDT bars (fixed seed) inside a
BacktestEngine. Nothing connects to an exchange: no live node, no adapters, no keys. This verifies the isolated
environment works and gives a reference for comparing MIA's paper OMS fills/fees against an independent engine.
It is NOT a strategy result and NOT evidence that anything is profitable.
"""
from __future__ import annotations

import json
import random
import sys
from decimal import Decimal

from nautilus_trader.backtest.engine import BacktestEngine, BacktestEngineConfig
from nautilus_trader.config import LoggingConfig
from nautilus_trader.examples.strategies.ema_cross import EMACross, EMACrossConfig
from nautilus_trader.model.currencies import BTC, USDT
from nautilus_trader.model.data import Bar, BarType
from nautilus_trader.model.enums import AccountType, OmsType
from nautilus_trader.model.identifiers import TraderId, Venue
from nautilus_trader.model.objects import Money
from nautilus_trader.test_kit.providers import TestInstrumentProvider

SEED = 4242
N_BARS = 2_000
START_NS = 1_767_225_600_000_000_000  # 2026-01-01T00:00:00Z
MINUTE_NS = 60_000_000_000


def synthetic_bars(instrument, bar_type) -> list[Bar]:
    rng = random.Random(SEED)
    price = 60_000.0
    bars = []
    for i in range(N_BARS):
        o = price
        c = max(1_000.0, o * (1 + rng.gauss(0, 0.0015)))
        h = max(o, c) * (1 + abs(rng.gauss(0, 0.0005)))
        lo = min(o, c) * (1 - abs(rng.gauss(0, 0.0005)))
        ts = START_NS + (i + 1) * MINUTE_NS
        bars.append(Bar(bar_type, instrument.make_price(o), instrument.make_price(h), instrument.make_price(lo),
                        instrument.make_price(c), instrument.make_qty(rng.uniform(5, 50)), ts, ts))
        price = c
    return bars


def main() -> int:
    engine = BacktestEngine(config=BacktestEngineConfig(trader_id=TraderId("MIA-RESEARCH-001"), logging=LoggingConfig(log_level="ERROR")))
    venue = Venue("BINANCE")  # simulated exchange inside the engine; no network
    engine.add_venue(venue=venue, oms_type=OmsType.NETTING, account_type=AccountType.CASH, base_currency=None,
                     starting_balances=[Money(100_000, USDT), Money(1, BTC)])
    instrument = TestInstrumentProvider.btcusdt_binance()
    engine.add_instrument(instrument)
    bar_type = BarType.from_str(f"{instrument.id}-1-MINUTE-LAST-EXTERNAL")
    engine.add_data(synthetic_bars(instrument, bar_type))
    engine.add_strategy(EMACross(EMACrossConfig(instrument_id=instrument.id, bar_type=bar_type, trade_size=Decimal("0.010"),
                                                fast_ema_period=10, slow_ema_period=20)))
    engine.run()
    fills = engine.trader.generate_order_fills_report()
    positions = engine.trader.generate_positions_report()
    summary = {"engine": "nautilus_trader", "bars": N_BARS, "seed": SEED, "filled_orders": int(len(fills)),
               "closed_positions": int(len(positions)), "venue": "SIMULATED", "live": False}
    engine.dispose()
    print(json.dumps(summary))
    return 0 if summary["filled_orders"] > 0 else 1  # a crossover strategy over 2,000 bars must trade at least once


if __name__ == "__main__":
    sys.exit(main())
