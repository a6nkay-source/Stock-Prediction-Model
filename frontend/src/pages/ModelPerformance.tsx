import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts'
import { AXIS, ChartTooltip, GRID, Legend, MODEL_COLOR } from '../components/charts'
import { Badge, Callout, Card, ErrorBox, Loading, PageHeader, Segmented, Stat, Term } from '../components/primitives'
import { api, useAsync, type Horizon, type HorizonMetrics, type ModelsResponse } from '../lib/api'
import { HORIZON_ADJ, HORIZON_LABEL, MODEL_LABEL, num, pct, shortDate, signedPct } from '../lib/format'
import { useProfile } from '../lib/profile'

const MODELS = ['baseline', 'logistic', 'random_forest', 'gradient_boosting', 'ensemble']
type Target = 'abs' | 'rel'

export default function ModelPerformance() {
  const { profile } = useProfile()
  const { data, loading, error, reload } = useAsync(api.models, [])
  const [horizon, setHorizon] = useState<Horizon>(profile.horizon)
  const [target, setTarget] = useState<Target>('abs')
  if (loading && !data) return <Loading />
  if (error || !data) return <ErrorBox message={error ?? 'No data'} onRetry={reload} />
  const node = data.metrics[target][horizon]
  return (
    <div className="space-y-4">
      <PageHeader title="Model Performance"
        lead="How the models did on data they had never seen. Every number here comes from walk-forward testing and is shown as measured.">
        <div className="flex flex-wrap gap-2">
          <Segmented<Target> value={target} onChange={setTarget} label="Question" options={[{ value: 'abs', label: 'Will it go up?' }, { value: 'rel', label: 'Will it beat its peers?' }]} />
          <Segmented<Horizon> value={horizon} onChange={setHorizon} label="Horizon" options={(['1m', '3m', '6m', '12m'] as Horizon[]).map((h) => ({ value: h, label: HORIZON_LABEL[h] }))} />
        </div>
      </PageHeader>
      <Verdict node={node} target={target} horizon={horizon} />
      <Summary data={data} />
      <ModelTable node={node} labels={data.meta.model_labels} />
      <div className="grid gap-4 xl:grid-cols-2">
        <AccuracyByYear node={node} />
        <Calibration node={node} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Importance data={data} target={target} horizon={horizon} />
        <div className="space-y-4">
          <HorizonComparison data={data} target={target} />
          {target === 'abs' && <Intervals node={node} horizon={horizon} />}
        </div>
      </div>
    </div>
  )
}

function Verdict({ node, target, horizon }: { node: HorizonMetrics; target: Target; horizon: Horizon }) {
  const e = node.models.ensemble
  const lift = e.accuracy_lift ?? 0
  const t = e.rank_ic_t_adjusted ?? 0
  const ic = e.rank_ic ?? 0
  if (target === 'abs') {
    const bad = lift <= 0.005
    return (
      <Callout tone={bad ? 'bad' : 'warn'} title={bad ? 'The models did not beat the naive forecast' : 'A small edge over the naive forecast'}>
        Over {HORIZON_LABEL[horizon]}, stocks in this universe rose {pct(e.base_rate)} of the time, so always answering “up” is right {pct(e.naive_accuracy)} of the time.
        The ensemble was right {pct(e.accuracy)} of the time — {bad ? 'no better' : `${(lift * 100).toFixed(1)} points better`}. Its AUC of {e.auc?.toFixed(3)} is
        {(e.auc ?? 0.5) < 0.5 ? ' below 0.5, meaning its probability ordering was, if anything, backwards.' : (e.auc ?? 0.5) < 0.53 ? ' barely above a coin flip.' : ' modestly above a coin flip.'}{' '}
        Predicting whether the market goes up is extremely hard, and this model has not solved it.
      </Callout>)
  }
  const tone = ic <= 0 ? 'bad' : t >= 2 ? 'good' : 'warn'
  return (
    <Callout tone={tone} title={ic <= 0 ? 'No ranking skill at this horizon' : t >= 2 ? 'Modest, statistically meaningful ranking skill' : 'Weak ranking skill — not statistically conclusive'}>
      Picking which stocks will beat the median is a fairer test than calling direction. The ensemble was right {pct(e.accuracy)} of the time (a coin flip is 50%).
      Its rank IC is {ic.toFixed(3)} with an overlap-adjusted t-statistic of {t.toFixed(2)} (about 2 or more is the usual bar for “probably not luck”).
      Its top fifth of picks beat its bottom fifth by {signedPct(e.top_minus_bottom)} per {HORIZON_LABEL[horizon]} on average.
      Even a real edge of this size is small, noisy, and partly a product of the hand-picked universe.
    </Callout>)
}

