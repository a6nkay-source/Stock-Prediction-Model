"""FastAPI app.  Run with:  uvicorn backend.main:app --reload --port 8000"""
from __future__ import annotations

import threading
import traceback
from typing import Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from backend import report, service
from backend.config import CORS_ORIGINS, DISCLAIMER, ROOT

Horizon = Literal["1m", "3m", "6m", "12m"]
Risk = Literal["conservative", "moderate", "aggressive"]

app = FastAPI(title="AI Stock Predictor", description=DISCLAIMER, version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])

_job = {"running": False, "log": [], "error": None}


def _guard(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except service.NotReady as exc:
        raise HTTPException(503, str(exc)) from exc


class Holding(BaseModel):
    ticker: str
    value: float = Field(0, ge=0)


class PortfolioIn(BaseModel):
    amount: float = Field(10_000, gt=0, le=1e9)
    horizon: Horizon = "6m"
    risk: Risk = "moderate"
    max_stock: float = Field(0.15, ge=0.03, le=1.0)
    max_sector: float = Field(0.30, ge=0.10, le=1.0)
    min_holdings: int = Field(8, ge=1, le=40)
    cash: float = Field(0.0, ge=0.0, le=0.9)
    avoid_sectors: list[str] = []
    prefer_sectors: list[str] = []
    holdings: list[Holding] = []
    keep_holdings: bool = False


class BacktestIn(BaseModel):
    horizon: Horizon = "6m"
    risk: Risk = "moderate"
    model: Literal["ensemble", "logistic", "random_forest", "gradient_boosting"] = "ensemble"
    top_n: int = Field(15, ge=3, le=40)
    rebalance_months: Literal[1, 3, 6, 12] = 1
    weighting: Literal["equal", "inverse_vol"] = "equal"
    max_stock: float = Field(0.15, ge=0.03, le=1.0)
    max_sector: float = Field(0.30, ge=0.10, le=1.0)
    cost_bps: float = Field(10, ge=0, le=200)
    slippage_bps: float = Field(5, ge=0, le=200)
    initial: float = Field(10_000, gt=0, le=1e9)
    start_year: int | None = Field(None, ge=2000, le=2100)


@app.get("/api/status")
def status():
    ready = service.is_ready()
    return {"ready": ready, "disclaimer": DISCLAIMER,
            "meta": service.art().meta if ready else None,
            "job": {"running": _job["running"], "log": _job["log"][-12:], "error": _job["error"]}}


@app.post("/api/refresh")
def refresh(fast: bool = False):
    """Re-download data and retrain in the background."""
    if _job["running"]:
        return {"started": False, "reason": "A refresh is already running."}

    def work():
        from backend import pipeline
        _job.update(running=True, log=[], error=None)
        try:
            pipeline.run(fast=fast, force_data=True, log=_job["log"].append)
        except Exception:
            _job["error"] = traceback.format_exc(limit=3)
        finally:
            _job["running"] = False

    threading.Thread(target=work, daemon=True).start()
    return {"started": True}


@app.get("/api/universe")
def universe():
    return service.universe()


@app.get("/api/predictions")
def predictions(horizon: Horizon = "6m", risk: Risk = "moderate"):
    return _guard(service.predictions, horizon, risk)


@app.get("/api/stocks/{ticker}")
def stock(ticker: str, horizon: Horizon = "6m", risk: Risk = "moderate"):
    detail = _guard(service.stock_detail, ticker, horizon, risk)
    if detail is None:
        raise HTTPException(404, f"{ticker.upper()} is not in the stock universe.")
    return detail


@app.get("/api/market")
def market(horizon: Horizon = "6m", risk: Risk = "moderate"):
    return _guard(service.market_overview, horizon, risk)


@app.post("/api/portfolio")
def portfolio(body: PortfolioIn):
    result = _guard(service.build_portfolio, body.model_dump())
    if "error" in result:
        raise HTTPException(422, result["error"])
    return result


@app.post("/api/backtest")
def backtest(body: BacktestIn):
    result = _guard(service.backtest, body.model_dump())
    if "error" in result:
        raise HTTPException(422, result["error"])
    return result


@app.get("/api/models")
def models():
    return _guard(service.model_performance)


@app.get("/api/report", response_class=HTMLResponse)
def research_report(download: bool = Query(False)):
    html = _guard(report.build_html)
    headers = {"Content-Disposition": 'attachment; filename="ai-stock-predictor-report.html"'} if download else {}
    return HTMLResponse(html, headers=headers)


# Serve the built frontend (npm run build) from the same server, if it exists.
_dist = ROOT / "frontend" / "dist"
if _dist.exists():
    app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        """Static files, falling back to index.html so client-side routes survive a reload."""
        target = (_dist / path).resolve()
        if path and target.is_file() and _dist.resolve() in target.parents:
            return FileResponse(target)
        return FileResponse(_dist / "index.html")
