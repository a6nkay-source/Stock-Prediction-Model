"""A self-contained, printable research report (HTML with inline SVG charts).

Open it in a browser and use Print -> Save as PDF for a document to hand in.
Every number is read from the pipeline's artifacts at the moment of download.
"""
from __future__ import annotations

import html
import math
from datetime import date

from backend import service
from backend.config import DISCLAIMER
from models.features import FEATURES, HORIZONS

COLORS = {"ai": "#2a78d6", "spy": "#eb6834", "equal_weight": "#1baf7a", "buy_hold": "#eda100"}
LABELS = {"ai": "AI portfolio", "spy": "S&P 500 (SPY)", "equal_weight": "Equal-weight universe",
          "buy_hold": "Buy and hold"}
HORIZON_TEXT = {"1m": "1 month", "3m": "3 months", "6m": "6 months", "12m": "12 months"}


def _pct(value, digits: int = 1, signed: bool = False) -> str:
    if value is None:
        return "n/a"
    return f"{value * 100:+.{digits}f}%" if signed else f"{value * 100:.{digits}f}%"


def _num(value, digits: int = 2) -> str:
    return "n/a" if value is None else f"{value:.{digits}f}"


def _money(value) -> str:
    return "n/a" if value is None else f"${value:,.0f}"


def _legend(keys: list[str], labels: dict[str, str], colors: dict[str, str]) -> str:
    items = "".join(f'<span><i style="background:{colors[k]}"></i>{html.escape(labels[k])}</span>' for k in keys)
    return f'<div class="legend">{items}</div>'


def line_chart(dates: list[str], series: dict[str, list], colors: dict[str, str], log: bool = False,
               percent: bool = False, width: int = 760, height: int = 300) -> str:
    left, right, top, bottom = 58, 12, 10, 26
    values = [v for s in series.values() for v in s if v is not None]
    lo, hi = min(values), max(values)
    if percent:
        hi = max(hi, 0.0)
    f = (lambda v: math.log10(v)) if log else (lambda v: v)
    flo, fhi = f(lo), f(hi)
    span = (fhi - flo) or 1.0
    n = len(dates)

    def x(i): return left + (width - left - right) * i / max(n - 1, 1)
    def y(v): return top + (height - top - bottom) * (1 - (f(v) - flo) / span)

    parts = [f'<svg viewBox="0 0 {width} {height}" role="img">']
    if log:
        ticks = [t for t in (1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5, 5e5, 1e6, 2e6, 5e6, 1e7) if lo <= t <= hi]
    else:
        step = (hi - lo) / 5
        ticks = [lo + step * i for i in range(6)]
    for t in ticks:
        label = _pct(t, 0) if percent else (f"${t / 1e6:.1f}M" if t >= 1e6 else f"${t / 1e3:.0f}k")
        parts.append(f'<line x1="{left}" x2="{width - right}" y1="{y(t):.1f}" y2="{y(t):.1f}" stroke="#e1e0d9"/>'
                     f'<text x="{left - 6}" y="{y(t) + 4:.1f}" text-anchor="end">{label}</text>')
    seen = set()
    for i, d in enumerate(dates):
        year = d[:4]
        if year not in seen and int(year) % 2 == 0 and i > 0:
            parts.append(f'<text x="{x(i):.1f}" y="{height - 8}" text-anchor="middle">{year}</text>')
        seen.add(year)
    for key, vals in series.items():
        pts = " ".join(f"{x(i):.1f},{y(v):.1f}" for i, v in enumerate(vals) if v is not None)
        parts.append(f'<polyline fill="none" stroke="{colors[key]}" stroke-width="2" '
                     f'stroke-linejoin="round" points="{pts}"/>')
    parts.append("</svg>")
    return "".join(parts)


