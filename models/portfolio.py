"""Portfolio construction: which stocks, and how much of each.

1. **Screen** — drop sectors the investor wants to avoid; give preferred sectors a
   small, explicit score bonus.
2. **Select** — pick stocks one at a time, each time taking the one with the best
   score *after* subtracting a penalty for being correlated with what is already
   chosen. This is what makes the portfolio diversified rather than a list of
   lookalikes.
3. **Weight** — mean-variance optimisation under hard limits (max per stock, max
   per sector, minimum position size, optional cash).

Nothing here is hard-coded to particular stocks or sectors: the allocation falls
out of the scores, the covariance matrix and the investor's constraints.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy.optimize import minimize
from sklearn.covariance import LedoitWolf

# How strongly each profile dislikes variance, and how many names it aims for.
RISK_PROFILES = {
    "conservative": {"aversion": 12.0, "holdings": 20},
    "moderate": {"aversion": 5.0, "holdings": 15},
    "aggressive": {"aversion": 1.5, "holdings": 10},
}
PREFERRED_SECTOR_BONUS = 5.0      # score points
CORRELATION_PENALTY = 30.0        # score points per unit of average correlation
# Assumption that converts a score into return units for the optimiser: one standard
# deviation of score among the chosen stocks is treated as 4% a year of expected
# return. It sets how hard the optimiser leans into high scores; it is not a forecast.
RETURN_PER_SCORE_SD = 0.04
MIN_POSITION = 0.02


@dataclass
class PortfolioRequest:
    amount: float = 10_000.0
    risk: str = "moderate"
    max_stock: float = 0.15
    max_sector: float = 0.30
    min_holdings: int = 8
    cash: float = 0.0
    avoid_sectors: list[str] = field(default_factory=list)
    prefer_sectors: list[str] = field(default_factory=list)
    keep_tickers: list[str] = field(default_factory=list)   # current holdings to keep


def shrunk_covariance(returns: pd.DataFrame) -> pd.DataFrame:
    """Annualised Ledoit-Wolf covariance — steadier than the raw sample estimate."""
    clean = returns.dropna(how="all").fillna(0.0)
    cov = LedoitWolf().fit(clean.to_numpy()).covariance_ * 252
    return pd.DataFrame(cov, index=returns.columns, columns=returns.columns)


def _capacity(sector_counts: dict[str, int], req: PortfolioRequest) -> float:
    """The most that can be invested given the per-stock and per-sector caps."""
    return sum(min(req.max_sector, n * req.max_stock) for n in sector_counts.values())


def select(scores: pd.Series, sectors: dict[str, str], corr: pd.DataFrame,
           req: PortfolioRequest) -> tuple[list[str], list[str]]:
    notes: list[str] = []
    pool = scores.dropna()
    pool = pool[[sectors.get(t) not in req.avoid_sectors for t in pool.index]]
    adjusted = pool + pd.Series([PREFERRED_SECTOR_BONUS if sectors.get(t) in req.prefer_sectors else 0.0
                                 for t in pool.index], index=pool.index)
    invested = 1.0 - req.cash
    n = max(RISK_PROFILES[req.risk]["holdings"], req.min_holdings, math.ceil(invested / req.max_stock - 1e-9))
    n = min(n, len(adjusted))
    chosen = [t for t in req.keep_tickers if t in adjusted.index][:n]
    per_sector_limit = max(1, math.ceil(req.max_sector / MIN_POSITION))

    def counts() -> dict[str, int]:
        out: dict[str, int] = {}
        for t in chosen:
            out[sectors.get(t, "Other")] = out.get(sectors.get(t, "Other"), 0) + 1
        return out

    while len(chosen) < len(adjusted):
        enough = len(chosen) >= n and _capacity(counts(), req) >= invested - 1e-9
        if enough:
            break
        remaining = adjusted.drop(chosen)
        if chosen:
            penalty = corr.loc[remaining.index, chosen].mean(axis=1) * CORRELATION_PENALTY
            remaining = remaining - penalty
        current = counts()
        remaining = remaining[[current.get(sectors.get(t, "Other"), 0) < per_sector_limit
                               for t in remaining.index]]
        if len(chosen) >= n:
            # Already have enough names: only a stock from a sector with spare room helps.
            remaining = remaining[[current.get(sectors.get(t, "Other"), 0) * req.max_stock < req.max_sector
                                   for t in remaining.index]]
        if remaining.empty:
            break
        chosen.append(remaining.idxmax())
    if len(chosen) > n:
        notes.append(f"Added {len(chosen) - n} extra holding(s) so the sector cap could be met.")
    return chosen, notes


def optimise(chosen: list[str], scores: pd.Series, sectors: dict[str, str], cov: pd.DataFrame,
             req: PortfolioRequest) -> tuple[pd.Series, list[str]]:
    notes: list[str] = []
    k = len(chosen)
    invested = 1.0 - req.cash
    capacity = _capacity({s: [sectors.get(t, "Other") for t in chosen].count(s)
                          for s in {sectors.get(t, "Other") for t in chosen}}, req)
    if capacity < invested - 1e-9:
        notes.append(f"Your limits only allow {capacity:.0%} to be invested with the stocks available; "
                     f"the remaining {1 - capacity:.0%} is held as cash.")
        invested = capacity
    s = scores.reindex(chosen).astype(float)
    z = (s - s.mean()) / s.std(ddof=0) if s.std(ddof=0) > 0 else s * 0
    mu = (z * RETURN_PER_SCORE_SD).to_numpy()
    sigma = cov.loc[chosen, chosen].to_numpy()
    aversion = RISK_PROFILES[req.risk]["aversion"]
    low = min(MIN_POSITION, invested / k / 2)
    bounds = [(low, req.max_stock)] * k
    constraints = [{"type": "eq", "fun": lambda w: w.sum() - invested}]
    for sector in sorted({sectors.get(t, "Other") for t in chosen}):
        mask = np.array([sectors.get(t, "Other") == sector for t in chosen], dtype=float)
        constraints.append({"type": "ineq", "fun": lambda w, m=mask: req.max_sector - w @ m})

    def objective(w):
        return -(w @ mu) + 0.5 * aversion * (w @ sigma @ w)

    start = np.full(k, invested / k)
    result = minimize(objective, start, jac=lambda w: -mu + aversion * (sigma @ w),
                      bounds=bounds, constraints=constraints, method="SLSQP",
                      options={"maxiter": 500, "ftol": 1e-10})
    weights = result.x if result.success else start
    if not result.success:
        notes.append("The optimiser did not converge; equal weights were used instead.")
    weights = np.clip(weights, 0, req.max_stock)
    return pd.Series(weights, index=chosen), notes


def portfolio_stats(weights: pd.Series, cov: pd.DataFrame, betas: pd.Series) -> dict:
    names = list(weights.index)
    w = weights.to_numpy()
    sigma = cov.loc[names, names].to_numpy()
    variance = float(w @ sigma @ w)
    vols = np.sqrt(np.diag(sigma))
    invested = w.sum()
    corr = sigma / np.outer(vols, vols)
    off_diagonal = corr[~np.eye(len(names), dtype=bool)]
    return {
        "volatility": math.sqrt(max(variance, 0.0)),
        "beta": float((weights * betas.reindex(names).fillna(1.0)).sum()),
        "diversification_ratio": float((w @ vols) / math.sqrt(variance)) if variance > 0 else None,
        "effective_holdings": float(invested ** 2 / (w ** 2).sum()) if (w ** 2).sum() > 0 else 0.0,
        "average_correlation": float(off_diagonal.mean()) if len(off_diagonal) else None,
    }
