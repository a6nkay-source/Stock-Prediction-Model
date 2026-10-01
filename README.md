# AI Stock Predictor — Portfolio Research Lab

An educational stock-prediction and portfolio-simulation web app, built for a Wharton Global
Youth investment project. It analyses 74 real large-cap U.S. stocks, estimates the probability
that each one rises or beats its peers over 1, 3, 6 and 12 months, explains why, builds a
diversified portfolio for an investor profile you define, and backtests the whole thing against
simple benchmarks.

> **Not financial advice.** This is a simulation for learning. Predictions are uncertain
> estimates from historical data, and past performance does not guarantee future results.

The project's guiding rule: **report what the models actually did, not what we hoped they
would do.** Where the models show no skill, the app says so on the page.

## What it found (data through 30 September 2026)

| Question | Result |
|---|---|
| Can the models call direction (up/down)? | **No.** At 6 months the ensemble was right 66.5% of the time; always guessing "up" was right 67.9%. AUC 0.48. Same story at every horizon. |
| Can they rank stocks against each other? | **Weakly.** Rank IC 0.02–0.10 depending on horizon; overlap-adjusted t-statistics of 1.5–1.9, just short of the usual bar of 2. |
| Did the AI portfolio beat the S&P 500? | Yes: 14.5% a year vs 11.0% (2006–2026, after costs). |
| Did it beat simply holding every stock equally? | **No**: 14.5% vs 16.1% a year, with a lower Sharpe ratio (0.61 vs 0.77) and a deeper worst loss (−58% vs −47%). |
| Were the predicted return ranges honest? | Yes: the "80%" ranges contained the outcome 79% of the time. |

Those backtest figures are for the default settings (6-month signal, moderate risk, top 15 stocks,
monthly rebalance). Other settings do better — the 12-month signal reaches about 20% a year — but
picking the best-looking setting after the fact is exactly the overfitting the project warns
about, so the defaults are what get reported.

Beating the S&P 500 proves little here, because the equal-weight universe — a strategy with no
intelligence at all — beat it too. That gap is survivorship bias: the stock list was chosen
today, from companies that turned out to be winners.

## Run it

Requirements: Python 3.11+ and Node 20+. No API keys are needed.

```bash
python3 -m venv .venv
```
```bash
.venv/bin/pip install -r requirements.txt
```
```bash
.venv/bin/python -m backend.pipeline
```

The pipeline downloads prices and SEC filings, trains every model with walk-forward validation
and writes the results to `models/artifacts/`. It takes roughly 20 minutes on a laptop. Add
`--fast` for a four-minute smoke test with small models, or `--refresh` to ignore the cache.

Then start the API and the frontend in two terminals:

```bash
.venv/bin/uvicorn backend.main:app --port 8000
```
```bash
cd frontend && npm install && npm run dev
```

Open http://localhost:5173. To serve everything from one port instead, run `npm run build` in
`frontend/` and open http://localhost:8000.

Run the tests with:

```bash
.venv/bin/python -m pytest
```

### Configuration

Copy `.env.example` to `.env` to change settings. `.env` is git-ignored; the browser never sees
it, because the frontend only talks to `/api`.

| Variable | Default | Meaning |
|---|---|---|
| `DATA_PROVIDER` | `yahoo` | `yahoo`, or `stooq` (prices only) |
| `SEC_USER_AGENT` | project name | How to identify yourself to SEC EDGAR (`Name email@example.com`) |
| `PRICE_START` | `2000-01-01` | First date of price history |
| `RISK_FREE_RATE` | `0.02` | Annual rate used in Sharpe ratios |
| `CACHE_DIR` | `data/cache` | Where downloads are cached |

## The pages

| Page | What it shows |
|---|---|
| **Portfolio Overview** | A board of twelve draggable widgets (suggested portfolio, model track record, top-ranked stocks, S&P 500, backtest, sectors, risk/return and more) that you can rearrange, lock and reset; the layout is saved in the browser. Sector performance and correlations sit below it |
| **AI Stock Predictor** | Every stock ranked by AI Score, with probabilities, expected range, risk, confidence, past returns and fundamentals in sortable columns |
| **Stock Explorer** | One stock in depth: price chart, predictions at every horizon, plain-language reasoning, factor contributions, every past prediction against what happened, fundamentals, analysts, earnings, news |
| **Portfolio Builder** | Investor profile form (amount, horizon, risk, limits, sectors to prefer or avoid, current holdings) and the optimised portfolio it produces |
| **Backtesting** | Adjustable simulation against the S&P 500, equal-weight and buy-and-hold: growth, drawdown, yearly returns, trades |
| **Model Performance** | Accuracy against the naive forecast, AUC, rank IC, calibration, accuracy by year, feature importance, interval coverage, best and worst predictions |
| **Methodology** | The research write-up, with a downloadable printable report |

