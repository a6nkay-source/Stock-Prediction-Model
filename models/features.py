"""Feature engineering.

The one rule that matters: every feature for date *t* is computed only from data
available on or before *t*. Rolling windows look backwards; fundamentals are
joined on their SEC filing date. ``tests/test_no_lookahead.py`` enforces this by
corrupting future data and checking that past features do not change.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

HORIZONS = {"1m": 21, "3m": 63, "6m": 126, "12m": 252}  # trading days
TRADING_DAYS = 252


@dataclass(frozen=True)
class Feature:
    name: str
    label: str
    family: str
    kind: str          # "pct" | "ratio" | "num"
    description: str


FEATURES: tuple[Feature, ...] = (
    Feature("ret_1m", "1-month return", "Momentum", "pct", "Price change over the last 21 trading days."),
    Feature("ret_3m", "3-month return", "Momentum", "pct", "Price change over the last 63 trading days."),
    Feature("ret_6m", "6-month return", "Momentum", "pct", "Price change over the last 126 trading days."),
    Feature("ret_12m", "12-month return", "Momentum", "pct", "Price change over the last 252 trading days."),
    Feature("mom_12_1", "12-1 month momentum", "Momentum", "pct",
            "Return from 12 months ago to 1 month ago — the classic momentum factor, skipping the most recent month."),
    Feature("mom_12_1_rank", "Momentum rank vs peers", "Momentum", "rank",
            "Where this stock's 12-1 momentum ranks in the universe (0 = weakest, 1 = strongest)."),
    Feature("ret_1m_rank", "1-month return rank vs peers", "Momentum", "rank",
            "Where the last month's return ranks in the universe."),
    Feature("px_sma50", "Price vs 50-day average", "Trend", "pct", "How far the price is above or below its 50-day moving average."),
    Feature("px_sma200", "Price vs 200-day average", "Trend", "pct", "How far the price is above or below its 200-day moving average."),
    Feature("dist_52w_high", "Distance from 52-week high", "Trend", "pct", "How far the price is below its highest level of the past year."),
    Feature("rsi_14", "RSI (14-day)", "Trend", "num", "Relative Strength Index: above 70 is often called overbought, below 30 oversold."),
    Feature("vol_1m", "1-month volatility", "Risk", "pct", "Annualised standard deviation of daily returns over 21 days."),
    Feature("vol_3m", "3-month volatility", "Risk", "pct", "Annualised standard deviation of daily returns over 63 days."),
    Feature("vol_12m", "12-month volatility", "Risk", "pct", "Annualised standard deviation of daily returns over 252 days."),
    Feature("vol_3m_rank", "Volatility rank vs peers", "Risk", "rank", "Where 3-month volatility ranks in the universe (1 = most volatile)."),
    Feature("mdd_12m", "12-month max drawdown", "Risk", "pct", "Largest peak-to-trough fall over the past year."),
    Feature("beta_12m", "Beta (12-month)", "Risk", "num", "Sensitivity to the S&P 500: 1.0 moves with the market, above 1 moves more."),
    Feature("rel_mom_sector", "6-month return vs sector", "Sector", "pct", "6-month return minus the average of its sector peers."),
    Feature("sector_ret_3m", "Sector 3-month return", "Sector", "pct", "Average 3-month return of the stock's sector."),
    Feature("sector_ret_6m", "Sector 6-month return", "Sector", "pct", "Average 6-month return of the stock's sector."),
    Feature("mkt_ret_1m", "Market 1-month return", "Market conditions", "pct", "S&P 500 return over the last month."),
    Feature("mkt_ret_6m", "Market 6-month return", "Market conditions", "pct", "S&P 500 return over the last six months."),
    Feature("mkt_vol_1m", "Market volatility", "Market conditions", "pct", "Annualised S&P 500 volatility over the last month."),
    Feature("mkt_px_sma200", "Market vs 200-day average", "Market conditions", "pct", "Whether the S&P 500 is above or below its long-term trend."),
    Feature("mkt_breadth", "Market breadth", "Market conditions", "pct", "Share of stocks in the universe trading above their 200-day average."),
    Feature("earnings_yield", "Earnings yield (E/P)", "Valuation", "pct",
            "Trailing 12-month EPS divided by price — the inverse of P/E. Higher means cheaper."),
    Feature("earnings_yield_rank", "Valuation rank vs peers", "Valuation", "rank", "Where earnings yield ranks in the universe (1 = cheapest)."),
    Feature("eps_growth", "EPS growth (YoY)", "Growth", "pct", "Year-over-year change in trailing 12-month diluted EPS, from SEC filings."),
    Feature("revenue_growth", "Revenue growth (YoY)", "Growth", "pct", "Year-over-year change in trailing 12-month revenue, from SEC filings."),
    Feature("revenue_growth_rank", "Revenue growth rank vs peers", "Growth", "rank", "Where revenue growth ranks in the universe."),
    Feature("net_margin", "Net profit margin", "Profitability", "pct", "Trailing 12-month net income divided by revenue."),
)
FEATURE_NAMES = [f.name for f in FEATURES]
FEATURE_META = {f.name: f for f in FEATURES}


def _rsi(close: pd.DataFrame, window: int = 14) -> pd.DataFrame:
    delta = close.diff()
    gain = delta.clip(lower=0).ewm(alpha=1 / window, min_periods=window).mean()
    loss = (-delta.clip(upper=0)).ewm(alpha=1 / window, min_periods=window).mean()
    return 100 - 100 / (1 + gain / loss.replace(0, np.nan))


def _rolling_max_drawdown(close: pd.DataFrame, window: int = 252) -> pd.DataFrame:
    """Worst peak-to-trough decline inside each trailing window."""
    out = {}
    for col in close:
        values = close[col].to_numpy(dtype=float)
        result = np.full(len(values), np.nan)
        if len(values) >= window:
            view = np.lib.stride_tricks.sliding_window_view(values, window)
            peaks = np.maximum.accumulate(view, axis=1)
            with np.errstate(invalid="ignore"):
                result[window - 1:] = (view / peaks - 1.0).min(axis=1)
        out[col] = result
    return pd.DataFrame(out, index=close.index)


def daily_fundamentals(fundamentals: dict[str, pd.DataFrame], index: pd.DatetimeIndex,
                       column: str) -> pd.DataFrame:
    """Forward-fill filing-dated values onto trading days (known the day after filing)."""
    out = {}
    for ticker, frame in fundamentals.items():
        if frame is None or frame.empty or column not in frame:
            out[ticker] = pd.Series(np.nan, index=index)
            continue
        series = frame[column].dropna()
        series.index = series.index + pd.Timedelta(days=1)  # filings can land after the close
        series = series[~series.index.duplicated(keep="last")]
        # A value is used for at most ~15 months; older than that is treated as missing.
        out[ticker] = series.reindex(index.union(series.index)).ffill(limit=320).reindex(index)
    return pd.DataFrame(out, index=index)


def compute_daily_features(adj_close: pd.DataFrame, close: pd.DataFrame, market: pd.Series,
                           sectors: dict[str, str],
                           fundamentals: dict[str, pd.DataFrame]) -> dict[str, pd.DataFrame]:
    """All features as date x ticker frames. Row *t* uses data up to and including *t*."""
    px = adj_close
    rets = px.pct_change(fill_method=None)
    mkt_rets = market.pct_change(fill_method=None)
    ann = np.sqrt(TRADING_DAYS)
    f: dict[str, pd.DataFrame] = {}

    for name, days in (("ret_1m", 21), ("ret_3m", 63), ("ret_6m", 126), ("ret_12m", 252)):
        f[name] = px / px.shift(days) - 1
    f["mom_12_1"] = px.shift(21) / px.shift(252) - 1
    f["px_sma50"] = px / px.rolling(50).mean() - 1
    f["px_sma200"] = px / px.rolling(200).mean() - 1
    f["dist_52w_high"] = px / px.rolling(252).max() - 1
    f["rsi_14"] = _rsi(px)
    f["vol_1m"] = rets.rolling(21).std() * ann
    f["vol_3m"] = rets.rolling(63).std() * ann
    f["vol_12m"] = rets.rolling(252).std() * ann
    f["mdd_12m"] = _rolling_max_drawdown(px)
    cov = rets.rolling(252, min_periods=200).cov(mkt_rets)
    f["beta_12m"] = cov.div(mkt_rets.rolling(252, min_periods=200).var(), axis=0)

    sector_series = pd.Series(sectors).reindex(px.columns)
    for name, source in (("sector_ret_3m", "ret_3m"), ("sector_ret_6m", "ret_6m")):
        means = f[source].T.groupby(sector_series).mean().T
        f[name] = means.reindex(columns=sector_series.values).set_axis(px.columns, axis=1)
        f[name] = f[name].where(px.notna())
    f["rel_mom_sector"] = f["ret_6m"] - f["sector_ret_6m"]

    live = px.notna()
    breadth = (f["px_sma200"] > 0).sum(axis=1) / f["px_sma200"].notna().sum(axis=1).replace(0, np.nan)
    market_features = {
        "mkt_ret_1m": market / market.shift(21) - 1,
        "mkt_ret_6m": market / market.shift(126) - 1,
        "mkt_vol_1m": mkt_rets.rolling(21).std() * ann,
        "mkt_px_sma200": market / market.rolling(200).mean() - 1,
        "mkt_breadth": breadth,
    }
    for name, series in market_features.items():
        f[name] = pd.DataFrame({c: series for c in px.columns}).where(live)

    eps = daily_fundamentals(fundamentals, px.index, "eps_ttm")
    yield_ = eps / close
    f["earnings_yield"] = yield_.where(yield_.abs() < 0.5)  # drop per-share data on another share class
    f["eps_growth"] = daily_fundamentals(fundamentals, px.index, "eps_growth").clip(-3, 5)
    f["revenue_growth"] = daily_fundamentals(fundamentals, px.index, "revenue_growth").clip(-1, 3)
    f["net_margin"] = daily_fundamentals(fundamentals, px.index, "net_margin").clip(-1, 1)

    for name, source in (("mom_12_1_rank", "mom_12_1"), ("ret_1m_rank", "ret_1m"),
                         ("vol_3m_rank", "vol_3m"), ("earnings_yield_rank", "earnings_yield"),
                         ("revenue_growth_rank", "revenue_growth")):
        f[name] = f[source].rank(axis=1, pct=True)

    return {name: f[name] for name in FEATURE_NAMES}


def month_end_dates(index: pd.DatetimeIndex) -> pd.DatetimeIndex:
    """Last trading day of each completed month."""
    series = pd.Series(index, index=index)
    ends = series.groupby([index.year, index.month]).max()
    ends = pd.DatetimeIndex(ends.values)
    # The current month is only "complete" if the calendar has moved past it.
    last = index[-1]
    if (last + pd.offsets.BDay(1)).month == last.month:
        ends = ends[ends < last]
    return ends


def build_panel(daily: dict[str, pd.DataFrame], adj_close: pd.DataFrame,
                dates: pd.DatetimeIndex) -> pd.DataFrame:
    """Long table: one row per (date, ticker) with features, forward returns and labels.

    Forward returns look into the future by design — they are the *targets*, and
    training only ever uses rows whose target was already known (see training.py).
    """
    position = pd.Series(np.arange(len(adj_close.index)), index=adj_close.index)
    stacked = {name: frame.loc[dates].stack(future_stack=True) for name, frame in daily.items()}
    panel = pd.DataFrame(stacked)
    panel.index.names = ["date", "ticker"]
    for label, days in HORIZONS.items():
        forward = (adj_close.shift(-days) / adj_close - 1).loc[dates]
        median = forward.median(axis=1)
        panel[f"fwd_{label}"] = forward.stack(future_stack=True)
        panel[f"rel_{label}"] = forward.sub(median, axis=0).stack(future_stack=True)
    panel = panel.reset_index()
    panel["t_idx"] = panel["date"].map(position).astype(int)
    # Need a year of history before a stock enters the sample.
    panel = panel[panel["ret_12m"].notna() & panel["vol_12m"].notna()]
    return panel.reset_index(drop=True)
