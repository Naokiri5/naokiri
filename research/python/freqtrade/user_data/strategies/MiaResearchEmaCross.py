"""
MIA research strategy for Freqtrade backtests ONLY (dry-run config, no keys).

A deliberately plain EMA crossover used to compare Freqtrade's backtester (fees, fills, ROI/stop handling) with MIA's
paper OMS and Strategy Lab on the same data. It is not a recommended strategy and must never be enabled on a live
exchange: MIA's deterministic decision engine and risk gate remain the only trade authority.
"""
from pandas import DataFrame

from freqtrade.strategy import IStrategy


class MiaResearchEmaCross(IStrategy):
    INTERFACE_VERSION = 3
    timeframe = "1h"
    can_short = False
    minimal_roi = {"0": 0.04}
    stoploss = -0.03
    startup_candle_count = 50
    process_only_new_candles = True

    def populate_indicators(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        dataframe["ema_fast"] = dataframe["close"].ewm(span=12, adjust=False).mean()
        dataframe["ema_slow"] = dataframe["close"].ewm(span=26, adjust=False).mean()
        return dataframe

    def populate_entry_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        cross_up = (dataframe["ema_fast"] > dataframe["ema_slow"]) & (dataframe["ema_fast"].shift(1) <= dataframe["ema_slow"].shift(1))
        dataframe.loc[cross_up & (dataframe["volume"] > 0), "enter_long"] = 1
        return dataframe

    def populate_exit_trend(self, dataframe: DataFrame, metadata: dict) -> DataFrame:
        cross_down = (dataframe["ema_fast"] < dataframe["ema_slow"]) & (dataframe["ema_fast"].shift(1) >= dataframe["ema_slow"].shift(1))
        dataframe.loc[cross_down, "exit_long"] = 1
        return dataframe
