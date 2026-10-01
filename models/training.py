"""Walk-forward training.

Models are always trained on the past and tested on the future:

    |---------- train ----------|-gap-|--- test block ---|
                                                 |---------- train ----------|-gap-|--- test ---|

The *gap* (purge) equals the prediction horizon: a 12-month label made on date
*s* is not known until *s* + 12 months, so a model fitted at date *d* may only
use samples with *s* + horizon <= *d*. Hyper-parameters are tuned inside each
training window on its own most recent slice — the test block is never touched.
"""
from __future__ import annotations

import warnings
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import FunctionTransformer, StandardScaler

from .features import FEATURE_NAMES, HORIZONS

try:  # XGBoost is optional; scikit-learn's histogram gradient boosting is the fallback
    import xgboost as xgb
    HAS_XGB = True
except Exception:  # pragma: no cover
    xgb = None
    HAS_XGB = False

BASE_MODELS = ["logistic", "random_forest", "gradient_boosting"]
MODEL_NAMES = ["baseline", *BASE_MODELS, "ensemble"]
MODEL_LABELS = {
    "baseline": "Baseline (historical base rate)",
    "logistic": "Logistic Regression",
    "random_forest": "Random Forest",
    "gradient_boosting": "Gradient Boosting (XGBoost)" if HAS_XGB else "Gradient Boosting (scikit-learn)",
    "ensemble": "Ensemble (average of the three)",
}
QUANTILES = (0.10, 0.25, 0.50, 0.75, 0.90)
TARGETS = ("abs", "rel")  # abs: return > 0.  rel: return > universe median.


def _clip(values):
    return np.clip(values, -5, 5)


@dataclass
class TrainConfig:
    refit_months: int = 12        # retrain once a year
    min_train_months: int = 60    # first model needs five years of history
    fast: bool = False            # smaller models, for tests
    n_jobs: int = -1              # threads per model (lower it when horizons train in parallel)
    seed: int = 7


def candidates(model: str, cfg: TrainConfig) -> list[tuple[dict, object]]:
    """Hyper-parameter candidates for one model family, deliberately regularised."""
    trees = 60 if cfg.fast else 200
    if model == "logistic":
        grid = [{"C": c} for c in ((0.03,) if cfg.fast else (0.0003, 0.003, 0.03, 0.3))]
        return [(p, Pipeline([
            ("impute", SimpleImputer(strategy="median", keep_empty_features=True)),
            ("scale", StandardScaler()),
            ("clip", FunctionTransformer(_clip)),
            ("model", LogisticRegression(C=p["C"], max_iter=500)),
        ])) for p in grid]
    if model == "random_forest":
        grid = [{"max_depth": 5, "min_samples_leaf": 100}]
        if not cfg.fast:
            grid += [{"max_depth": 3, "min_samples_leaf": 300}, {"max_depth": 8, "min_samples_leaf": 40}]
        return [(p, Pipeline([
            ("impute", SimpleImputer(strategy="median", keep_empty_features=True)),
            ("model", RandomForestClassifier(n_estimators=trees, max_features=0.4, max_samples=0.6,
                                             n_jobs=cfg.n_jobs, random_state=cfg.seed, **p)),
        ])) for p in grid]
    if model == "gradient_boosting":
        grid = [{"max_depth": 2, "n_estimators": 300}, {"max_depth": 1, "n_estimators": 150},
                {"max_depth": 3, "n_estimators": 200}, {"max_depth": 4, "n_estimators": 120}]
        if cfg.fast:
            grid = [{"max_depth": 2, "n_estimators": 60}]
        if HAS_XGB:
            return [(p, xgb.XGBClassifier(learning_rate=0.03, subsample=0.7, colsample_bytree=0.7,
                                          min_child_weight=30, reg_lambda=10.0, n_jobs=cfg.n_jobs,
                                          random_state=cfg.seed, eval_metric="logloss", **p))
                    for p in grid]
        return [(p, Pipeline([
            ("impute", SimpleImputer(strategy="median", keep_empty_features=True)),
            ("model", HistGradientBoostingClassifier(learning_rate=0.03, max_iter=p["n_estimators"],
                                                     max_depth=p["max_depth"], min_samples_leaf=60,
                                                     l2_regularization=5.0, random_state=cfg.seed)),
        ])) for p in grid]
    raise ValueError(model)


def _quantile_model(q: float, cfg: TrainConfig):
    # Imputing first avoids a scikit-learn binning error on columns that are entirely
    # missing (SEC fundamentals do not exist before 2009).
    return Pipeline([
        ("impute", SimpleImputer(strategy="median", keep_empty_features=True)),
        ("model", HistGradientBoostingRegressor(loss="quantile", quantile=q, max_depth=3,
                                                max_iter=40 if cfg.fast else 120, learning_rate=0.05,
                                                min_samples_leaf=60, l2_regularization=1.0,
                                                random_state=cfg.seed)),
    ])


def target_column(horizon: str, target: str) -> str:
    return f"{'fwd' if target == 'abs' else 'rel'}_{horizon}"


def known_by(panel: pd.DataFrame, horizon: str, target: str, t_idx: int) -> pd.DataFrame:
    """Rows whose label was fully observable on trading day ``t_idx`` (the purge)."""
    col = target_column(horizon, target)
    mask = (panel["t_idx"] + HORIZONS[horizon] <= t_idx) & panel[col].notna()
    return panel[mask]


def _inner_split(train: pd.DataFrame, horizon: str):
    """Most recent 25% of training dates for validation, purged from the rest."""
    dates = np.sort(train["date"].unique())
    if len(dates) < 24:
        return None
    cut = dates[int(len(dates) * 0.75)]
    val = train[train["date"] >= cut]
    cut_idx = val["t_idx"].min()
    fit = train[train["t_idx"] + HORIZONS[horizon] <= cut_idx]
    if len(fit) < 500 or val.empty or fit.empty:
        return None
    return fit, val


