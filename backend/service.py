"""Everything the API serves, computed from the pipeline's artifacts."""
from __future__ import annotations

import json
import math
from functools import lru_cache

import numpy as np
import pandas as pd

from backend import sentiment
from backend.config import ARTIFACT_DIR, RISK_FREE_RATE
from backtesting.engine import BacktestConfig, simulate
from backtesting.metrics import drawdown, performance, yearly_returns
from backtesting.strategy import equal_weights, top_n_weights
from data import store
from data.universe import BENCHMARK, get_stock, load_universe, sector_map
from models import explain
from models.features import FEATURE_META, FEATURE_NAMES, FEATURES, HORIZONS
from models.portfolio import (CORRELATION_PENALTY, PREFERRED_SECTOR_BONUS, PortfolioRequest, optimise,
                              portfolio_stats, select, shrunk_covariance)
from models.scoring import RISK_WEIGHT, ai_score, confidence, risk_level
from models.training import BASE_MODELS, MODEL_NAMES

HORIZON_TEXT = {"1m": "month", "3m": "3 months", "6m": "6 months", "12m": "12 months"}
NEVER = 1e9  # cache TTL meaning "use what is on disk"


class NotReady(RuntimeError):
    """Raised when the pipeline has not produced artifacts yet."""


# ----------------------------------------------------------------- artifacts

class Artifacts:
    def __init__(self) -> None:
        self._stamp = None

    def _load(self) -> None:
        meta_path = ARTIFACT_DIR / "meta.json"
        if not meta_path.exists():
            raise NotReady("Run `python -m backend.pipeline` to build the models first.")
        stamp = meta_path.stat().st_mtime
        if stamp == self._stamp:
            return
        self.meta = json.loads(meta_path.read_text())
        self.metrics = json.loads((ARTIFACT_DIR / "metrics.json").read_text())
        self.importance = json.loads((ARTIFACT_DIR / "importance.json").read_text())
        self.latest = json.loads((ARTIFACT_DIR / "latest.json").read_text())
        self.oos = pd.read_parquet(ARTIFACT_DIR / "oos.parquet")
        self.panel = pd.read_parquet(ARTIFACT_DIR / "panel.parquet")
        self.prices = store.load_prices(ttl_hours=NEVER)
        self._stamp = stamp
        _backtest_cached.cache_clear()

    def get(self) -> "Artifacts":
        self._load()
        return self


_artifacts = Artifacts()


def art() -> Artifacts:
    return _artifacts.get()


def is_ready() -> bool:
    return (ARTIFACT_DIR / "meta.json").exists()


def _num(value):
    """JSON-safe number: NaN/inf become None, which the UI shows as 'Data unavailable'."""
    if value is None:
        return None
    try:
        value = float(value)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def _skill(a: Artifacts, target: str, horizon: str, model: str = "ensemble") -> dict:
    node = a.metrics.get(target, {}).get(horizon, {}).get("models", {}).get(model, {})
    return {k: node.get(k) for k in ("n", "n_dates", "accuracy", "naive_accuracy", "accuracy_lift",
                                     "base_rate", "auc", "brier", "rank_ic", "rank_ic_t_adjusted",
                                     "top_minus_bottom")}


# ------------------------------------------------------------- price metrics

def _trailing_return(series: pd.Series, days: int):
    series = series.dropna()
    if len(series) <= days:
        return None
    return _num(series.iloc[-1] / series.iloc[-1 - days] - 1)


def price_metrics(a: Artifacts, ticker: str) -> dict:
    series = a.prices.adj_close[ticker].dropna()
    rets = series.pct_change().dropna()
    year = series.tail(253)
    out = {
        "price": _num(a.prices.close[ticker].dropna().iloc[-1]),
        "returns": {"1m": _trailing_return(series, 21), "3m": _trailing_return(series, 63),
                    "6m": _trailing_return(series, 126), "1y": _trailing_return(series, 252),
                    "3y": _trailing_return(series, 756)},
        "volatility": _num(rets.tail(252).std() * math.sqrt(252)) if len(rets) >= 60 else None,
        "max_drawdown_1y": _num(drawdown(year).min()) if len(year) > 20 else None,
        "max_drawdown_all": _num(drawdown(series).min()),
        "history_start": str(series.index[0].date()),
    }
    out["risk_level"] = risk_level(out["volatility"])
    return out