def bar_chart(groups: list[str], series: dict[str, list], colors: dict[str, str], width: int = 760,
              height: int = 240, lo: float | None = None) -> str:
    left, right, top, bottom = 44, 12, 10, 26
    values = [v for s in series.values() for v in s if v is not None]
    lo = min(0.0, *values) if lo is None else lo
    hi = max(values)
    span = (hi - lo) or 1.0
    band = (width - left - right) / len(groups)
    bar = min(22.0, band * 0.7 / len(series))

    def y(v): return top + (height - top - bottom) * (1 - (v - lo) / span)

    parts = [f'<svg viewBox="0 0 {width} {height}" role="img">']
    for i in range(5):
        t = lo + span * i / 4
        parts.append(f'<line x1="{left}" x2="{width - right}" y1="{y(t):.1f}" y2="{y(t):.1f}" stroke="#e1e0d9"/>'
                     f'<text x="{left - 6}" y="{y(t) + 4:.1f}" text-anchor="end">{_pct(t, 0)}</text>')
    for g, group in enumerate(groups):
        centre = left + band * (g + 0.5)
        start = centre - bar * len(series) / 2
        for k, (key, vals) in enumerate(series.items()):
            v = vals[g]
            if v is None:
                continue
            top_y, base_y = min(y(v), y(max(lo, 0))), max(y(v), y(max(lo, 0)))
            parts.append(f'<rect x="{start + k * bar + 1:.1f}" y="{top_y:.1f}" width="{bar - 2:.1f}" '
                         f'height="{max(base_y - top_y, 0.5):.1f}" rx="2" fill="{colors[key]}"/>')
        parts.append(f'<text x="{centre:.1f}" y="{height - 8}" text-anchor="middle">{html.escape(str(group))}</text>')
    parts.append("</svg>")
    return "".join(parts)


def _table(header: list[str], rows: list[list[str]]) -> str:
    head = "".join(f"<th>{html.escape(h)}</th>" for h in header)
    body = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in row) + "</tr>" for row in rows)
    return f"<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>"


