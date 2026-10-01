"""Yahoo Finance provider (via the open-source ``yfinance`` package). No API key."""
from __future__ import annotations

import math

import pandas as pd

from .base import MarketDataProvider, PriceData

# our field name -> Yahoo ``info`` key
SNAPSHOT_FIELDS = {
    "price": "currentPrice",
    "market_cap": "marketCap",
    "pe_trailing": "trailingPE",
    "pe_forward": "forwardPE",
    "eps_trailing": "trailingEps",
    "eps_forward": "forwardEps",
    "eps_growth": "earningsGrowth",
    "revenue_growth": "revenueGrowth",
    "profit_margin": "profitMargins",
    "debt_to_equity": "debtToEquity",
    "free_cash_flow": "freeCashflow",
    "dividend_yield": "dividendYield",
    "beta_provider": "beta",
    "analyst_target_mean": "targetMeanPrice",
    "analyst_target_low": "targetLowPrice",
    "analyst_target_high": "targetHighPrice",
    "analyst_rating": "recommendationKey",
    "analyst_rating_score": "recommendationMean",
    "analyst_count": "numberOfAnalystOpinions",
    "industry": "industry",
    "long_name": "longName",
    "summary": "longBusinessSummary",
}


def _clean(value):
    if value is None:
        return None
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    return value


class YahooProvider(MarketDataProvider):
    name = "Yahoo Finance (yfinance)"

    def get_prices(self, tickers: list[str], start: str) -> PriceData:
        import yfinance as yf

        raw = yf.download(tickers, start=start, auto_adjust=False, actions=True,
                          progress=False, threads=True, group_by="column")
        if raw is None or raw.empty:
            raise RuntimeError("Yahoo Finance returned no price data")

        def field(name: str) -> pd.DataFrame:
            frame = raw[name]
            if isinstance(frame, pd.Series):
                frame = frame.to_frame(tickers[0])
            frame = frame.reindex(columns=tickers)
            frame.index = pd.to_datetime(frame.index).tz_localize(None)
            return frame.sort_index()

        adj, close = field("Adj Close"), field("Close")
        splits = field("Stock Splits").fillna(0.0)
        keep = adj.notna().any(axis=1)
        return PriceData(adj[keep], close[keep], splits[keep])

    def get_snapshot(self, ticker: str) -> dict:
        import yfinance as yf

        info = yf.Ticker(ticker).info or {}
        out = {ours: _clean(info.get(theirs)) for ours, theirs in SNAPSHOT_FIELDS.items()}
        # Yahoo quotes these two as percentages; store everything as fractions.
        if out["dividend_yield"] is not None:
            out["dividend_yield"] = out["dividend_yield"] / 100.0
        if out["debt_to_equity"] is not None:
            out["debt_to_equity"] = out["debt_to_equity"] / 100.0
        return out

    def get_news(self, ticker: str) -> list[dict]:
        import yfinance as yf

        items = []
        for raw in (yf.Ticker(ticker).news or [])[:12]:
            content = raw.get("content") or raw
            title = content.get("title")
            if not title:
                continue
            url = ((content.get("canonicalUrl") or {}).get("url")
                   or (content.get("clickThroughUrl") or {}).get("url") or content.get("link"))
            items.append({
                "title": title,
                "summary": content.get("summary") or "",
                "publisher": (content.get("provider") or {}).get("displayName") or content.get("publisher"),
                "url": url,
                "published": content.get("pubDate") or content.get("displayTime"),
            })
        return items

    def get_earnings(self, ticker: str) -> list[dict]:
        import yfinance as yf

        frame = yf.Ticker(ticker).get_earnings_history()
        if frame is None or len(frame) == 0:
            return []
        rows = []
        for quarter, row in frame.iterrows():
            rows.append({
                "quarter": str(pd.Timestamp(quarter).date()),
                "eps_actual": _clean(float(row.get("epsActual"))),
                "eps_estimate": _clean(float(row.get("epsEstimate"))),
                "surprise_pct": _clean(float(row.get("surprisePercent"))),
            })
        return rows
