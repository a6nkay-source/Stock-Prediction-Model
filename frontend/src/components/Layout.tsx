import { Activity, BarChart3, BookOpen, Briefcase, FlaskConical, LayoutDashboard, Menu, Moon, RefreshCw, Search, Sun, TrendingUp, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { api, useAsync, type Horizon, type Risk } from '../lib/api'
import { shortDate } from '../lib/format'
import { useProfile } from '../lib/profile'
import { Loading } from './primitives'

const NAV = [
  { to: '/', label: 'Portfolio Overview', icon: LayoutDashboard },
  { to: '/predictor', label: 'AI Stock Predictor', icon: TrendingUp },
  { to: '/explorer', label: 'Stock Explorer', icon: Search },
  { to: '/builder', label: 'Portfolio Builder', icon: Briefcase },
  { to: '/backtesting', label: 'Backtesting', icon: Activity },
  { to: '/models', label: 'Model Performance', icon: BarChart3 },
  { to: '/methodology', label: 'Methodology', icon: BookOpen },
]

function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? 'light')
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try { localStorage.setItem('theme', theme) } catch { /* private mode */ }
  }, [theme])
  return [theme, () => setTheme(theme === 'dark' ? 'light' : 'dark')]
}

export default function Layout() {
  const [theme, toggleTheme] = useTheme()
  const [open, setOpen] = useState(false)
  const { profile, update } = useProfile()
  const location = useLocation()
  const status = useAsync(api.status, [])
  const job = status.data?.job
  useEffect(() => setOpen(false), [location.pathname])
  // While a refresh is running, poll until it finishes, then reload the page data.
  useEffect(() => {
    if (!job?.running) return
    const id = setInterval(async () => {
      const s = await api.status().catch(() => null)
      if (s && !s.job.running) { clearInterval(id); window.location.reload() }
    }, 5000)
    return () => clearInterval(id)
  }, [job?.running])

  const refresh = async () => {
    if (!confirm('Re-download market data and retrain every model? This takes 15–30 minutes and runs in the background.')) return
    await api.refresh()
    status.reload()
  }

  return (
    <div className="flex min-h-full">
      <aside className={`fixed inset-y-0 left-0 z-30 w-60 shrink-0 border-r border-line bg-surface transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex h-14 items-center gap-2 border-b border-line px-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-white"><FlaskConical className="h-4 w-4" /></span>
          <div className="leading-tight">
            <div className="text-sm font-semibold">AI Stock Predictor</div>
            <div className="text-[11px] text-muted">Portfolio research lab</div>
          </div>
        </div>
        <nav className="p-2">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} end={to === '/'}
              className={({ isActive }) => `mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] ${isActive ? 'bg-accent-soft font-medium text-accent' : 'text-ink-2 hover:bg-surface-2 hover:text-ink'}`}>
              <Icon className="h-4 w-4" /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="absolute inset-x-0 bottom-0 border-t border-line p-4 text-[11px] leading-snug text-muted">
          Educational simulation. Not financial advice. Past performance does not guarantee future results.
        </div>
      </aside>
      {open && <div className="fixed inset-0 z-20 bg-black/40 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col overflow-x-clip">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b border-line bg-surface/95 px-4 backdrop-blur">
          <button className="rounded-lg p-1.5 hover:bg-surface-2 lg:hidden" onClick={() => setOpen(!open)} aria-label="Toggle navigation">
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <label className="flex items-center gap-1.5 text-xs text-ink-2">
            <span className="hidden sm:inline">Horizon</span>
            <select className="field !w-auto !py-1" value={profile.horizon} onChange={(e) => update({ horizon: e.target.value as Horizon })}>
              <option value="1m">1 month</option><option value="3m">3 months</option>
              <option value="6m">6 months</option><option value="12m">12 months</option>
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs text-ink-2">
            <span className="hidden sm:inline">Risk tolerance</span>
            <select className="field !w-auto !py-1" value={profile.risk} onChange={(e) => update({ risk: e.target.value as Risk })}>
              <option value="conservative">Conservative</option><option value="moderate">Moderate</option>
              <option value="aggressive">Aggressive</option>
            </select>
          </label>
          <div className="ml-auto flex items-center gap-2 text-xs text-ink-2">
            {status.data?.meta && <span className="hidden md:inline">Data as of {shortDate(status.data.meta.as_of)}</span>}
            <button onClick={refresh} disabled={job?.running} title="Re-download data and retrain"
              className="hidden items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 hover:bg-surface-2 disabled:opacity-60 sm:flex">
              <RefreshCw className={`h-3.5 w-3.5 ${job?.running ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{job?.running ? 'Retraining…' : 'Refresh data'}</span>
            </button>
            <button onClick={toggleTheme} aria-label="Toggle dark mode" className="rounded-lg border border-line p-1.5 hover:bg-surface-2">
              {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1400px] flex-1 p-4 sm:p-6">
          {status.loading && !status.data ? <Loading />
            : status.error ? <NotReady message={`Cannot reach the API (${status.error}). Start it with: uvicorn backend.main:app --port 8000`} />
            : !status.data?.ready ? <NotReady message={job?.running ? 'Models are being trained for the first time. This page will reload when they are ready.' : 'No trained models yet. Run `python -m backend.pipeline` (or press “Refresh data”) to download data and train.'} log={job?.log} />
            : <Outlet />}
        </main>
        <footer className="border-t border-line px-6 py-3 text-xs text-muted">
          {status.data?.disclaimer ?? 'Educational simulation — not financial advice.'}
        </footer>
      </div>
    </div>
  )
}

function NotReady({ message, log }: { message: string; log?: string[] }) {
  return (
    <div className="mx-auto mt-16 max-w-xl rounded-xl border border-line bg-surface p-6 text-center">
      <h1 className="text-lg font-semibold">Not ready yet</h1>
      <p className="mt-2 text-ink-2">{message}</p>
      {log && log.length > 0 && <pre className="mt-4 overflow-x-auto rounded-lg bg-surface-2 p-3 text-left text-xs text-ink-2">{log.join('\n')}</pre>}
    </div>
  )
}
