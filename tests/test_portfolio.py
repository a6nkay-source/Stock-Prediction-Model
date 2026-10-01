import numpy as np
import pandas as pd

from models.portfolio import PortfolioRequest, optimise, select, shrunk_covariance
from models.scoring import ai_score, confidence


def _setup(market):
    returns = market["adj"].pct_change().dropna().tail(252)
    scores = pd.Series(np.linspace(90, 20, len(market["tickers"])), index=market["tickers"])
    return returns, scores, shrunk_covariance(returns), returns.corr()


def test_constraints_are_respected(market):
    returns, scores, cov, corr = _setup(market)
    req = PortfolioRequest(max_stock=0.15, max_sector=0.40, min_holdings=8, cash=0.05)
    chosen, _ = select(scores, market["sectors"], corr, req)
    weights, _ = optimise(chosen, scores, market["sectors"], cov, req)
    assert len(chosen) >= 8
    assert weights.max() <= 0.15 + 1e-6
    assert np.isclose(weights.sum(), 0.95, atol=1e-4)
    by_sector = weights.groupby(lambda t: market["sectors"][t]).sum()
    assert by_sector.max() <= 0.40 + 1e-6


def test_avoided_sectors_are_excluded(market):
    returns, scores, cov, corr = _setup(market)
    req = PortfolioRequest(max_sector=0.6, max_stock=0.2, min_holdings=5, avoid_sectors=["Tech"])
    chosen, _ = select(scores, market["sectors"], corr, req)
    assert all(market["sectors"][t] != "Tech" for t in chosen)


def test_impossible_limits_fall_back_to_cash(market):
    returns, scores, cov, corr = _setup(market)
    req = PortfolioRequest(max_sector=0.2, max_stock=0.15, min_holdings=5)  # 3 sectors x 20% = 60%
    chosen, _ = select(scores, market["sectors"], corr, req)
    weights, notes = optimise(chosen, scores, market["sectors"], cov, req)
    assert weights.sum() <= 0.60 + 1e-6 and notes


def test_score_and_confidence_are_bounded():
    p = pd.Series({"A": 0.6, "B": 0.5, "C": 0.4})
    vol = pd.Series({"A": 0.9, "B": 0.5, "C": 0.1})
    for risk in ("conservative", "moderate", "aggressive"):
        assert ai_score(p, vol, risk).between(0, 100).all()
    assert ai_score(p, vol, "aggressive").idxmax() == "A"
    unskilled = confidence([0.8, 0.8, 0.8], 1.0, skill_auc=0.49)
    assert unskilled["value"] <= 50 and unskilled["capped_for_low_skill"]
