import { useNavigate } from 'react-router-dom'
import { Heatmap, ShareBars } from '../components/charts'
import { ProfileForm } from '../components/ProfileForm'
import { Callout, Card, ErrorBox, Loading, PageHeader, ProbBar, RiskBadge, SortableTable, Stat, Term, type Column } from '../components/primitives'
import { api, useAsync, type PortfolioHolding, type PortfolioResponse } from '../lib/api'
import { HORIZON_ADJ, money, num, pct, shortDate, signedPct } from '../lib/format'
import { portfolioRequest, useProfile } from '../lib/profile'

export default function Builder() {
  const { profile } = useProfile()
  const body = portfolioRequest(profile)
  const key = JSON.stringify(body)
  const { data, loading, error, reload } = useAsync(() => api.portfolio(body), [key])
  return (
    <div className="space-y-4">
      <PageHeader title="Portfolio Builder" lead="Describe the investor; the algorithm selects and weights the stocks. Every change recalculates the portfolio." />
      <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <Card title="Investor profile" subtitle="Saved in this browser only" className="self-start">
          <ProfileForm />
        </Card>
        <div className="min-w-0 space-y-4">
          {error ? <ErrorBox message={error} onRetry={reload} /> : !data ? <Loading label="Optimising…" /> : <Result data={data} stale={loading} maxStock={profile.maxStock} maxSector={profile.maxSector} />}
        </div>
      </div>
    </div>
  )
}