# --------------------------------------------------------------- predictions

def _stock_prediction(a: Artifacts, ticker: str, horizon: str) -> dict | None:
    node = a.latest["stocks"].get(ticker)
    if not node or horizon not in node["horizons"]:
        return None
    h = node["horizons"][horizon]
    abs_, rel = h.get("abs", {}), h.get("rel", {})
    feature_values = node["features"]
    completeness = sum(v is not None for v in feature_values.values()) / len(feature_values)
    probs = [abs_.get(f"p_{m}") for m in BASE_MODELS]
    skill = _skill(a, "abs", horizon)
    return {
        "p_up": abs_.get("p_ensemble"), "p_beat": rel.get("p_ensemble"),
        "p_up_models": {m: abs_.get(f"p_{m}") for m in MODEL_NAMES},
        "p_beat_models": {m: rel.get(f"p_{m}") for m in MODEL_NAMES},
        "range": {k: abs_.get(k) for k in ("q10", "q25", "q50", "q75", "q90")},
        "confidence": confidence(probs, completeness, skill.get("auc")),
        "base_rate": abs_.get("p_baseline"),
        "data_completeness": completeness,
    }


def _scores(a: Artifacts, horizon: str, risk: str) -> pd.Series:
    stocks = a.latest["stocks"]
    p = pd.Series({t: n["horizons"].get(horizon, {}).get("rel", {}).get("p_ensemble")
                   for t, n in stocks.items()}, dtype=float)
    vol_rank = pd.Series({t: n["features"].get("vol_3m_rank") for t, n in stocks.items()}, dtype=float)
    return ai_score(p.dropna(), vol_rank, risk)


def _factors(a: Artifacts, ticker: str, horizon: str, target: str, probability: float) -> list[dict]:
    node = a.latest["stocks"][ticker]
    contributions = node["horizons"][horizon].get(f"contrib_{target}", {})
    return explain.factor_list(contributions, node["features"], node["percentiles"], probability or 0.5)


def predictions(horizon: str = "6m", risk: str = "moderate") -> dict:
    a = art()
    scores = _scores(a, horizon, risk)
    sectors = sector_map()
    rows = []
    for ticker, score in scores.sort_values(ascending=False).items():
        stock = get_stock(ticker)
        pred = _stock_prediction(a, ticker, horizon)
        metrics = price_metrics(a, ticker)
        feats = a.latest["stocks"][ticker]["features"]
        snap = store.cached_snapshot(ticker)
        factors = _factors(a, ticker, horizon, "rel", pred["p_beat"])
        usable = [f for f in factors if not f["missing"]]
        ey = feats.get("earnings_yield")
        rows.append({
            "ticker": ticker, "name": stock.name if stock else ticker, "sector": sectors.get(ticker),
            "score": _num(score), **pred, **metrics,
            "beta": _num(feats.get("beta_12m")),
            "pe": _num(1 / ey) if ey and ey > 0 else _num(snap.get("pe_trailing")),
            "eps_growth": _num(feats.get("eps_growth")),
            "revenue_growth": _num(feats.get("revenue_growth")),
            "profit_margin": _num(feats.get("net_margin")),
            "market_cap": _num(snap.get("market_cap")),
            "dividend_yield": _num(snap.get("dividend_yield")),
            "debt_to_equity": _num(snap.get("debt_to_equity")),
            "free_cash_flow": _num(snap.get("free_cash_flow")),
            "top_positive": [f["headline"] for f in usable if f["direction"] == "positive"][:3],
            "top_negative": [f["headline"] for f in usable if f["direction"] == "negative"][:3],
        })
    for i, row in enumerate(rows, 1):
        row["rank"] = i
    return {
        "as_of": a.latest["as_of"], "horizon": horizon, "risk": risk,
        "risk_weight": RISK_WEIGHT[risk],
        "skill": {"abs": _skill(a, "abs", horizon), "rel": _skill(a, "rel", horizon)},
        "intervals": a.metrics.get("abs", {}).get(horizon, {}).get("intervals", {}),
        "rows": rows,
    }


# -------------------------------------------------------------- stock detail

def _news(ticker: str) -> tuple[list[dict], dict | None]:
    items = []
    for item in store.load_news(ticker):
        text = f"{item.get('title', '')}. {item.get('summary', '')}"
        items.append({**item, "summary": (item.get("summary") or "")[:280],
                      "sentiment": sentiment.score_headline(text)})
    return items, sentiment.summarise(items)


