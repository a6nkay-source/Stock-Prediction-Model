"""Honest scoring of out-of-sample predictions. Nothing here is rounded up."""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score

from .features import HORIZONS
from .training import MODEL_NAMES


def _rank_ic(frame: pd.DataFrame, prob_col: str) -> pd.Series:
    """Per-date Spearman correlation between predicted probability and realised return."""
    values = {}
    for date, group in frame.groupby("date"):
        if len(group) >= 10 and group[prob_col].nunique() > 1:
            values[date] = spearmanr(group[prob_col], group["actual"]).statistic
    return pd.Series(values, dtype=float)


def evaluate_model(frame: pd.DataFrame, model: str, horizon: str) -> dict:
    """Metrics for one model on labelled out-of-sample rows of one horizon/target."""
    frame = frame[frame["actual"].notna()]
    if frame.empty:
        return {"n": 0}
    prob = frame[f"p_{model}"].clip(1e-4, 1 - 1e-4)
    y = (frame["actual"] > 0).astype(int)
    pred = (prob >= 0.5).astype(int)
    base_rate = float(y.mean())
    out = {
        "n": int(len(frame)),
        "n_dates": int(frame["date"].nunique()),
        "accuracy": float((pred == y).mean()),
        "base_rate": base_rate,
        # Accuracy of the laziest possible forecaster: always predict the majority class.
        "naive_accuracy": max(base_rate, 1 - base_rate),
        "brier": float(brier_score_loss(y, prob)),
        "log_loss": float(log_loss(y, prob, labels=[0, 1])),
        "auc": float(roc_auc_score(y, prob)) if y.nunique() == 2 and prob.nunique() > 1 else None,
    }
    out["accuracy_lift"] = out["accuracy"] - out["naive_accuracy"]

    ic = _rank_ic(frame, f"p_{model}")
    if len(ic) > 2 and ic.std() > 0:
        t_stat = ic.mean() / ic.std(ddof=1) * np.sqrt(len(ic))
        # Monthly samples of an h-month label overlap, so the effective sample is ~1/h as large.
        overlap = max(1.0, HORIZONS[horizon] / 21)
        out.update(rank_ic=float(ic.mean()), rank_ic_t=float(t_stat),
                   rank_ic_t_adjusted=float(t_stat / np.sqrt(overlap)),
                   rank_ic_positive_share=float((ic > 0).mean()))
    else:
        out.update(rank_ic=None, rank_ic_t=None, rank_ic_t_adjusted=None, rank_ic_positive_share=None)

    by_year = frame.assign(correct=(pred == y).values, up=y.values).groupby(frame["date"].dt.year)
    out["by_year"] = [{"year": int(year), "accuracy": float(g["correct"].mean()),
                       "naive_accuracy": float(max(g["up"].mean(), 1 - g["up"].mean())),
                       "base_rate": float(g["up"].mean()), "n": int(len(g))}
                      for year, g in by_year]

    # Calibration: when the model says 70%, does it happen 70% of the time?
    if prob.nunique() > 10:
        bins = pd.qcut(prob, 10, duplicates="drop")
        grouped = pd.DataFrame({"p": prob, "y": y, "r": frame["actual"]}).groupby(bins, observed=True)
        out["calibration"] = [{"predicted": float(g["p"].mean()), "observed": float(g["y"].mean()),
                               "mean_return": float(g["r"].mean()), "n": int(len(g))}
                              for _, g in grouped]
    else:
        out["calibration"] = []

    # Do the model's favourite stocks actually beat its least favourite ones?
    def spread(group: pd.DataFrame) -> float:
        ranks = group[f"p_{model}"].rank(pct=True)
        return group.loc[ranks >= 0.8, "actual"].mean() - group.loc[ranks <= 0.2, "actual"].mean()

    if frame[f"p_{model}"].nunique() > 1:
        spreads = frame.groupby("date").apply(spread, include_groups=False).dropna()
        out["top_minus_bottom"] = float(spreads.mean()) if len(spreads) else None
    else:
        out["top_minus_bottom"] = None
    return out


def interval_coverage(frame: pd.DataFrame) -> dict:
    """How often the realised return landed inside the predicted ranges."""
    frame = frame[frame["actual"].notna() & frame["q50"].notna()]
    if frame.empty:
        return {}
    actual = frame["actual"]
    return {
        "n": int(len(frame)),
        "coverage_50": float(((actual >= frame["q25"]) & (actual <= frame["q75"])).mean()),
        "coverage_80": float(((actual >= frame["q10"]) & (actual <= frame["q90"])).mean()),
        "median_abs_error": float((actual - frame["q50"]).abs().median()),
        "mean_abs_error": float((actual - frame["q50"]).abs().mean()),
        "mean_width_50": float((frame["q75"] - frame["q25"]).mean()),
        "mean_width_80": float((frame["q90"] - frame["q10"]).mean()),
    }


def _record(row: pd.Series) -> dict:
    return {"ticker": row["ticker"], "date": str(pd.Timestamp(row["date"]).date()),
            "probability": float(row["p_ensemble"]), "predicted_median": float(row["q50"]),
            "predicted_low": float(row["q10"]), "predicted_high": float(row["q90"]),
            "actual": float(row["actual"])}


def best_and_worst(frame: pd.DataFrame) -> dict:
    """Largest miss and best call of the median forecast (absolute-return target)."""
    frame = frame[frame["actual"].notna() & frame["q50"].notna()]
    if frame.empty:
        return {"worst": None, "best": None}
    error = frame["actual"] - frame["q50"]
    worst = frame.loc[error.idxmin()]                 # reality fell furthest short of the forecast
    confident = frame[frame["p_ensemble"] >= frame["p_ensemble"].quantile(0.8)]
    best = confident.loc[confident["actual"].idxmax()]  # high-conviction call that paid off most
    return {"worst": _record(worst), "best": _record(best)}


def evaluate_all(oos: pd.DataFrame) -> dict:
    """metrics[target][horizon] = {models: {...}, intervals: {...}, extremes: {...}}"""
    out: dict = {}
    for (target, horizon), frame in oos.groupby(["target", "horizon"]):
        node = {"models": {m: evaluate_model(frame, m, horizon) for m in MODEL_NAMES},
                "first_date": str(frame["date"].min().date()),
                "last_date": str(frame["date"].max().date()),
                "last_labelled_date": str(frame.loc[frame["actual"].notna(), "date"].max().date())}
        if target == "abs":
            node["intervals"] = interval_coverage(frame)
            node["extremes"] = best_and_worst(frame)
        out.setdefault(target, {})[horizon] = node
    return out
