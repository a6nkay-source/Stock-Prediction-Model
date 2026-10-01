import { useMemo, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AXIS, ChartTooltip, GRID, Legend, SERIES, ShareBars } from '../components/charts'
import { Badge, Callout, Card, ErrorBox, Loading, PageHeader, Segmented, Stat, Term } from '../components/primitives'
import { api, useAsync, type BacktestResponse, type Horizon, type PerfStats, type Risk, type StrategyKey } from '../lib/api'
import { money, num, pct, shortDate, signedPct, tone, year } from '../lib/format'
import { useProfile } from '../lib/profile'

const KEYS: StrategyKey[] = ['ai', 'spy', 'equal_weight', 'buy_hold']

interface Params {
  horizon: Horizon; risk: Risk; model: string; top_n: number; rebalance_months: number; weighting: string
  max_stock: number; max_sector: number; cost_bps: number; slippage_bps: number; initial: number; start_year: number | null
}

export default function Backtesting() {
  const { profile } = useProfile()
  const [params, setParams] = useState<Params>({
    horizon: profile.horizon, risk: profile.risk, model: 'ensemble', top_n: 15, rebalance_months: 1, weighting: 'equal',
    max_stock: profile.maxStock, max_sector: profile.maxSector, cost_bps: 10, slippage_bps: 5, initial: profile.amount, start_year: null,
  })
  const set = (patch: Partial<Params>) => setParams((p) => ({ ...p, ...patch }))
  const { data, loading, error, reload } = useAsync(() => api.backtest(params), [JSON.stringify(params)])

  return (
    <div className="space-y-4">
      <PageHeader title="Backtesting"
        lead="What would have happened if the model’s rankings had been followed, month after month, using only predictions made before each trade." />
      <Card title="Simulation settings" subtitle="Every change re-runs the simulation on the stored walk-forward predictions">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          <Sel label="Signal horizon" value={params.horizon} onChange={(v) => set({ horizon: v as Horizon })} options={[['1m', '1 month'], ['3m', '3 months'], ['6m', '6 months'], ['12m', '12 months']]} />
          <Sel label="Signal model" value={params.model} onChange={(v) => set({ model: v })} options={[['ensemble', 'Ensemble'], ['logistic', 'Logistic Regression'], ['random_forest', 'Random Forest'], ['gradient_boosting', 'Gradient Boosting']]} />
          <Sel label="Risk tolerance" value={params.risk} onChange={(v) => set({ risk: v as Risk })} options={[['conservative', 'Conservative'], ['moderate', 'Moderate'], ['aggressive', 'Aggressive']]} />
          <Sel label="Rebalance" value={String(params.rebalance_months)} onChange={(v) => set({ rebalance_months: Number(v) })} options={[['1', 'Monthly'], ['3', 'Quarterly'], ['6', 'Twice a year'], ['12', 'Yearly']]} />
          <Sel label="Weighting" value={params.weighting} onChange={(v) => set({ weighting: v })} options={[['equal', 'Equal weight'], ['inverse_vol', 'Inverse volatility']]} />
          <Sel label="Start year" value={String(params.start_year ?? '')} onChange={(v) => set({ start_year: v ? Number(v) : null })} options={[['', 'Earliest'], ...['2008', '2010', '2013', '2016', '2019', '2021', '2023'].map((y) => [y, y] as [string, string])]} />
          <NumField label="Stocks held" value={params.top_n} min={3} max={40} onChange={(v) => set({ top_n: v })} />
          <NumField label="Max per stock (%)" value={Math.round(params.max_stock * 100)} min={3} max={100} onChange={(v) => set({ max_stock: v / 100 })} />
          <NumField label="Max per sector (%)" value={Math.round(params.max_sector * 100)} min={10} max={100} onChange={(v) => set({ max_sector: v / 100 })} />
          <NumField label="Trading cost (bps)" value={params.cost_bps} min={0} max={200} onChange={(v) => set({ cost_bps: v })} />
          <NumField label="Slippage (bps)" value={params.slippage_bps} min={0} max={200} onChange={(v) => set({ slippage_bps: v })} />
          <NumField label="Starting value ($)" value={params.initial} min={100} max={1e9} onChange={(v) => set({ initial: v })} />
        </div>
        <p className="mt-3 text-xs text-muted">1 bps = 0.01%. Costs are charged on every dollar traded. Trades happen at the close of the day after each signal.</p>
      </Card>
      {error ? <ErrorBox message={error} onRetry={reload} /> : !data ? <Loading label="Running the simulation…" /> : <Results data={data} stale={loading} />}
    </div>
  )
}

