export type Denominator = { key: string; label: string; unit: string }
export type Meta = { denominators: Denominator[]; tickers: string[]; indices: string[]; periods: string[] }
export type Changes = Record<string, number | null>

export type Bar = {
  time: string
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

export type TrendModel = 'auto' | 'regression' | 'mean' | 'bands'
export type ResolvedModel = Exclude<TrendModel, 'auto'>

export type Channel = {
  model: ResolvedModel
  provisional_from: string | null
  start: string
  end: string
  times: string[]
  lines: Record<string, number[]>
  sigma: number
  z: number
  pct_from_trend: number
  annual_growth: number | null
}

export type ChartData = {
  ticker: string
  denominator: string
  bars: Bar[]
  channel: Channel | null
  changes: Changes
}

export type LeaderRow = {
  ticker: string
  last_date: string
  price_ars: number
  value: number
  changes: Changes
  z: number | null
  pct_from_trend: number | null
  annual_growth: number | null
  history_start: string
  trend_years: number
  model: ResolvedModel | null
}

export type Leaderboard = { denominator: string; trend_years: number; fit: string; rows: LeaderRow[] }

export type SigmaTile = {
  denominator: string
  label: string
  z?: number
  pct_from_trend?: number
  annual_growth?: number | null
  start?: string
  end?: string
  model?: ResolvedModel
  error?: string
}

export type Interval = 'd' | 'w' | 'm'
export type FitMode = 'log' | 'lin'

async function get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v))
  const res = await fetch(`/api${path}${qs.size ? `?${qs}` : ''}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? `${res.status} ${res.statusText}`)
  }
  return res.json()
}

export const api = {
  meta: () => get<Meta>('/meta'),
  chart: (ticker: string, p: { denom: string; interval: Interval; fit: FitMode; start?: string; end?: string; model: TrendModel; band_years: number }) =>
    get<ChartData>(`/chart/${ticker}`, p),
  sigmas: (ticker: string, p: { interval: Interval; fit: FitMode; start?: string; end?: string; model: TrendModel; band_years: number }) =>
    get<{ ticker: string; tiles: SigmaTile[] }>(`/sigmas/${ticker}`, p),
  leaderboard: (p: { denom: string; trend_years: number; fit: FitMode; model: TrendModel; band_years: number }) => get<Leaderboard>('/leaderboard', p),
  refresh: async () => {
    const res = await fetch('/api/refresh', { method: 'POST' })
    return res.json() as Promise<{ refreshed: number; failed: string[] }>
  },
}
