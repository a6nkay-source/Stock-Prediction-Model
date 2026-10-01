"""The explicit ranking formula. No hidden judgement, no popularity bonus.

    AI Score = 100 x [ (1 - w) x rank(P_outperform) + w x (1 - volatility rank) ]

``rank(P_outperform)`` is the stock's percentile, within the universe on that date,
of the ensemble's probability of beating the median stock over the chosen horizon.
``w`` is set by the investor's risk tolerance: more cautious investors give more
weight to low volatility.

The absolute-direction probability (P positive return) is shown to the user but is
*not* part of the score: in walk-forward testing it showed no skill at ranking
stocks (see the Model Performance page).
"""
from __future__ import annotations

import pandas as pd

RISK_WEIGHT = {"conservative": 0.40, "moderate": 0.20, "aggressive": 0.0}
RISK_LEVELS = (("Low", 0.20), ("Medium", 0.32))  # annualised 12-month volatility cut-offs


def ai_score(p_outperform: pd.Series, vol_rank: pd.Series, risk: str = "moderate") -> pd.Series:
    """Score 0-100 for one date. Both inputs are indexed by ticker."""
    w = RISK_WEIGHT.get(risk, RISK_WEIGHT["moderate"])
    signal = p_outperform.rank(pct=True)
    safety = 1 - vol_rank.reindex(signal.index).fillna(0.5)
    return 100 * ((1 - w) * signal + w * safety)


def risk_level(volatility: float | None) -> str:
    if volatility is None or volatility != volatility:
        return "Unknown"
    for label, cutoff in RISK_LEVELS:
        if volatility < cutoff:
            return label
    return "High"


def confidence(probabilities: list[float], completeness: float, skill_auc: float | None) -> dict:
    """A 0-100 heuristic for how consistent the signal is — NOT a chance of being right.

    45% model agreement, 35% conviction (distance from a coin flip), 20% data
    completeness. Capped at 50 when the model's walk-forward AUC at this horizon is
    no better than chance, because consistency without skill is not worth much.
    """
    spread = max(probabilities) - min(probabilities)
    mean = sum(probabilities) / len(probabilities)
    agreement = max(0.0, 1 - spread / 0.20)
    conviction = min(1.0, abs(mean - 0.5) / 0.20)
    value = 100 * (0.45 * agreement + 0.35 * conviction + 0.20 * completeness)
    capped = skill_auc is None or skill_auc <= 0.52
    if capped:
        value = min(value, 50.0)
    label = "High" if value >= 67 else "Medium" if value >= 40 else "Low"
    return {"value": round(value, 1), "label": label, "capped_for_low_skill": capped,
            "agreement": agreement, "conviction": conviction, "completeness": completeness,
            "model_spread": spread}