def _history(a: Artifacts, ticker: str, horizon: str) -> dict:
    """Every past out-of-sample prediction for this stock next to what really happened."""
    frame = a.oos[(a.oos["ticker"] == ticker) & (a.oos["horizon"] == horizon)]
    abs_ = frame[frame["target"] == "abs"].sort_values("date")
    rel = frame[frame["target"] == "rel"].set_index("date")["p_ensemble"]
    points = [{"date": str(r.date.date()), "p_up": _num(r.p_ensemble), "p_beat": _num(rel.get(r.date)),
               "q10": _num(r.q10), "q25": _num(r.q25), "q50": _num(r.q50), "q75": _num(r.q75),
               "q90": _num(r.q90), "actual": _num(r.actual)} for r in abs_.itertuples()]
    done = abs_[abs_["actual"].notna()]
    summary = None
    if len(done):
        up = done["actual"] > 0
        error = done["actual"] - done["q50"]
        worst, best = done.loc[error.idxmin()], done.loc[error.abs().idxmin()]

        def rec(r):
            return {"date": str(r["date"].date()), "predicted": _num(r["q50"]), "actual": _num(r["actual"]),
                    "probability": _num(r["p_ensemble"])}
        summary = {
            "n": int(len(done)),
            "accuracy": _num(((done["p_ensemble"] >= 0.5) == up).mean()),
            "naive_accuracy": _num(max(up.mean(), 1 - up.mean())),
            "coverage_80": _num(((done["actual"] >= done["q10"]) & (done["actual"] <= done["q90"])).mean()),
            "worst": rec(worst), "best": rec(best),
        }
    return {"points": points, "summary": summary}


def stock_detail(ticker: str, horizon: str = "6m", risk: str = "moderate") -> dict | None:
    a = art()
    ticker = ticker.upper()
    stock = get_stock(ticker)
    if stock is None or ticker not in a.latest["stocks"]:
        return None
    snap = store.load_snapshot(ticker)
    feats = a.latest["stocks"][ticker]["features"]
    scores = _scores(a, horizon, risk)
    metrics = price_metrics(a, ticker)
    preds = {h: _stock_prediction(a, ticker, h) for h in HORIZONS}
    pred = preds[horizon]
    factors_rel = _factors(a, ticker, horizon, "rel", pred["p_beat"])
    factors_abs = _factors(a, ticker, horizon, "abs", pred["p_up"])
    skill_abs = _skill(a, "abs", horizon)

    series = a.prices.adj_close[ticker].dropna()
    bench = a.prices.adj_close[BENCHMARK].reindex(series.index).ffill()
    news, news_summary = _news(ticker)
    ey = feats.get("earnings_yield")
    price = metrics["price"]
    target = snap.get("analyst_target_mean")

    return {
        "ticker": ticker, "name": snap.get("long_name") or stock.name, "sector": stock.sector,
        "industry": snap.get("industry"), "summary": snap.get("summary"),
        "as_of": a.latest["as_of"], "horizon": horizon,
        "score": _num(scores.get(ticker)),
        "rank": int(scores.rank(ascending=False).get(ticker)) if ticker in scores else None,
        "universe_size": int(len(scores)),
        "metrics": {**metrics, "beta": _num(feats.get("beta_12m")),
                    "rsi_14": _num(feats.get("rsi_14")), "dist_52w_high": _num(feats.get("dist_52w_high"))},
        "prices": {"dates": [str(d.date()) for d in series.index],
                   "close": [round(float(v), 4) for v in series.values],
                   "benchmark": [round(float(v), 4) for v in bench.values]},
        "fundamentals": {
            "pe": _num(snap.get("pe_trailing")),
            "pe_forward": _num(snap.get("pe_forward")),
            "pe_filings": _num(1 / ey) if ey and ey > 0 else None,
            "eps_growth": _num(feats.get("eps_growth")),
            "revenue_growth": _num(feats.get("revenue_growth")),
            "profit_margin": _num(feats.get("net_margin")),
            "eps_growth_quarterly": _num(snap.get("eps_growth")),
            "revenue_growth_quarterly": _num(snap.get("revenue_growth")),
            "debt_to_equity": _num(snap.get("debt_to_equity")),
            "free_cash_flow": _num(snap.get("free_cash_flow")),
            "market_cap": _num(snap.get("market_cap")),
            "dividend_yield": _num(snap.get("dividend_yield")),
        },
        "analyst": {
            "target_mean": _num(target), "target_low": _num(snap.get("analyst_target_low")),
            "target_high": _num(snap.get("analyst_target_high")),
            "implied_upside": _num(target / price - 1) if target and price else None,
            "rating": snap.get("analyst_rating"), "rating_score": _num(snap.get("analyst_rating_score")),
            "count": snap.get("analyst_count"),
        },
        "earnings": store.load_earnings(ticker),
        "news": news, "news_sentiment": news_summary,
        "predictions": preds,
        "skill": {h: {"abs": _skill(a, "abs", h), "rel": _skill(a, "rel", h),
                      "intervals": a.metrics.get("abs", {}).get(h, {}).get("intervals", {})}
                  for h in HORIZONS},
        "explanation": {
            "outperform": {"factors": factors_rel, "families": explain.family_summary(factors_rel)},
            "direction": {"factors": factors_abs, "families": explain.family_summary(factors_abs)},
            "reasoning": explain.reasoning(
                ticker, stock.name, HORIZON_TEXT[horizon], pred["p_up"], pred["p_beat"], pred["base_rate"],
                pred["range"]["q10"], pred["range"]["q90"], factors_rel,
                pred["confidence"]["model_spread"], skill_abs),
        },
        "history": _history(a, ticker, horizon),
    }


