"""Point-in-time fundamentals from SEC EDGAR (free, official, no API key).

Every XBRL fact carries the date it was *filed*, so we know when the market could
first have seen it. That is what lets the model use fundamentals historically
without look-ahead bias — a snapshot of today's fundamentals could not.

For each company we build trailing-twelve-month (TTM) revenue, net income and
diluted EPS, each stamped with the date it became public.
"""
from __future__ import annotations

import os
import time

import numpy as np
import pandas as pd
import requests

FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json"
DEFAULT_UA = "Stock-Prediction-Model educational research project"

# Companies changed tags over the years; earlier tags in each list win.
CONCEPTS = {
    "revenue": [
        "RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet",
        "RevenuesNetOfInterestExpense", "RevenueFromContractWithCustomerIncludingAssessedTax",
        "SalesRevenueGoodsNet",
    ],
    "net_income": ["NetIncomeLoss", "NetIncomeLossAvailableToCommonStockholdersBasic", "ProfitLoss"],
    "eps": ["EarningsPerShareDiluted", "EarningsPerShareBasic"],
}
UNITS = {"revenue": "USD", "net_income": "USD", "eps": "USD/shares"}


def fetch_company_facts(cik: int) -> dict:
    headers = {"User-Agent": os.getenv("SEC_USER_AGENT") or DEFAULT_UA}
    for attempt in range(3):
        resp = requests.get(FACTS_URL.format(cik=cik), headers=headers, timeout=45)
        if resp.status_code == 200:
            return resp.json()
        time.sleep(1.5 * (attempt + 1))
    resp.raise_for_status()
    return {}


def _periods(facts_list: list[dict], concept: str) -> pd.DataFrame:
    """One row per reporting period (start, end): value and the date first filed."""
    rows = []
    for rank, tag in enumerate(CONCEPTS[concept]):
        for facts in facts_list:
            node = facts.get("facts", {}).get("us-gaap", {}).get(tag)
            if not node:
                continue
            for fact in node.get("units", {}).get(UNITS[concept], []):
                if "start" not in fact or not str(fact.get("form", "")).startswith(("10-K", "10-Q")):
                    continue
                rows.append((fact["start"], fact["end"], fact["val"], fact["filed"], rank))
    if not rows:
        return pd.DataFrame(columns=["start", "end", "val", "filed", "days"])
    frame = pd.DataFrame(rows, columns=["start", "end", "val", "filed", "rank"])
    for col in ("start", "end", "filed"):
        frame[col] = pd.to_datetime(frame[col])
    # First filing of each period = the value the market originally saw.
    frame = frame.sort_values(["start", "end", "filed", "rank"]).drop_duplicates(["start", "end"])
    frame["days"] = (frame["end"] - frame["start"]).dt.days
    return frame.drop(columns="rank").reset_index(drop=True)


def _split_adjust(frame: pd.DataFrame, splits: pd.Series | None) -> pd.DataFrame:
    """Put per-share values on today's share basis.

    A value filed before a split is on the old share count; divide it by every
    split that took effect after its filing date.
    """
    if splits is None or frame.empty:
        return frame
    splits = splits[splits > 0]
    if splits.empty:
        return frame
    frame = frame.copy()
    factor = np.ones(len(frame))
    for when, ratio in splits.items():
        factor = np.where(frame["filed"].values < np.datetime64(when), factor * ratio, factor)
    frame["val"] = frame["val"] / factor
    return frame


def _ttm(frame: pd.DataFrame) -> pd.DataFrame:
    """Trailing-twelve-month values, each with the date it became available.

    Annual periods are used directly. For interim periods:
    TTM = last full year + year-to-date − the same year-to-date a year earlier.
    """
    if frame.empty:
        return pd.DataFrame(columns=["available", "period_end", "ttm"])
    annual = frame[frame["days"].between(350, 380)]
    interim = frame[frame["days"].between(60, 300)]
    out = [(r.filed, r.end, r.val) for r in annual.itertuples()]
    annual_ends = set(annual["end"])
    week = pd.Timedelta(days=8)
    # Longest year-to-date period for each period end.
    ytd = interim.sort_values("days").drop_duplicates("end", keep="last")
    for cur in ytd.itertuples():
        if cur.end in annual_ends:
            continue
        prior_year = annual[(annual["end"] - (cur.start - pd.Timedelta(days=1))).abs() <= week]
        if prior_year.empty:
            continue
        year = prior_year.iloc[-1]
        prior_ytd = interim[((interim["start"] - year["start"]).abs() <= week)
                            & ((interim["days"] - cur.days).abs() <= 8)]
        if prior_ytd.empty:
            continue
        value = year["val"] + cur.val - prior_ytd.iloc[-1]["val"]
        out.append((max(cur.filed, year["filed"]), cur.end, value))
    ttm = pd.DataFrame(out, columns=["available", "period_end", "ttm"]).sort_values(
        ["available", "period_end"])
    # Keep only entries that advance the reporting period (drop late restatements).
    previous_max = ttm["period_end"].cummax().shift()
    ttm = ttm[previous_max.isna() | (ttm["period_end"] > previous_max)]
    return ttm.drop_duplicates("available", keep="last").reset_index(drop=True)


def _yoy(ttm: pd.DataFrame) -> pd.Series:
    """Year-over-year growth of a TTM series, aligned to ``ttm`` rows."""
    growth = []
    for row in ttm.itertuples():
        target = row.period_end - pd.Timedelta(days=365)
        prior = ttm[(ttm["period_end"] - target).abs() <= pd.Timedelta(days=15)]
        if prior.empty or abs(prior.iloc[-1]["ttm"]) < 1e-9:
            growth.append(np.nan)
        else:
            base = prior.iloc[-1]["ttm"]
            growth.append((row.ttm - base) / abs(base))
    return pd.Series(growth, index=ttm.index, dtype=float)


def point_in_time_fundamentals(ciks: tuple[int, ...] | list[int],
                               splits: pd.Series | None = None) -> pd.DataFrame:
    """Fundamentals indexed by the date they became public.

    Columns: eps_ttm, eps_growth, revenue_ttm, revenue_growth, net_income_ttm,
    net_margin. Forward-fill onto trading days to get what was known each day.
    """
    facts_list = []
    for cik in ciks:
        try:
            facts_list.append(fetch_company_facts(cik))
        except Exception:
            continue
        time.sleep(0.12)  # stay well under SEC's 10 requests/second limit
    pieces = {}
    for concept in CONCEPTS:
        periods = _periods(facts_list, concept)
        if concept == "eps":
            periods = _split_adjust(periods, splits)
        ttm = _ttm(periods)
        if ttm.empty:
            continue
        ttm["growth"] = _yoy(ttm)
        pieces[concept] = ttm.set_index("available")[["ttm", "growth"]]
    if not pieces:
        return pd.DataFrame()
    dates = sorted(set().union(*[p.index for p in pieces.values()]))
    out = pd.DataFrame(index=pd.DatetimeIndex(dates, name="available"))
    for concept, piece in pieces.items():
        aligned = piece.reindex(out.index).ffill()
        name = {"revenue": "revenue", "net_income": "net_income", "eps": "eps"}[concept]
        out[f"{name}_ttm"] = aligned["ttm"]
        out[f"{name}_growth"] = aligned["growth"]
    if {"net_income_ttm", "revenue_ttm"} <= set(out.columns):
        revenue = out["revenue_ttm"].where(out["revenue_ttm"] > 0)
        out["net_margin"] = out["net_income_ttm"] / revenue
    return out