## How the prediction works

1. **Data.** Daily adjusted prices from Yahoo Finance. Fundamentals from SEC EDGAR, where every
   number carries the date it was *filed* — so the model only ever sees what the market could
   have known. (Yahoo's fundamentals are a snapshot of today and would leak the future into
   historical training; they are used for display only.)
2. **Features (31).** Momentum, trend, volatility, drawdown, beta, sector-relative strength,
   market conditions, valuation (earnings yield), EPS and revenue growth, profit margin.
3. **Targets.** For each horizon: *is the return positive?* and *does it beat the median stock?*
4. **Models.** A base-rate baseline, logistic regression, random forest and XGBoost. The published
   number is the plain average of the last three, fixed in advance. Expected-return ranges come
   from quantile regression with a conformal correction.
5. **Walk-forward validation.** Retrain every 12 months on earlier data only, with a gap equal
   to the horizon so no future label is used. Hyper-parameters are tuned inside each training
   window, never on the test period.
6. **Score.** `AI Score = 100 × [(1 − w) × rank(P beat peers) + w × (1 − volatility rank)]`, where
   `w` is 0.40, 0.20 or 0 for conservative, moderate or aggressive investors.
7. **Explanations.** Per-stock factor contributions: logistic coefficients averaged with XGBoost
   SHAP values, translated into sentences.

## How the backtest works

At each month-end the stocks are scored using only out-of-sample predictions. The top 15 are
bought in equal weights (at most 30% per sector), **at the next day's close**, paying 10 bps in
costs and 5 bps of slippage on every dollar traded. The S&P 500, an equal-weight universe and a
buy-and-hold portfolio run through the same simulator with the same costs.

Automated tests corrupt all future prices and assert that no past feature changes, that no
fundamental is used before its filing date, and that a trade never earns the return of the day
its signal was generated.

## Project layout

```
data/          provider interface, Yahoo / Stooq / SEC EDGAR providers, disk cache, universe.csv
models/        features, walk-forward training, evaluation, explanations, scoring, portfolio optimiser
backtesting/   simulator, performance metrics, weighting rules
backend/       FastAPI app, pipeline, service layer, report generator
frontend/      React + TypeScript + Tailwind + Recharts + Motion (shadcn-style layout: src/components/ui, "@/" alias)
tests/         look-ahead, backtest and portfolio tests
```

**Adding UI components:** the frontend follows the shadcn layout (`components.json`, the `@/`
import alias, `src/components/ui/`, `cn()` in `src/lib/utils.ts`), so `npx shadcn@latest add <name>`
works from `frontend/`. shadcn colour names such as `bg-card` and `ring-border` are mapped onto
this app's own light and dark tokens in `src/index.css`.

**Adding stocks:** add a row to `data/universe.csv` (ticker, name, sector, SEC CIK) and re-run
the pipeline. **Swapping the data vendor:** implement `MarketDataProvider` in
`data/providers/base.py` and register it in `data/providers/__init__.py`.

## Limitations

- **Survivorship bias.** The universe is today's large caps. Failed and shrunken companies are
  missing, which flatters every strategy drawn from the list.
- **No demonstrated directional skill.** The probability of a positive return is shown, but it
  did not beat the base rate in testing. Confidence scores are capped accordingly.
- **Weak, unstable ranking skill.** Not statistically conclusive, and it varies year to year.
- **Choices made after seeing results.** History was extended from 2006 to 2000, return ranges
  were conformally widened, and P(positive) was dropped from the score — all after early results.
- **Costs are simplified.** Flat basis points; no taxes, no market impact.
- **Free data has gaps.** SEC per-share data is missing for some dual-class companies (Visa,
  Berkshire Hathaway) and before 2009; those values are treated as missing, never invented.
  News sentiment is a simple keyword count, shown for context and not used by the model.
- **Yahoo Finance is unofficial.** It can rate-limit or change without notice; the Stooq
  provider is the price fallback.

## What could be improved

- A point-in-time index membership list, to remove survivorship bias properly.
- More history and more stocks (mid-caps), for more independent market cycles.
- Historical analyst estimates and news, so they could be tested rather than only displayed.
- Purged, embargoed cross-validation and a deflated Sharpe ratio to account for multiple testing.
- A turnover penalty in the backtest's portfolio construction.

Inspired in part by [quantsim](https://github.com/NeilGilani/quantsim): costs on by default,
benchmarks always shown side by side, and no-look-ahead enforced by tests.