# ------------------------------------------------------------------ overview

def market_overview(horizon: str = "6m", risk: str = "moderate") -> dict:
    a = art()
    sectors = sector_map()
    adj = a.prices.adj_close
    symbols = [t for t in a.latest["stocks"] if t in adj]
    scores = _scores(a, horizon, risk)
    bench = adj[BENCHMARK].dropna()
    bench_rets = bench.pct_change().dropna()

    sector_rows = []
    for sector in sorted(set(sectors.values())):
        members = [t for t in symbols if sectors[t] == sector]
        if not members:
            continue
        row = {"sector": sector, "n": len(members),
               "avg_score": _num(scores.reindex(members).mean())}
        for label, days in (("1m", 21), ("3m", 63), ("6m", 126), ("1y", 252)):
            values = [_trailing_return(adj[t], days) for t in members]
            values = [v for v in values if v is not None]
            row[label] = _num(np.mean(values)) if values else None
        sector_rows.append(row)

    scatter = []
    for t in symbols:
        m = price_metrics(a, t)
        pred = _stock_prediction(a, t, horizon)
        scatter.append({"ticker": t, "sector": sectors[t], "volatility": m["volatility"],
                        "return_1y": m["returns"]["1y"], "score": _num(scores.get(t)),
                        "p_beat": pred["p_beat"] if pred else None})

    rets = adj[symbols].pct_change(fill_method=None).tail(252)
    sector_rets = rets.T.groupby(pd.Series(sectors)).mean().T
    corr = sector_rets.corr()
    feats = next(iter(a.latest["stocks"].values()))["features"]
    return {
        "as_of": a.latest["as_of"],
        "market": {
            "price": _num(bench.iloc[-1]),
            "returns": {k: _trailing_return(bench, d) for k, d in
                        (("1m", 21), ("3m", 63), ("6m", 126), ("1y", 252), ("3y", 756))},
            "volatility": _num(bench_rets.tail(252).std() * math.sqrt(252)),
            "max_drawdown_1y": _num(drawdown(bench.tail(253)).min()),
            "vs_200d": _num(feats.get("mkt_px_sma200")), "breadth": _num(feats.get("mkt_breadth")),
            "history": {"dates": [str(d.date()) for d in bench.index[-756:]],
                        "close": [round(float(v), 2) for v in bench.values[-756:]]},
        },
        "sectors": sector_rows, "scatter": scatter,
        "correlation": {"labels": list(corr.columns),
                        "matrix": [[_num(v) for v in row] for row in corr.to_numpy()]},
    }


# ----------------------------------------------------------------- portfolio

