import { useEffect, useState } from 'react'
import { api, type FitMode, type Meta, type TrendModel } from './api'
import ChartView from './ChartView'
import LeaderboardView from './LeaderboardView'
import { usePersisted } from './persist'
import { useTheme, type Theme, type ThemeChoice } from './theme'

type Route = { page: 'leaders' } | { page: 'chart'; ticker: string }

function parseHash(): Route {
  const m = window.location.hash.match(/^#\/chart\/([^/?]+)/)
  return m ? { page: 'chart', ticker: decodeURIComponent(m[1]).toUpperCase() } : { page: 'leaders' }
}

export type Shared = {
  denom: string
  setDenom: (d: string) => void
  fit: FitMode
  setFit: (f: FitMode) => void
  trendYears: number
  setTrendYears: (y: number) => void
  theme: Theme
  trendModel: TrendModel
  setTrendModel: (m: TrendModel) => void
  bandYears: number
  setBandYears: (y: number) => void
  themeChoice: ThemeChoice
  setThemeChoice: (t: ThemeChoice) => void
  refresh: () => void
  refreshing: boolean
}

export default function App() {
  const [route, setRoute] = useState<Route>(parseHash)
  const [meta, setMeta] = useState<Meta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [denom, setDenom] = usePersisted('denom', 'merval')
  const [fit, setFit] = usePersisted<FitMode>('fit', 'log')
  const [trendYears, setTrendYears] = usePersisted('trendYearsAll', 0)
  const [themeChoice, setThemeChoice, theme] = useTheme()
  const [trendModel, setTrendModel] = usePersisted<TrendModel>('trendModel', 'auto')
  const [bandYears, setBandYears] = usePersisted('bandYears', 2)
  const [lastTicker, setLastTicker] = usePersisted('lastTicker', 'GGAL')

  useEffect(() => {
    const onHash = () => setRoute(parseHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => {
    if (route.page === 'chart') setLastTicker(route.ticker)
  }, [route, setLastTicker])

  useEffect(() => {
    api.meta().then(setMeta, (e: Error) => setError(e.message))
  }, [])

  const refresh = async () => {
    setRefreshing(true)
    try {
      await api.refresh()
      setReloadKey((k) => k + 1)
    } finally {
      setRefreshing(false)
    }
  }

  const shared: Shared = {
    denom, setDenom, fit, setFit, trendYears, setTrendYears, theme,
    trendModel, setTrendModel, bandYears, setBandYears, themeChoice, setThemeChoice, refresh, refreshing,
  }

  return (
    <div className="app">
      {route.page === 'leaders' && (
      <header className="topbar">
        <a className="brand" href="#/">BYMA Charts</a>
        <nav>
          <a href="#/" className={route.page === 'leaders' ? 'active' : ''}>Leaderboard</a>
          <a href={`#/chart/${lastTicker}`}>
            Chart
          </a>
        </nav>
        <select
          value={themeChoice}
          onChange={(e) => setThemeChoice(e.target.value as ThemeChoice)}
          aria-label="Theme"
          title="Theme"
        >
          <option value="system">◐ System</option>
          <option value="light">☀ Light</option>
          <option value="dark">☾ Dark</option>
        </select>
        <button className="ghost" onClick={refresh} disabled={refreshing} title="Re-download all end-of-day data">
          {refreshing ? 'Refreshing…' : 'Refresh data'}
        </button>
      </header>
      )}
      {error && <div className="error">Backend unreachable: {error}</div>}
      {meta && route.page === 'leaders' && <LeaderboardView key={reloadKey} meta={meta} shared={shared} />}
      {meta && route.page === 'chart' && (
        <ChartView key={`${route.ticker}-${reloadKey}`} meta={meta} ticker={route.ticker} shared={shared} />
      )}
      {!meta && !error && <div className="loading">Loading…</div>}
    </div>
  )
}
