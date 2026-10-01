"""The stock universe. Edit ``data/universe.csv`` to add or remove stocks."""
from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import pandas as pd

UNIVERSE_FILE = Path(__file__).resolve().parent / "universe.csv"
BENCHMARK = "SPY"  # S&P 500 ETF; its adjusted close includes dividends


@dataclass(frozen=True)
class Stock:
    ticker: str
    name: str
    sector: str
    ciks: tuple[int, ...]  # SEC identifiers, newest first (predecessor entities after)


@lru_cache(maxsize=1)
def load_universe() -> tuple[Stock, ...]:
    frame = pd.read_csv(UNIVERSE_FILE, dtype=str).fillna("")
    stocks = []
    for row in frame.itertuples(index=False):
        ciks = tuple(int(c) for c in row.cik.split("|") if c.strip())
        stocks.append(Stock(row.ticker.strip().upper(), row.name.strip(), row.sector.strip(), ciks))
    return tuple(stocks)


def tickers() -> list[str]:
    return [s.ticker for s in load_universe()]


def sector_map() -> dict[str, str]:
    return {s.ticker: s.sector for s in load_universe()}


def get_stock(ticker: str) -> Stock | None:
    return next((s for s in load_universe() if s.ticker == ticker.upper()), None)