def build_portfolio(payload: dict) -> dict:
    a = art()
    sectors = sector_map()
    horizon = payload.get("horizon", "6m")
    current = {h["ticker"].upper(): float(h.get("value") or 0) for h in payload.get("holdings", [])
               if h.get("ticker")}
    known = {t: v for t, v in current.items() if t in a.latest["stocks"]}
    req = PortfolioRequest(
        amount=float(payload.get("amount", 10_000)),
        risk=payload.get("risk", "moderate"),
        max_stock=float(payload.get("max_stock", 0.15)),
        max_sector=float(payload.get("max_sector", 0.30)),
        min_holdings=int(payload.get("min_holdings", 8)),
        cash=float(payload.get("cash", 0.0)),
        avoid_sectors=list(payload.get("avoid_sectors", [])),
        prefer_sectors=list(payload.get("prefer_sectors", [])),
        keep_tickers=list(known) if payload.get("keep_holdings") else [],
    )
    scores = _scores(a, horizon, req.risk)
    symbols = list(scores.index)
    returns = a.prices.adj_close[symbols].pct_change(fill_method=None).tail(252)
    cov = shrunk_covariance(returns)
    corr = returns.corr()
    chosen, notes = select(scores, sectors, corr, req)
    if not chosen:
        return {"error": "No stocks are left after applying your sector exclusions."}
    weights, more = optimise(chosen, scores, sectors, cov, req)
    notes += more
    weights = weights.sort_values(ascending=False)
    betas = pd.Series({t: a.latest["stocks"][t]["features"].get("beta_12m") for t in chosen}, dtype=float)

    total = req.amount + sum(known.values())
    holdings = []
    for ticker, weight in weights.items():
        pred = _stock_prediction(a, ticker, horizon)
        metrics = price_metrics(a, ticker)
        dollars = weight * total
        factors = [f for f in _factors(a, ticker, horizon, "rel", pred["p_beat"]) if not f["missing"]]
        holdings.append({
            "ticker": ticker, "name": get_stock(ticker).name, "sector": sectors[ticker],
            "weight": _num(weight), "dollars": _num(dollars), "price": metrics["price"],
            "shares": _num(dollars / metrics["price"]) if metrics["price"] else None,
            "score": _num(scores[ticker]), "p_up": pred["p_up"], "p_beat": pred["p_beat"],
            "range": pred["range"], "volatility": metrics["volatility"], "risk_level": metrics["risk_level"],
            "current_dollars": _num(known.get(ticker, 0.0)),
            "trade_dollars": _num(dollars - known.get(ticker, 0.0)),
            "why": [f["headline"] for f in factors if f["direction"] == "positive"][:2],
            "watch": [f["headline"] for f in factors if f["direction"] == "negative"][:1],
        })
    sells = [{"ticker": t, "current_dollars": v, "trade_dollars": -v,
              "sector": sectors.get(t)} for t, v in known.items() if t not in weights.index]
    unknown = [t for t in current if t not in known]
    if unknown:
        notes.append("Not in the stock universe, so not analysed: " + ", ".join(unknown) + ".")

    sector_alloc = weights.groupby(lambda t: sectors[t]).sum().sort_values(ascending=False)
    cash_weight = max(0.0, 1.0 - float(weights.sum()))
    stats = portfolio_stats(weights, cov, betas)
    w = weights / weights.sum()
    stats.update(
        avg_p_up=_num(sum(w[h["ticker"]] * h["p_up"] for h in holdings)),
        avg_p_beat=_num(sum(w[h["ticker"]] * h["p_beat"] for h in holdings)),
        avg_score=_num(sum(w[h["ticker"]] * h["score"] for h in holdings)),
        invested=_num(weights.sum()), cash=_num(cash_weight), n_holdings=len(holdings),
        max_weight=_num(weights.max()), max_sector_weight=_num(sector_alloc.max()),
        risk_level=risk_level(stats["volatility"] / max(float(weights.sum()), 1e-9)),
    )
    held = corr.loc[list(weights.index), list(weights.index)]
    return {
        "as_of": a.latest["as_of"], "horizon": horizon, "total_value": total, "request": req.__dict__,
        "holdings": holdings, "sells": sells,
        "sectors": [{"sector": s, "weight": _num(v)} for s, v in sector_alloc.items()]
                   + ([{"sector": "Cash", "weight": _num(cash_weight)}] if cash_weight > 0.0005 else []),
        "stats": stats, "notes": notes,
        "correlation": {"labels": list(held.columns),
                        "matrix": [[_num(v) for v in row] for row in held.to_numpy()]},
        "method": {"preferred_sector_bonus": PREFERRED_SECTOR_BONUS,
                   "correlation_penalty": CORRELATION_PENALTY},
        "skill": _skill(a, "rel", horizon),
    }


