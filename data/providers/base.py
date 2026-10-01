"""Provider interface. Implement this to plug in a different data vendor."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

import pandas as pd


@dataclass
class PriceData:
    """Daily prices, one column per ticker, indexed by trading date.

    ``adj_close`` is adjusted for splits AND dividends (use it for returns).
    ``close`` is adjusted for splits only (use it for price ratios such as P/E).
    ``splits`` holds the split ratio on the day a split took effect, else 0.
    """

    adj_close: pd.DataFrame
    close: pd.DataFrame
    splits: pd.DataFrame


class MarketDataProvider(ABC):
    name: str = "provider"

    @abstractmethod
    def get_prices(self, tickers: list[str], start: str) -> PriceData:
        """Daily price history for every ticker from ``start`` to today."""

    def get_snapshot(self, ticker: str) -> dict:
        """Current fundamentals and analyst data. Missing fields must be None."""
        return {}

    def get_news(self, ticker: str) -> list[dict]:
        """Recent headlines: [{title, publisher, url, published}]."""
        return []

    def get_earnings(self, ticker: str) -> list[dict]:
        """Recent quarters: [{quarter, eps_actual, eps_estimate, surprise_pct}]."""
        return []
