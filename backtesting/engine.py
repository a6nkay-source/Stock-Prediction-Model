"""A small, honest portfolio simulator.

Rules that keep it honest:

* **No look-ahead.** Target weights decided with data through the close of day *t*
  are traded at the close of day *t + lag* (default: the next trading day).
* **Costs on by default.** Every dollar traded pays commission/spread plus slippage.
* **Benchmarks run through the same simulator**, with the same costs and dates.
* Uninvested money sits in cash earning nothing.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd


@dataclass
class BacktestConfig:
    initial: float = 10_000.0
    cost_bps: float = 10.0       # commission + half-spread, per dollar traded
    slippage_bps: float = 5.0    # price moving against you while trading
    execution_lag: int = 1       # trading days between the signal and the trade
    trade_threshold: float = 0.001  # weight changes below 0.1% are not counted as a trade


@dataclass
class SimulationResult:
    name: str
    equity: pd.Series
    weights: pd.DataFrame            # target weights at each trade date
    n_trades: int = 0
    turnover: float = 0.0            # average one-way turnover per rebalance
    total_costs: float = 0.0
    round_trips: list[dict] = field(default_factory=list)
    trade_log: list[dict] = field(default_factory=list)

    @property
    def win_rate(self) -> float | None:
        if not self.round_trips:
            return None
        return float(np.mean([t["return"] > 0 for t in self.round_trips]))


def simulate(prices: pd.DataFrame, targets: dict[pd.Timestamp, pd.Series],
             cfg: BacktestConfig | None = None, name: str = "strategy") -> SimulationResult:
    """Follow ``targets`` (signal date -> weights summing to <= 1) through ``prices``."""
    cfg = cfg or BacktestConfig()
    if not targets:
        raise ValueError("no target weights supplied")
    prices = prices.ffill()
    index = prices.index
    rate = (cfg.cost_bps + cfg.slippage_bps) / 1e4

    # Map each signal date to the day it is actually traded.
    schedule: dict[int, pd.Series] = {}
    for signal_date in sorted(targets):
        pos = index.searchsorted(pd.Timestamp(signal_date), side="right") - 1 + cfg.execution_lag
        if 0 <= pos < len(index):
            schedule[pos] = targets[signal_date]
    if not schedule:
        raise ValueError("no trade date falls inside the price history")

    first = min(schedule)
    cols = list(prices.columns)
    px = prices.to_numpy(dtype=float)
    holdings = np.zeros(len(cols))            # dollars in each stock
    cash = cfg.initial
    equity = np.empty(len(index) - first)
    entry: dict[str, tuple[pd.Timestamp, float]] = {}
    round_trips, trade_log, weight_rows, turnovers = [], [], {}, []
    n_trades, total_costs = 0, 0.0

    for step, pos in enumerate(range(first, len(index))):
        if step > 0:  # holdings drift with prices
            growth = px[pos] / px[pos - 1]
            holdings = holdings * np.where(np.isfinite(growth), growth, 1.0)
        total = holdings.sum() + cash
        if pos in schedule:
            target = schedule[pos].reindex(cols).fillna(0.0).to_numpy(dtype=float)
            target = np.where(np.isfinite(px[pos]), target, 0.0)   # cannot buy what has no price
            target = np.clip(target, 0.0, None)
            if target.sum() > 1.0:
                target = target / target.sum()
            desired = target * total
            traded = np.abs(desired - holdings).sum()
            cost = traded * rate
            total_costs += cost
            if step > 0 or traded > 0:
                turnovers.append(traded / 2 / total if step > 0 else traded / total)
            old_weights = holdings / total if total > 0 else holdings
            total -= cost
            new_holdings = target * total
            date = index[pos]
            for i, ticker in enumerate(cols):
                change = target[i] - old_weights[i]
                if abs(change) < cfg.trade_threshold:
                    continue
                n_trades += 1
                trade_log.append({"date": str(date.date()), "ticker": ticker,
                                  "action": "BUY" if change > 0 else "SELL",
                                  "weight_change": float(change), "price": float(px[pos][i])})
                if old_weights[i] < cfg.trade_threshold <= target[i]:
                    entry[ticker] = (date, px[pos][i])
                elif target[i] < cfg.trade_threshold and ticker in entry:
                    opened, cost_basis = entry.pop(ticker)
                    round_trips.append({"ticker": ticker, "entry": str(opened.date()),
                                        "exit": str(date.date()),
                                        "return": float(px[pos][i] / cost_basis - 1)})
            holdings = new_holdings
            cash = total - holdings.sum()
            weight_rows[date] = pd.Series(target, index=cols)
        equity[step] = holdings.sum() + cash

    weights = pd.DataFrame(weight_rows).T if weight_rows else pd.DataFrame(columns=cols)
    curve = pd.Series(equity, index=index[first:], name=name)
    if first > 0:
        # Start the curve at the untouched starting capital on the signal day, so the
        # cost of the very first purchase shows up as a loss rather than vanishing.
        curve = pd.concat([pd.Series([cfg.initial], index=[index[first - 1]]), curve]).rename(name)
    return SimulationResult(
        name=name, equity=curve, weights=weights,
        n_trades=n_trades, turnover=float(np.mean(turnovers[1:])) if len(turnovers) > 1 else 0.0,
        total_costs=float(total_costs), round_trips=round_trips, trade_log=trade_log)
