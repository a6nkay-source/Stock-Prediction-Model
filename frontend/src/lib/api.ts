/** Typed client for the Python API. All requests go to /api (proxied in development). */
import { useCallback, useEffect, useRef, useState } from 'react'

export type Horizon = '1m' | '3m' | '6m' | '12m'
export type Risk = 'conservative' | 'moderate' | 'aggressive'
export type Num = number | null

export interface Skill {
  n: Num; n_dates: Num; accuracy: Num; naive_accuracy: Num; accuracy_lift: Num; base_rate: Num
  auc: Num; brier: Num; rank_ic: Num; rank_ic_t_adjusted: Num; top_minus_bottom: Num
}
export interface Range { q10: Num; q25: Num; q50: Num; q75: Num; q90: Num }
export interface Confidence {
  value: number; label: 'Low' | 'Medium' | 'High'; capped_for_low_skill: boolean
  agreement: number; conviction: number; completeness: number; model_spread: number
}
export interface Prediction {
  p_up: Num; p_beat: Num; p_up_models: Record<string, Num>; p_beat_models: Record<string, Num>
  range: Range; confidence: Confidence; base_rate: Num; data_completeness: number
}
export interface Returns { '1m': Num; '3m': Num; '6m': Num; '1y': Num; '3y': Num }
export interface PriceMetrics {
  price: Num; returns: Returns; volatility: Num; max_drawdown_1y: Num; max_drawdown_all: Num
  risk_level: string; history_start: string
}
export interface PredictionRow extends Prediction, PriceMetrics {
  ticker: string; name: string; sector: string; score: Num; rank: number; beta: Num; pe: Num
  eps_growth: Num; revenue_growth: Num; profit_margin: Num; market_cap: Num; dividend_yield: Num
  debt_to_equity: Num; free_cash_flow: Num; top_positive: string[]; top_negative: string[]
}
export interface Intervals {
  n?: number; coverage_50?: number; coverage_80?: number; median_abs_error?: number
  mean_abs_error?: number; mean_width_50?: number; mean_width_80?: number
}
export interface PredictionsResponse {
  as_of: string; horizon: Horizon; risk: Risk; risk_weight: number
  skill: { abs: Skill; rel: Skill }; intervals: Intervals; rows: PredictionRow[]
}
export interface Factor {
  feature: string; label: string; family: string; headline: string; value: Num; value_text: string
  percentile: Num; contribution: number; points: number; direction: 'positive' | 'negative'
  description: string; missing: boolean
}
export interface Explanation { factors: Factor[]; families: { family: string; points: number }[] }
export interface HistoryPoint {
  date: string; p_up: Num; p_beat: Num; q10: Num; q25: Num; q50: Num; q75: Num; q90: Num; actual: Num
}
export interface CallRecord { date: string; predicted: Num; actual: Num; probability: Num }
export interface NewsItem {
  title: string; summary: string; publisher: string | null; url: string | null; published: string | null
  sentiment: { score: number; label: 'positive' | 'negative' | 'neutral' }
}
export interface StockDetail {
  ticker: string; name: string; sector: string; industry: string | null; summary: string | null
  as_of: string; horizon: Horizon; score: Num; rank: number | null; universe_size: number
  metrics: PriceMetrics & { beta: Num; rsi_14: Num; dist_52w_high: Num }
  prices: { dates: string[]; close: number[]; benchmark: number[] }
  fundamentals: Record<string, Num>
  analyst: { target_mean: Num; target_low: Num; target_high: Num; implied_upside: Num; rating: string | null; rating_score: Num; count: Num }
  earnings: { quarter: string; eps_actual: Num; eps_estimate: Num; surprise_pct: Num }[]
  news: NewsItem[]
  news_sentiment: { score: number; label: string; n_headlines: number; n_positive: number; n_negative: number; method: string } | null
  predictions: Record<Horizon, Prediction>
  skill: Record<Horizon, { abs: Skill; rel: Skill; intervals: Intervals }>
  explanation: { outperform: Explanation; direction: Explanation; reasoning: string[] }
  history: { points: HistoryPoint[]; summary: { n: number; accuracy: Num; naive_accuracy: Num; coverage_80: Num; worst: CallRecord; best: CallRecord } | null }
}
export interface Matrix { labels: string[]; matrix: Num[][] }
export interface MarketOverview {
  as_of: string
  market: { price: Num; returns: Returns; volatility: Num; max_drawdown_1y: Num; vs_200d: Num; breadth: Num; history: { dates: string[]; close: number[] } }
  sectors: { sector: string; n: number; avg_score: Num; '1m': Num; '3m': Num; '6m': Num; '1y': Num }[]
  scatter: { ticker: string; sector: string; volatility: Num; return_1y: Num; score: Num; p_beat: Num }[]
  correlation: Matrix
}
export interface PortfolioHolding {
  ticker: string; name: string; sector: string; weight: number; dollars: number; price: Num; shares: Num
  score: Num; p_up: Num; p_beat: Num; range: Range; volatility: Num; risk_level: string
  current_dollars: number; trade_dollars: number; why: string[]; watch: string[]
}
export interface PortfolioResponse {
  as_of: string; horizon: Horizon; total_value: number
  holdings: PortfolioHolding[]
  sells: { ticker: string; current_dollars: number; trade_dollars: number; sector: string | null }[]
  sectors: { sector: string; weight: number }[]
  stats: {
    volatility: number; beta: number; diversification_ratio: Num; effective_holdings: number
    average_correlation: Num; avg_p_up: Num; avg_p_beat: Num; avg_score: Num; invested: number
    cash: number; n_holdings: number; max_weight: number; max_sector_weight: number; risk_level: string
  }
  notes: string[]; correlation: Matrix
  method: { preferred_sector_bonus: number; correlation_penalty: number }
  skill: Skill
}
export interface PerfStats {
  start_value: number; end_value: number; start_date: string; end_date: string; years: number
  total_return: number; annualized_return: number; volatility: number; sharpe: number; sortino: number
  max_drawdown: number; calmar: Num; best_month: Num; worst_month: Num; positive_months: Num
  beta?: number; alpha?: number; tracking_error?: number; information_ratio?: Num
  months_beating_benchmark?: Num; n_trades: number; win_rate: Num; turnover: number
  total_costs: number; round_trips: number
}
export type StrategyKey = 'ai' | 'spy' | 'equal_weight' | 'buy_hold'
export interface BacktestResponse {
  params: Record<string, unknown>; as_of: string; risk_free_rate: number
  series: { dates: string[] } & Record<StrategyKey, number[]>
  drawdowns: { dates: string[] } & Record<StrategyKey, number[]>
  stats: Record<StrategyKey, PerfStats>
  yearly: ({ year: number } & Record<StrategyKey, Num>)[]
  rolling_excess: { spy: Num[]; equal_weight: Num[] }
  holdings: { ticker: string; weight: number; sector: string }[]
  sectors: { sector: string; weight: number }[]
  last_rebalance: string; n_rebalances: number; avg_holdings: Num
  recent_trades: { date: string; ticker: string; action: 'BUY' | 'SELL'; weight_change: number; price: number }[]
  best_trades: { ticker: string; entry: string; exit: string; return: number }[]
  worst_trades: { ticker: string; entry: string; exit: string; return: number }[]
  verdict: { tone: 'good' | 'bad' | 'warn'; text: string }[]
}
export interface ModelMetrics extends Skill {
  log_loss: Num; rank_ic_t: Num; rank_ic_positive_share: Num
  by_year: { year: number; accuracy: number; naive_accuracy: number; base_rate: number; n: number }[]
  calibration: { predicted: number; observed: number; mean_return: number; n: number }[]
}
export interface ExtremeCall {
  ticker: string; date: string; probability: number; predicted_median: number
  predicted_low: number; predicted_high: number; actual: number
}
export interface HorizonMetrics {
  models: Record<string, ModelMetrics>; first_date: string; last_date: string; last_labelled_date: string
  intervals?: Intervals; extremes?: { worst: ExtremeCall | null; best: ExtremeCall | null }
}
export interface Meta {
  built_at: string; as_of: string; price_start: string; first_prediction: string; n_stocks: number
  n_rows: number; n_features: number; provider: string; fundamentals_source: string; xgboost: boolean
  model_labels: Record<string, string>; fast_mode: boolean; refit_months: number; min_train_months: number
  fundamentals_coverage: number; elapsed_seconds: number
  training: Record<string, Record<string, { params: Record<string, Record<string, number>>; n_train: number; train_end: string }>>
  universe: { ticker: string; name: string; sector: string }[]
}
export interface ModelsResponse {
  meta: Meta
  metrics: Record<'abs' | 'rel', Record<Horizon, HorizonMetrics>>
  importance: Record<'abs' | 'rel', Record<Horizon, Record<string, Record<string, number>>>>
  features: { name: string; label: string; family: string; description: string }[]
  risk_weights: Record<Risk, number>
}
export interface Status {
  ready: boolean; disclaimer: string; meta: Meta | null
  job: { running: boolean; log: string[]; error: string | null }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init)
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body?.detail) detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch { /* not JSON */ }
    throw new Error(detail)
  }
  return res.json() as Promise<T>
}
const post = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export const api = {
  status: () => request<Status>('/status'),
  refresh: () => request<{ started: boolean; reason?: string }>('/refresh', { method: 'POST' }),
  predictions: (h: Horizon, r: Risk) => request<PredictionsResponse>(`/predictions?horizon=${h}&risk=${r}`),
  stock: (t: string, h: Horizon, r: Risk) => request<StockDetail>(`/stocks/${encodeURIComponent(t)}?horizon=${h}&risk=${r}`),
  market: (h: Horizon, r: Risk) => request<MarketOverview>(`/market?horizon=${h}&risk=${r}`),
  portfolio: (body: unknown) => post<PortfolioResponse>('/portfolio', body),
  backtest: (body: unknown) => post<BacktestResponse>('/backtest', body),
  models: () => request<ModelsResponse>('/models'),
}

export interface Async<T> { data: T | null; loading: boolean; error: string | null; reload: () => void }

/** Run an async loader whenever `deps` change; ignores responses from stale requests. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]): Async<T> {
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({
    data: null, loading: true, error: null,
  })
  const [tick, setTick] = useState(0)
  const latest = useRef(0)
  useEffect(() => {
    const id = ++latest.current
    setState((s) => ({ ...s, loading: true, error: null }))
    loader()
      .then((data) => { if (id === latest.current) setState({ data, loading: false, error: null }) })
      .catch((e: Error) => { if (id === latest.current) setState({ data: null, loading: false, error: e.message }) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return { ...state, reload }
}
