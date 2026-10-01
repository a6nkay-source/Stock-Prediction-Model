/** Small building blocks shared by every page. */
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Info, Loader2 } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { GLOSSARY } from '../lib/glossary'

export function Card({ title, subtitle, action, children, className = '' }: {
  title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string
}) {
  return (
    <section className={`rounded-xl border border-line bg-surface p-4 sm:p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-2">{subtitle}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

/** A financial term with a plain-language tooltip (hover or keyboard focus). */
export function Term({ name, children }: { name: string; children?: ReactNode }) {
  const text = GLOSSARY[name]
  if (!text) return <>{children ?? name}</>
  return (
    <span className="group relative inline-flex cursor-help items-center gap-1" tabIndex={0}>
      <span className="underline decoration-dotted decoration-muted underline-offset-2">{children ?? name}</span>
      <span role="tooltip" className="pointer-events-none absolute left-0 top-full z-40 mt-1 hidden w-64 rounded-lg border border-line bg-surface p-2.5 text-left text-xs font-normal normal-case leading-snug tracking-normal text-ink-2 shadow-lg group-hover:block group-focus:block">
        <span className="mb-0.5 block font-semibold text-ink">{name}</span>
        {text}
      </span>
    </span>
  )
}

export function Stat({ label, term, value, sub, tone = '' }: {
  label: string; term?: string; value: ReactNode; sub?: ReactNode; tone?: string
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="text-xs text-ink-2">{term ? <Term name={term}>{label}</Term> : label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-2">{sub}</div>}
    </div>
  )
}

const BADGE: Record<string, string> = {
  good: 'bg-[color-mix(in_srgb,var(--good)_14%,transparent)] text-good',
  warn: 'bg-[color-mix(in_srgb,var(--warn)_22%,transparent)] text-warn',
  bad: 'bg-[color-mix(in_srgb,var(--bad)_14%,transparent)] text-bad',
  neutral: 'bg-surface-2 text-ink-2',
  accent: 'bg-accent-soft text-accent',
}
export function Badge({ tone = 'neutral', children }: { tone?: keyof typeof BADGE | string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[tone] ?? BADGE.neutral}`}>
      {children}
    </span>
  )
}

/** Risk is shown with a label and a level meter, never colour alone. */
export function RiskBadge({ level }: { level: string }) {
  const n = level === 'Low' ? 1 : level === 'Medium' ? 2 : level === 'High' ? 3 : 0
  const toneName = n === 1 ? 'good' : n === 2 ? 'warn' : n === 3 ? 'bad' : 'neutral'
  return (
    <Badge tone={toneName}>
      <span className="flex items-end gap-[2px]" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span key={i} className="w-[3px] rounded-sm bg-current" style={{ height: 3 + i * 3, opacity: i <= n ? 1 : 0.25 }} />
        ))}
      </span>
      {level}
    </Badge>
  )
}

export function ConfidenceBadge({ label, value }: { label: string; value: number }) {
  const toneName = label === 'High' ? 'good' : label === 'Medium' ? 'warn' : 'neutral'
  return <Badge tone={toneName}>{label} · {value.toFixed(0)}</Badge>
}

/** Probability as a bar with the 50% coin-flip line marked. */
export function ProbBar({ value, baseline }: { value: number | null; baseline?: number | null }) {
  if (value === null || value === undefined) return <span className="text-muted">n/a</span>
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-2 w-20 shrink-0 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
        <div className="absolute inset-y-0 w-px bg-ink/50" style={{ left: `${(baseline ?? 0.5) * 100}%` }} />
      </div>
      <span className="tnum w-9 text-right">{(value * 100).toFixed(0)}%</span>
    </div>
  )
}

/** Expected-return range: 10–90% band, 25–75% box, median tick, zero line. */
export function RangeBar({ q10, q25, q50, q75, q90, min = -0.5, max = 0.8, width = 120 }: {
  q10: number | null; q25: number | null; q50: number | null; q75: number | null; q90: number | null
  min?: number; max?: number; width?: number
}) {
  if (q10 === null || q90 === null || q50 === null || q25 === null || q75 === null) {
    return <span className="text-muted">n/a</span>
  }
  const x = (v: number) => ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * width
  return (
    <svg width={width} height={16} role="img" aria-label={`Range ${(q10 * 100).toFixed(0)}% to ${(q90 * 100).toFixed(0)}%`}>
      <line x1={x(0)} x2={x(0)} y1={0} y2={16} stroke="var(--axis)" strokeWidth={1} />
      <line x1={x(q10)} x2={x(q90)} y1={8} y2={8} stroke="var(--s1)" strokeWidth={2} strokeLinecap="round" opacity={0.45} />
      <rect x={x(q25)} y={4} width={Math.max(2, x(q75) - x(q25))} height={8} rx={2} fill="var(--s1)" opacity={0.75} />
      <line x1={x(q50)} x2={x(q50)} y1={2} y2={14} stroke="var(--ink)" strokeWidth={2} />
    </svg>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-ink-2">
      <Loader2 className="h-4 w-4 animate-spin" /> {label}
    </div>
  )
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-bad" />
        <div>
          <div className="font-semibold">Something went wrong</div>
          <p className="mt-1 text-ink-2">{message}</p>
          {onRetry && <button onClick={onRetry} className="mt-3 rounded-lg border border-line px-3 py-1.5 hover:bg-surface-2">Try again</button>}
        </div>
      </div>
    </div>
  )
}

