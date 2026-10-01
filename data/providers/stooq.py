"""Stooq provider: free daily prices over plain CSV, no API key and no dependencies.

Prices only — Stooq closes are split/dividend adjusted, so ``close`` and
``adj_close`` are the same series and split history is unavailable. Fundamentals,
news and earnings return nothing, which the app shows as "Data unavailable".
"""
from __future__ import annotations

import io
import urllib.request

import pandas as pd

from .base import MarketDataProvider, PriceData

URL = "https://stooq.com/q/d/l/?s={symbol}&i=d"


class StooqProvider(MarketDataProvider):
    name = "Stooq"

    def _one(self, ticker: str) -> pd.Series:
        symbol = ticker.lower() if "." in ticker else f"{ticker.lower()}.us"
        req = urllib.request.Request(URL.format(symbol=symbol),
                                     headers={"User-Agent": "Stock-Prediction-Model"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            text = resp.read().decode("utf-8", errors="replace")
        if not text.startswith("Date"):
            raise RuntimeError(f"Stooq returned no data for {ticker!r}")
        frame = pd.read_csv(io.StringIO(text), parse_dates=["Date"]).set_index("Date")
        return frame["Close"].astype(float).rename(ticker)

    def get_prices(self, tickers: list[str], start: str) -> PriceData:
        series = []
        for ticker in tickers:
            try:
                series.append(self._one(ticker))
            except Exception:
                series.append(pd.Series(dtype=float, name=ticker))
        close = pd.concat(series, axis=1).sort_index().loc[start:]
        if close.dropna(how="all").empty:
            raise RuntimeError("Stooq returned no price data")
        return PriceData(close, close.copy(), close * 0.0)