def build_html() -> str:
    a = service.art()
    meta, metrics = a.meta, a.metrics
    bt = service.backtest({})
    stats, params = bt["stats"], bt["params"]
    ai, spy, ew = stats["ai"], stats["spy"], stats["equal_weight"]
    h = params["horizon"]
    rel, abs_ = metrics["rel"][h]["models"]["ensemble"], metrics["abs"][h]["models"]["ensemble"]
    intervals = metrics["abs"][h].get("intervals", {})
    extremes = metrics["abs"][h].get("extremes", {})

    rank_skill = (rel.get("rank_ic") or 0) > 0 and (rel.get("rank_ic_t_adjusted") or 0) >= 2
    beats_ew = ai["annualized_return"] > ew["annualized_return"] and ai["sharpe"] > ew["sharpe"]
    direction_skill = (abs_.get("accuracy_lift") or 0) > 0.005
    if rank_skill and beats_ew:
        conclusion = ("The evidence supports the hypothesis, with caveats: the ranking signal is statistically "
                      "distinguishable from chance and the portfolio beat the equal-weight benchmark on both "
                      "return and risk-adjusted return.")
    elif (rel.get("rank_ic") or 0) > 0 and beats_ew:
        conclusion = ("The evidence is suggestive but not conclusive: the portfolio beat the equal-weight "
                      "benchmark, but the ranking signal is too weak to rule out luck.")
    elif beats_ew:
        conclusion = ("Mixed: the portfolio beat the equal-weight benchmark, but the ranking signal itself shows "
                      "no measurable skill, so the result may be luck or a side effect of the constraints.")
    else:
        conclusion = ("We cannot reject the null hypothesis: after costs the AI portfolio did not beat simply "
                      "holding every stock in the universe equally on a risk-adjusted basis.")

    skill_rows = []
    for hz in HORIZONS:
        x, r = metrics["abs"][hz]["models"]["ensemble"], metrics["rel"][hz]["models"]["ensemble"]
        skill_rows.append([HORIZON_TEXT[hz], _pct(x["accuracy"]), _pct(x["naive_accuracy"]), _num(x["auc"], 3),
                           _num(r["rank_ic"], 3), _num(r["rank_ic_t_adjusted"]), _pct(r["top_minus_bottom"], 1, True)])
    model_rows = []
    for name in ("baseline", "logistic", "random_forest", "gradient_boosting", "ensemble"):
        x, r = metrics["abs"][h]["models"][name], metrics["rel"][h]["models"][name]
        model_rows.append([html.escape(meta["model_labels"][name]), _pct(x["accuracy"]), _pct(x["naive_accuracy"]),
                           "—" if name == "baseline" else _num(x["auc"], 3), _num(x["brier"], 4),
                           _num(r.get("rank_ic"), 3) if r.get("rank_ic") is not None else "—"])
    bt_rows = [[LABELS[k], _money(stats[k]["end_value"]), _pct(stats[k]["total_return"], 0, True),
                _pct(stats[k]["annualized_return"], 1, True), _pct(stats[k]["volatility"]),
                _num(stats[k]["sharpe"]), _pct(stats[k]["max_drawdown"]), f'{stats[k]["n_trades"]:,}',
                _pct(stats[k]["win_rate"], 0) if stats[k]["win_rate"] is not None else "—"]
               for k in ("ai", "spy", "equal_weight", "buy_hold")]

    keys = ["ai", "spy", "equal_weight", "buy_hold"]
    equity = line_chart(bt["series"]["dates"], {k: bt["series"][k] for k in keys}, COLORS, log=True)
    drawdowns = line_chart(bt["drawdowns"]["dates"], {k: bt["drawdowns"][k] for k in keys[:3]}, COLORS, percent=True, height=220)
    accuracy = bar_chart([HORIZON_TEXT[hz] for hz in HORIZONS], {
        "model": [metrics["abs"][hz]["models"]["ensemble"]["accuracy"] for hz in HORIZONS],
        "naive": [metrics["abs"][hz]["models"]["ensemble"]["naive_accuracy"] for hz in HORIZONS],
    }, {"model": "#2a78d6", "naive": "#898781"}, lo=0.4)
    yearly = bar_chart([str(r["year"])[2:] for r in bt["yearly"]],
                       {k: [r[k] for r in bt["yearly"]] for k in keys[:3]}, COLORS)
    importance = sorted(a.importance["rel"][h]["average"].items(), key=lambda kv: -kv[1])[:10]
    feature_label = {f.name: f.label for f in FEATURES}
    importance_rows = [[html.escape(feature_label.get(k, k)), _pct(v)] for k, v in importance]
    families = {}
    for f in FEATURES:
        families.setdefault(f.family, []).append(f.label)
    feature_list = "".join(f"<li><b>{html.escape(k)}:</b> {html.escape(', '.join(v))}</li>" for k, v in families.items())
    worst, best = extremes.get("worst"), extremes.get("best")

    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>AI Stock Predictor — Research Report</title>