@dataclass
class FittedModels:
    horizon: str
    target: str
    models: dict = field(default_factory=dict)       # name -> fitted estimator
    params: dict = field(default_factory=dict)       # name -> chosen hyper-parameters
    quantiles: dict = field(default_factory=dict)    # q -> fitted regressor
    widen: dict = field(default_factory=dict)        # (low q, high q) -> conformal correction
    n_train: int = 0
    train_end: str = ""

    def predict(self, frame: pd.DataFrame) -> pd.DataFrame:
        X = frame[FEATURE_NAMES]
        out = pd.DataFrame(index=frame.index)
        for name in ["baseline", *BASE_MODELS]:
            out[f"p_{name}"] = self.models[name].predict_proba(X)[:, 1]
        out["p_ensemble"] = out[[f"p_{m}" for m in BASE_MODELS]].mean(axis=1)
        if self.quantiles:
            raw = np.column_stack([self.quantiles[q].predict(X) for q in QUANTILES])
            raw.sort(axis=1)  # quantile models are fitted separately; enforce ordering
            for i, q in enumerate(QUANTILES):
                out[f"q{int(q * 100)}"] = raw[:, i]
            for (low, high), extra in self.widen.items():
                out[f"q{int(low * 100)}"] -= extra
                out[f"q{int(high * 100)}"] += extra
            out["q25"] = out["q25"].clip(lower=out["q10"], upper=out["q50"])
            out["q75"] = out["q75"].clip(lower=out["q50"], upper=out["q90"])
        return out


def fit_models(train: pd.DataFrame, horizon: str, target: str, cfg: TrainConfig) -> FittedModels:
    """Tune on the tail of ``train`` and refit each model on all of it."""
    col = target_column(horizon, target)
    X, y = train[FEATURE_NAMES], (train[col] > 0).astype(int)
    fitted = FittedModels(horizon, target, n_train=len(train),
                          train_end=str(pd.Timestamp(train["date"].max()).date()))
    fitted.models["baseline"] = DummyClassifier(strategy="prior").fit(X, y)
    split = _inner_split(train, horizon)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        for name in BASE_MODELS:
            options = candidates(name, cfg)
            best = 0
            if split is not None and len(options) > 1:
                fit, val = split
                y_fit, y_val = (fit[col] > 0).astype(int), (val[col] > 0).astype(int)
                if y_fit.nunique() == 2 and y_val.nunique() == 2:
                    losses = []
                    for _, estimator in options:
                        estimator.fit(fit[FEATURE_NAMES], y_fit)
                        prob = estimator.predict_proba(val[FEATURE_NAMES])[:, 1]
                        losses.append(log_loss(y_val, np.clip(prob, 1e-4, 1 - 1e-4)))
                    best = int(np.argmin(losses))
            params, _ = options[best]
            estimator = candidates(name, cfg)[best][1]  # fresh, unfitted copy
            fitted.models[name] = estimator.fit(X, y)
            fitted.params[name] = params
        if target == "abs":
            if split is not None:
                fitted.widen = _conformal_widths(*split, col, cfg)
            for q in QUANTILES:
                fitted.quantiles[q] = _quantile_model(q, cfg).fit(X, train[col])
    return fitted


def _conformal_widths(fit: pd.DataFrame, val: pd.DataFrame, col: str, cfg: TrainConfig) -> dict:
    """Conformalised quantile regression (Romano et al., 2019).

    Raw quantile models tend to produce ranges that are too narrow. Measure how far
    realised returns fell outside the range on held-out *training* data and widen
    (or narrow) the range by that amount. Still no test data involved.
    """
    preds = {q: _quantile_model(q, cfg).fit(fit[FEATURE_NAMES], fit[col]).predict(val[FEATURE_NAMES])
             for q in QUANTILES if q != 0.5}
    actual = val[col].to_numpy()
    out = {}
    for low, high in ((0.10, 0.90), (0.25, 0.75)):
        miss = np.maximum(preds[low] - actual, actual - preds[high])
        out[(low, high)] = float(np.quantile(miss, high - low))
    return out


def walk_forward(panel: pd.DataFrame, horizon: str, target: str,
                 cfg: TrainConfig | None = None, log=None) -> pd.DataFrame:
    """Out-of-sample predictions for every date after the initial training window."""
    cfg = cfg or TrainConfig()
    col = target_column(horizon, target)
    dates = np.sort(panel["date"].unique())
    first_idx = panel.groupby("date")["t_idx"].first()
    pieces = []
    for start in range(cfg.min_train_months, len(dates), cfg.refit_months):
        block = dates[start:start + cfg.refit_months]
        train = known_by(panel, horizon, target, int(first_idx[block[0]]))
        if len(train) < 500 or (train[col] > 0).nunique() < 2:
            continue
        fitted = fit_models(train, horizon, target, cfg)
        test = panel[panel["date"].isin(block)]
        pred = fitted.predict(test)
        pred.insert(0, "date", test["date"].values)
        pred.insert(1, "ticker", test["ticker"].values)
        pred["actual"] = test[col].values
        pred["train_end"] = fitted.train_end
        pieces.append(pred)
        if log:
            log(f"  {horizon}/{target}: trained through {fitted.train_end} on {len(train):,} rows "
                f"-> predicted {pd.Timestamp(block[0]).date()}..{pd.Timestamp(block[-1]).date()}")
    if not pieces:
        return pd.DataFrame()
    out = pd.concat(pieces, ignore_index=True)
    out.insert(2, "horizon", horizon)
    out.insert(3, "target", target)
    return out
