import { Download, Printer } from 'lucide-react'
import type { ReactNode } from 'react'
import { Callout, Card, ErrorBox, Loading, PageHeader } from '../components/ui'
import { api, useAsync, type BacktestResponse, type Horizon, type ModelsResponse } from '../lib/api'
import { HORIZON_ADJ, HORIZON_LABEL, money, num, pct, shortDate, signedPct } from '../lib/format'

const HORIZONS: Horizon[] = ['1m', '3m', '6m', '12m']

export default function Methodology() {
  const models = useAsync(api.models, [])
  const backtest = useAsync(() => api.backtest({}), [])
  if (models.error) return <ErrorBox message={models.error} onRetry={models.reload} />
  if (!models.data || !backtest.data) return <Loading />
  const m = models.data, b = backtest.data, meta = m.meta
  const families = [...new Set(m.features.map((f) => f.family))]
  return (
    <div className="space-y-4">
      <PageHeader title="Research & Methodology"
        lead="How this project asks its question, what it did to answer it honestly, and what it found — including where it fell short.">
        <div className="no-print flex gap-2">
          <a href="/api/report?download=true" className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:opacity-90"><Download className="h-3.5 w-3.5" /> Download report</a>
          <a href="/api/report" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-xs font-medium hover:bg-surface-2"><Printer className="h-3.5 w-3.5" /> Open printable version</a>
        </div>
      </PageHeader>

      <Section n={1} title="Research question">
        <p>Can machine-learning models, using only information that was publicly available at the time, identify large U.S. stocks that go on to outperform — well enough that a portfolio built from their rankings beats simple alternatives after trading costs?</p>
      </Section>

      <Section n={2} title="Hypothesis">
        <p><strong>H₁.</strong> An ensemble trained on momentum, risk, valuation and growth features ranks stocks better than chance out of sample (rank IC above zero), and a portfolio of its top-ranked stocks earns a higher risk-adjusted return than holding every stock in the universe equally.</p>
        <p><strong>H₀.</strong> The rankings are no better than chance, and the portfolio does not beat the equal-weight benchmark after costs.</p>
        <p>We also test a harder claim — that the models can predict whether a stock will simply go <em>up</em> — expecting it to be much weaker, because that is mostly a bet on the whole market.</p>
      </Section>

      <Section n={3} title="Data sources">
        <ul>
          <li><strong>Prices:</strong> {meta.provider}. Daily closes from {shortDate(meta.price_start)} to {shortDate(meta.as_of)}, adjusted for splits and dividends, for {meta.n_stocks} large U.S. companies across 11 sectors plus the SPY exchange-traded fund as the S&P 500 benchmark.</li>
          <li><strong>Fundamentals used by the model:</strong> {meta.fundamentals_source}. Revenue, net income and earnings per share are rebuilt as trailing-twelve-month figures and stamped with the date each filing became public. They are available for {pct(meta.fundamentals_coverage, 0)} of training rows (SEC structured data begins in 2009).</li>
          <li><strong>Display-only data:</strong> current market cap, debt/equity, free cash flow, dividend yield, analyst targets, earnings surprises and news headlines come from Yahoo Finance. They are shown for context and are <em>not</em> model inputs, because no free point-in-time history exists to test them on.</li>
          <li>All downloads are cached on disk, and the provider sits behind an interface so it can be swapped. Anything missing is displayed as “Data unavailable” — never filled with a made-up value.</li>
        </ul>
      </Section>

      <Section n={4} title="Feature engineering">
        <p>{meta.n_features} features per stock per month, in {families.length} themes. Every feature for a date uses only data from that date or earlier.</p>
        <div className="mt-2 grid gap-x-6 gap-y-3 md:grid-cols-2">
          {families.map((fam) => (
            <div key={fam}><div className="text-xs font-semibold text-ink">{fam}</div>
              <div className="text-xs text-ink-2">{m.features.filter((f) => f.family === fam).map((f) => f.label).join(' · ')}</div></div>))}
        </div>
      </Section>

      <Section n={5} title="Machine-learning methodology">
        <p>Two yes/no questions are modelled at four horizons (1, 3, 6 and 12 months): <em>will the stock’s return be positive?</em> and <em>will it beat the median stock?</em> For each, four models are compared:</p>
        <ul>
          <li><strong>Baseline</strong> — predicts the historical base rate for every stock. Any real model must beat this.</li>
          <li><strong>Logistic regression</strong> — a linear model on standardised features; simple and easy to interpret.</li>
          <li><strong>Random forest</strong> — an average of many decision trees; captures non-linear effects.</li>
          <li><strong>{meta.model_labels.gradient_boosting}</strong> — trees built in sequence, each correcting the last.</li>
        </ul>
        <p>The published prediction is the plain average of the three real models (an ensemble), fixed in advance rather than chosen after seeing which did best. Expected-return ranges come from separate quantile-regression models, widened by a conformal correction measured on held-out training data.</p>
      </Section>

      <Section n={6} title="Training methodology">
        <p>Models are retrained every {meta.refit_months} months on all history available at that point; the first model is fitted after {meta.min_train_months / 12} years of data. Hyper-parameters (regularisation strength, tree depth) are chosen inside each training window, on its own most recent quarter of dates, by log loss. The test period plays no part in that choice. All candidate settings are deliberately conservative: shallow trees, large leaves, strong shrinkage.</p>
      </Section>

      <Section n={7} title="Time-series validation">
        <p>Ordinary cross-validation shuffles the data, which would let a model learn from the future. Instead we use <strong>walk-forward validation</strong>: train on the past, predict the next {meta.refit_months} months, roll forward, repeat.</p>
        <pre className="my-2 overflow-x-auto rounded-lg bg-surface-2 p-3 text-xs leading-relaxed text-ink-2">{`|-------- train --------|gap|-- test --|
|------------- train -------------|gap|-- test --|
|------------------ train ------------------|gap|-- test --|`}</pre>
        <p>The <strong>gap</strong> matters: a 12-month label created in January is not known until the following January, so a model fitted today may only use samples whose outcome has already been observed. Automated tests corrupt all future prices and confirm that no past feature changes, and that no fundamental value is used before its filing date.</p>
      </Section>

      <Section n={8} title="Backtesting methodology">
        <ul>
          <li>At each month-end, stocks are scored using only out-of-sample predictions. The top {String(b.params.top_n)} are bought in equal weights, with no more than {pct(Number(b.params.max_sector), 0)} in one sector.</li>
          <li>Trades execute at the <em>next</em> day’s close, never the same day as the signal.</li>
          <li>Every dollar traded pays {String(b.params.cost_bps)} bps in costs plus {String(b.params.slippage_bps)} bps of slippage.</li>
          <li>Three benchmarks run through the same simulator with the same costs: the S&P 500 (SPY), the whole universe held in equal weights and rebalanced monthly, and the universe bought once and never touched.</li>
        </ul>
      </Section>

      <Section n={9} title="Risk management">
        <ul>
          <li>Hard limits on any one stock and any one sector, a minimum number of holdings, and an optional cash allocation.</li>
          <li>Stock selection penalises correlation with holdings already chosen; weights come from a mean-variance optimiser using a shrunk (Ledoit-Wolf) covariance matrix.</li>
          <li>Risk tolerance changes two things only: how much weight low volatility gets in the score, and how strongly the optimiser penalises variance.</li>
          <li>Every prediction is shown with a range, a confidence label and the model’s measured track record.</li>
        </ul>
      </Section>

      <Section n={10} title="Limitations">
        <ul>
          <li><strong>Markets are largely unpredictable.</strong> Prices already reflect public information. Any edge found here is small and could vanish.</li>
          <li><strong>Survivorship bias.</strong> The {meta.n_stocks} stocks were chosen today because they are large and well known now. Companies that shrank, failed or were acquired are missing. This flatters every strategy drawn from the list, which is why the equal-weight universe — not the S&P 500 — is the fair benchmark.</li>
          <li><strong>Look-ahead bias and data leakage.</strong> Guarded against by filing-dated fundamentals, the purge gap and automated tests. One residual risk: SEC data reflects companies’ reported tags, and a handful of facts may be restated values.</li>
          <li><strong>Overfitting.</strong> With {meta.n_features} features and a few independent market cycles, models can memorise noise. The design choices were made by a researcher who could see results, which is itself a subtle form of overfitting.</li>
          <li><strong>Choices made after seeing results.</strong> Three design decisions followed early test results and are disclosed here: price history was extended from 2006 back to 2000 to include more market cycles; the expected-return ranges were widened with a conformal correction after the raw ranges proved too narrow; and the probability of a positive return was left out of the ranking score after it showed no ranking skill. Each is defensible, but each is also a way hindsight can creep in.</li>
          <li><strong>Regime changes.</strong> Relationships that held in one decade (for example, momentum) can reverse in the next. The year-by-year accuracy chart shows how unstable skill is.</li>
          <li><strong>Limited history.</strong> About {Math.round((new Date(meta.as_of).getTime() - new Date(meta.first_prediction).getTime()) / 3.156e10)} years of test data contains only a handful of bear markets. Monthly samples of multi-month returns overlap heavily, so the true sample is far smaller than the row count suggests.</li>
          <li><strong>Transaction costs and slippage.</strong> Modelled as a flat rate. Real costs vary with trade size and market stress; taxes are ignored entirely.</li>
          <li><strong>Model instability.</strong> Retraining on new data can change rankings noticeably. The three models often disagree.</li>
          <li><strong>Data quality.</strong> Free data contains errors. Some companies lack certain SEC fields (for example, per-share earnings for dual-class shares); those values are treated as missing.</li>
        </ul>
      </Section>

      <Section n={11} title="Results">
        <Results m={m} b={b} />
      </Section>

      <Callout tone="warn" title="Not financial advice">
        This is an educational simulation built for a student research project. Its predictions are uncertain estimates from historical data. Past performance does not guarantee future results.
      </Callout>
    </div>
  )
}

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <Card>
      <h2 className="mb-2 flex items-baseline gap-2 text-base font-semibold"><span className="tnum text-muted">{String(n).padStart(2, '0')}</span>{title}</h2>
      <div className="max-w-4xl space-y-2 text-[13px] leading-relaxed text-ink-2 [&_li]:ml-5 [&_li]:list-disc [&_strong]:text-ink [&_ul]:space-y-1.5">{children}</div>
    </Card>
  )
}

