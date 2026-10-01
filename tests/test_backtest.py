import numpy as np
import pandas as pd

from backtesting.engine import BacktestConfig, simulate
from backtesting.metrics import drawdown, performance
from backtesting.strategy import cap_weights, top_n_weights


def _prices():
    index = pd.bdate_range("2020-01-01", periods=300)
    return pd.DataFrame({"A": np.linspace(100, 200, 300), "B": np.full(300, 50.0)}, index=index)


def test_buy_and_hold_matches_price_change_without_costs():
    prices = _prices()
    result = simulate(prices, {prices.index[0]: pd.Series({"A": 1.0})},
                      BacktestConfig(initial=1000, cost_bps=0, slippage_bps=0))
    expected = 1000 * prices["A"].iloc[-1] / prices["A"].iloc[1]
    assert np.isclose(result.equity.iloc[-1], expected)
    assert result.n_trades == 1


def test_costs_reduce_returns_and_are_charged_on_turnover():
    prices = _prices()
    targets = {d: pd.Series({"A": 1.0}) if i % 2 == 0 else pd.Series({"B": 1.0})
               for i, d in enumerate(prices.index[::20])}
    free = simulate(prices, targets, BacktestConfig(cost_bps=0, slippage_bps=0))
    paid = simulate(prices, targets, BacktestConfig(cost_bps=10, slippage_bps=5))
    assert paid.equity.iloc[-1] < free.equity.iloc[-1]
    assert paid.total_costs > 0 and free.total_costs == 0
    assert len(paid.round_trips) > 0


def test_cash_is_preserved_when_weights_sum_below_one():
    prices = _prices()
    result = simulate(prices, {prices.index[0]: pd.Series({"B": 0.5})},
                      BacktestConfig(initial=1000, cost_bps=0, slippage_bps=0))
    assert np.allclose(result.equity, 1000)   # B is flat and the rest is cash


def test_curve_starts_at_the_starting_capital_and_shows_entry_costs():
    prices = _prices()
    result = simulate(prices, {prices.index[5]: pd.Series({"B": 1.0})},
                      BacktestConfig(initial=1000, cost_bps=10, slippage_bps=0))
    assert result.equity.iloc[0] == 1000 and result.equity.index[0] == prices.index[5]
    assert np.isclose(result.equity.iloc[-1], 999.0)   # 10 bps on $1,000 traded


def test_metrics_on_a_known_curve():
    index = pd.bdate_range("2020-01-01", periods=253)
    equity = pd.Series(np.concatenate([np.linspace(100, 120, 100), np.linspace(120, 90, 53),
                                       np.linspace(90, 110, 100)]), index=index)
    stats = performance(equity)
    assert np.isclose(stats["total_return"], 0.10)
    assert np.isclose(stats["max_drawdown"], 90 / 120 - 1)
    assert np.isclose(drawdown(equity).min(), -0.25)


def test_weight_caps():
    weights = cap_weights(pd.Series({"A": 5.0, "B": 1.0, "C": 1.0, "D": 1.0}), 0.4)
    assert np.isclose(weights.sum(), 1.0) and weights.max() <= 0.4 + 1e-9
    scores = pd.Series({f"T{i}": 100 - i for i in range(10)})
    sectors = {f"T{i}": "Tech" if i < 6 else "Other" for i in range(10)}
    picked = top_n_weights(scores, sectors, n=5, max_weight=0.25, max_sector=0.4)
    assert sum(sectors[t] == "Tech" for t in picked.index) == 2   # sector cap: 40% of 5 names
    assert np.isclose(picked.sum(), 1.0)
