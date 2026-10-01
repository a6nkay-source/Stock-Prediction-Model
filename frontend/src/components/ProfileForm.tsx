import { Plus, Trash2 } from 'lucide-react'
import type { Horizon, Risk } from '../lib/api'
import { SECTORS, useProfile } from '../lib/profile'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  )
}

function Chips({ selected, blocked, onToggle }: { selected: string[]; blocked: string[]; onToggle: (s: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {SECTORS.map((s) => {
        const on = selected.includes(s), off = blocked.includes(s)
        return (
          <button key={s} type="button" disabled={off} aria-pressed={on} onClick={() => onToggle(s)}
            className={`rounded-full border px-2.5 py-1 text-xs ${on ? 'border-accent bg-accent-soft font-medium text-accent' : 'border-line text-ink-2 hover:bg-surface-2'} disabled:cursor-not-allowed disabled:opacity-35`}>
            {s}
          </button>)
      })}
    </div>
  )
}

/** Every input that defines the investor. Nothing is assumed about her; she sets it all. */
export function ProfileForm() {
  const { profile: p, update, reset } = useProfile()
  const toggle = (list: string[], s: string) => (list.includes(s) ? list.filter((x) => x !== s) : [...list, s])
  const setHolding = (i: number, patch: Partial<{ ticker: string; value: number }>) =>
    update({ holdings: p.holdings.map((h, j) => (j === i ? { ...h, ...patch } : h)) })
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount to invest ($)">
          <input className="field tnum" type="number" min={100} step={500} value={p.amount} onChange={(e) => update({ amount: Math.max(0, Number(e.target.value)) })} />
        </Field>
        <Field label="Investment horizon">
          <select className="field" value={p.horizon} onChange={(e) => update({ horizon: e.target.value as Horizon })}>
            <option value="1m">1 month</option><option value="3m">3 months</option><option value="6m">6 months</option><option value="12m">12 months</option>
          </select>
        </Field>
        <Field label="Risk tolerance">
          <select className="field" value={p.risk} onChange={(e) => update({ risk: e.target.value as Risk })}>
            <option value="conservative">Conservative</option><option value="moderate">Moderate</option><option value="aggressive">Aggressive</option>
          </select>
        </Field>
        <Field label="Minimum number of stocks">
          <input className="field tnum" type="number" min={1} max={40} value={p.minHoldings} onChange={(e) => update({ minHoldings: Math.min(40, Math.max(1, Number(e.target.value))) })} />
        </Field>
        <Field label={`Max in one stock: ${(p.maxStock * 100).toFixed(0)}%`}>
          <input className="w-full accent-[var(--accent)]" type="range" min={3} max={50} value={p.maxStock * 100} onChange={(e) => update({ maxStock: Number(e.target.value) / 100 })} />
        </Field>
        <Field label={`Max in one sector: ${(p.maxSector * 100).toFixed(0)}%`}>
          <input className="w-full accent-[var(--accent)]" type="range" min={10} max={100} step={5} value={p.maxSector * 100} onChange={(e) => update({ maxSector: Number(e.target.value) / 100 })} />
        </Field>
        <Field label={`Keep as cash: ${(p.cash * 100).toFixed(0)}%`}>
          <input className="w-full accent-[var(--accent)]" type="range" min={0} max={50} step={5} value={p.cash * 100} onChange={(e) => update({ cash: Number(e.target.value) / 100 })} />
        </Field>
      </div>
      <Field label="Industries she is interested in" hint="These get a small, fixed score bonus (+5 points). They are not guaranteed a place.">
        <Chips selected={p.preferSectors} blocked={p.avoidSectors} onToggle={(s) => update({ preferSectors: toggle(p.preferSectors, s) })} />
      </Field>
      <Field label="Industries to avoid" hint="Stocks in these sectors are excluded completely.">
        <Chips selected={p.avoidSectors} blocked={p.preferSectors} onToggle={(s) => update({ avoidSectors: toggle(p.avoidSectors, s) })} />
      </Field>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-ink-2">Current holdings (optional)</span>
          <button type="button" className="inline-flex items-center gap-1 text-xs text-accent hover:underline" onClick={() => update({ holdings: [...p.holdings, { ticker: '', value: 0 }] })}>
            <Plus className="h-3 w-3" /> Add
          </button>
        </div>
        {p.holdings.length === 0 && <p className="text-[11px] text-muted">None entered. Add what she already owns to see the trades needed.</p>}
        <div className="space-y-1.5">
          {p.holdings.map((h, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className="field !w-24 uppercase" placeholder="Ticker" value={h.ticker} onChange={(e) => setHolding(i, { ticker: e.target.value.toUpperCase() })} aria-label="Ticker" />
              <input className="field tnum" type="number" min={0} placeholder="Value ($)" value={h.value || ''} onChange={(e) => setHolding(i, { value: Number(e.target.value) })} aria-label="Value in dollars" />
              <button type="button" aria-label="Remove holding" className="rounded-lg p-1.5 text-ink-2 hover:bg-surface-2" onClick={() => update({ holdings: p.holdings.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></button>
            </div>))}
        </div>
        {p.holdings.length > 0 && (
          <label className="mt-2 flex items-center gap-1.5 text-xs text-ink-2">
            <input type="checkbox" checked={p.keepHoldings} onChange={(e) => update({ keepHoldings: e.target.checked })} /> Keep these in the new portfolio
          </label>)}
      </div>
      <button type="button" onClick={reset} className="text-xs text-ink-2 underline decoration-dotted hover:text-ink">Reset to defaults</button>
    </div>
  )
}
