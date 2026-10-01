"""Build everything the app serves: data -> features -> walk-forward models -> artifacts.

    python -m backend.pipeline            # full run (about 10-20 minutes)
    python -m backend.pipeline --fast     # small models, for a quick smoke test
    python -m backend.pipeline --refresh  # ignore the cache and re-download data
"""
from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from joblib import Parallel, delayed

from backend.config import ARTIFACT_DIR
from data import store
from data.providers import get_provider
from data.universe import BENCHMARK, load_universe, sector_map, tickers
from models.evaluation import evaluate_all
from models.explain import global_importance, local_contributions
from models.features import FEATURE_NAMES, HORIZONS, build_panel, compute_daily_features, month_end_dates
from models.training import (HAS_XGB, MODEL_LABELS, TARGETS, TrainConfig, fit_models, known_by,
                             walk_forward)


def build_dataset(force: bool = False):
    prices = store.load_prices(force)
    symbols = [t for t in tickers() if t in prices.adj_close and prices.adj_close[t].notna().any()]
    fundamentals = store.load_all_fundamentals(prices, force)
    adj, close = prices.adj_close[symbols], prices.close[symbols]
    daily = compute_daily_features(adj, close, prices.adj_close[BENCHMARK], sector_map(), fundamentals)
    panel = build_panel(daily, adj, month_end_dates(adj.index))
    latest = build_panel(daily, adj, pd.DatetimeIndex([adj.index[-1]]))
    return prices, panel, latest


def _train_task(panel: pd.DataFrame, latest: pd.DataFrame, horizon: str, target: str, cfg: TrainConfig):
    """One horizon/target: walk-forward predictions, then a final model for today."""
    oos = walk_forward(panel, horizon, target, cfg)
    train = known_by(panel, horizon, target, int(latest["t_idx"].iloc[0]))
    fitted = fit_models(train, horizon, target, cfg)
    pred = fitted.predict(latest)
    pred.insert(0, "ticker", latest["ticker"].values)
    contrib = local_contributions(fitted, latest)
    contrib.insert(0, "ticker", latest["ticker"].values)
    sample = train.sample(min(len(train), 3000), random_state=cfg.seed)
    info = {"params": fitted.params, "n_train": fitted.n_train, "train_end": fitted.train_end,
            "interval_widening": {f"{int(a * 100)}-{int(b * 100)}": v for (a, b), v in fitted.widen.items()}}
    return horizon, target, oos, pred, contrib, global_importance(fitted, sample), info


def run(fast: bool = False, force_data: bool = False, log=print) -> dict:
    started = time.time()
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    log("1/5 Loading prices and SEC fundamentals ...")
    prices, panel, latest = build_dataset(force_data)
    log(f"    {panel['ticker'].nunique()} stocks, {panel['date'].nunique()} month-ends, "
        f"{len(panel):,} rows, {prices.adj_close.index[0].date()} to {prices.adj_close.index[-1].date()}")

    log("2/5 Walk-forward training (4 horizons x 2 targets) ...")
    cfg = TrainConfig(fast=fast, n_jobs=2)
    tasks = [(h, t) for h in HORIZONS for t in TARGETS]
    results = Parallel(n_jobs=4)(delayed(_train_task)(panel, latest, h, t, cfg) for h, t in tasks)

    log("3/5 Scoring out-of-sample predictions ...")
    oos = pd.concat([r[2] for r in results], ignore_index=True)
    metrics = evaluate_all(oos)

    as_of = prices.adj_close.index[-1]
    percentiles = latest.set_index("ticker")[FEATURE_NAMES].rank(pct=True)
    values = latest.set_index("ticker")[FEATURE_NAMES]
    latest_out: dict = {t: {"features": _clean(values.loc[t].to_dict()),
                            "percentiles": _clean(percentiles.loc[t].to_dict()), "horizons": {}}
                        for t in values.index}
    importance: dict = {}
    training_info: dict = {}
    for horizon, target, _, pred, contrib, imp, info in results:
        importance.setdefault(target, {})[horizon] = imp
        training_info.setdefault(target, {})[horizon] = info
        pred, contrib = pred.set_index("ticker"), contrib.set_index("ticker")
        for ticker in pred.index:
            node = latest_out[ticker]["horizons"].setdefault(horizon, {})
            node[target] = _clean(pred.loc[ticker].to_dict())
            node[f"contrib_{target}"] = _clean(contrib.loc[ticker].to_dict())

    log("4/5 Fetching current fundamentals for display ...")
    fetched = store.warm_snapshots(list(values.index))
    log(f"    {fetched}/{len(values.index)} snapshots available")

    log("5/5 Writing artifacts ...")
    oos.to_parquet(ARTIFACT_DIR / "oos.parquet")
    panel.to_parquet(ARTIFACT_DIR / "panel.parquet")
    (ARTIFACT_DIR / "latest.json").write_text(json.dumps({"as_of": str(as_of.date()), "stocks": latest_out}))
    (ARTIFACT_DIR / "metrics.json").write_text(json.dumps(metrics))
    (ARTIFACT_DIR / "importance.json").write_text(json.dumps(importance))
    meta = {
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "as_of": str(as_of.date()),
        "price_start": str(prices.adj_close.index[0].date()),
        "first_prediction": str(oos["date"].min().date()),
        "n_stocks": int(panel["ticker"].nunique()),
        "n_rows": int(len(panel)),
        "n_features": len(FEATURE_NAMES),
        "provider": get_provider().name,
        "fundamentals_source": "SEC EDGAR XBRL company facts (filing-dated)",
        "xgboost": HAS_XGB,
        "model_labels": MODEL_LABELS,
        "fast_mode": fast,
        "refit_months": cfg.refit_months,
        "min_train_months": cfg.min_train_months,
        "training": training_info,
        "fundamentals_coverage": float(panel["earnings_yield"].notna().mean()),
        "elapsed_seconds": round(time.time() - started, 1),
        "universe": [{"ticker": s.ticker, "name": s.name, "sector": s.sector} for s in load_universe()],
    }
    (ARTIFACT_DIR / "meta.json").write_text(json.dumps(meta))
    log(f"Done in {meta['elapsed_seconds']:.0f}s.")
    return meta


def _clean(mapping: dict) -> dict:
    """JSON has no NaN; missing values become null and render as 'Data unavailable'."""
    out = {}
    for key, value in mapping.items():
        if isinstance(value, (float, np.floating)):
            out[key] = None if not np.isfinite(value) else float(value)
        elif isinstance(value, (np.integer,)):
            out[key] = int(value)
        else:
            out[key] = value
    return out


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--fast", action="store_true", help="small models for a quick smoke test")
    parser.add_argument("--refresh", action="store_true", help="re-download data, ignoring the cache")
    args = parser.parse_args()
    run(fast=args.fast, force_data=args.refresh)