# ------------------------------------------------------------------ backtest

def _signal_tables(a: Artifacts, horizon: str, model: str):
    oos = a.oos[(a.oos["horizon"] == horizon) & (a.oos["target"] == "rel")]
    prob = oos.pivot(index="date", columns="ticker", values=f"p_{model}")
    panel = a.panel[a.panel["date"].isin(prob.index)]
    vol_rank = panel.pivot(index="date", columns="ticker", values="vol_3m_rank")
    vol = panel.pivot(index="date", columns="ticker", values="vol_3m")
    return prob, vol_rank, vol


def _sample(series: pd.Series, step: int = 5) -> pd.Series:
    """Weekly points keep the charts light; statistics always use daily data."""
    keep = list(range(0, len(series), step))
    if keep[-1] != len(series) - 1:
        keep.append(len(series) - 1)
    return series.iloc[keep]


def backtest(params: dict | None = None) -> dict:
    params = params or {}
    key = json.dumps({
        "horizon": params.get("horizon", "6m"), "risk": params.get("risk", "moderate"),
        "model": params.get("model", "ensemble"), "top_n": int(params.get("top_n", 15)),
        "rebalance_months": int(params.get("rebalance_months", 1)),
        "weighting": params.get("weighting", "equal"),
        "max_stock": float(params.get("max_stock", 0.15)), "max_sector": float(params.get("max_sector", 0.30)),
        "cost_bps": float(params.get("cost_bps", 10)), "slippage_bps": float(params.get("slippage_bps", 5)),
        "initial": float(params.get("initial", 10_000)), "start_year": params.get("start_year"),
    }, sort_keys=True)
    art()  # make sure artifacts (and the cache they invalidate) are current
    return _backtest_cached(key)


@lru_cache(maxsize=64)
def _backtest_cached(key: str) -> dict:
    p = json.loads(key)
    a = art()
    sectors = sector_map()
    prob, vol_rank, vol = _signal_tables(a, p["horizon"], p["model"])
    dates = list(prob.index)
    if p["start_year"]:
        dates = [d for d in dates if d.year >= int(p["start_year"])]
    if len(dates) < 3:
        return {"error": "Not enough history for this start year."}
    rebalance = dates[::p["rebalance_months"]]
    cfg = BacktestConfig(initial=p["initial"], cost_bps=p["cost_bps"], slippage_bps=p["slippage_bps"])
    symbols = list(prob.columns)
    prices = a.prices.adj_close[symbols]

    ai_targets, ew_targets = {}, {}
    for date in rebalance:
        available = prob.loc[date].dropna()
        available = available[prices.loc[:date, available.index].iloc[-1].notna()]
        scores = ai_score(available, vol_rank.loc[date], p["risk"])
        ai_targets[date] = top_n_weights(scores, sectors, p["top_n"], p["max_stock"], p["max_sector"],
                                         p["weighting"], vol.loc[date])
        ew_targets[date] = equal_weights(list(available.index))
    first = rebalance[0]
    runs = {
        "ai": simulate(prices, ai_targets, cfg, "AI portfolio"),
        "spy": simulate(a.prices.adj_close[[BENCHMARK]], {first: pd.Series({BENCHMARK: 1.0})}, cfg, "S&P 500"),
        "equal_weight": simulate(prices, ew_targets, cfg, "Equal-weight universe"),
        "buy_hold": simulate(prices, {first: ew_targets[first]}, cfg, "Buy and hold"),
    }
    index = runs["ai"].equity.index
    spy_equity = runs["spy"].equity.reindex(index).ffill()
    stats = {}
    for name, run in runs.items():
        equity = run.equity.reindex(index).ffill()
        stats[name] = performance(equity, RISK_FREE_RATE, None if name == "spy" else spy_equity)
        stats[name].update(n_trades=run.n_trades, win_rate=run.win_rate, turnover=run.turnover,
                           total_costs=run.total_costs, round_trips=len(run.round_trips))
    ai = runs["ai"]
    sampled = _sample(ai.equity)
    series = {"dates": [str(d.date()) for d in sampled.index]}
    drawdowns = {"dates": series["dates"]}
    for name, run in runs.items():
        equity = run.equity.reindex(index).ffill()
        series[name] = [round(float(v), 2) for v in equity.reindex(sampled.index).values]
        drawdowns[name] = [round(float(v), 4) for v in drawdown(equity).reindex(sampled.index).values]

    years = sorted(set().union(*[yearly_returns(r.equity.reindex(index).ffill()).keys() for r in runs.values()]))
    yearly = []
    for year in years:
        row = {"year": year}
        for name, run in runs.items():
            row[name] = _num(yearly_returns(run.equity.reindex(index).ffill()).get(year))
        yearly.append(row)

    rolling = {}
    window = 252
    for name in ("spy", "equal_weight"):
        other = runs[name].equity.reindex(index).ffill()
        excess = (ai.equity / ai.equity.shift(window) - 1) - (other / other.shift(window) - 1)
        rolling[name] = [_num(v) for v in excess.reindex(sampled.index).values]

    last = ai.weights.iloc[-1]
    last = last[last > 0].sort_values(ascending=False)
    sector_now = last.groupby(lambda t: sectors.get(t, "Other")).sum().sort_values(ascending=False)
    trips = sorted(ai.round_trips, key=lambda t: t["return"])
    return {
        "params": p, "as_of": a.latest["as_of"], "risk_free_rate": RISK_FREE_RATE,
        "series": series, "drawdowns": drawdowns, "stats": stats, "yearly": yearly,
        "rolling_excess": rolling,
        "holdings": [{"ticker": t, "weight": _num(w), "sector": sectors.get(t)} for t, w in last.items()],
        "sectors": [{"sector": s, "weight": _num(w)} for s, w in sector_now.items()],
        "last_rebalance": str(ai.weights.index[-1].date()),
        "n_rebalances": int(len(ai.weights)),
        "avg_holdings": _num((ai.weights > 0).sum(axis=1).mean()),
        "recent_trades": ai.trade_log[-40:][::-1],
        "best_trades": trips[-5:][::-1], "worst_trades": trips[:5],
        "verdict": _verdict(stats),
    }


