import { ArrowRight } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts'
import { AXIS, GRID, Heatmap, ShareBars } from '../components/charts'
import { SkillNote } from '../components/SkillNote'
import { Card, ErrorBox, Loading, PageHeader, ProbBar, RiskBadge, Stat, Term } from '../components/ui'
import { api, useAsync } from '../lib/api'
import { HORIZON_ADJ, money, monthYear, num, pct, shortDate, signedPct, tone } from '../lib/format'
import { portfolioRequest, useProfile } from '../lib/profile'

const SHORT: Record<string, string> = {
  'Communication Services': 'Comm. Services', 'Consumer Discretionary': 'Cons. Discretionary', 'Consumer Staples': 'Cons. Staples',
}
// Sequential blue: darker = higher AI score.
const scoreColor = (score: number | null) => `color-mix(in srgb, var(--s1) ${Math.round(8 + 92 * ((score ?? 50) / 100))}%, var(--neutral-fill))`

export default function Overview() {
  const { profile } = useProfile()
  const navigate = useNavigate()
  const body = portfolioRequest(profile)
  const market = useAsync(() => api.market(profile.horizon, profile.risk), [profile.horizon, profile.risk])
  const preds = useAsync(() => api.predictions(profile.horizon, profile.risk), [profile.horizon, profile.risk])
  const portfolio = useAsync(() => api.portfolio(body), [JSON.stringify(body)])

  if (market.error) return <ErrorBox message={market.error} onRetry={market.reload} />
  if (!market.data || !preds.data) return <Loading />
  const m = market.data.market
  const p = portfolio.data
  const history = m.history.dates.map((date, i) => ({ date, close: m.history.close[i] }))
  const scatter = market.data.scatter.filter((s) => s.volatility !== null && s.return_1y !== null)

  return (
    <div className="space-y-4">
      <PageHeader title="Portfolio Overview"
        lead={<>A {profile.risk} investor with {money(profile.amount)} and a {HORIZON_ADJ[profile.horizon]} horizon. Change the profile in the <Link to="/builder" className="text-accent hover:underline">Portfolio Builder</Link>.</>} />

      <SkillNote horizon={profile.horizon} abs={preds.data.skill.abs} rel={preds.data.skill.rel} intervals={preds.data.intervals} />

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Suggested portfolio" subtitle={p ? `${p.stats.n_holdings} stocks chosen and weighted by the optimiser for this profile` : undefined}
          action={<Link to="/builder" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">Customise <ArrowRight className="h-3 w-3" /></Link>}>
          {portfolio.error ? <p className="text-bad">{portfolio.error}</p> : !p ? <Loading /> : (
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <Fact label="Value" value={money(p.total_value)} />
                  <Fact label={<Term name="Volatility">Expected volatility</Term>} value={pct(p.stats.volatility)} />
                  <Fact label={<Term name="Beta" />} value={num(p.stats.beta)} />
                  <Fact label={<Term name="Effective holdings" />} value={num(p.stats.effective_holdings, 1)} />
                  <Fact label={<Term name="P(beat peers)">Avg. P(beat peers)</Term>} value={pct(p.stats.avg_p_beat, 0)} />
                  <Fact label="Risk level" value={<RiskBadge level={p.stats.risk_level} />} />
                </div>
                <h3 className="mb-2 mt-5 text-xs font-semibold text-ink-2">Largest positions</h3>
                <ShareBars rows={p.holdings.slice(0, 6).map((h) => ({ label: `${h.ticker} · ${h.name}`, value: h.weight }))} cap={profile.maxStock} format={(v) => pct(v, 1)} />
              </div>
              <div>
                <h3 className="mb-2 text-xs font-semibold text-ink-2">Sector allocation (limit {pct(profile.maxSector, 0)})</h3>
                <ShareBars rows={p.sectors.map((s) => ({ label: s.sector, value: s.weight, muted: s.sector === 'Cash' }))} cap={profile.maxSector} format={(v) => pct(v, 1)} />
              </div>
            </div>)}
        </Card>
        <Card title="Top-ranked stocks" subtitle={`By AI score, ${HORIZON_ADJ[profile.horizon]} horizon`}
          action={<Link to="/predictor" className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">All {preds.data.rows.length} <ArrowRight className="h-3 w-3" /></Link>}>
          <ul className="divide-y divide-[var(--border)]">
            {preds.data.rows.filter((r) => !profile.avoidSectors.includes(r.sector)).slice(0, 7).map((r) => (
              <li key={r.ticker}>
                <button onClick={() => navigate(`/explorer/${r.ticker}`)} className="flex w-full items-center justify-between gap-3 py-2 text-left hover:bg-surface-2">
                  <div className="min-w-0"><span className="font-semibold">{r.ticker}</span> <span className="text-xs text-ink-2">{r.sector}</span>
                    <div className="truncate text-xs text-muted">{r.top_positive[0] ?? ''}</div></div>
                  <div className="flex shrink-0 items-center gap-3"><ProbBar value={r.p_beat} /><span className="w-7 text-right font-semibold tnum">{num(r.score, 0)}</span></div>
                </button>
              </li>))}
          </ul>
          <p className="mt-2 text-xs text-muted">Bar = probability of beating the median stock; number = AI score.</p>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="S&P 500, 1 month" value={signedPct(m.returns['1m'])} tone={tone(m.returns['1m'])} />
        <Stat label="S&P 500, 1 year" value={signedPct(m.returns['1y'])} tone={tone(m.returns['1y'])} />
        <Stat label="Market volatility" term="Volatility" value={pct(m.volatility)} sub="Past year, annualised" />
        <Stat label="Vs 200-day average" value={signedPct(m.vs_200d)} sub={m.vs_200d !== null && m.vs_200d > 0 ? 'Above its long-term trend' : 'Below its long-term trend'} />
        <Stat label="Market breadth" value={pct(m.breadth, 0)} sub="Stocks above their 200-day average" />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="S&P 500 (SPY), last three years" subtitle={`Through ${shortDate(market.data.as_of)}; dividends reinvested`}>
          <div className="h-64">
            <ResponsiveContainer>
              <AreaChart data={history} margin={{ top: 5, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid {...GRID} />
                <XAxis dataKey="date" {...AXIS} tickFormatter={monthYear} minTickGap={50} />
                <YAxis {...AXIS} axisLine={false} domain={['auto', 'auto']} tickFormatter={(v: number) => `$${v.toFixed(0)}`} width={48} />
                <Tooltip content={({ active, payload }) => active && payload?.length ? (
                  <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
                    <div className="font-medium">{shortDate(payload[0].payload.date)}</div><div className="tnum text-ink-2">{money(payload[0].payload.close, 2)}</div>
                  </div>) : null} />
                <Area dataKey="close" stroke="var(--s1)" strokeWidth={2} fill="var(--s1)" fillOpacity={0.1} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Risk vs return, past year" subtitle="Each dot is a stock. Darker blue = higher AI score. Past return is not the prediction.">
          <div className="h-64">
            <ResponsiveContainer>
              <ScatterChart margin={{ top: 5, right: 12, left: 0, bottom: 14 }}>
                <CartesianGrid stroke="var(--grid)" />
                <XAxis type="number" dataKey="volatility" {...AXIS} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} domain={['auto', 'auto']}
                  label={{ value: 'Volatility (risk)', position: 'insideBottom', offset: -8, fontSize: 11, fill: 'var(--muted)' }} />
                <YAxis type="number" dataKey="return_1y" {...AXIS} axisLine={false} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} width={48} />
                <ZAxis range={[70, 70]} />
                <ReferenceLine y={0} stroke="var(--axis)" />
                <Tooltip cursor={false} content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const s = payload[0].payload as (typeof scatter)[number]
                  return (
                    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
                      <div className="font-semibold">{s.ticker} <span className="font-normal text-ink-2">{s.sector}</span></div>
                      <div className="tnum text-ink-2">1-year return {signedPct(s.return_1y)} · volatility {pct(s.volatility)}</div>
                      <div className="tnum text-ink-2">AI score {num(s.score, 0)} · P(beat peers) {pct(s.p_beat, 0)}</div>
                    </div>)
                }} />
                <Scatter data={scatter} isAnimationActive={false} onClick={(e: { payload?: { ticker: string } }) => e?.payload && navigate(`/explorer/${e.payload.ticker}`)}
                  shape={(props: { cx?: number; cy?: number; payload?: { score: number | null } }) => (
                    <circle cx={props.cx} cy={props.cy} r={5} fill={scoreColor(props.payload?.score ?? null)} stroke="var(--surface)" strokeWidth={2} style={{ cursor: 'pointer' }} />)} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Sector performance" subtitle="Average return of the universe’s stocks in each sector">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr className="border-b border-line text-xs text-ink-2">
                <th className="py-2 text-left font-medium">Sector</th><th className="text-right font-medium">Stocks</th>
                {['1M', '3M', '6M', '1Y'].map((h) => <th key={h} className="text-right font-medium">{h}</th>)}
                <th className="text-right font-medium">Avg. AI score</th></tr></thead>
              <tbody>{market.data.sectors.map((s) => (
                <tr key={s.sector} className="border-b border-line last:border-0">
                  <td className="py-1.5">{s.sector}</td><td className="text-right tnum text-ink-2">{s.n}</td>
                  {(['1m', '3m', '6m', '1y'] as const).map((k) => <td key={k} className={`text-right tnum ${tone(s[k])}`}>{signedPct(s[k])}</td>)}
                  <td className="text-right tnum font-medium">{num(s.avg_score, 0)}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </Card>
        <Card title="How sectors move together" subtitle="Correlation of daily sector returns over the past year">
          <Heatmap data={market.data.correlation} short={(l) => SHORT[l] ?? l} />
        </Card>
      </div>
    </div>
  )
}

function Fact({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return <div><div className="text-xs text-ink-2">{label}</div><div className="mt-0.5 text-lg font-semibold tnum">{value}</div></div>
}
