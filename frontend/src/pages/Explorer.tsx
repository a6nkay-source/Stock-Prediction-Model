import { ExternalLink } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts'
import { AXIS, ChartTooltip, downsample, GRID, Legend, MODEL_COLOR } from '../components/charts'
import { Badge, Callout, Card, ConfidenceBadge, ErrorBox, Loading, PageHeader, ProbBar, RangeBar, RiskBadge, Segmented, Stat, Term } from '../components/ui'
import { api, useAsync, type Factor, type Horizon, type StockDetail } from '../lib/api'
import { compactMoney, HORIZON_ADJ, HORIZON_LABEL, MODEL_LABEL, money, monthYear, NA, num, pct, shortDate, signedPct, tone } from '../lib/format'
import { useProfile } from '../lib/profile'

const RANGES = [{ value: 126, label: '6M' }, { value: 252, label: '1Y' }, { value: 756, label: '3Y' }, { value: 1260, label: '5Y' }, { value: 0, label: 'Max' }]

export default function Explorer() {
  const { ticker: param } = useParams()
  const navigate = useNavigate()
  const { profile } = useProfile()
  const universe = useAsync(() => api.predictions(profile.horizon, profile.risk), [profile.horizon, profile.risk])
  const ticker = (param ?? universe.data?.rows[0]?.ticker ?? '').toUpperCase()
  const detail = useAsync<StockDetail | null>(
    () => (ticker ? api.stock(ticker, profile.horizon, profile.risk) : Promise.resolve(null)),
    [ticker, profile.horizon, profile.risk])

  return (
    <div className="space-y-4">
      <PageHeader title="Stock Explorer" lead="Everything the model knows about one stock: the data, the prediction, the reasons, and how its past predictions turned out.">
        <select className="field !w-72" value={ticker} onChange={(e) => navigate(`/explorer/${e.target.value}`)} aria-label="Choose a stock">
          {(universe.data?.rows ?? []).slice().sort((a, b) => a.ticker.localeCompare(b.ticker)).map((r) => (
            <option key={r.ticker} value={r.ticker}>{r.ticker} — {r.name}</option>))}
        </select>
      </PageHeader>
      {detail.loading && !detail.data ? <Loading label={`Loading ${ticker}…`} />
        : detail.error ? <ErrorBox message={detail.error} onRetry={detail.reload} />
        : detail.data ? <Detail d={detail.data} /> : null}
    </div>
  )
}

