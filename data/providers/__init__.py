"""Data providers. ``get_provider`` returns the one selected by DATA_PROVIDER."""
from __future__ import annotations

import os

from .base import MarketDataProvider


def get_provider(name: str | None = None) -> MarketDataProvider:
    name = (name or os.getenv("DATA_PROVIDER", "yahoo")).lower()
    if name == "yahoo":
        from .yahoo import YahooProvider
        return YahooProvider()
    if name == "stooq":
        from .stooq import StooqProvider
        return StooqProvider()
    raise ValueError(f"unknown DATA_PROVIDER {name!r} (expected 'yahoo' or 'stooq')")