function Summary({ data }: { data: ModelsResponse }) {
  const m = data.meta
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <Stat label="Stocks" value={m.n_stocks} sub="Large-cap U.S. companies" />
      <Stat label="Training rows" value={m.n_rows.toLocaleString()} sub="One per stock per month" />
      <Stat label="Features" value={m.n_features} sub={`SEC fundamentals on ${pct(m.fundamentals_coverage, 0)} of rows`} />
      <Stat label="Test period" value={<span className="text-xl">{m.first_prediction.slice(0, 4)}–{m.as_of.slice(0, 4)}</span>} sub={`Prices from ${m.price_start.slice(0, 4)}`} />
      <Stat label="Retraining" value={<span className="text-xl">Every {m.refit_months} months</span>} sub={`First model after ${m.min_train_months / 12} years of data`} />
    </div>
  )
}

function ModelTable({ node, labels }: { node: HorizonMetrics; labels: Record<string, string> }) {
  const best = Math.max(...MODELS.filter((m) => m !== 'baseline').map((m) => node.models[m].auc ?? 0))
  return (
    <Card title="Model comparison" subtitle={`Out-of-sample predictions from ${shortDate(node.first_date)}; outcomes known through ${shortDate(node.last_labelled_date)} · ${node.models.ensemble.n?.toLocaleString()} predictions over ${node.models.ensemble.n_dates} months`}>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead><tr className="border-b border-line text-xs text-ink-2">
            <th className="py-2 text-left font-medium">Model</th>
            <th className="px-2 text-right font-medium">Accuracy</th>
            <th className="px-2 text-right font-medium"><Term name="Naive accuracy">Naive</Term></th>
            <th className="px-2 text-right font-medium">Edge</th>
            <th className="px-2 text-right font-medium"><Term name="AUC" /></th>
            <th className="px-2 text-right font-medium"><Term name="Brier score">Brier</Term></th>
            <th className="px-2 text-right font-medium"><Term name="Rank IC" /></th>
            <th className="px-2 text-right font-medium">t (adjusted)</th>
            <th className="px-2 text-right font-medium">Top − bottom fifth</th>
          </tr></thead>
          <tbody>{MODELS.map((m) => {
            const x = node.models[m]
            const lift = x.accuracy_lift ?? 0
            return (
              <tr key={m} className="border-b border-line last:border-0">
                <td className="py-2"><span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: MODEL_COLOR[m] }} />
                  <span className="font-medium">{labels[m] ?? MODEL_LABEL[m]}</span>{m !== 'baseline' && x.auc === best && <Badge tone="accent">highest AUC</Badge>}</span></td>
                <td className="px-2 text-right tnum font-semibold">{pct(x.accuracy)}</td>
                <td className="px-2 text-right tnum text-ink-2">{pct(x.naive_accuracy)}</td>
                <td className={`px-2 text-right tnum ${lift > 0.005 ? 'text-good' : lift < -0.005 ? 'text-bad' : 'text-ink-2'}`}>{m === 'baseline' ? '—' : `${lift > 0 ? '+' : ''}${(lift * 100).toFixed(1)} pts`}</td>
                <td className="px-2 text-right tnum">{m === 'baseline' ? '—' : num(x.auc, 3)}</td>
                <td className="px-2 text-right tnum">{num(x.brier, 4)}</td>
                <td className="px-2 text-right tnum">{num(x.rank_ic, 3, '—')}</td>
                <td className="px-2 text-right tnum">{num(x.rank_ic_t_adjusted, 2, '—')}</td>
                <td className="px-2 text-right tnum">{signedPct(x.top_minus_bottom, 1, '—')}</td>
              </tr>)
          })}</tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">
        The baseline predicts the historical base rate for every stock, so it cannot rank. “Edge” is accuracy minus the naive forecast. A lower Brier score is better.
        The t-statistic is shrunk to account for overlapping monthly samples.
      </p>
    </Card>
  )
}

