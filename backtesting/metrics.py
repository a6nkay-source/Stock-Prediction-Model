"""Performance statistics for an equity curve."""
from __future__ import annotations

import numpy as np
import pandas as pd

TRADING_DAYS = 252


def drawdown(equity: pd.Series) -> pd.Series:
    return equity / equity.cummax() - 1.0


def performance(equity: pd.Series, risk_free: float = 0.0,
                benchmark: pd.Series | None = None) -> dict:
    """Headline statistics. ``risk_free`` is an annual rate used in Sharpe and Sortino."""
    equity = equity.dropna()
    rets = equity.pct_change().dropna()
    years = max((equity.index[-1] - equity.index[0]).days / 365.25, 1e-9)
    total = float(equity.iloc[-1] / equity.iloc[0] - 1)
    cagr = float((equity.iloc[-1] / equity.iloc[0]) ** (1 / years) - 1)
    vol = float(rets.std(ddof=1) * np.sqrt(TRADING_DAYS)) if len(rets) > 1 else 0.0
    excess = rets - risk_free / TRADING_DAYS
    sharpe = float(excess.mean() / rets.std(ddof=1) * np.sqrt(TRADING_DAYS)) if vol > 0 else 0.0
    downside = np.sqrt((np.minimum(excess, 0) ** 2).mean()) * np.sqrt(TRADING_DAYS)
    sortino = float(excess.mean() * TRADING_DAYS / downside) if downside > 0 else 0.0
    max_dd = float(drawdown(equity).min())
    monthly = equity.resample("ME").last().pct_change().dropna()
    out = {
        "start_value": float(equity.iloc[0]), "end_value": float(equity.iloc[-1]),
        "start_date": str(equity.index[0].date()), "end_date": str(equity.index[-1].date()),
        "years": float(years), "total_return": total, "annualized_return": cagr,
        "volatility": vol, "sharpe": sharpe, "sortino": sortino, "max_drawdown": max_dd,
        "calmar": float(cagr / abs(max_dd)) if max_dd < 0 else None,
        "best_month": float(monthly.max()) if len(monthly) else None,
        "worst_month": float(monthly.min()) if len(monthly) else None,
        "positive_months": float((monthly > 0).mean()) if len(monthly) else None,
    }
    if benchmark is not None:
        bench = benchmark.reindex(equity.index).pct_change().dropna()
        joined = pd.concat([rets, bench], axis=1, keys=["p", "b"]).dropna()
        if len(joined) > 20 and joined["b"].var() > 0:
            beta = float(joined["p"].cov(joined["b"]) / joined["b"].var())
            rf_daily = risk_free / TRADING_DAYS
            alpha = float(((joined["p"] - rf_daily).mean() - beta * (joined["b"] - rf_daily).mean())
                          * TRADING_DAYS)
            active = joined["p"] - joined["b"]
            tracking = float(active.std(ddof=1) * np.sqrt(TRADING_DAYS))
            bench_monthly = benchmark.reindex(equity.index).resample("ME").last().pct_change().dropna()
            both = pd.concat([monthly, bench_monthly], axis=1, keys=["p", "b"]).dropna()
            out.update(beta=beta, alpha=alpha, tracking_error=tracking,
                       information_ratio=float(active.mean() * TRADING_DAYS / tracking) if tracking > 0 else None,
                       months_beating_benchmark=float((both["p"] > both["b"]).mean()) if len(both) else None)
    return out


def yearly_returns(equity: pd.Series) -> dict[int, float]:
    yearly = equity.resample("YE").last()
    first = pd.Series([equity.iloc[0]], index=[equity.index[0] - pd.Timedelta(days=1)])
    rets = pd.concat([first, yearly]).pct_change().dropna()
    return {int(d.year): float(v) for d, v in rets.items()}
