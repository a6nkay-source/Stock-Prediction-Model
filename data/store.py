"""Cached access to everything the app needs. All network calls go through here."""
from __future__ import annotations

import os

import pandas as pd

from . import cache
from .providers import get_provider
from .providers.base import PriceData
from .providers.edgar import point_in_time_fundamentals
from .universe import BENCHMARK, Stock, load_universe, tickers

PRICE_TTL_HOURS = 12
FUNDAMENTAL_TTL_HOURS = 24 * 7
SNAPSHOT_TTL_HOURS = 24
NEWS_TTL_HOURS = 3


def _safe(ticker: str) -> str:
    return ticker.replace("/", "_")


def load_prices(force: bool = False, ttl_hours: float = PRICE_TTL_HOURS) -> PriceData:
    """Daily prices for the universe plus the benchmark, with a Stooq fallback.

    Pass a huge ``ttl_hours`` to read whatever is cached without re-downloading.
    """
    symbols = tickers() + [BENCHMARK]
    start = os.getenv("PRICE_START", "2000-01-01")

    def download() -> pd.DataFrame:
        try:
            data = get_provider().get_prices(symbols, start)
        except Exception:
            data = get_provider("stooq").get_prices(symbols, start)
        return pd.concat({"adj_close": data.adj_close, "close": data.close,
                          "splits": data.splits}, axis=1)

    frame = cache.cached_frame("prices", ttl_hours, download, force)
    return PriceData(frame["adj_close"], frame["close"], frame["splits"])


def load_fundamentals(stock: Stock, splits: pd.Series | None, force: bool = False) -> pd.DataFrame:
    """Filing-dated fundamentals for one stock (empty frame if unavailable)."""
    def download() -> pd.DataFrame:
        frame = point_in_time_fundamentals(stock.ciks, splits)
        if frame.empty:
            return pd.DataFrame({"eps_ttm": []}, index=pd.DatetimeIndex([], name="available"))
        return frame

    try:
        return cache.cached_frame(f"fundamentals/{_safe(stock.ticker)}", FUNDAMENTAL_TTL_HOURS,
                                  download, force)
    except Exception:
        return pd.DataFrame()


def load_all_fundamentals(prices: PriceData, force: bool = False) -> dict[str, pd.DataFrame]:
    out = {}
    for stock in load_universe():
        splits = prices.splits[stock.ticker] if stock.ticker in prices.splits else None
        out[stock.ticker] = load_fundamentals(stock, splits, force)
    return out


def load_snapshot(ticker: str, force: bool = False, ttl_hours: float = SNAPSHOT_TTL_HOURS) -> dict:
    try:
        return cache.cached_json(f"snapshot/{_safe(ticker)}", ttl_hours,
                                 lambda: get_provider().get_snapshot(ticker), force)
    except Exception:
        return {}


def load_news(ticker: str) -> list[dict]:
    try:
        return cache.cached_json(f"news/{_safe(ticker)}", NEWS_TTL_HOURS,
                                 lambda: get_provider().get_news(ticker))
    except Exception:
        return []


def load_earnings(ticker: str) -> list[dict]:
    try:
        return cache.cached_json(f"earnings/{_safe(ticker)}", SNAPSHOT_TTL_HOURS,
                                 lambda: get_provider().get_earnings(ticker))
    except Exception:
        return []


def cached_snapshot(ticker: str) -> dict:
    """Snapshot from the cache only — never triggers a download (used for big tables)."""
    path = cache.cache_dir() / f"snapshot/{_safe(ticker)}.json"
    if not path.exists():
        return {}
    try:
        import json
        return json.loads(path.read_text())
    except Exception:
        return {}


def warm_snapshots(symbols: list[str], workers: int = 4) -> int:
    """Fetch current fundamentals for many tickers; returns how many succeeded."""
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(workers) as pool:
        results = list(pool.map(load_snapshot, symbols))
    return sum(1 for r in results if r)