function AccuracyByYear({ node }: { node: HorizonMetrics }) {
  const rows = node.models.ensemble.by_year.map((y) => ({ year: y.year, model: y.accuracy, naive: y.naive_accuracy, n: y.n }))
  const wins = rows.filter((r) => r.model > r.naive).length
  return (
    <Card title="Accuracy year by year" subtitle={`Ensemble vs the naive forecast. The model beat naive in ${wins} of ${rows.length} years — skill that comes and goes is a sign of instability.`}>
      <Legend items={[{ color: 'var(--s1)', label: 'Ensemble accuracy' }, { color: 'var(--muted)', label: 'Naive (majority) accuracy' }]} />
      <div className="mt-2 h-64">
        <ResponsiveContainer>
          <BarChart data={rows} margin={{ top: 5, right: 8, left: 0, bottom: 0 }} barGap={2}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="year" {...AXIS} />
            <YAxis {...AXIS} axisLine={false} domain={[0, 1]} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} width={40} />
            <ReferenceLine y={0.5} stroke="var(--axis)" />
            <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={<ChartTooltip format={(v) => pct(v)} />} />
            <Bar dataKey="model" name="Ensemble" fill="var(--s1)" radius={[3, 3, 0, 0]} maxBarSize={14} isAnimationActive={false} />
            <Bar dataKey="naive" name="Naive" fill="var(--muted)" radius={[3, 3, 0, 0]} maxBarSize={14} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}

function Calibration({ node }: { node: HorizonMetrics }) {
  const rows = node.models.ensemble.calibration.map((c) => ({ predicted: c.predicted, observed: c.observed, n: c.n }))
  const lo = Math.min(...rows.map((r) => Math.min(r.predicted, r.observed)), 0.4) - 0.03
  const hi = Math.max(...rows.map((r) => Math.max(r.predicted, r.observed)), 0.6) + 0.03
  const diagonal = [{ predicted: lo, perfect: lo }, { predicted: hi, perfect: hi }]
  return (
    <Card title="Calibration" subtitle="When the ensemble said X%, how often did it happen? Dots on the dashed line would be perfect.">
      <Legend items={[{ color: 'var(--s1)', label: 'Ensemble (10 equal-sized groups)' }, { color: 'var(--muted)', label: 'Perfect calibration', dashed: true }]} />
      <div className="mt-2 h-64">
        <ResponsiveContainer>
          <ComposedChart margin={{ top: 5, right: 12, left: 0, bottom: 14 }}>
            <CartesianGrid stroke="var(--grid)" />
            <XAxis type="number" dataKey="predicted" domain={[lo, hi]} {...AXIS} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
              label={{ value: 'Predicted probability', position: 'insideBottom', offset: -8, fontSize: 11, fill: 'var(--muted)' }} />
            <YAxis type="number" domain={[lo, hi]} {...AXIS} axisLine={false} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} width={40} />
            <Tooltip cursor={false} content={({ active, payload }) => {
              const p = payload?.find((x) => x.dataKey === 'observed')?.payload as { predicted: number; observed: number; n: number } | undefined
              return active && p ? (
                <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
                  <div className="tnum">Predicted {pct(p.predicted)} → happened {pct(p.observed)}</div><div className="text-ink-2">{p.n.toLocaleString()} predictions</div>
                </div>) : null
            }} />
            <Line data={diagonal} dataKey="perfect" stroke="var(--muted)" strokeDasharray="4 4" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line data={rows} dataKey="observed" stroke="var(--s1)" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Scatter data={rows} dataKey="observed" fill="var(--s1)" isAnimationActive={false}
              shape={(p: { cx?: number; cy?: number }) => <circle cx={p.cx} cy={p.cy} r={4} fill="var(--s1)" stroke="var(--surface)" strokeWidth={2} />} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}

function Importance({ data, target, horizon }: { data: ModelsResponse; target: Target; horizon: Horizon }) {
  const [by, setBy] = useState<'feature' | 'family'>('feature')
  const imp = data.importance[target][horizon].average
  const meta = Object.fromEntries(data.features.map((f) => [f.name, f]))
  let rows: { label: string; value: number; hint: string }[]
  if (by === 'feature') {
    rows = Object.entries(imp).map(([k, v]) => ({ label: meta[k]?.label ?? k, value: v, hint: meta[k]?.description ?? '' }))
  } else {
    const fam: Record<string, number> = {}
    for (const [k, v] of Object.entries(imp)) fam[meta[k]?.family ?? 'Other'] = (fam[meta[k]?.family ?? 'Other'] ?? 0) + v
    rows = Object.entries(fam).map(([label, value]) => ({ label, value, hint: '' }))
  }
  rows.sort((a, b) => b.value - a.value)
  const shown = rows.slice(0, 14)
  const max = shown[0]?.value ?? 1
  return (
    <Card title="Feature importance" subtitle="Share of total importance, averaged across the three models (final model for this horizon)"
      action={<Segmented value={by} onChange={setBy} options={[{ value: 'feature', label: 'Features' }, { value: 'family', label: 'Themes' }]} />}>
      <div className="space-y-2">
        {shown.map((r) => (
          <div key={r.label} className="grid grid-cols-[minmax(120px,200px)_1fr_44px] items-center gap-2 text-xs" title={r.hint}>
            <span className="truncate text-ink-2">{r.label}</span>
            <div className="h-3 rounded-sm bg-surface-2"><div className="h-full rounded-r-[4px] bg-[var(--s1)]" style={{ width: `${(r.value / max) * 100}%` }} /></div>
            <span className="tnum text-right">{pct(r.value, 1)}</span>
          </div>))}
      </div>
      <p className="mt-3 text-xs text-muted">Importance says what the model leans on, not that the feature causes returns. Correlated features share importance between them.</p>
    </Card>
  )
}