function Sel({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="block"><span className="mb-1 block text-xs font-medium text-ink-2">{label}</span>
      <select className="field" value={value} onChange={(e) => onChange(e.target.value)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    </label>)
}
function NumField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value))
  const commit = () => {
    const v = Math.min(max, Math.max(min, Number(text) || min))
    setText(String(v))
    if (v !== value) onChange(v)
  }
  return (
    <label className="block"><span className="mb-1 block text-xs font-medium text-ink-2">{label}</span>
      <input className="field tnum" type="number" min={min} max={max} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
    </label>)
}

function Results({ data, stale }: { data: BacktestResponse; stale: boolean }) {
  const [log, setLog] = useState(true)
  const ai = data.stats.ai
  const equity = useMemo(() => data.series.dates.map((date, i) => ({ date, ai: data.series.ai[i], spy: data.series.spy[i], equal_weight: data.series.equal_weight[i], buy_hold: data.series.buy_hold[i] })), [data])
  const dd = useMemo(() => data.drawdowns.dates.map((date, i) => ({ date, ai: data.drawdowns.ai[i], spy: data.drawdowns.spy[i], equal_weight: data.drawdowns.equal_weight[i] })), [data])
  const rolling = useMemo(() => data.series.dates.map((date, i) => ({ date, spy: data.rolling_excess.spy[i], equal_weight: data.rolling_excess.equal_weight[i] })).filter((r) => r.spy !== null), [data])
  const legend = KEYS.map((k) => ({ color: SERIES[k].color, label: SERIES[k].label }))

  return (
    <div className={`space-y-4 transition-opacity ${stale ? 'opacity-60' : ''}`}>
      <Card title="What the backtest shows" subtitle={`${shortDate(ai.start_date)} to ${shortDate(ai.end_date)} · ${ai.years.toFixed(1)} years · ${data.n_rebalances} rebalances`}>
        <ul className="space-y-2">
          {data.verdict.map((v, i) => (
            <li key={i} className="flex items-start gap-2 text-[13px] leading-relaxed">
              <Badge tone={v.tone}>{v.tone === 'good' ? 'Ahead' : v.tone === 'bad' ? 'Behind' : 'Caution'}</Badge>
              <span className="text-ink-2">{v.text}</span>
            </li>))}
        </ul>
      </Card>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Starting value" value={money(ai.start_value)} />
        <Stat label="Ending value" value={money(ai.end_value)} sub={`S&P 500: ${money(data.stats.spy.end_value)}`} />
        <Stat label="Total return" value={signedPct(ai.total_return, 0)} tone={tone(ai.total_return)} sub={`Equal-weight: ${signedPct(data.stats.equal_weight.total_return, 0)}`} />
        <Stat label="Annualized return" term="Annualized return" value={signedPct(ai.annualized_return)} sub={`S&P 500: ${signedPct(data.stats.spy.annualized_return)}`} />
        <Stat label="Max drawdown" term="Max drawdown" value={pct(ai.max_drawdown)} tone="text-bad" sub={`S&P 500: ${pct(data.stats.spy.max_drawdown)}`} />
        <Stat label="Sharpe ratio" term="Sharpe ratio" value={num(ai.sharpe)} sub={`Risk-free rate ${pct(data.risk_free_rate, 0)}`} />
        <Stat label="Volatility" term="Volatility" value={pct(ai.volatility)} sub={`S&P 500: ${pct(data.stats.spy.volatility)}`} />
        <Stat label="Number of trades" value={ai.n_trades.toLocaleString()} sub={`${pct(ai.turnover, 0)} turnover per rebalance`} />
        <Stat label="Win rate" term="Win rate" value={pct(ai.win_rate, 0)} sub={`${ai.round_trips} closed positions`} />
        <Stat label="Costs paid" value={money(ai.total_costs)} sub="Commission, spread and slippage" />
      </div>

      <Card title="Growth of the portfolio" subtitle="All four strategies start with the same money on the same day and pay the same trading costs"
        action={<Segmented value={log ? 'log' : 'linear'} onChange={(v) => setLog(v === 'log')} options={[{ value: 'log', label: 'Log scale' }, { value: 'linear', label: 'Linear' }]} />}>
        <Legend items={legend} />
        <div className="mt-2 h-80">
          <ResponsiveContainer>
            <LineChart data={equity} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid {...GRID} />
              <XAxis dataKey="date" {...AXIS} tickFormatter={year} minTickGap={40} />
              <YAxis {...AXIS} axisLine={false} scale={log ? 'log' : 'linear'} domain={['auto', 'auto']} width={62} allowDataOverflow
                tickFormatter={(v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${(v / 1000).toFixed(0)}k`)} />
              <Tooltip content={<ChartTooltip format={(v) => money(v)} labelFormat={shortDate} />} />
              {(['buy_hold', 'equal_weight', 'spy', 'ai'] as StrategyKey[]).map((k) => (
                <Line key={k} dataKey={k} name={SERIES[k].label} stroke={SERIES[k].color} strokeWidth={2} dot={false} isAnimationActive={false} />))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Drawdown" subtitle="How far each strategy was below its own previous peak">
          <Legend items={legend.slice(0, 3)} />
          <div className="mt-2 h-60">
            <ResponsiveContainer>
              <LineChart data={dd} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="date" {...AXIS} tickFormatter={year} minTickGap={40} />
                <YAxis {...AXIS} axisLine={false} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} width={44} />
                <Tooltip content={<ChartTooltip format={(v) => pct(v)} labelFormat={shortDate} />} />
                {(['equal_weight', 'spy', 'ai'] as StrategyKey[]).map((k) => (
                  <Line key={k} dataKey={k} name={SERIES[k].label} stroke={SERIES[k].color} strokeWidth={k === 'ai' ? 2 : 1.5} dot={false} isAnimationActive={false} />))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Rolling one-year lead over the benchmarks" subtitle="AI portfolio’s trailing 12-month return minus each benchmark’s. Below zero = the AI portfolio was behind.">
          <Legend items={[{ color: SERIES.spy.color, label: 'vs S&P 500' }, { color: SERIES.equal_weight.color, label: 'vs equal-weight universe' }]} />
          <div className="mt-2 h-60">
            <ResponsiveContainer>
              <LineChart data={rolling} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="date" {...AXIS} tickFormatter={year} minTickGap={40} />
                <YAxis {...AXIS} axisLine={false} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} width={44} />
                <ReferenceLine y={0} stroke="var(--ink-2)" />
                <Tooltip content={<ChartTooltip format={(v) => `${signedPct(v)} pts`} labelFormat={shortDate} />} />
                <Line dataKey="spy" name="vs S&P 500" stroke={SERIES.spy.color} strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line dataKey="equal_weight" name="vs equal-weight" stroke={SERIES.equal_weight.color} strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <Card title="Side-by-side comparison" subtitle="Alpha, beta and information ratio are measured against the S&P 500">
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead><tr className="border-b border-line text-xs text-ink-2">
              <th className="py-2 text-left font-medium">Measure</th>
              {KEYS.map((k) => <th key={k} className="px-2 text-right font-medium"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: SERIES[k].color }} />{SERIES[k].label}</span></th>)}
            </tr></thead>
            <tbody>
              {COMPARE.map(([label, term, fmt]) => (
                <tr key={label} className="border-b border-line last:border-0">
                  <td className="py-1.5 text-ink-2">{term ? <Term name={term}>{label}</Term> : label}</td>
                  {KEYS.map((k) => <td key={k} className={`px-2 text-right tnum ${k === 'ai' ? 'font-semibold' : ''}`}>{fmt(data.stats[k])}</td>)}
                </tr>))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Year by year" subtitle="Calendar-year returns. The first and last years are partial.">
        <Legend items={legend.slice(0, 3)} />
        <div className="mt-2 h-64">
          <ResponsiveContainer>
            <BarChart data={data.yearly} margin={{ top: 5, right: 8, left: 0, bottom: 0 }} barGap={2} barCategoryGap="18%">
              <CartesianGrid {...GRID} />
              <XAxis dataKey="year" {...AXIS} />
              <YAxis {...AXIS} axisLine={false} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} width={44} />
              <ReferenceLine y={0} stroke="var(--axis)" />
              <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<ChartTooltip format={(v) => signedPct(v)} />} />
              {(['ai', 'spy', 'equal_weight'] as StrategyKey[]).map((k) => <Bar key={k} dataKey={k} name={SERIES[k].label} fill={SERIES[k].color} radius={[3, 3, 0, 0]} maxBarSize={14} isAnimationActive={false} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-ink-2">Show as a table</summary>
          <table className="mt-2 w-full max-w-xl">
            <thead><tr className="text-left text-ink-2"><th className="py-1 font-medium">Year</th>{KEYS.map((k) => <th key={k} className="text-right font-medium">{SERIES[k].label}</th>)}</tr></thead>
            <tbody>{data.yearly.map((y) => <tr key={y.year} className="border-t border-line"><td className="py-1">{y.year}</td>{KEYS.map((k) => <td key={k} className={`text-right tnum ${tone(y[k])}`}>{signedPct(y[k])}</td>)}</tr>)}</tbody>
          </table>
        </details>
      </Card>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Holdings after the last rebalance" subtitle={`${shortDate(data.last_rebalance)} · average ${num(data.avg_holdings, 1)} stocks held`}>
          <ShareBars rows={data.holdings.map((h) => ({ label: h.ticker, value: h.weight }))} format={(v) => pct(v, 1)} />
          <h3 className="mb-2 mt-4 text-xs font-semibold text-ink-2">By sector</h3>
          <ShareBars rows={data.sectors.map((s) => ({ label: s.sector, value: s.weight }))} format={(v) => pct(v, 0)} />
        </Card>
        <Card title="Best and worst closed positions" subtitle="Return from the day bought to the day fully sold">
          <TradeList title="Best" rows={data.best_trades} />
          <TradeList title="Worst" rows={data.worst_trades} />
        </Card>
        <Card title="Most recent trades">
          <ul className="max-h-80 divide-y divide-[var(--border)] overflow-y-auto text-xs">
            {data.recent_trades.map((t, i) => (
              <li key={i} className="flex items-center justify-between py-1.5">
                <span><Badge tone={t.action === 'BUY' ? 'good' : 'bad'}>{t.action}</Badge> <span className="ml-1 font-semibold">{t.ticker}</span></span>
                <span className="tnum text-ink-2">{signedPct(t.weight_change)} of portfolio · {shortDate(t.date)}</span>
              </li>))}
          </ul>
        </Card>
      </div>

      <Callout tone="warn" title="Read this before believing any backtest">
        A backtest is a simulation, not a track record. The stock list was chosen with hindsight (survivorship bias), real trading costs and taxes
        would differ, the settings above can be tuned until something looks good (overfitting), and markets change. If you try many settings,
        the best-looking result is the least trustworthy one.
      </Callout>
    </div>
  )
}

const COMPARE: [string, string | null, (s: PerfStats) => string][] = [
  ['Ending value', null, (s) => money(s.end_value)],
  ['Total return', null, (s) => signedPct(s.total_return, 0)],
  ['Annualized return', 'Annualized return', (s) => signedPct(s.annualized_return)],
  ['Volatility', 'Volatility', (s) => pct(s.volatility)],
  ['Sharpe ratio', 'Sharpe ratio', (s) => num(s.sharpe)],
  ['Sortino ratio', 'Sortino ratio', (s) => num(s.sortino)],
  ['Max drawdown', 'Max drawdown', (s) => pct(s.max_drawdown)],
  ['Best month', null, (s) => signedPct(s.best_month)],
  ['Worst month', null, (s) => signedPct(s.worst_month)],
  ['Positive months', null, (s) => pct(s.positive_months, 0)],
  ['Months beating the S&P 500', null, (s) => pct(s.months_beating_benchmark, 0, false, '—')],
  ['Beta', 'Beta', (s) => num(s.beta, 2, '—')],
  ['Alpha (per year)', 'Alpha', (s) => signedPct(s.alpha, 1, '—')],
  ['Information ratio', 'Information ratio', (s) => num(s.information_ratio, 2, '—')],
  ['Trades', null, (s) => s.n_trades.toLocaleString()],
  ['Turnover per rebalance', 'Turnover', (s) => pct(s.turnover, 0)],
  ['Costs paid', null, (s) => money(s.total_costs)],
]

function TradeList({ title, rows }: { title: string; rows: BacktestResponse['best_trades'] }) {
  return (
    <div className="mb-3">
      <h3 className="mb-1 text-xs font-semibold text-ink-2">{title}</h3>
      {rows.length === 0 ? <p className="text-xs text-muted">No closed positions.</p> : (
        <ul className="divide-y divide-[var(--border)] text-xs">
          {rows.map((t, i) => (
            <li key={i} className="flex items-center justify-between py-1.5">
              <span><span className="font-semibold">{t.ticker}</span> <span className="text-muted">{shortDate(t.entry)} → {shortDate(t.exit)}</span></span>
              <span className={`tnum font-medium ${tone(t.return)}`}>{signedPct(t.return)}</span>
            </li>))}
        </ul>)}
    </div>
  )
}
