"""Turning model output into reasons a person can read.

Contributions are exact for the logistic model (coefficient x standardised value)
and TreeSHAP values for XGBoost; the two are averaged. They are in log-odds and
converted to approximate probability points for display.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .features import FEATURE_META, FEATURE_NAMES
from .training import HAS_XGB, FittedModels

if HAS_XGB:
    import xgboost as xgb


def local_contributions(fitted: FittedModels, frame: pd.DataFrame) -> pd.DataFrame:
    """Per-row, per-feature push on the prediction, in log-odds."""
    X = frame[FEATURE_NAMES]
    logistic = fitted.models["logistic"]
    z = logistic[:-1].transform(X)
    parts = [np.asarray(z) * logistic[-1].coef_[0]]
    booster = fitted.models["gradient_boosting"]
    if HAS_XGB and hasattr(booster, "get_booster"):
        shap = booster.get_booster().predict(xgb.DMatrix(X), pred_contribs=True)
        parts.append(shap[:, :-1])
    return pd.DataFrame(np.mean(parts, axis=0), index=frame.index, columns=FEATURE_NAMES)


def global_importance(fitted: FittedModels, sample: pd.DataFrame) -> dict[str, dict[str, float]]:
    """Normalised feature importance per model plus their average."""
    out: dict[str, pd.Series] = {}
    logistic = fitted.models["logistic"]
    out["logistic"] = pd.Series(np.abs(logistic[-1].coef_[0]), index=FEATURE_NAMES)
    out["random_forest"] = pd.Series(fitted.models["random_forest"][-1].feature_importances_,
                                     index=FEATURE_NAMES)
    booster = fitted.models["gradient_boosting"]
    if HAS_XGB and hasattr(booster, "get_booster"):
        shap = booster.get_booster().predict(xgb.DMatrix(sample[FEATURE_NAMES]), pred_contribs=True)
        out["gradient_boosting"] = pd.Series(np.abs(shap[:, :-1]).mean(axis=0), index=FEATURE_NAMES)
    normalised = {name: s / s.sum() if s.sum() > 0 else s for name, s in out.items()}
    normalised["average"] = pd.concat(normalised, axis=1).mean(axis=1)
    return {name: {k: float(v) for k, v in s.items()} for name, s in normalised.items()}


def format_value(name: str, value: float | None) -> str:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return "Data unavailable"
    kind = FEATURE_META[name].kind
    if kind == "pct":
        return f"{value * 100:+.1f}%" if "vol" not in name and name != "net_margin" else f"{value * 100:.1f}%"
    if kind == "rank":
        return f"{value * 100:.0f}th percentile"
    return f"{value:.2f}"


def _level(percentile: float | None) -> str:
    if percentile is None or np.isnan(percentile):
        return ""
    if percentile >= 0.8:
        return "Very high"
    if percentile >= 0.6:
        return "Above-average"
    if percentile > 0.4:
        return "Average"
    if percentile > 0.2:
        return "Below-average"
    return "Very low"


# Rank features read better as a comparison with peers: (high, low, middle).
RANK_HEADLINES = {
    "mom_12_1_rank": ("Stronger momentum than most peers", "Weaker momentum than most peers", "Mid-pack momentum"),
    "ret_1m_rank": ("Stronger last month than most peers", "Weaker last month than most peers", "Mid-pack last month"),
    "vol_3m_rank": ("More volatile than most peers", "Less volatile than most peers", "Typical volatility for the universe"),
    "earnings_yield_rank": ("Cheaper than most peers on earnings", "Pricier than most peers on earnings", "Mid-pack valuation"),
    "revenue_growth_rank": ("Faster revenue growth than most peers", "Slower revenue growth than most peers", "Mid-pack revenue growth"),
}


def factor_list(contributions: dict[str, float], values: dict[str, float | None],
                percentiles: dict[str, float | None], probability: float) -> list[dict]:
    """Every feature's effect, largest first, with a plain-language headline."""
    slope = max(probability * (1 - probability), 0.05)  # d(prob)/d(log-odds)
    factors = []
    for name, push in contributions.items():
        meta = FEATURE_META[name]
        value = values.get(name)
        missing = value is None or (isinstance(value, float) and np.isnan(value))
        pct = percentiles.get(name)
        if name in RANK_HEADLINES and not missing:
            high, low, middle = RANK_HEADLINES[name]
            headline = high if value >= 0.6 else low if value <= 0.4 else middle
        elif meta.family == "Market conditions" or missing:
            headline = meta.label
        elif name == "dist_52w_high":
            headline = ("Trading near its 52-week high" if value > -0.05 else
                        "Far below its 52-week high" if value < -0.20 else "Below its 52-week high")
        else:
            label = meta.label
            if len(label) > 1 and label[1].islower():   # keep acronyms such as EPS and RSI intact
                label = label[0].lower() + label[1:]
            headline = f"{_level(pct)} {label}".strip()
        factors.append({
            "feature": name, "label": meta.label, "family": meta.family, "headline": headline,
            "value": None if missing else float(value), "value_text": format_value(name, value),
            "percentile": None if pct is None or np.isnan(pct) else float(pct),
            "contribution": float(push), "points": float(push * slope * 100),
            "direction": "positive" if push > 0 else "negative",
            "description": meta.description, "missing": bool(missing),
        })
    factors.sort(key=lambda f: -abs(f["contribution"]))
    return factors


