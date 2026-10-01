/** The investor's profile: defined entirely by her own inputs, saved in the browser. */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Horizon, Risk } from './api'

export interface Holding { ticker: string; value: number }
export interface Profile {
  amount: number
  horizon: Horizon
  risk: Risk
  maxStock: number      // fraction
  maxSector: number     // fraction
  minHoldings: number
  cash: number          // fraction
  preferSectors: string[]
  avoidSectors: string[]
  holdings: Holding[]
  keepHoldings: boolean
}
export const DEFAULT_PROFILE: Profile = {
  amount: 10000, horizon: '6m', risk: 'moderate', maxStock: 0.15, maxSector: 0.3, minHoldings: 8,
  cash: 0, preferSectors: [], avoidSectors: [], holdings: [], keepHoldings: false,
}
export const SECTORS = [
  'Technology', 'Communication Services', 'Consumer Discretionary', 'Consumer Staples', 'Healthcare',
  'Financials', 'Industrials', 'Energy', 'Utilities', 'Real Estate', 'Materials',
]

interface Ctx { profile: Profile; update: (patch: Partial<Profile>) => void; reset: () => void }
const ProfileContext = createContext<Ctx | null>(null)
const KEY = 'investor-profile-v1'

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profile, setProfile] = useState<Profile>(() => {
    try {
      const saved = localStorage.getItem(KEY)
      return saved ? { ...DEFAULT_PROFILE, ...JSON.parse(saved) } : DEFAULT_PROFILE
    } catch { return DEFAULT_PROFILE }
  })
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(profile)) } catch { /* private mode */ }
  }, [profile])
  const value = useMemo<Ctx>(() => ({
    profile,
    update: (patch) => setProfile((p) => ({ ...p, ...patch })),
    reset: () => setProfile(DEFAULT_PROFILE),
  }), [profile])
  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useProfile(): Ctx {
  const ctx = useContext(ProfileContext)
  if (!ctx) throw new Error('useProfile must be used inside ProfileProvider')
  return ctx
}

/** Body for POST /api/portfolio. */
// eslint-disable-next-line react-refresh/only-export-components
export function portfolioRequest(p: Profile) {
  return {
    amount: p.amount, horizon: p.horizon, risk: p.risk, max_stock: p.maxStock, max_sector: p.maxSector,
    min_holdings: p.minHoldings, cash: p.cash, avoid_sectors: p.avoidSectors, prefer_sectors: p.preferSectors,
    holdings: p.holdings.filter((h) => h.ticker.trim()), keep_holdings: p.keepHoldings,
  }
}