<style>
  body {{ font: 14px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; color: #0b0b0b; max-width: 820px; margin: 32px auto; padding: 0 20px; }}
  h1 {{ font-size: 26px; margin: 0 0 4px; }} h2 {{ font-size: 17px; margin: 28px 0 6px; border-bottom: 1px solid #e1e0d9; padding-bottom: 4px; }}
  .sub {{ color: #52514e; }} .note {{ background: #f3f2ee; border-left: 3px solid #fab219; padding: 10px 14px; border-radius: 6px; margin: 14px 0; }}
  table {{ border-collapse: collapse; width: 100%; margin: 8px 0 14px; font-size: 12.5px; font-variant-numeric: tabular-nums; }}
  th, td {{ padding: 5px 8px; border-bottom: 1px solid #e1e0d9; text-align: right; }} th:first-child, td:first-child {{ text-align: left; }}
  th {{ font-weight: 600; color: #52514e; }} svg {{ width: 100%; height: auto; }} svg text {{ font-size: 10.5px; fill: #898781; }}
  .legend {{ display: flex; flex-wrap: wrap; gap: 14px; font-size: 12px; color: #52514e; margin: 6px 0; }}
  .legend i {{ display: inline-block; width: 14px; height: 3px; margin-right: 5px; vertical-align: middle; }}
  figure {{ margin: 10px 0 18px; break-inside: avoid; }} figcaption {{ font-size: 12px; color: #52514e; }}
  li {{ margin: 3px 0; }} @media print {{ body {{ margin: 0; }} h2 {{ break-after: avoid; }} }}
</style></head><body>
<h1>Can machine learning pick stocks?</h1>
<div class="sub">An AI stock-prediction and portfolio simulation · Wharton Global Youth investment project · Report generated {date.today():%B %d, %Y} · data through {meta["as_of"]}</div>
<div class="note"><b>{html.escape(DISCLAIMER)}</b></div>

<h2>1. Research question</h2>
<p>Can machine-learning models, using only information that was publicly available at the time, identify large U.S. stocks that go on to outperform — well enough that a portfolio built from their rankings beats simple alternatives after trading costs?</p>
<p><b>Hypothesis.</b> An ensemble trained on momentum, risk, valuation and growth features ranks stocks better than chance out of sample, and a portfolio of its top-ranked stocks earns a higher risk-adjusted return than holding every stock in the universe equally. <b>Null hypothesis.</b> It does not.</p>

<h2>2. Methodology</h2>
<ul>
<li><b>Universe.</b> {meta["n_stocks"]} large, liquid U.S. stocks across 11 sectors, chosen in advance; benchmark SPY (S&amp;P 500).</li>
<li><b>Data.</b> Daily prices from {meta["price_start"]} ({html.escape(meta["provider"])}); fundamentals from {html.escape(meta["fundamentals_source"])}, each value stamped with the date it became public.</li>
<li><b>Features ({meta["n_features"]}).</b><ul>{feature_list}</ul></li>
<li><b>Targets.</b> At 1, 3, 6 and 12 months: (a) is the return positive? (b) does the stock beat the median stock?</li>
<li><b>Models.</b> A base-rate baseline, logistic regression, random forest and {html.escape(meta["model_labels"]["gradient_boosting"])}; the published prediction is the plain average of the last three. Return ranges come from quantile regression with a conformal correction.</li>
<li><b>Validation.</b> Walk-forward: retrain every {meta["refit_months"]} months on all earlier data, predict the following {meta["refit_months"]} months, with a gap equal to the prediction horizon so that no label from the future is used. Hyper-parameters are tuned inside each training window only. First out-of-sample prediction: {meta["first_prediction"]}.</li>
<li><b>Score.</b> AI Score = 100 × [(1 − w) × rank(P beat peers) + w × (1 − volatility rank)], where w depends on risk tolerance (0.40 conservative, 0.20 moderate, 0 aggressive).</li>
<li><b>Backtest.</b> Each month-end buy the top {params["top_n"]} stocks by score in equal weights (max {params["max_sector"] * 100:.0f}% per sector), trade at the next day's close, pay {params["cost_bps"]:.0f} + {params["slippage_bps"]:.0f} basis points on every dollar traded. Benchmarks run through the same simulator.</li>
</ul>

<h2>3. Results: prediction skill</h2>
{_table(["Horizon", "Direction accuracy", "Naive 'always up'", "Direction AUC", "Ranking IC", "t (overlap-adjusted)", "Top − bottom fifth"], skill_rows)}
<figure>{_legend(["model", "naive"], {"model": "Ensemble accuracy", "naive": "Naive 'always up' accuracy"}, {"model": "#2a78d6", "naive": "#898781"})}{accuracy}
<figcaption>Figure 1. Directional accuracy of the ensemble against the naive forecast, by horizon (axis starts at 40%).</figcaption></figure>
<p><b>Calling direction ({HORIZON_TEXT[h]}).</b> {"The ensemble beat the naive forecast by " + f"{abs_['accuracy_lift'] * 100:.1f} points." if direction_skill else f"The ensemble was right {_pct(abs_['accuracy'])} of the time; always guessing 'up' was right {_pct(abs_['naive_accuracy'])}. It showed no skill at calling direction."}
<b>Ranking stocks.</b> Rank IC {_num(rel["rank_ic"], 3)}, overlap-adjusted t = {_num(rel["rank_ic_t_adjusted"])} — {"statistically distinguishable from zero." if rank_skill else "not statistically distinguishable from zero at the usual threshold of 2."}</p>
<p><b>Model comparison at {HORIZON_TEXT[h]}.</b></p>
{_table(["Model", "Direction accuracy", "Naive", "AUC", "Brier", "Ranking IC"], model_rows)}
<p><b>Uncertainty.</b> The "80%" predicted ranges contained the actual return {_pct(intervals.get("coverage_80"), 0)} of the time and the "50%" ranges {_pct(intervals.get("coverage_50"), 0)}; the typical miss of the median forecast was {_pct(intervals.get("median_abs_error"))} points.
{f"Worst prediction: {worst['ticker']} on {worst['date']} — forecast median {_pct(worst['predicted_median'], 1, True)}, actual {_pct(worst['actual'], 1, True)}." if worst else ""}
{f"Best high-conviction call: {best['ticker']} on {best['date']} — actual {_pct(best['actual'], 1, True)}." if best else ""}</p>
<p><b>Most important features for ranking ({HORIZON_TEXT[h]}).</b></p>
{_table(["Feature", "Share of importance"], importance_rows)}

<h2>4. Results: backtest</h2>
<p>{ai["start_date"]} to {ai["end_date"]} ({ai["years"]:.1f} years), starting with {_money(ai["start_value"])}, after costs. Sharpe ratios use a {bt["risk_free_rate"] * 100:.0f}% risk-free rate.</p>
{_table(["Strategy", "Ending value", "Total return", "Annualized", "Volatility", "Sharpe", "Max drawdown", "Trades", "Win rate"], bt_rows)}
<figure>{_legend(keys, LABELS, COLORS)}{equity}<figcaption>Figure 2. Growth of {_money(ai["start_value"])} (logarithmic scale).</figcaption></figure>
<figure>{_legend(keys[:3], LABELS, COLORS)}{drawdowns}<figcaption>Figure 3. Drawdown from each strategy's previous peak.</figcaption></figure>
<figure>{_legend(keys[:3], LABELS, COLORS)}{yearly}<figcaption>Figure 4. Calendar-year returns (first and last years are partial).</figcaption></figure>
<ul>{"".join(f"<li>{html.escape(v['text'])}</li>" for v in bt["verdict"])}</ul>

<h2>5. Limitations</h2>
<ul>
<li><b>Market unpredictability.</b> Prices already reflect public information; any edge is small and may disappear.</li>
<li><b>Survivorship bias.</b> The stock list was chosen today from companies that are large now. Failed and shrunken companies are missing, which flatters every strategy drawn from the list. The equal-weight universe, not the S&amp;P 500, is the fair benchmark.</li>
<li><b>Look-ahead bias and data leakage.</b> Addressed with filing-dated fundamentals, a purge gap and automated tests, but restated SEC values may remain.</li>
<li><b>Overfitting.</b> Trying many backtest settings and reporting the best would overstate performance; the settings reported here are the defaults fixed before the results were seen.</li>
<li><b>Choices made after seeing results.</b> Price history was extended from 2006 to 2000 to cover more market cycles; return ranges were widened with a conformal correction after the raw ranges proved too narrow; and the probability of a positive return was left out of the ranking score after showing no ranking skill. Each is a way hindsight can creep in.</li>
<li><b>Regime changes and model instability.</b> Skill varies year to year; relationships can reverse.</li>
<li><b>Limited history.</b> The test period contains few independent market cycles, and overlapping multi-month returns shrink the effective sample.</li>
<li><b>Transaction costs and slippage.</b> Modelled as a flat rate; taxes are ignored.</li>
<li><b>Data quality.</b> Free data contains errors; unavailable values are treated as missing rather than invented.</li>
</ul>

<h2>6. Conclusions</h2>
<p>{conclusion}</p>
<p>The clearest finding is about humility: predicting whether a stock goes up is close to a coin flip once the market's general upward drift is accounted for, and even where a ranking edge appears it is small, unstable, and partly a product of how the stock list was chosen. A system like this is best used to organise information and make risk visible — not as an oracle.</p>
</body></html>"""