function Results({ m, b }: { m: ModelsResponse; b: BacktestResponse }) {
  const ai = b.stats.ai, spy = b.stats.spy, ew = b.stats.equal_weight
  const h = b.params.horizon as Horizon
  const rel = m.metrics.rel[h].models.ensemble
  const abs = m.metrics.abs[h].models.ensemble
  const rankSkill = (rel.rank_ic ?? 0) > 0 && (rel.rank_ic_t_adjusted ?? 0) >= 2
  const beatsEW = ai.annualized_return > ew.annualized_return && ai.sharpe > ew.sharpe
  const directionSkill = (abs.accuracy_lift ?? 0) > 0.005
  const conclusion = rankSkill && beatsEW
    ? 'The evidence supports H₁, with caveats: the ranking signal is statistically distinguishable from chance and the portfolio beat the equal-weight benchmark on both return and risk-adjusted return.'
    : (rel.rank_ic ?? 0) > 0 && beatsEW
      ? 'The evidence is suggestive but not conclusive: the portfolio beat the equal-weight benchmark, but the ranking signal is too weak to rule out luck.'
      : beatsEW
        ? 'Mixed: the portfolio beat the equal-weight benchmark, but the ranking signal itself shows no measurable skill, so the result may be luck or a side effect of the constraints.'
        : 'We cannot reject H₀: after costs the AI portfolio did not beat simply holding every stock in the universe equally on a risk-adjusted basis.'
  return (
    <>
      <p><strong>Prediction skill (ensemble, out of sample).</strong></p>
      <div className="overflow-x-auto">
        <table className="w-full max-w-3xl text-xs">
          <thead><tr className="border-b border-line text-left"><th className="py-1.5 font-medium">Horizon</th><th className="text-right font-medium">Direction accuracy</th><th className="text-right font-medium">Naive “always up”</th><th className="text-right font-medium">Direction AUC</th><th className="text-right font-medium">Ranking IC</th><th className="text-right font-medium">t (adjusted)</th><th className="text-right font-medium">Top − bottom fifth</th></tr></thead>
          <tbody>{HORIZONS.map((hz) => {
            const a = m.metrics.abs[hz].models.ensemble, r = m.metrics.rel[hz].models.ensemble
            return (<tr key={hz} className="border-b border-line last:border-0"><td className="py-1.5">{HORIZON_LABEL[hz]}</td>
              <td className="text-right tnum">{pct(a.accuracy)}</td><td className="text-right tnum">{pct(a.naive_accuracy)}</td><td className="text-right tnum">{num(a.auc, 3)}</td>
              <td className="text-right tnum">{num(r.rank_ic, 3)}</td><td className="text-right tnum">{num(r.rank_ic_t_adjusted, 2)}</td><td className="text-right tnum">{signedPct(r.top_minus_bottom)}</td></tr>)
          })}</tbody>
        </table>
      </div>
      <p>
        <strong>Calling direction:</strong> {directionSkill ? `at the ${HORIZON_ADJ[h]} horizon the ensemble beat the naive forecast by ${((abs.accuracy_lift ?? 0) * 100).toFixed(1)} points.` : `at the ${HORIZON_ADJ[h]} horizon the ensemble did not beat the naive “always up” forecast (${pct(abs.accuracy)} vs ${pct(abs.naive_accuracy)}).`}{' '}
        <strong>Ranking stocks:</strong> rank IC {num(rel.rank_ic, 3)}, overlap-adjusted t = {num(rel.rank_ic_t_adjusted, 2)} — {rankSkill ? 'statistically distinguishable from zero.' : 'not statistically distinguishable from zero at the usual threshold of 2.'}
      </p>
      <p><strong>Backtest ({shortDate(ai.start_date)} – {shortDate(ai.end_date)}, {money(ai.start_value)} start, top {String(b.params.top_n)} stocks, monthly, after costs).</strong></p>
      <div className="overflow-x-auto">
        <table className="w-full max-w-3xl text-xs">
          <thead><tr className="border-b border-line text-left"><th className="py-1.5 font-medium">Strategy</th><th className="text-right font-medium">Ending value</th><th className="text-right font-medium">Annualized return</th><th className="text-right font-medium">Volatility</th><th className="text-right font-medium">Sharpe</th><th className="text-right font-medium">Max drawdown</th></tr></thead>
          <tbody>{([['AI portfolio', ai], ['S&P 500 (SPY)', spy], ['Equal-weight universe', ew], ['Buy and hold', b.stats.buy_hold]] as const).map(([name, s]) => (
            <tr key={name} className="border-b border-line last:border-0"><td className="py-1.5">{name}</td><td className="text-right tnum">{money(s.end_value)}</td><td className="text-right tnum">{signedPct(s.annualized_return)}</td><td className="text-right tnum">{pct(s.volatility)}</td><td className="text-right tnum">{num(s.sharpe)}</td><td className="text-right tnum">{pct(s.max_drawdown)}</td></tr>))}</tbody>
        </table>
      </div>
      <p><strong>Conclusion.</strong> {conclusion}</p>
      <p>Beating the S&P 500 here proves little, because the equal-weight universe — a strategy with no intelligence at all — {ew.annualized_return > spy.annualized_return ? `also beat it (${signedPct(ew.annualized_return)} vs ${signedPct(spy.annualized_return)} a year)` : 'did not'}. That gap is survivorship bias made visible. Interactive charts are on the Backtesting and Model Performance pages.</p>
    </>
  )
}