export function Callout({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'bad' | 'good'; title?: string; children: ReactNode }) {
  const color = tone === 'warn' ? 'var(--warn)' : tone === 'bad' ? 'var(--bad)' : tone === 'good' ? 'var(--good)' : 'var(--accent)'
  const Icon = tone === 'info' || tone === 'good' ? Info : AlertTriangle
  return (
    <div className="flex gap-3 rounded-xl border border-line bg-surface p-4" style={{ borderLeft: `3px solid ${color}` }}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color }} />
      <div className="text-[13px] leading-relaxed text-ink-2">
        {title && <div className="mb-0.5 font-semibold text-ink">{title}</div>}
        {children}
      </div>
    </div>
  )
}

export function PageHeader({ title, lead, children }: { title: string; lead?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {lead && <p className="mt-1 text-ink-2">{lead}</p>}
      </div>
      {children}
    </div>
  )
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label?: string
}) {
  return (
    <div className="inline-flex max-w-full shrink-0 overflow-x-auto rounded-lg border border-line bg-surface-2 p-0.5" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} onClick={() => onChange(o.value)} aria-pressed={o.value === value}
          className={`whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${o.value === value ? 'bg-surface text-ink shadow-sm' : 'text-ink-2 hover:text-ink'}`}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export interface Column<T> {
  key: string
  header: ReactNode
  sort?: (row: T) => number | string | null
  render: (row: T) => ReactNode
  align?: 'left' | 'right'
  className?: string
}

/** A table whose columns sort on click; missing values always sort last. */
export function SortableTable<T>({ rows, columns, rowKey, initialSort, initialDir = 'desc', onRowClick, dense }: {
  rows: T[]; columns: Column<T>[]; rowKey: (row: T) => string; initialSort?: string
  initialDir?: 'asc' | 'desc'; onRowClick?: (row: T) => void; dense?: boolean
}) {
  const [sortKey, setSortKey] = useState(initialSort)
  const [dir, setDir] = useState<'asc' | 'desc'>(initialDir)
  const sorted = useMemo(() => {
    const col = columns.find((c) => c.key === sortKey)
    if (!col?.sort) return rows
    const get = col.sort
    return [...rows].sort((a, b) => {
      const va = get(a), vb = get(b)
      if (va === null && vb === null) return 0
      if (va === null) return 1
      if (vb === null) return -1
      const cmp = typeof va === 'string' ? va.localeCompare(String(vb)) : va - (vb as number)
      return dir === 'asc' ? cmp : -cmp
    })
  }, [rows, columns, sortKey, dir])
  const pad = dense ? 'px-2 py-1.5' : 'px-3 py-2'
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-line text-xs text-ink-2">
            {columns.map((c) => {
              const active = c.key === sortKey
              const Icon = !active ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown
              return (
                <th key={c.key} scope="col" aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={`${pad} whitespace-nowrap font-medium ${c.align === 'right' ? 'text-right' : 'text-left'}`}>
                  {c.sort ? (
                    <button className={`inline-flex items-center gap-1 hover:text-ink ${active ? 'text-ink' : ''}`}
                      onClick={() => {
                        if (active) setDir(dir === 'asc' ? 'desc' : 'asc')
                        else { setSortKey(c.key); setDir(typeof c.sort!(rows[0]) === 'string' ? 'asc' : 'desc') }
                      }}>
                      {c.header} <Icon className={`h-3 w-3 ${active ? '' : 'opacity-40'}`} />
                    </button>
                  ) : c.header}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={rowKey(row)} onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`border-b border-line last:border-0 ${onRowClick ? 'cursor-pointer hover:bg-surface-2' : ''}`}>
              {columns.map((c) => (
                <td key={c.key} className={`${pad} ${c.align === 'right' ? 'text-right tnum' : ''} ${c.className ?? ''}`}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
