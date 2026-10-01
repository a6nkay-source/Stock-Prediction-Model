"""Turning scores into target weights, for the AI strategy and its benchmarks."""
from __future__ import annotations

import math

import pandas as pd


def cap_weights(weights: pd.Series, max_weight: float) -> pd.Series:
    """Scale to sum to 1 with no weight above the cap; the excess is spread over the rest.

    If the cap makes full investment impossible (n x cap < 1) the remainder stays in cash.
    """
    weights = weights / weights.sum()
    for _ in range(len(weights)):
        over = weights > max_weight + 1e-12
        if not over.any():
            break
        weights[over] = max_weight
        free = ~(weights >= max_weight - 1e-12)
        room = 1.0 - weights[~free].sum()
        if not free.any() or room <= 0:
            break
        weights[free] = weights[free] / weights[free].sum() * room
    return weights


def top_n_weights(scores: pd.Series, sectors: dict[str, str], n: int = 15,
                  max_weight: float = 0.15, max_sector: float = 0.30,
                  weighting: str = "equal", volatility: pd.Series | None = None) -> pd.Series:
    """Pick the ``n`` highest-scoring stocks, respecting the sector cap, and weight them."""
    scores = scores.dropna().sort_values(ascending=False)
    per_sector = max(1, math.floor(max_sector * n + 1e-9))
    chosen, counts = [], {}
    for ticker in scores.index:
        sector = sectors.get(ticker, "Other")
        if counts.get(sector, 0) >= per_sector:
            continue
        chosen.append(ticker)
        counts[sector] = counts.get(sector, 0) + 1
        if len(chosen) == n:
            break
    if not chosen:
        return pd.Series(dtype=float)
    if weighting == "inverse_vol" and volatility is not None:
        raw = 1.0 / volatility.reindex(chosen).clip(lower=0.05).fillna(volatility.median())
    else:
        raw = pd.Series(1.0, index=chosen)
    return cap_weights(raw.astype(float), max_weight)


def equal_weights(tickers: list[str]) -> pd.Series:
    return pd.Series(1.0 / len(tickers), index=tickers) if tickers else pd.Series(dtype=float)
