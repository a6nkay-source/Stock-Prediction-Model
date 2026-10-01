"""The integrity tests: nothing computed for date t may depend on data after t."""
import numpy as np
import pandas as pd

from backtesting.engine import BacktestConfig, simulate
from models.features import FEATURE_NAMES, HORIZONS, build_panel, compute_daily_features, month_end_dates
from models.training import TrainConfig, known_by, walk_forward


def _features(market, adj=None, spy=None, fundamentals=None):
    adj = market["adj"] if adj is None else adj
    return compute_daily_features(adj, adj, market["spy"] if spy is None else spy, market["sectors"],
                                  market["fundamentals"] if fundamentals is None else fundamentals)


def test_features_ignore_future_prices(market):
    """Scramble every price after a cut-off: features up to the cut-off must not move."""
    cut = market["adj"].index[900]
    base = _features(market)
    adj, spy = market["adj"].copy(), market["spy"].copy()
    rng = np.random.default_rng(1)
    adj.loc[adj.index > cut] *= rng.uniform(0.2, 5.0, size=adj.loc[adj.index > cut].shape)
    spy.loc[spy.index > cut] *= 3.0
    changed = _features(market, adj, spy)
    for name in FEATURE_NAMES:
        pd.testing.assert_frame_equal(base[name].loc[:cut], changed[name].loc[:cut], check_exact=False,
                                      rtol=1e-9, obj=name)


def test_fundamentals_are_not_used_before_they_are_filed(market):
    """A filing must not influence any feature on or before its filing date."""
    filed = market["fundamentals"]["S00"].index[10]
    altered = {t: f.copy() for t, f in market["fundamentals"].items()}
    altered["S00"].loc[filed:, "eps_ttm"] *= 100
    base, changed = _features(market), _features(market, fundamentals=altered)
    pd.testing.assert_series_equal(base["earnings_yield"]["S00"].loc[:filed],
                                   changed["earnings_yield"]["S00"].loc[:filed])
    after = base["earnings_yield"]["S00"].loc[filed + pd.Timedelta(days=5):].dropna()
    assert not after.equals(changed["earnings_yield"]["S00"].reindex(after.index))


def test_training_rows_have_labels_known_at_fit_time(market):
    daily = _features(market)
    panel = build_panel(daily, market["adj"], month_end_dates(market["adj"].index))
    for horizon, days in HORIZONS.items():
        fit_day = int(panel["t_idx"].quantile(0.7))
        train = known_by(panel, horizon, "abs", fit_day)
        assert (train["t_idx"] + days <= fit_day).all()


def test_walk_forward_never_trains_on_its_test_period(market):
    daily = _features(market)
    panel = build_panel(daily, market["adj"], month_end_dates(market["adj"].index))
    oos = walk_forward(panel, "3m", "abs", TrainConfig(fast=True, min_train_months=24))
    assert len(oos) > 0
    assert (pd.to_datetime(oos["train_end"]) < oos["date"]).all()
    # the label of the last training row must also be known before the prediction date
    gap = (oos["date"] - pd.to_datetime(oos["train_end"])).dt.days
    assert gap.min() >= 63 * 7 / 5 - 10


def test_backtest_trades_the_day_after_the_signal(market):
    """A weight chosen on day t must not earn day t's or day t+1's return."""
    prices = market["adj"][["S00"]].copy()
    signal = prices.index[100]
    prices.iloc[101] = prices.iloc[100] * 2      # a huge jump on the day after the signal
    prices.iloc[102:] = prices.iloc[101].values  # then flat
    result = simulate(prices, {signal: pd.Series({"S00": 1.0})},
                      BacktestConfig(initial=1000, cost_bps=0, slippage_bps=0))
    assert result.weights.index[0] == prices.index[101]  # traded at the next close
    assert np.isclose(result.equity.iloc[-1], 1000)       # so it missed the jump
