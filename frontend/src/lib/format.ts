/** Formatting helpers. A missing value is always shown as "Data unavailable". */
export const NA = 'Data unavailable'
export const NA_SHORT = 'n/a'

type N = number | null | undefined
const ok = (v: N): v is number => v !== null && v !== undefined && Number.isFinite(v)

export function pct(v: N, digits = 1, signed = false, na = NA_SHORT): string {
  if (!ok(v)) return na
  const s = (v * 100).toFixed(digits)
  return `${signed && v > 0 ? '+' : ''}${s}%`
}
export const signedPct = (v: N, digits = 1, na = NA_SHORT) => pct(v, digits, true, na)

export function num(v: N, digits = 2, na = NA_SHORT): string {
  return ok(v) ? v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : na
}

export function money(v: N, digits = 0, na = NA_SHORT): string {
  return ok(v)
    ? v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits })
    : na
}

export function compactMoney(v: N, na = NA_SHORT): string {
  if (!ok(v)) return na
  const a = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (a >= 1e12) return `${sign}$${(a / 1e12).toFixed(2)}T`
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(1)}B`
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(1)}K`
  return `${sign}$${a.toFixed(0)}`
}

export function shortDate(iso: string): string {
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso)
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
}
export function monthYear(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`)
  return d.toLocaleDateString('en-US', { year: '2-digit', month: 'short' })
}
export const year = (iso: string) => iso.slice(0, 4)

/** Colour class for a value where up is good. */
export function tone(v: N): string {
  if (!ok(v) || v === 0) return 'text-ink-2'
  return v > 0 ? 'text-good' : 'text-bad'
}

export const HORIZON_LABEL: Record<string, string> = {
  '1m': '1 month', '3m': '3 months', '6m': '6 months', '12m': '12 months',
}
/** For use before a noun: "a 6-month horizon". */
export const HORIZON_ADJ: Record<string, string> = {
  '1m': '1-month', '3m': '3-month', '6m': '6-month', '12m': '12-month',
}
export const MODEL_LABEL: Record<string, string> = {
  baseline: 'Baseline', logistic: 'Logistic Regression', random_forest: 'Random Forest',
  gradient_boosting: 'Gradient Boosting', ensemble: 'Ensemble',
}
