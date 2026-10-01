/** Chart helpers: shared tooltip, legend, colours, and a correlation heatmap. */
import { useState, type ReactNode } from 'react'
import type { Matrix } from '../lib/api'

export const SERIES = {
  ai: { color: 'var(--s1)', label: 'AI portfolio' },
  spy: { color: 'var(--s2)', label: 'S&P 500 (SPY)' },
  equal_weight: { color: 'var(--s3)', label: 'Equal-weight universe' },
  buy_hold: { color: 'var(--s4)', label: 'Buy and hold' },
} as const

export const MODEL_COLOR: Record<string, string> = {
  logistic: 'var(--s1)', random_forest: 'var(--s2)', gradient_boosting: 'var(--s3)',
  ensemble: 'var(--s4)', baseline: 'var(--muted)',
}

export const AXIS = { tickLine: false, axisLine: { stroke: 'var(--axis)' }, tick: { fontSize: 11 } }
export const GRID = { stroke: 'var(--grid)', vertical: false }

interface TipEntry { name?: string | number; value?: unknown; color?: string; dataKey?: string | number | ((o: unknown) => unknown); payload?: Record<string, unknown> }
/** One tooltip style for every chart; values are formatted by the caller. */
export function ChartTooltip({ active, payload, label, format, labelFormat, hide }: {
  active?: boolean; payload?: readonly TipEntry[]; label?: string | number
  format: (value: number, key: string) => string; labelFormat?: (label: string) => string; hide?: string[]
}) {
  if (!active || !payload?.length) return null
  const rows = payload.filter((p) => typeof p.value === 'number' && !hide?.includes(String(p.dataKey)))
  if (!rows.length) return null
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      {label !== undefined && <div className="mb-1 font-medium text-ink">{labelFormat ? labelFormat(String(label)) : label}</div>}
      {rows.map((p) => (
        <div key={String(p.dataKey)} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5 text-ink-2">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color }} /> {p.name}
          </span>
          <span className="tnum font-medium text-ink">{format(p.value as number, String(p.dataKey))}</span>
        </div>
      ))}
    </div>
  )
}

export function Legend({ items }: { items: { color: string; label: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4" style={i.dashed
            ? { backgroundImage: `linear-gradient(90deg, ${i.color} 60%, transparent 0)`, backgroundSize: '6px 2px' }
            : { background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  )
}

/** Diverging blue ↔ red with a neutral midpoint, for values in [-1, 1]. */
function diverging(v: number): string {
  const t = Math.max(-1, Math.min(1, v))
  const pole = t >= 0 ? 'var(--s1)' : 'var(--bad)'
  return `color-mix(in srgb, ${pole} ${Math.round(Math.abs(t) * 100)}%, var(--neutral-fill))`
}

export function Heatmap({ data, short }: { data: Matrix; short?: (label: string) => string }) {
  const [hover, setHover] = useState<{ r: number; c: number } | null>(null)
  const n = data.labels.length
  const lab = short ?? ((s: string) => s)
  return (
    <div>
      <div className="overflow-x-auto">
        <div className="inline-grid gap-[2px] text-[10px]" style={{ gridTemplateColumns: `auto repeat(${n}, minmax(22px, 34px))` }}>
          <div />
          {data.labels.map((l) => (
            <div key={l} className="flex h-28 items-end justify-center pb-1 text-ink-2">
              <span className="[writing-mode:vertical-rl] rotate-180 whitespace-nowrap">{lab(l)}</span>
            </div>
          ))}
          {data.matrix.map((row, r) => (
            <FragmentRow key={data.labels[r]} label={lab(data.labels[r])}>
              {row.map((v, c) => (
                <div key={c} onMouseEnter={() => setHover({ r, c })} onMouseLeave={() => setHover(null)}
                  className="flex aspect-square items-center justify-center rounded-[3px] tnum"
                  style={{ background: v === null ? 'var(--surface-2)' : diverging(v), color: v !== null && Math.abs(v) > 0.55 ? '#fff' : 'var(--ink-2)' }}
                  title={v === null ? 'n/a' : `${data.labels[r]} × ${data.labels[c]}: ${v.toFixed(2)}`}>
                  {n <= 16 && v !== null ? v.toFixed(1) : ''}
                </div>
              ))}
            </FragmentRow>
          ))}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-2">
        <span className="flex items-center gap-2">
          −1
          <span className="h-2 w-28 rounded-full" style={{ background: 'linear-gradient(90deg, var(--bad), var(--neutral-fill), var(--s1))' }} />
          +1 <span className="text-muted">(move opposite → move together)</span>
        </span>
        <span className="tnum min-h-4">
          {hover && data.matrix[hover.r][hover.c] !== null
            ? `${data.labels[hover.r]} × ${data.labels[hover.c]}: ${data.matrix[hover.r][hover.c]!.toFixed(2)}`
            : 'Hover a cell for the exact value'}
        </span>
      </div>
    </div>
  )
}

function FragmentRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <div className="flex items-center justify-end whitespace-nowrap pr-2 text-ink-2">{label}</div>
      {children}
    </>
  )
}

/** Horizontal bars for a share-of-total breakdown (used instead of a many-colour pie). */
export function ShareBars({ rows, cap, format }: {
  rows: { label: string; value: number; muted?: boolean }[]; cap?: number; format: (v: number) => string
}) {
  const max = Math.max(cap ?? 0, ...rows.map((r) => r.value), 0.0001)
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[minmax(64px,150px)_1fr_44px] items-center gap-2 text-xs">
          <span className="truncate text-ink-2" title={r.label}>{r.label}</span>
          <div className="relative h-3 rounded-sm bg-surface-2">
            <div className="h-full rounded-r-[4px]" style={{ width: `${(r.value / max) * 100}%`, background: r.muted ? 'var(--muted)' : 'var(--s1)' }} />
            {cap !== undefined && <div className="absolute inset-y-[-3px] w-px bg-ink" style={{ left: `${(cap / max) * 100}%` }} title={`Limit ${format(cap)}`} />}
          </div>
          <span className="tnum text-right text-ink">{format(r.value)}</span>
        </div>
      ))}
    </div>
  )
}

/** Thin out a long series so charts stay responsive. */
export function downsample<T>(rows: T[], max = 600): T[] {
  if (rows.length <= max) return rows
  const step = Math.ceil(rows.length / max)
  const out = rows.filter((_, i) => i % step === 0)
  if (out[out.length - 1] !== rows[rows.length - 1]) out.push(rows[rows.length - 1])
  return out
}
