/**
 * The widgets on the Portfolio Overview board.
 *
 * Each widget reads live API data from `BoardContext`, so the grid can keep its
 * `renderItem` stable and only the widgets whose data changed re-render.
 * Cells are square, so a widget's width is also a proxy for its height: the
 * container queries below (`@[400px]:…`) decide how much detail fits.
 */
import { ArrowRight } from 'lucide-react'
import { createContext, useContext, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Area, AreaChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts'
import type { WidgetItem } from '@/components/ui/draggable-widget-grid'
import type { BacktestResponse, MarketOverview, PortfolioResponse, PredictionsResponse } from '@/lib/api'
import { HORIZON_LABEL, money, num, pct, shortDate, signedPct } from '@/lib/format'
import { GLOSSARY } from '@/lib/glossary'
import type { Profile } from '@/lib/profile'
import { AXIS, ChartTooltip, downsample, SERIES } from './charts'
import { Badge, RiskBadge } from './primitives'

/* ------------------------------------------------------------------ *
 * Board definition
 * ------------------------------------------------------------------ */

export type WidgetKind =
  | 'portfolio' | 'trust' | 'toppick' | 'breadth' | 'picks' | 'sp500'
  | 'sectors' | 'backtest' | 'scatter' | 'allocation' | 'volatility' | 'trend'

export interface BoardWidget extends WidgetItem {
  kind: WidgetKind
}

/** Default arrangement. The areas add up to 24 cells, so 2, 3 and 4 columns all tile exactly. */
export const DEFAULT_WIDGETS: BoardWidget[] = [
  { id: 'portfolio', kind: 'portfolio', size: 'lg', label: 'Suggested portfolio' },
  { id: 'trust', kind: 'trust', size: 'wide', label: 'How far to trust the predictions' },
  { id: 'toppick', kind: 'toppick', size: 'sm', label: 'Top-ranked stock' },
  { id: 'breadth', kind: 'breadth', size: 'sm', label: 'Market breadth' },
  { id: 'picks', kind: 'picks', size: 'tall', label: 'Top-ranked stocks' },
  { id: 'sp500', kind: 'sp500', size: 'wide', label: 'S&P 500 over the past year' },
  { id: 'sectors', kind: 'sectors', size: 'tall', label: 'Sector returns' },
  { id: 'backtest', kind: 'backtest', size: 'wide', label: 'Backtest result' },
  { id: 'scatter', kind: 'scatter', size: 'lg', label: 'Risk versus return' },
  { id: 'allocation', kind: 'allocation', size: 'tall', label: 'Sector allocation' },
  { id: 'volatility', kind: 'volatility', size: 'sm', label: 'Market volatility' },
  { id: 'trend', kind: 'trend', size: 'sm', label: 'S&P 500 trend' },
]

export interface BoardData {
  profile: Profile
  market: MarketOverview
  preds: PredictionsResponse
  portfolio: PortfolioResponse | null
  portfolioError: string | null
  backtest: BacktestResponse | null
  backtestError: string | null
}

export const BoardContext = createContext<BoardData | null>(null)

function useBoard(): BoardData {
  const data = useContext(BoardContext)
  if (!data) throw new Error('Overview widgets must be rendered inside BoardContext')
  return data
}

/* ------------------------------------------------------------------ *
 * Building blocks
 * ------------------------------------------------------------------ */

function Shell({ title, meta, children }: { title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <section className="@container flex h-full flex-col gap-3 p-4 sm:p-5">
      <header className="flex items-center justify-between gap-2 leading-none">
        <h3 className="truncate text-[11px] font-medium uppercase tracking-[0.08em] text-ink-2">{title}</h3>
        {meta && <span className="shrink-0 text-xs text-ink-2">{meta}</span>}
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  )
}

function Big({ children, unit }: { children: ReactNode; unit?: string }) {
  return (
    <p className="text-[26px] font-semibold leading-none tracking-tight tabular-nums @[200px]:text-[32px]">
      {children}
      {unit && <span className="text-xs font-normal tracking-normal text-ink-2">{' '}{unit}</span>}
    </p>
  )
}

/** A link that still works while the board is draggable (the grid blocks real anchors). */
function Go({ to, children, className = '' }: { to: string; children: ReactNode; className?: string }) {
  const navigate = useNavigate()
  return (
    <button type="button" onClick={() => navigate(to)}
      className={`inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-accent hover:underline ${className}`}>
      {children} <ArrowRight className="h-3 w-3" />
    </button>
  )
}

function Skeleton() {
  return <div className="flex-1 animate-pulse rounded-lg bg-surface-2 motion-reduce:animate-none" aria-label="Loading" />
}

function Problem({ children }: { children: ReactNode }) {
  return <p className="text-xs text-bad">{children}</p>
}

/** A signed change with an arrow, so direction never depends on colour alone. */
function Delta({ value, label }: { value: number | null; label: string }) {
  if (value === null) return <span className="text-muted">n/a</span>
  const up = value >= 0
  return (
    <span className={`tabular-nums ${up ? 'text-good' : 'text-bad'}`}>
      <span aria-hidden="true">{up ? '↑' : '↓'} </span>{Math.abs(value * 100).toFixed(1)}%
      <span className="text-ink-2"> {label}</span>
    </span>
  )
}

function Dot({ tone }: { tone: 'good' | 'warn' | 'bad' }) {
  const color = tone === 'good' ? 'var(--good)' : tone === 'warn' ? 'var(--warn)' : 'var(--bad)'
  return <span aria-hidden="true" className="inline-block size-2 shrink-0 rounded-full" style={{ background: color }} />
}

/** Label on the left, value on the right. */
function Row({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs" title={hint}>
      <dt className="min-w-0 truncate text-ink-2">{label}</dt>
      <dd className="font-medium tabular-nums">{value}</dd>
    </div>
  )
}

/** Label and value above a thin bar; reads at any width. An optional mark shows a limit. */
function BarRow({ label, value, max, cap, text, muted, className = '' }: {
  label: string; value: number; max: number; cap?: number; text: string; muted?: boolean; className?: string
}) {
  return (
    <div className={className}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="min-w-0 truncate text-ink-2" title={label}>{label}</span>
        <span className="font-medium tabular-nums">{text}</span>
      </div>
      <div className="relative mt-1 h-1.5 rounded-full bg-surface-2">
        <div className="h-full rounded-full" style={{ width: `${Math.min(1, value / max) * 100}%`, background: muted ? 'var(--muted)' : 'var(--s1)' }} />
        {cap !== undefined && cap <= max && (
          <div className="absolute inset-y-[-2px] w-px bg-ink" style={{ left: `${(cap / max) * 100}%` }} title={`Limit ${(cap * 100).toFixed(0)}%`} />
        )}
      </div>
    </div>
  )
}

/** A chart area that fills whatever height is left in the widget. */
function ChartBox({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative min-h-0 flex-1 ${className}`}>
      <div className="absolute inset-0">{children}</div>
    </div>
  )
}

function Swatches({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-ink-2">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1">
          <span className="inline-block h-0.5 w-3" style={{ background: i.color }} />{i.label}
        </span>
      ))}
    </div>
  )
}

const SHORT_SECTOR: Record<string, string> = {
  'Communication Services': 'Communication', 'Consumer Discretionary': 'Discretionary', 'Consumer Staples': 'Staples',
}

/* ------------------------------------------------------------------ *
 * Widgets
 * ------------------------------------------------------------------ */

function PortfolioWidget() {
  const { portfolio: p, portfolioError, profile } = useBoard()
  return (
    <Shell title="Suggested portfolio" meta={<Go to="/builder">Customise</Go>}>
      {portfolioError ? <Problem>{portfolioError}</Problem> : !p ? <Skeleton /> : (
        <>
          <Big>{money(p.total_value)}</Big>
          <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-2">
            {p.stats.n_holdings} stocks · {pct(p.stats.cash, 0)} cash <RiskBadge level={p.stats.risk_level} />
          </p>
          <dl className="mt-3 grid grid-cols-3 gap-3 @[400px]:mt-4">
            {([
              ['Volatility', pct(p.stats.volatility), GLOSSARY.Volatility],
              ['Beta', num(p.stats.beta), GLOSSARY.Beta],
              ['P(beat peers)', pct(p.stats.avg_p_beat, 0), GLOSSARY['P(beat peers)']],
            ] as const).map(([label, value, hint]) => (
              <div key={label} title={hint}>
                <dt className="truncate text-[11px] text-ink-2">{label}</dt>
                <dd className="mt-0.5 text-base font-semibold tabular-nums @[400px]:text-lg">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-auto pt-2">
            <h4 className="mb-1.5 text-xs font-medium @[400px]:mb-2">Largest positions <span className="font-normal text-ink-2">· limit {pct(profile.maxStock, 0)} each</span></h4>
            <div className="space-y-1.5 @[400px]:space-y-2.5">
              {p.holdings.slice(0, 8).map((h, i) => (
                <BarRow key={h.ticker} label={`${h.ticker} · ${h.name}`} value={h.weight} max={Math.max(profile.maxStock, p.stats.max_weight)}
                  cap={profile.maxStock} text={pct(h.weight, 1)} className={i >= 6 ? 'hidden @[480px]:block' : i >= 4 ? 'hidden @[400px]:block' : ''} />
              ))}
            </div>
          </div>
        </>
      )}
    </Shell>
  )
}

function TrustWidget() {
  const { preds, profile } = useBoard()
  const a = preds.skill.abs, r = preds.skill.rel
  const lift = a.accuracy_lift ?? 0
  const ic = r.rank_ic ?? 0, t = r.rank_ic_t_adjusted ?? 0
  const direction = lift <= 0.005
    ? { tone: 'bad', label: 'No skill shown' }
    : { tone: 'warn', label: `+${(lift * 100).toFixed(1)} pts edge` }
  const ranking = ic <= 0 ? { tone: 'bad', label: 'No skill shown' }
    : t >= 2 ? { tone: 'good', label: 'Modest skill' } : { tone: 'warn', label: 'Weak, unproven' }
  const rows = [
    {
      title: 'Calling up or down', verdict: direction,
      short: `Right ${pct(a.accuracy)} · always “up” ${pct(a.naive_accuracy)}`,
      long: `In testing the model was right ${pct(a.accuracy)} of the time. Always guessing “up” was right ${pct(a.naive_accuracy)}.`,
    },
    {
      title: 'Ranking stocks', verdict: ranking,
      short: `Top fifth beat bottom fifth by ${signedPct(r.top_minus_bottom)}`,
      long: `Its top fifth of picks beat its bottom fifth by ${signedPct(r.top_minus_bottom)} per ${HORIZON_LABEL[profile.horizon]} (rank IC ${ic.toFixed(3)}, t = ${t.toFixed(1)}; 2 is the usual bar).`,
    },
  ]
  return (
    <Shell title="How far to trust this" meta={<Go to="/models">Track record</Go>}>
      <div className="flex flex-1 flex-col justify-around gap-2">
        {rows.map((row) => (
          <div key={row.title}>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[13px] font-medium">{row.title}</span>
              <Badge tone={row.verdict.tone}>{row.verdict.label}</Badge>
            </div>
            <p className="mt-0.5 truncate text-xs text-ink-2 @[400px]:hidden">{row.short}</p>
            <p className="mt-1 hidden text-xs leading-snug text-ink-2 @[400px]:block">{row.long}</p>
          </div>
        ))}
      </div>
    </Shell>
  )
}

function useRanked() {
  const { preds, profile } = useBoard()
  return preds.rows.filter((r) => !profile.avoidSectors.includes(r.sector))
}

function TopPickWidget() {
  const navigate = useNavigate()
  const ranked = useRanked()
  const top = ranked[0]
  if (!top) return <Shell title="Rank #1"><Problem>No stocks left after your exclusions.</Problem></Shell>
  return (
    <Shell title="Rank #1" meta={`of ${ranked.length}`}>
      <button type="button" onClick={() => navigate(`/explorer/${top.ticker}`)} className="flex flex-1 cursor-pointer flex-col text-left" title="Open in Stock Explorer">
        <Big>{top.ticker}</Big>
        <span className="mt-1.5 truncate text-xs text-ink-2">{top.name}</span>
        <dl className="mt-auto w-full space-y-1">
          <Row label="AI score" value={num(top.score, 0)} hint={GLOSSARY['AI Score']} />
          <Row label="P(beat peers)" value={pct(top.p_beat, 0)} hint={GLOSSARY['P(beat peers)']} />
        </dl>
      </button>
    </Shell>
  )
}

function BreadthWidget() {
  const { market } = useBoard()
  const breadth = market.market.breadth
  return (
    <Shell title="Market breadth">
      <Big>{pct(breadth, 0)}</Big>
      <p className="mt-2 text-xs leading-snug text-ink-2">of stocks are above their 200-day average</p>
      <div className="mt-auto h-1.5 rounded-full bg-surface-2" role="img" aria-label={`${pct(breadth, 0)} of stocks above their 200-day average`}>
        <div className="h-full rounded-full bg-[var(--s1)]" style={{ width: `${(breadth ?? 0) * 100}%` }} />
      </div>
    </Shell>
  )
}

function VolatilityWidget() {
  const { market } = useBoard()
  const vol = market.market.volatility
  // The S&P 500's long-run realised volatility is roughly 15–20% a year.
  const mood = vol === null ? null : vol < 0.14 ? 'Calmer than usual' : vol <= 0.22 ? 'Typical for the market' : 'More turbulent than usual'
  return (
    <Shell title="Market volatility">
      <div title={GLOSSARY.Volatility}><Big>{pct(vol)}</Big></div>
      {mood && <p className="mt-2 text-xs leading-snug text-ink-2">{mood}</p>}
      <dl className="mt-auto">
        <Row label="Worst dip, 1 yr" value={pct(market.market.max_drawdown_1y)} hint={GLOSSARY['Max drawdown']} />
      </dl>
    </Shell>
  )
}

function TrendWidget() {
  const { market } = useBoard()
  const gap = market.market.vs_200d
  const above = (gap ?? 0) >= 0
  return (
    <Shell title="S&P 500 trend">
      <Big>{signedPct(gap)}</Big>
      <p className="mt-2 flex items-start gap-1.5 text-xs leading-snug text-ink-2">
        <span className="mt-1"><Dot tone={above ? 'good' : 'warn'} /></span>
        {above ? 'Above' : 'Below'} its 200-day average
      </p>
      <dl className="mt-auto space-y-1">
        <Row label="1 month" value={signedPct(market.market.returns['1m'])} />
        <Row label="3 months" value={signedPct(market.market.returns['3m'])} />
      </dl>
    </Shell>
  )
}

function PicksWidget() {
  const navigate = useNavigate()
  const ranked = useRanked()
  return (
    <Shell title="Top-ranked" meta="AI score">
      <ol className="flex flex-1 flex-col justify-between">
        {ranked.slice(0, 8).map((r, i) => (
          <li key={r.ticker}>
            <button type="button" onClick={() => navigate(`/explorer/${r.ticker}`)} title={`${r.name} — open in Stock Explorer`}
              className="-mx-1.5 flex w-[calc(100%+0.75rem)] cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-surface-2">
              <span className="w-3 shrink-0 text-[11px] tabular-nums text-muted">{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold leading-tight">{r.ticker}</span>
                <span className="hidden truncate text-[11px] leading-tight text-ink-2 @[180px]:block">{SHORT_SECTOR[r.sector] ?? r.sector}</span>
              </span>
              <span className="text-[13px] font-semibold tabular-nums">{num(r.score, 0)}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className="mt-2 hidden @[180px]:block"><Go to="/predictor">All {ranked.length} stocks</Go></div>
    </Shell>
  )
}

function Sp500Widget() {
  const { market } = useBoard()
  const m = market.market
  const year = m.history.dates.slice(-253).map((date, i) => ({ date, close: m.history.close.slice(-253)[i] }))
  const data = downsample(year, 130)
  return (
    <Shell title="S&P 500" meta={<Delta value={m.returns['1m']} label="1 mo" />}>
      <Big unit="past year">{signedPct(m.returns['1y'])}</Big>
      <ChartBox className="mt-3">
        <ResponsiveContainer>
          <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
            <YAxis hide domain={['auto', 'auto']} />
            <XAxis dataKey="date" hide />
            <Tooltip content={<ChartTooltip format={(v) => money(v, 2)} labelFormat={shortDate} />} />
            <Area dataKey="close" name="SPY" stroke="var(--s1)" strokeWidth={2} fill="var(--s1)" fillOpacity={0.1} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </ChartBox>
    </Shell>
  )
}

function SectorsWidget() {
  const { market } = useBoard()
  const rows = [...market.sectors].sort((a, b) => (b['3m'] ?? -9) - (a['3m'] ?? -9))
  const max = Math.max(...rows.map((r) => Math.abs(r['3m'] ?? 0)), 0.01)
  return (
    <Shell title="Sectors" meta="3-mo return">
      <ul className="flex flex-1 flex-col justify-between">
        {rows.map((s) => {
          const v = s['3m'] ?? 0
          return (
            <li key={s.sector} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 text-xs @[180px]:grid-cols-[88px_minmax(0,1fr)_38px]" title={s.sector}>
              <span className="truncate text-ink-2">{SHORT_SECTOR[s.sector] ?? s.sector}</span>
              {/* Diverging bar: right of the centre line is a gain, left is a loss. */}
              <span aria-hidden="true" className="relative hidden h-1.5 @[180px]:block">
                <span className="absolute inset-y-[-2px] left-1/2 w-px bg-[var(--axis)]" />
                <span className="absolute inset-y-0 rounded-full" style={{
                  width: `${(Math.abs(v) / max) * 50}%`, background: v >= 0 ? 'var(--s1)' : 'var(--bad)',
                  ...(v >= 0 ? { left: '50%' } : { right: '50%' }),
                }} />
              </span>
              <span className="text-right font-medium tabular-nums">{signedPct(s['3m'], 0)}</span>
            </li>
          )
        })}
      </ul>
    </Shell>
  )
}

function AllocationWidget() {
  const { portfolio: p, portfolioError, profile } = useBoard()
  return (
    <Shell title="Sector mix" meta={`limit ${pct(profile.maxSector, 0)}`}>
      {portfolioError ? <Problem>{portfolioError}</Problem> : !p ? <Skeleton /> : (
        <div className="flex flex-1 flex-col justify-between gap-1">
          {p.sectors.slice(0, 9).map((s) => (
            <BarRow key={s.sector} label={SHORT_SECTOR[s.sector] ?? s.sector} value={s.weight} max={Math.max(profile.maxSector, p.stats.max_sector_weight)}
              cap={s.sector === 'Cash' ? undefined : profile.maxSector} text={pct(s.weight, 0)} muted={s.sector === 'Cash'} />
          ))}
        </div>
      )}
    </Shell>
  )
}

function BacktestWidget() {
  const { backtest: b, backtestError } = useBoard()
  if (backtestError) return <Shell title="Backtest"><Problem>{backtestError}</Problem></Shell>
  if (!b) return <Shell title="Backtest"><Skeleton /></Shell>
  const ai = b.stats.ai, ew = b.stats.equal_weight
  const gap = ai.annualized_return - ew.annualized_return
  const rows = downsample(b.series.dates.map((date, i) => ({
    date, ai: b.series.ai[i], spy: b.series.spy[i], equal_weight: b.series.equal_weight[i],
  })), 160)
  const keys = ['equal_weight', 'spy', 'ai'] as const
  return (
    <Shell title={`Backtest since ${ai.start_date.slice(0, 4)}`}
      meta={<span className={gap >= 0 ? 'text-good' : 'text-bad'}><span aria-hidden="true">{gap >= 0 ? '↑' : '↓'} </span>{Math.abs(gap * 100).toFixed(1)} pts/yr <span className="text-ink-2">vs equal-weight</span></span>}>
      <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1.5">
        <Big unit="a year, after costs">{signedPct(ai.annualized_return)}</Big>
        <Swatches items={[{ color: SERIES.ai.color, label: 'AI' }, { color: SERIES.spy.color, label: 'S&P 500' }, { color: SERIES.equal_weight.color, label: 'Equal-weight' }]} />
      </div>
      <ChartBox className="mt-2">
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
            <YAxis hide scale="log" domain={['auto', 'auto']} />
            <XAxis dataKey="date" hide />
            <Tooltip content={<ChartTooltip format={(v) => money(v)} labelFormat={shortDate} />} />
            {keys.map((k) => (
              <Line key={k} dataKey={k} name={SERIES[k].label} stroke={SERIES[k].color} strokeWidth={k === 'ai' ? 2 : 1.5} dot={false} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </ChartBox>
    </Shell>
  )
}

// Sequential blue: a darker dot has a higher AI score.
const scoreColor = (score: number | null) => `color-mix(in srgb, var(--s1) ${Math.round(8 + 92 * ((score ?? 50) / 100))}%, var(--neutral-fill))`

function ScatterWidget() {
  const navigate = useNavigate()
  const { market } = useBoard()
  const points = market.scatter.filter((s) => s.volatility !== null && s.return_1y !== null)
  return (
    <Shell title="Risk vs return, past year" meta={
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-10 rounded-full" style={{ background: `linear-gradient(90deg, ${scoreColor(0)}, ${scoreColor(100)})` }} />AI score
      </span>}>
      <ChartBox>
        <ResponsiveContainer>
          <ScatterChart margin={{ top: 6, right: 8, left: -8, bottom: 12 }}>
            <CartesianGrid stroke="var(--grid)" />
            <XAxis type="number" dataKey="volatility" {...AXIS} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} domain={['auto', 'auto']}
              label={{ value: 'Volatility (risk)', position: 'insideBottom', offset: -6, fontSize: 11, fill: 'var(--muted)' }} />
            <YAxis type="number" dataKey="return_1y" {...AXIS} axisLine={false} tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`} width={46} />
            <ZAxis range={[60, 60]} />
            <ReferenceLine y={0} stroke="var(--axis)" />
            <Tooltip cursor={false} content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const s = payload[0].payload as (typeof points)[number]
              return (
                <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
                  <div className="font-semibold">{s.ticker} <span className="font-normal text-ink-2">{s.sector}</span></div>
                  <div className="tabular-nums text-ink-2">1-year return {signedPct(s.return_1y)} · volatility {pct(s.volatility)}</div>
                  <div className="tabular-nums text-ink-2">AI score {num(s.score, 0)} · P(beat peers) {pct(s.p_beat, 0)}</div>
                </div>
              )
            }} />
            <Scatter data={points} isAnimationActive={false}
              onClick={(e: { payload?: { ticker: string } }) => e?.payload && navigate(`/explorer/${e.payload.ticker}`)}
              shape={(props: { cx?: number; cy?: number; payload?: { score: number | null } }) => (
                <circle cx={props.cx} cy={props.cy} r={5} fill={scoreColor(props.payload?.score ?? null)} stroke="var(--surface)" strokeWidth={2} style={{ cursor: 'pointer' }} />
              )} />
          </ScatterChart>
        </ResponsiveContainer>
      </ChartBox>
      <p className="mt-1 hidden text-[11px] text-muted @[400px]:block">Each dot is a stock; click one to open it. Past return is not the prediction.</p>
    </Shell>
  )
}

/* ------------------------------------------------------------------ *
 * Render
 * ------------------------------------------------------------------ */

const VIEWS: Record<WidgetKind, () => ReactNode> = {
  portfolio: PortfolioWidget, trust: TrustWidget, toppick: TopPickWidget, breadth: BreadthWidget,
  picks: PicksWidget, sp500: Sp500Widget, sectors: SectorsWidget, backtest: BacktestWidget,
  scatter: ScatterWidget, allocation: AllocationWidget, volatility: VolatilityWidget, trend: TrendWidget,
}

/** Stable `renderItem` for the grid. */
export function renderBoardWidget(item: WidgetItem): ReactNode {
  const View = VIEWS[(item as BoardWidget).kind]
  return View ? <View /> : null
}