def _verdict(stats: dict) -> list[dict]:
    """Plain statements of what the backtest does and does not show."""
    ai, spy, ew = stats["ai"], stats["spy"], stats["equal_weight"]
    lines = []

    def compare(name: str, other: dict) -> None:
        gap = ai["annualized_return"] - other["annualized_return"]
        beat = gap > 0
        lines.append({"tone": "good" if beat else "bad", "text": (
            f"The AI portfolio returned {ai['annualized_return']:.1%} a year versus "
            f"{other['annualized_return']:.1%} for {name} — "
            f"{'ahead' if beat else 'behind'} by {abs(gap) * 100:.1f} points a year after costs.")})

    compare("the S&P 500", spy)
    compare("simply holding every stock in the universe equally", ew)
    sharper = ai["sharpe"] > ew["sharpe"]
    lines.append({"tone": "good" if sharper else "bad", "text": (
        f"Risk-adjusted (Sharpe ratio): {ai['sharpe']:.2f} for the AI portfolio, {ew['sharpe']:.2f} for "
        f"equal-weight, {spy['sharpe']:.2f} for the S&P 500.")})
    lines.append({"tone": "bad" if ai["max_drawdown"] < spy["max_drawdown"] else "good", "text": (
        f"Worst peak-to-trough loss: {ai['max_drawdown']:.1%} for the AI portfolio versus "
        f"{spy['max_drawdown']:.1%} for the S&P 500.")})
    lines.append({"tone": "warn", "text": (
        "The equal-weight universe is the fair comparison, not the S&P 500. Every stock here was "
        "chosen in hindsight as a large, well-known company today (survivorship bias), so any "
        "portfolio drawn from this list starts with a head start over the index.")})
    return lines


# ------------------------------------------------------------- model results

def model_performance() -> dict:
    a = art()
    return {
        "meta": a.meta, "metrics": a.metrics, "importance": a.importance,
        "features": [{"name": f.name, "label": f.label, "family": f.family,
                      "description": f.description} for f in FEATURES],
        "risk_weights": RISK_WEIGHT,
    }


def universe() -> list[dict]:
    return [{"ticker": s.ticker, "name": s.name, "sector": s.sector} for s in load_universe()]