def family_summary(factors: list[dict]) -> list[dict]:
    totals: dict[str, float] = {}
    for f in factors:
        totals[f["family"]] = totals.get(f["family"], 0.0) + f["points"]
    return sorted(({"family": k, "points": v} for k, v in totals.items()), key=lambda r: -abs(r["points"]))


def reasoning(ticker: str, name: str, horizon_text: str, p_up: float, p_beat: float,
              base_rate: float | None, low: float | None, high: float | None,
              factors: list[dict], spread: float, skill: dict) -> list[str]:
    """A short, plain-English account of the prediction and how far to trust it."""
    lines = []
    sentence = (f"The ensemble estimates a {p_up:.0%} chance that {name} ({ticker}) has a positive "
                f"return over the next {horizon_text}")
    if base_rate is not None:
        gap = p_up - base_rate
        relation = "about the same as" if abs(gap) < 0.03 else ("above" if gap > 0 else "below")
        sentence += (f". Historically {base_rate:.0%} of all stock-periods in this universe were "
                     f"positive, so this is {relation} the typical stock")
    lines.append(sentence + ".")
    lean = "more likely than not to beat" if p_beat > 0.52 else (
        "less likely than not to beat" if p_beat < 0.48 else "roughly a coin flip against")
    lines.append(f"Against its peers, the model puts the chance of beating the median stock at "
                 f"{p_beat:.0%} — {lean} the universe.")
    if low is not None and high is not None:
        lines.append(f"The central 80% range of outcomes it expects is {low:+.0%} to {high:+.0%}. "
                     "That width is the point: the model is far from sure.")
    ups = [f for f in factors if f["direction"] == "positive" and not f["missing"]][:3]
    downs = [f for f in factors if f["direction"] == "negative" and not f["missing"]][:3]
    if ups:
        lines.append("What helps most: " + "; ".join(
            f"{f['headline']} ({f['value_text']})" for f in ups) + ".")
    if downs:
        lines.append("What hurts most: " + "; ".join(
            f"{f['headline']} ({f['value_text']})" for f in downs) + ".")
    if spread >= 0.08:
        lines.append(f"The three models disagree noticeably (their estimates span {spread * 100:.0f} "
                     "points), which lowers confidence.")
    else:
        lines.append(f"The three models broadly agree (their estimates span {spread * 100:.0f} points).")
    accuracy, naive = skill.get("accuracy"), skill.get("naive_accuracy")
    if accuracy is not None and naive is not None:
        verdict = ("That is no better than always guessing 'up', so the direction call on its own "
                   "has shown no real skill." if accuracy <= naive + 0.005 else
                   "That is only a small edge over always guessing 'up'.")
        lines.append(f"Track record: in walk-forward testing this model called the direction "
                     f"correctly {accuracy:.1%} of the time at this horizon, versus {naive:.1%} for "
                     f"always guessing 'up'. {verdict}")
    return lines