function Result({ data, stale, maxStock, maxSector }: { data: PortfolioResponse; stale: boolean; maxStock: number; maxSector: number }) {
  const navigate = useNavigate()
  const s = data.stats
  const hasCurrent = data.holdings.some((h) => h.current_dollars > 0) || data.sells.length > 0
  const columns: Column<PortfolioHolding>[] = [
    { key: 'ticker', header: 'Stock', sort: (r) => r.ticker, render: (r) => (<div><div className="font-semibold">{r.ticker}</div><div className="max-w-[140px] truncate text-xs text-ink-2">{r.name}</div></div>) },
    { key: 'sector', header: 'Sector', sort: (r) => r.sector, render: (r) => <span className="whitespace-nowrap text-ink-2">{r.sector}</span> },
    { key: 'weight', header: 'Weight', align: 'right', sort: (r) => r.weight, render: (r) => <span className="font-semibold">{pct(r.weight)}</span> },
    { key: 'dollars', header: 'Amount', align: 'right', sort: (r) => r.dollars, render: (r) => money(r.dollars) },
    { key: 'shares', header: '≈ Shares', align: 'right', sort: (r) => r.shares, render: (r) => num(r.shares, 1) },
    { key: 'score', header: <Term name="AI Score" />, align: 'right', sort: (r) => r.score, render: (r) => num(r.score, 0) },
    { key: 'p_beat', header: <Term name="P(beat peers)" />, sort: (r) => r.p_beat, render: (r) => <ProbBar value={r.p_beat} /> },
    { key: 'risk', header: 'Risk', sort: (r) => r.volatility, render: (r) => <RiskBadge level={r.risk_level} /> },
    { key: 'why', header: 'Why it was chosen', render: (r) => (
      <div className="min-w-[190px] text-xs leading-snug text-ink-2">
        {r.why.map((t) => <div key={t}><span className="font-semibold text-good">+</span> {t}</div>)}
        {r.watch.map((t) => <div key={t}><span className="font-semibold text-bad">−</span> {t}</div>)}
      </div>) },
    ...(hasCurrent ? [{ key: 'trade', header: 'Trade needed', align: 'right' as const, sort: (r: PortfolioHolding) => r.trade_dollars,
      render: (r: PortfolioHolding) => <span className={r.trade_dollars >= 0 ? 'text-good' : 'text-bad'}>{r.trade_dollars >= 0 ? 'Buy ' : 'Sell '}{money(Math.abs(r.trade_dollars))}</span> }] : []),
  ]
  return (
    <div className={`space-y-4 transition-opacity ${stale ? 'opacity-60' : ''}`}>
      {data.notes.map((n) => <Callout key={n} tone="warn">{n}</Callout>)}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Portfolio value" value={money(data.total_value)} sub={`${s.n_holdings} stocks · ${pct(s.cash, 0)} cash`} />
        <Stat label="Expected volatility" term="Volatility" value={pct(s.volatility)} sub={<RiskBadge level={s.risk_level} />} />
        <Stat label="Portfolio beta" term="Beta" value={num(s.beta)} sub="1.00 = moves with the S&P 500" />
        <Stat label="Average P(beat peers)" term="P(beat peers)" value={pct(s.avg_p_beat, 0)} sub={`Average AI score ${num(s.avg_score, 0)}`} />
        <Stat label="Diversification ratio" term="Diversification ratio" value={num(s.diversification_ratio)} sub="Above 1 = combining reduced risk" />
        <Stat label="Effective holdings" term="Effective holdings" value={num(s.effective_holdings, 1)} sub={`of ${s.n_holdings} positions`} />
        <Stat label="Average correlation" term="Correlation" value={num(s.average_correlation)} sub="Between holdings, past year" />
        <Stat label="Largest position / sector" value={`${pct(s.max_weight, 0)} / ${pct(s.max_sector_weight, 0)}`} sub={`Limits: ${pct(maxStock, 0)} / ${pct(maxSector, 0)}`} />
      </div>

      <Card title="Suggested holdings" subtitle={`As of ${shortDate(data.as_of)} · ${HORIZON_ADJ[data.horizon]} horizon · click a row for the full reasoning`}>
        <SortableTable rows={data.holdings} columns={columns} rowKey={(r) => r.ticker} initialSort="weight" onRowClick={(r) => navigate(`/explorer/${r.ticker}`)} />
        {data.sells.length > 0 && (
          <p className="mt-3 text-xs text-ink-2">
            Current holdings not in the suggested portfolio: {data.sells.map((x) => `${x.ticker} (${money(x.current_dollars)})`).join(', ')}.
            Reaching the target would mean selling them — which may have tax consequences this simulation ignores.
          </p>)}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Sector allocation" subtitle={`Calculated by the optimiser. The vertical mark is your ${pct(maxSector, 0)} sector limit.`}>
          <ShareBars rows={data.sectors.map((x) => ({ label: x.sector, value: x.weight, muted: x.sector === 'Cash' }))} cap={maxSector} format={(v) => pct(v, 1)} />
        </Card>
        <Card title="Position sizes" subtitle={`The vertical mark is your ${pct(maxStock, 0)} single-stock limit.`}>
          <ShareBars rows={data.holdings.map((h) => ({ label: h.ticker, value: h.weight }))} cap={maxStock} format={(v) => pct(v, 1)} />
        </Card>
      </div>

      <Card title="How the holdings move together" subtitle="Correlation of daily returns over the past year. Lower numbers mean better diversification.">
        <Heatmap data={data.correlation} />
      </Card>

      <Card title="How this portfolio was built">
        <ol className="list-decimal space-y-1.5 pl-5 text-[13px] leading-relaxed text-ink-2">
          <li><strong className="text-ink">Screen.</strong> Sectors marked “avoid” are removed. Preferred sectors get +{data.method.preferred_sector_bonus} score points.</li>
          <li><strong className="text-ink">Select.</strong> Stocks are added one at a time: each pick is the highest score after subtracting a penalty for being correlated with the stocks already chosen ({data.method.correlation_penalty} points per unit of average correlation).</li>
          <li><strong className="text-ink">Weight.</strong> A mean-variance optimiser sets the weights subject to your limits: at most {pct(maxStock, 0)} per stock and {pct(maxSector, 0)} per sector, at least 2% per position. Your risk tolerance sets how strongly it penalises variance.</li>
          <li><strong className="text-ink">Reality check.</strong> In walk-forward testing the ranking signal behind these picks had a rank IC of {data.skill.rank_ic?.toFixed(3) ?? 'n/a'} (overlap-adjusted t = {data.skill.rank_ic_t_adjusted?.toFixed(1) ?? 'n/a'}); top-fifth minus bottom-fifth spread {signedPct(data.skill.top_minus_bottom)} per period. See Backtesting for how following it would have gone.</li>
        </ol>
      </Card>
    </div>
  )
}
