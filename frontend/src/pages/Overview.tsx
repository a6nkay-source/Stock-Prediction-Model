import { Lock, LockOpen, RotateCcw } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Heatmap } from '@/components/charts'
import { BoardContext, DEFAULT_WIDGETS, renderBoardWidget, type BoardData, type BoardWidget } from '@/components/overview-widgets'
import DraggableWidgetGrid, { type WidgetItem } from '@/components/ui/draggable-widget-grid'
import { Card, ErrorBox, Loading, PageHeader } from '@/components/primitives'
import { api, useAsync } from '@/lib/api'
import { HORIZON_ADJ, money, num, signedPct, tone } from '@/lib/format'
import { portfolioRequest, useProfile } from '@/lib/profile'

const SHORT: Record<string, string> = {
  'Communication Services': 'Comm. Services', 'Consumer Discretionary': 'Cons. Discretionary', 'Consumer Staples': 'Cons. Staples',
}
const LAYOUT_KEY = 'overview-layout-v1'
const LOCK_KEY = 'overview-locked-v1'

/** The saved widget order, with any widgets added since it was saved appended at the end. */
function loadLayout(): BoardWidget[] {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? 'null')
    if (!Array.isArray(ids)) return DEFAULT_WIDGETS
    const byId = new Map(DEFAULT_WIDGETS.map((w) => [w.id, w]))
    const saved = ids.map((id) => byId.get(String(id))).filter((w): w is BoardWidget => Boolean(w))
    return [...saved, ...DEFAULT_WIDGETS.filter((w) => !saved.includes(w))]
  } catch {
    return DEFAULT_WIDGETS
  }
}

function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch { /* private mode: the layout just is not remembered */ }
}

export default function Overview() {
  const { profile } = useProfile()
  const body = portfolioRequest(profile)
  const backtestBody = {
    horizon: profile.horizon, risk: profile.risk, max_stock: profile.maxStock, max_sector: profile.maxSector,
    initial: Math.max(100, profile.amount),
  }
  const market = useAsync(() => api.market(profile.horizon, profile.risk), [profile.horizon, profile.risk])
  const preds = useAsync(() => api.predictions(profile.horizon, profile.risk), [profile.horizon, profile.risk])
  const portfolio = useAsync(() => api.portfolio(body), [JSON.stringify(body)])
  const backtest = useAsync(() => api.backtest(backtestBody), [JSON.stringify(backtestBody)])

  // The grid owns the order after mount; changing `version` remounts it with a new arrangement.
  const [board, setBoard] = useState(() => ({ version: 0, items: loadLayout() }))
  const [locked, setLocked] = useState(() => {
    try { return localStorage.getItem(LOCK_KEY) === '1' } catch { return false }
  })
  const saveLayout = useCallback((items: WidgetItem[]) => store(LAYOUT_KEY, JSON.stringify(items.map((i) => i.id))), [])
  const resetLayout = () => {
    store(LAYOUT_KEY, null)
    setBoard((b) => ({ version: b.version + 1, items: DEFAULT_WIDGETS }))
  }
  const toggleLock = () => setLocked((was) => {
    store(LOCK_KEY, was ? null : '1')
    return !was
  })

  const data = useMemo<BoardData | null>(() => (market.data && preds.data ? {
    profile, market: market.data, preds: preds.data,
    portfolio: portfolio.data, portfolioError: portfolio.error,
    backtest: backtest.data, backtestError: backtest.error,
  } : null), [profile, market.data, preds.data, portfolio.data, portfolio.error, backtest.data, backtest.error])

  if (market.error) return <ErrorBox message={market.error} onRetry={market.reload} />
  if (preds.error) return <ErrorBox message={preds.error} onRetry={preds.reload} />
  if (!data) return <Loading />

  const button = 'inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-ink-2 hover:bg-surface-2 hover:text-ink'
  return (
    <div className="space-y-4">
      <PageHeader title="Portfolio Overview"
        lead={<>A {profile.risk} investor with {money(profile.amount)} and a {HORIZON_ADJ[profile.horizon]} horizon. Change the profile in the <Link to="/builder" className="text-accent hover:underline">Portfolio Builder</Link>.</>}>
        <div className="flex gap-2">
          <button type="button" onClick={toggleLock} aria-pressed={locked} className={button}
            title={locked ? 'Allow widgets to be rearranged' : 'Stop widgets from being dragged'}>
            {locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
            {locked ? 'Layout locked' : 'Lock layout'}
          </button>
          <button type="button" onClick={resetLayout} className={button} title="Put every widget back where it started">
            <RotateCcw className="h-3.5 w-3.5" /> Reset layout
          </button>
        </div>
      </PageHeader>

      <p className="text-xs text-muted">
        {locked ? 'The layout is locked.' : (
          <>
            <span className="[@media(pointer:coarse)]:hidden">Drag any widget to rearrange the board, or focus one and hold Alt with the arrow keys.</span>
            <span className="hidden [@media(pointer:coarse)]:inline">Press and hold a widget, then drag to rearrange the board.</span>
          </>
        )}{' '}Your layout is saved in this browser.
      </p>

      <BoardContext.Provider value={data}>
        <DraggableWidgetGrid key={board.version} items={board.items} onChange={saveLayout} renderItem={renderBoardWidget}
          editable={!locked} maxColumns={4} cellSize={215} gap={12} radius={16} />
      </BoardContext.Provider>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Sector performance" subtitle="Average return of the universe’s stocks in each sector">
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr className="border-b border-line text-xs text-ink-2">
                <th className="py-2 text-left font-medium">Sector</th><th className="text-right font-medium">Stocks</th>
                {['1M', '3M', '6M', '1Y'].map((h) => <th key={h} className="text-right font-medium">{h}</th>)}
                <th className="text-right font-medium">Avg. AI score</th></tr></thead>
              <tbody>{data.market.sectors.map((s) => (
                <tr key={s.sector} className="border-b border-line last:border-0">
                  <td className="py-1.5">{s.sector}</td><td className="text-right tnum text-ink-2">{s.n}</td>
                  {(['1m', '3m', '6m', '1y'] as const).map((k) => <td key={k} className={`text-right tnum ${tone(s[k])}`}>{signedPct(s[k])}</td>)}
                  <td className="text-right tnum font-medium">{num(s.avg_score, 0)}</td>
                </tr>))}</tbody>
            </table>
          </div>
        </Card>
        <Card title="How sectors move together" subtitle="Correlation of daily sector returns over the past year">
          <Heatmap data={data.market.correlation} short={(l) => SHORT[l] ?? l} />
        </Card>
      </div>
    </div>
  )
}