function HorizonComparison({ data, target }: { data: ModelsResponse; target: Target }) {
  const rows = (['1m', '3m', '6m', '12m'] as Horizon[]).map((h) => {
    const e = data.metrics[target][h].models.ensemble
    return { horizon: HORIZON_LABEL[h], model: e.accuracy, naive: e.naive_accuracy, auc: e.auc, ic: e.rank_ic, t: e.rank_ic_t_adjusted }
  })
  return (
    <Card title="Ensemble across horizons" subtitle="The same honesty check at every horizon">
      <table className="w-full text-[13px]">
        <thead><tr className="border-b border-line text-xs text-ink-2"><th className="py-2 text-left font-medium">Horizon</th><th className="text-right font-medium">Accuracy</th><th className="text-right font-medium">Naive</th><th className="text-right font-medium">AUC</th><th className="text-right font-medium">Rank IC</th><th className="text-right font-medium">t (adj.)</th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.horizon} className="border-b border-line last:border-0">
            <td className="py-1.5">{r.horizon}</td><td className="text-right tnum font-semibold">{pct(r.model)}</td><td className="text-right tnum text-ink-2">{pct(r.naive)}</td>
            <td className="text-right tnum">{num(r.auc, 3)}</td><td className="text-right tnum">{num(r.ic, 3)}</td><td className="text-right tnum">{num(r.t, 2)}</td>
          </tr>))}</tbody>
      </table>
    </Card>
  )
}

function Intervals({ node, horizon }: { node: HorizonMetrics; horizon: Horizon }) {
  const iv = node.intervals, ex = node.extremes
  if (!iv?.n) return null
  return (
    <Card title="Expected-return ranges" subtitle="Were the predicted ranges wide enough?">
      <div className="grid grid-cols-2 gap-3">
        <Box label="“80%” range contained the outcome" value={pct(iv.coverage_80, 0)} sub={`Target 80% · average width ${pct(iv.mean_width_80, 0)}`} />
        <Box label="“50%” range contained the outcome" value={pct(iv.coverage_50, 0)} sub={`Target 50% · average width ${pct(iv.mean_width_50, 0)}`} />
        <Box label="Typical miss of the median forecast" value={`${pct(iv.median_abs_error)} pts`} sub={`Per ${HORIZON_ADJ[horizon]} prediction`} />
        <Box label="Average miss" value={`${pct(iv.mean_abs_error)} pts`} sub="Pulled up by a few very large misses" />
      </div>
      {ex?.worst && ex.best && (
        <div className="mt-3 space-y-2 text-[13px] text-ink-2">
          <p><Badge tone="bad">Worst prediction</Badge> {ex.worst.ticker}, {shortDate(ex.worst.date)}: forecast median {signedPct(ex.worst.predicted_median)} (range {signedPct(ex.worst.predicted_low, 0)} to {signedPct(ex.worst.predicted_high, 0)}, {pct(ex.worst.probability, 0)} chance of a gain). Actual: <strong className="text-bad">{signedPct(ex.worst.actual)}</strong>.</p>
          <p><Badge tone="good">Best high-conviction call</Badge> {ex.best.ticker}, {shortDate(ex.best.date)}: {pct(ex.best.probability, 0)} chance of a gain, forecast median {signedPct(ex.best.predicted_median)}. Actual: <strong className="text-good">{signedPct(ex.best.actual)}</strong>.</p>
        </div>)}
    </Card>
  )
}

function Box({ label, value, sub }: { label: string; value: string; sub: string }) {
  return <div className="rounded-lg bg-surface-2 p-3"><div className="text-xs text-ink-2">{label}</div><div className="mt-0.5 text-lg font-semibold tnum">{value}</div><div className="text-xs text-muted">{sub}</div></div>
}
