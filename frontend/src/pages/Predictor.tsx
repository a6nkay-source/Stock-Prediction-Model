import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SkillNote } from '../components/SkillNote'
import { Card, ConfidenceBadge, ErrorBox, Loading, PageHeader, ProbBar, RangeBar, RiskBadge, Segmented, SortableTable, Term, type Column } from '../components/primitives'
import { api, useAsync, type PredictionRow } from '../lib/api'
import { compactMoney, HORIZON_ADJ, NA, num, pct, signedPct, tone } from '../lib/format'
import { SECTORS, useProfile } from '../lib/profile'

type View = 'prediction' | 'returns' | 'risk' | 'fundamentals'
const na = (text: string) => (text === 'n/a' ? <span className="text-muted" title={NA}>{NA}</span> : text)

export default function Predictor() {
  const { profile } = useProfile()
  const navigate = useNavigate()
  const { data, loading, error, reload } = useAsync(() => api.predictions(profile.horizon, profile.risk), [profile.horizon, profile.risk])
  const [view, setView] = useState<View>('prediction')
  const [sector, setSector] = useState('all')
  const [query, setQuery] = useState('')
  const [hideAvoided, setHideAvoided] = useState(true)

  const rows = useMemo(() => {
    if (!data) return []
    const q = query.trim().toLowerCase()
    return data.rows.filter((r) =>
      (sector === 'all' || r.sector === sector)
      && (!hideAvoided || !profile.avoidSectors.includes(r.sector))
      && (!q || r.ticker.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)))
  }, [data, sector, query, hideAvoided, profile.avoidSectors])

  const columns = useMemo<Column<PredictionRow>[]>(() => {
    const base: Column<PredictionRow>[] = [
      { key: 'rank', header: '#', sort: (r) => r.rank, render: (r) => <span className="text-muted">{r.rank}</span>, align: 'right' },
      { key: 'ticker', header: 'Stock', sort: (r) => r.ticker, render: (r) => (
        <div><div className="font-semibold">{r.ticker}</div><div className="max-w-[150px] truncate text-xs text-ink-2">{r.name}</div></div>) },
      { key: 'sector', header: 'Sector', sort: (r) => r.sector, render: (r) => <span className="whitespace-nowrap text-ink-2">{r.sector}</span> },
      { key: 'score', header: <Term name="AI Score" />, sort: (r) => r.score, align: 'right', render: (r) => <span className="font-semibold">{num(r.score, 0)}</span> },
    ]
    const sets: Record<View, Column<PredictionRow>[]> = {
      prediction: [
        { key: 'p_beat', header: <Term name="P(beat peers)" />, sort: (r) => r.p_beat, render: (r) => <ProbBar value={r.p_beat} /> },
        { key: 'p_up', header: <Term name="P(positive)" />, sort: (r) => r.p_up, render: (r) => <ProbBar value={r.p_up} baseline={r.base_rate} /> },
        { key: 'range', header: <Term name="Expected range" />, sort: (r) => r.range.q50, render: (r) => (
          <div className="flex items-center gap-2"><RangeBar {...r.range} />
            <span className="tnum whitespace-nowrap text-xs text-ink-2">{signedPct(r.range.q10, 0)} to {signedPct(r.range.q90, 0)}</span></div>) },
        { key: 'risk', header: 'Risk', sort: (r) => r.volatility, render: (r) => <RiskBadge level={r.risk_level} /> },
        { key: 'conf', header: <Term name="Confidence" />, sort: (r) => r.confidence.value, render: (r) => <ConfidenceBadge {...r.confidence} /> },
        { key: 'why', header: 'Main drivers', render: (r) => (
          <div className="min-w-[200px] text-xs leading-snug">
            {r.top_positive.slice(0, 2).map((t) => <div key={t} className="text-ink-2"><span className="font-semibold text-good">+</span> {t}</div>)}
            {r.top_negative.slice(0, 1).map((t) => <div key={t} className="text-ink-2"><span className="font-semibold text-bad">−</span> {t}</div>)}
          </div>) },
      ],
      returns: (['1m', '3m', '6m', '1y', '3y'] as const).map((k) => ({
        key: `ret_${k}`, header: `${k.toUpperCase()} return`, align: 'right' as const, sort: (r: PredictionRow) => r.returns[k],
        render: (r: PredictionRow) => <span className={tone(r.returns[k])}>{na(signedPct(r.returns[k]))}</span>,
      })),
      risk: [
        { key: 'risk', header: 'Risk level', sort: (r) => r.volatility, render: (r) => <RiskBadge level={r.risk_level} /> },
        { key: 'vol', header: <Term name="Volatility" />, align: 'right', sort: (r) => r.volatility, render: (r) => na(pct(r.volatility)) },
        { key: 'mdd1', header: <Term name="Max drawdown">Max drawdown (1Y)</Term>, align: 'right', sort: (r) => r.max_drawdown_1y, render: (r) => na(pct(r.max_drawdown_1y)) },
        { key: 'mdd', header: 'Max drawdown (all)', align: 'right', sort: (r) => r.max_drawdown_all, render: (r) => na(pct(r.max_drawdown_all)) },
        { key: 'beta', header: <Term name="Beta" />, align: 'right', sort: (r) => r.beta, render: (r) => na(num(r.beta)) },
      ],
      fundamentals: [
        { key: 'pe', header: <Term name="P/E" />, align: 'right', sort: (r) => r.pe, render: (r) => na(num(r.pe, 1)) },
        { key: 'epsg', header: <Term name="EPS growth" />, align: 'right', sort: (r) => r.eps_growth, render: (r) => <span className={tone(r.eps_growth)}>{na(signedPct(r.eps_growth))}</span> },
        { key: 'revg', header: <Term name="Revenue growth" />, align: 'right', sort: (r) => r.revenue_growth, render: (r) => <span className={tone(r.revenue_growth)}>{na(signedPct(r.revenue_growth))}</span> },
        { key: 'margin', header: <Term name="Profit margin" />, align: 'right', sort: (r) => r.profit_margin, render: (r) => na(pct(r.profit_margin)) },
        { key: 'de', header: <Term name="Debt/equity" />, align: 'right', sort: (r) => r.debt_to_equity, render: (r) => na(num(r.debt_to_equity)) },
        { key: 'fcf', header: <Term name="Free cash flow" />, align: 'right', sort: (r) => r.free_cash_flow, render: (r) => na(compactMoney(r.free_cash_flow)) },
        { key: 'cap', header: <Term name="Market cap" />, align: 'right', sort: (r) => r.market_cap, render: (r) => na(compactMoney(r.market_cap)) },
        { key: 'div', header: <Term name="Dividend yield" />, align: 'right', sort: (r) => r.dividend_yield, render: (r) => (r.dividend_yield === null ? '—' : pct(r.dividend_yield, 2)) },
      ],
    }
    return [...base, ...sets[view]]
  }, [view])

  if (loading && !data) return <Loading label="Scoring the universe…" />
  if (error || !data) return <ErrorBox message={error ?? 'No data'} onRetry={reload} />

  return (
    <div className="space-y-4">
      <PageHeader title="AI Stock Predictor"
        lead={<>Every stock in the universe, ranked by an explicit score for a {HORIZON_ADJ[data.horizon]} horizon and a {data.risk} risk tolerance. Click a row for the full reasoning.</>} />
      <SkillNote horizon={data.horizon} abs={data.skill.abs} rel={data.skill.rel} intervals={data.intervals} />
      <Card>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Segmented<View> value={view} onChange={setView} label="Columns" options={[
            { value: 'prediction', label: 'Prediction' }, { value: 'returns', label: 'Past returns' },
            { value: 'risk', label: 'Risk' }, { value: 'fundamentals', label: 'Fundamentals' }]} />
          <select className="field !w-auto !py-1 text-xs" value={sector} onChange={(e) => setSector(e.target.value)} aria-label="Sector filter">
            <option value="all">All sectors</option>
            {SECTORS.map((s) => <option key={s}>{s}</option>)}
          </select>
          <input className="field !w-44 !py-1 text-xs" placeholder="Search ticker or name" value={query} onChange={(e) => setQuery(e.target.value)} />
          {profile.avoidSectors.length > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-ink-2">
              <input type="checkbox" checked={hideAvoided} onChange={(e) => setHideAvoided(e.target.checked)} /> Hide sectors I avoid
            </label>)}
          <span className="ml-auto text-xs text-muted">{rows.length} of {data.rows.length} stocks</span>
        </div>
        <SortableTable rows={rows} columns={columns} rowKey={(r) => r.ticker} initialSort="score" onRowClick={(r) => navigate(`/explorer/${r.ticker}`)} />
      </Card>
      <Card title="How the score is calculated">
        <p className="text-[13px] leading-relaxed text-ink-2">
          <code className="rounded bg-surface-2 px-1.5 py-0.5 text-ink">AI Score = 100 × [ {(1 - data.risk_weight).toFixed(2)} × rank(P beat peers) + {data.risk_weight.toFixed(2)} × (1 − volatility rank) ]</code>
          <br />The first term is the stock’s percentile on the ensemble’s probability of beating the median stock. The second rewards lower volatility, and its weight
          comes from your risk tolerance ({data.risk}). Popularity, company size and analyst opinions are not inputs. The probability of a positive return is shown
          for information but is not part of the score, because it showed no ranking skill in testing.
        </p>
      </Card>
    </div>
  )
}
