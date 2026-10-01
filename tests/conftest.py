"""Synthetic market data so the tests never touch the network."""
import numpy as np
import pandas as pd
import pytest


@pytest.fixture(scope="session")
def market():
    rng = np.random.default_rng(0)
    index = pd.bdate_range("2012-01-02", periods=1500)
    tickers = [f"S{i:02d}" for i in range(12)]
    common = rng.normal(0.0004, 0.009, len(index))
    rets = {t: common * rng.uniform(0.6, 1.4) + rng.normal(0.0002, 0.012, len(index)) for t in tickers}
    adj = pd.DataFrame({t: 50 * np.exp(np.cumsum(r)) for t, r in rets.items()}, index=index)
    spy = pd.Series(100 * np.exp(np.cumsum(common)), index=index, name="SPY")
    sectors = {t: ["Tech", "Health", "Energy"][i % 3] for i, t in enumerate(tickers)}
    filed = pd.DatetimeIndex(pd.date_range("2012-02-15", periods=24, freq="91D"), name="available")
    fundamentals = {t: pd.DataFrame({
        "eps_ttm": rng.uniform(1, 5, len(filed)), "eps_growth": rng.normal(0.1, 0.2, len(filed)),
        "revenue_growth": rng.normal(0.08, 0.1, len(filed)), "net_margin": rng.uniform(0.05, 0.3, len(filed)),
    }, index=filed) for t in tickers}
    return {"adj": adj, "spy": spy, "sectors": sectors, "fundamentals": fundamentals, "tickers": tickers}