function Detail({ d }: { d: StockDetail }) {
  const pred = d.predictions[d.horizon]
  const skill = d.skill[d.horizon]
  return (
    <>
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold">{d.name}</h2>
              <Badge tone="accent">{d.ticker}</Badge><Badge>{d.sector}</Badge>
              {d.industry && <Badge>{d.industry}</Badge>}
            </div>
            <p className="mt-2 line-clamp-3 text-[13px] text-ink-2">{d.summary ?? `Company description: ${NA}.`}</p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-semibold tnum">{money(d.metrics.price, 2)}</div>
            <div className="text-xs text-ink-2">Close on {shortDate(d.as_of)}</div>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="AI Score" term="AI Score" value={num(d.score, 0)} sub={d.rank ? `Rank ${d.rank} of ${d.universe_size}` : undefined} />
        <Stat label={`P(beat peers), ${HORIZON_LABEL[d.horizon]}`} term="P(beat peers)" value={pct(pred.p_beat, 0)} sub="50% is a coin flip" />
        <Stat label={`P(positive), ${HORIZON_LABEL[d.horizon]}`} term="P(positive)" value={pct(pred.p_up, 0)} sub={`Base rate for any stock: ${pct(pred.base_rate, 0)}`} />
        <Stat label="Expected range (80%)" term="Expected range" value={<span className="text-xl">{signedPct(pred.range.q10, 0)} to {signedPct(pred.range.q90, 0)}</span>} sub={`Median ${signedPct(pred.range.q50)}`} />
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="text-xs text-ink-2">Risk and <Term name="Confidence">confidence</Term></div>
          <div className="mt-2 flex flex-wrap gap-1.5"><RiskBadge level={d.metrics.risk_level} /><ConfidenceBadge {...pred.confidence} /></div>
          <div className="mt-1.5 text-xs text-ink-2">{pred.confidence.capped_for_low_skill ? 'Capped: the model has shown no directional skill at this horizon.' : `Models span ${(pred.confidence.model_spread * 100).toFixed(0)} points.`}</div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <Card title="AI reasoning" subtitle="The numbers, translated into plain language" className="xl:col-span-2">
          <ul className="space-y-2 text-[13px] leading-relaxed text-ink-2">
            {d.explanation.reasoning.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
        </Card>
        <FactorCard d={d} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <PriceChart d={d} />
        <Card title="Predictions at every horizon" subtitle="With the track record of the model that produced each one">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr className="border-b border-line text-left text-xs text-ink-2">
                <th className="py-2 pr-2 font-medium">Horizon</th><th className="px-2 font-medium">P(positive)</th>
                <th className="px-2 font-medium">P(beat peers)</th><th className="px-2 font-medium">Expected range</th>
                <th className="px-2 font-medium">Confidence</th><th className="px-2 text-right font-medium">Model accuracy / naive</th>
              </tr></thead>
              <tbody>
                {(Object.keys(d.predictions) as Horizon[]).map((h) => {
                  const p = d.predictions[h], s = d.skill[h].abs
                  return (
                    <tr key={h} className={`border-b border-line last:border-0 ${h === d.horizon ? 'bg-accent-soft/60' : ''}`}>
                      <td className="whitespace-nowrap py-2 pr-2 font-medium">{HORIZON_LABEL[h]}</td>
                      <td className="px-2"><ProbBar value={p.p_up} baseline={p.base_rate} /></td>
                      <td className="px-2"><ProbBar value={p.p_beat} /></td>
                      <td className="px-2"><div className="flex items-center gap-2"><RangeBar {...p.range} width={90} /><span className="tnum whitespace-nowrap text-xs text-ink-2">{signedPct(p.range.q10, 0)} to {signedPct(p.range.q90, 0)}</span></div></td>
                      <td className="px-2"><ConfidenceBadge {...p.confidence} /></td>
                      <td className="px-2 text-right tnum">{pct(s.accuracy)} / {pct(s.naive_accuracy)}</td>
                    </tr>)
                })}
              </tbody>
            </table>
          </div>
          <h3 className="mb-2 mt-4 text-xs font-semibold text-ink-2">How the individual models see the {HORIZON_ADJ[d.horizon]} direction</h3>
          <div className="space-y-1.5">
            {['logistic', 'random_forest', 'gradient_boosting', 'ensemble', 'baseline'].map((m) => (
              <div key={m} className="grid grid-cols-[150px_1fr_40px] items-center gap-2 text-xs">
                <span className="text-ink-2">{MODEL_LABEL[m]}</span>
                <div className="relative h-2.5 rounded-sm bg-surface-2">
                  <div className="h-full rounded-r-[4px]" style={{ width: `${(pred.p_up_models[m] ?? 0) * 100}%`, background: MODEL_COLOR[m] }} />
                  <div className="absolute inset-y-[-2px] left-1/2 w-px bg-ink/50" />
                </div>
                <span className="tnum text-right">{pct(pred.p_up_models[m], 0)}</span>
              </div>))}
          </div>
          <p className="mt-2 text-xs text-muted">Naive = always guessing “up”. If model accuracy is not above it, the direction call has shown no skill (AUC {skill.abs.auc?.toFixed(2)}).</p>
        </Card>
      </div>

      <HistoryCard d={d} />

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Price behaviour">
          <Rows rows={[
            ['1-month return', signedPct(d.metrics.returns['1m']), d.metrics.returns['1m']],
            ['3-month return', signedPct(d.metrics.returns['3m']), d.metrics.returns['3m']],
            ['6-month return', signedPct(d.metrics.returns['6m']), d.metrics.returns['6m']],
            ['1-year return', signedPct(d.metrics.returns['1y']), d.metrics.returns['1y']],
            ['3-year return', signedPct(d.metrics.returns['3y']), d.metrics.returns['3y']],
            [<Term name="Volatility" />, pct(d.metrics.volatility)],
            [<Term name="Max drawdown">Max drawdown (1Y)</Term>, pct(d.metrics.max_drawdown_1y)],
            [`Max drawdown since ${d.metrics.history_start.slice(0, 4)}`, pct(d.metrics.max_drawdown_all)],
            [<Term name="Beta" />, num(d.metrics.beta)],
            [<Term name="RSI">RSI (14-day)</Term>, num(d.metrics.rsi_14, 0)],
            ['Below 52-week high', pct(d.metrics.dist_52w_high)],
          ]} />
        </Card>
        <Card title="Fundamentals" subtitle="Growth and margin from SEC filings; the rest from Yahoo Finance">
          <Rows rows={[
            [<Term name="P/E">P/E (trailing)</Term>, num(d.fundamentals.pe ?? d.fundamentals.pe_filings, 1)],
            ['P/E (forward)', num(d.fundamentals.pe_forward, 1)],
            [<Term name="EPS growth">EPS growth (YoY, TTM)</Term>, signedPct(d.fundamentals.eps_growth), d.fundamentals.eps_growth],
            [<Term name="Revenue growth">Revenue growth (YoY, TTM)</Term>, signedPct(d.fundamentals.revenue_growth), d.fundamentals.revenue_growth],
            [<Term name="Profit margin" />, pct(d.fundamentals.profit_margin)],
            [<Term name="Debt/equity" />, num(d.fundamentals.debt_to_equity)],
            [<Term name="Free cash flow" />, compactMoney(d.fundamentals.free_cash_flow)],
            [<Term name="Market cap" />, compactMoney(d.fundamentals.market_cap)],
            [<Term name="Dividend yield" />, d.fundamentals.dividend_yield === null ? 'None / not reported' : pct(d.fundamentals.dividend_yield, 2)],
          ]} />
        </Card>
        <Card title="Analysts and earnings" subtitle="Shown for context; not inputs to the model">
          <Rows rows={[
            ['Consensus rating', d.analyst.rating ? `${d.analyst.rating.replace('_', ' ')}${d.analyst.count ? ` (${d.analyst.count} analysts)` : ''}` : 'n/a'],
            ['Mean price target', money(d.analyst.target_mean, 2)],
            ['Target range', d.analyst.target_low !== null && d.analyst.target_high !== null ? `${money(d.analyst.target_low)} – ${money(d.analyst.target_high)}` : 'n/a'],
            ['Implied move to target', signedPct(d.analyst.implied_upside), d.analyst.implied_upside],
          ]} />
          <h3 className="mb-1 mt-4 text-xs font-semibold text-ink-2">Recent earnings vs estimates</h3>
          {d.earnings.length === 0 ? <p className="text-xs text-muted">{NA}</p> : (
            <table className="w-full text-xs">
              <thead><tr className="text-left text-ink-2"><th className="py-1 font-medium">Quarter</th><th className="text-right font-medium">Actual EPS</th><th className="text-right font-medium">Estimate</th><th className="text-right font-medium">Surprise</th></tr></thead>
              <tbody>{d.earnings.map((e) => (
                <tr key={e.quarter} className="border-t border-line">
                  <td className="py-1">{monthYear(e.quarter)}</td><td className="text-right tnum">{num(e.eps_actual)}</td>
                  <td className="text-right tnum">{num(e.eps_estimate)}</td>
                  <td className={`text-right tnum ${tone(e.surprise_pct)}`}>{signedPct(e.surprise_pct)}</td>
                </tr>))}</tbody>
            </table>)}
        </Card>
      </div>

      <Card title="Recent news" subtitle={d.news_sentiment ? `Headline tone: ${d.news_sentiment.label} (${d.news_sentiment.n_positive} positive, ${d.news_sentiment.n_negative} negative of ${d.news_sentiment.n_headlines}). ${d.news_sentiment.method}` : undefined}>
        {d.news.length === 0 ? <p className="text-ink-2">{NA}</p> : (
          <ul className="divide-y divide-[var(--border)]">
            {d.news.slice(0, 8).map((n, i) => (
              <li key={i} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  {n.url ? <a href={n.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium hover:underline">{n.title} <ExternalLink className="h-3 w-3 shrink-0 text-muted" /></a> : <span className="font-medium">{n.title}</span>}
                  <div className="text-xs text-muted">{n.publisher ?? 'Unknown source'}{n.published ? ` · ${shortDate(n.published)}` : ''}</div>
                </div>
                <Badge tone={n.sentiment.label === 'positive' ? 'good' : n.sentiment.label === 'negative' ? 'bad' : 'neutral'}>{n.sentiment.label}</Badge>
              </li>))}
          </ul>)}
      </Card>
    </>
  )
}

function Rows({ rows }: { rows: [React.ReactNode, string, (number | null)?][] }) {
  return (
    <dl className="divide-y divide-[var(--border)] text-[13px]">
      {rows.map(([label, value, signal], i) => (
        <div key={i} className="flex items-center justify-between gap-3 py-1.5">
          <dt className="text-ink-2">{label}</dt>
          <dd className={`tnum font-medium ${value === 'n/a' ? 'font-normal text-muted' : signal !== undefined ? tone(signal) : ''}`}>{value === 'n/a' ? NA : value}</dd>
        </div>))}
    </dl>
  )
}

function FactorCard({ d }: { d: StockDetail }) {
  const [which, setWhich] = useState<'outperform' | 'direction'>('outperform')
  const exp = d.explanation[which]
  const usable = exp.factors.filter((f) => !f.missing)
  const positives = usable.filter((f) => f.direction === 'positive').slice(0, 6)
  const negatives = usable.filter((f) => f.direction === 'negative').slice(0, 6)
  const max = Math.max(...usable.map((f) => Math.abs(f.points)), 0.5)
  const missing = exp.factors.filter((f) => f.missing).map((f) => f.label)
  const List = ({ items, sign }: { items: Factor[]; sign: '+' | '−' }) => (
    <div>
      <h3 className="mb-2 text-xs font-semibold text-ink-2">{sign === '+' ? 'Why the model likes it' : 'What counts against it'}</h3>
      {items.length === 0 && <p className="text-xs text-muted">Nothing material.</p>}
      <ul className="space-y-2.5">
        {items.map((f) => (
          <li key={f.feature} title={f.description}>
            <div className="flex items-baseline justify-between gap-2 text-[13px]">
              <span><span className={`font-semibold ${sign === '+' ? 'text-good' : 'text-bad'}`}>{sign}</span> {f.headline} <span className="text-muted">({f.value_text})</span></span>
              <span className="tnum whitespace-nowrap text-xs text-ink-2">{f.points > 0 ? '+' : ''}{f.points.toFixed(1)} pts</span>
            </div>
            <div className="mt-1 h-1.5 rounded-sm bg-surface-2">
              <div className="h-full rounded-r-[4px]" style={{ width: `${(Math.abs(f.points) / max) * 100}%`, background: sign === '+' ? 'var(--good)' : 'var(--bad)' }} />
            </div>
          </li>))}
      </ul>
    </div>
  )
  return (
    <Card className="xl:col-span-3" title="What is driving the prediction"
      subtitle="Each factor’s push on the probability, in percentage points (logistic coefficients averaged with XGBoost SHAP values)"
      action={<Segmented value={which} onChange={setWhich} options={[{ value: 'outperform', label: 'Beating peers' }, { value: 'direction', label: 'Positive return' }]} />}>
      <div className="grid gap-6 md:grid-cols-2"><List items={positives} sign="+" /><List items={negatives} sign="−" /></div>
      <div className="mt-4 flex flex-wrap gap-1.5 border-t border-line pt-3">
        <span className="text-xs text-ink-2">Net effect by theme:</span>
        {exp.families.map((f) => <Badge key={f.family} tone={f.points > 0.05 ? 'good' : f.points < -0.05 ? 'bad' : 'neutral'}>{f.family} {f.points > 0 ? '+' : ''}{f.points.toFixed(1)}</Badge>)}
      </div>
      {missing.length > 0 && <p className="mt-2 text-xs text-muted">{NA} for: {missing.join(', ')}. The model fills these with the typical value, which lowers confidence.</p>}
    </Card>
  )
}

function PriceChart({ d }: { d: StockDetail }) {
  const [range, setRange] = useState(252)
  const data = useMemo(() => {
    const n = d.prices.dates.length
    const start = range === 0 ? 0 : Math.max(0, n - range)
    const p0 = d.prices.close[start], b0 = d.prices.benchmark[start]
    const rows = []
    for (let i = start; i < n; i++) rows.push({ date: d.prices.dates[i], stock: d.prices.close[i] / p0 - 1, bench: d.prices.benchmark[i] / b0 - 1 })
    return downsample(rows, 500)
  }, [d, range])
  return (
    <Card title="Total return vs the S&P 500" subtitle="Both start at 0% at the left edge; dividends reinvested"
      action={<Segmented value={range} onChange={setRange} options={RANGES} />}>
      <Legend items={[{ color: 'var(--s1)', label: d.ticker }, { color: 'var(--s2)', label: 'S&P 500 (SPY)' }]} />
      <div className="mt-2 h-72">
        <ResponsiveContainer>
          <ComposedChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="date" {...AXIS} tickFormatter={monthYear} minTickGap={50} />
            <YAxis {...AXIS} axisLine={false} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} width={48} />
            <ReferenceLine y={0} stroke="var(--axis)" />
            <Tooltip content={<ChartTooltip format={(v) => signedPct(v)} labelFormat={shortDate} />} />
            <Line dataKey="bench" name="S&P 500" stroke="var(--s2)" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line dataKey="stock" name={d.ticker} stroke="var(--s1)" strokeWidth={2} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}

function HistoryCard({ d }: { d: StockDetail }) {
  const s = d.history.summary
  const data = d.history.points.map((p) => ({
    date: p.date, band: p.q10 !== null && p.q90 !== null ? [p.q10, p.q90] as [number, number] : null,
    median: p.q50, actual: p.actual,
  }))
  return (
    <Card title={`Prediction vs what actually happened — ${HORIZON_ADJ[d.horizon]} horizon`}
      subtitle={`Each month’s forecast for ${d.ticker} was made by a model trained only on earlier data. The most recent forecasts have no outcome yet.`}>
      {data.length === 0 ? <p className="text-ink-2">{NA}</p> : (
        <>
          <Legend items={[{ color: 'var(--s1)', label: 'Predicted median' }, { color: 'color-mix(in srgb, var(--s1) 30%, transparent)', label: 'Predicted 80% range' }, { color: 'var(--s2)', label: 'Actual return' }]} />
          <div className="mt-2 h-72">
            <ResponsiveContainer>
              <ComposedChart data={data} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="date" {...AXIS} tickFormatter={monthYear} minTickGap={50} />
                <YAxis {...AXIS} axisLine={false} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} width={48} />
                <ReferenceLine y={0} stroke="var(--axis)" />
                <Tooltip content={<ChartTooltip format={(v) => signedPct(v)} labelFormat={(l) => `Forecast made ${shortDate(l)}`} hide={['band']} />} />
                <Area dataKey="band" name="80% range" stroke="none" fill="var(--s1)" fillOpacity={0.14} isAnimationActive={false} connectNulls />
                <Line dataKey="median" name="Predicted median" stroke="var(--s1)" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Scatter dataKey="actual" name="Actual return" fill="var(--s2)" shape={<Dot />} isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </>)}
      {s && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Mini label={`Direction right for ${d.ticker}`} value={pct(s.accuracy)} sub={`Always guessing “up”: ${pct(s.naive_accuracy)} · ${s.n} forecasts`} />
          <Mini label="Outcomes inside the 80% range" value={pct(s.coverage_80, 0)} sub="A well-calibrated range would give 80%" />
          <Mini label="Worst miss" value={`${signedPct(s.worst.actual)} actual`} sub={`Forecast median ${signedPct(s.worst.predicted)} on ${shortDate(s.worst.date)}`} />
          <Mini label="Closest call" value={`${signedPct(s.best.actual)} actual`} sub={`Forecast median ${signedPct(s.best.predicted)} on ${shortDate(s.best.date)}`} />
        </div>)}
      {s && s.accuracy !== null && s.naive_accuracy !== null && s.accuracy <= s.naive_accuracy && (
        <div className="mt-3"><Callout tone="warn">For this stock the model’s direction calls were no better than always guessing “up”. Treat the probability as a rough guide at best.</Callout></div>)}
    </Card>
  )
}

function Dot(props: { cx?: number; cy?: number; payload?: { actual: number | null } }) {
  if (props.cx === undefined || props.cy === undefined || props.payload?.actual == null) return null
  return <circle cx={props.cx} cy={props.cy} r={3} fill="var(--s2)" stroke="var(--surface)" strokeWidth={1} />
}

function Mini({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg bg-surface-2 p-3">
      <div className="text-xs text-ink-2">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tnum">{value}</div>
      <div className="text-xs text-muted">{sub}</div>
    </div>
  )
}
