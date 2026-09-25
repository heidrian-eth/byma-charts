import { useEffect, useMemo, useState } from 'react'
import { api, type Leaderboard, type LeaderRow, type Meta } from './api'
import type { Shared } from './App'
import Controls from './Controls'
import { num, pct, sigmas, tone } from './format'
import { usePersisted } from './persist'

type SortKey = 'ticker' | 'z' | 'pct_from_trend' | 'annual_growth' | `chg:${string}`
const TOP_N = 8

function sortValue(r: LeaderRow, key: SortKey): number | string | null {
  if (key === 'ticker') return r.ticker
  if (key.startsWith('chg:')) return r.changes[key.slice(4)] ?? null
  return r[key as 'z' | 'pct_from_trend' | 'annual_growth']
}

function sorted(rows: LeaderRow[], key: SortKey, desc: boolean): LeaderRow[] {
  return [...rows].sort((a, b) => {
    const va = sortValue(a, key)
    const vb = sortValue(b, key)
    if (va === null) return 1
    if (vb === null) return -1
    const c = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number)
    return desc ? -c : c
  })
}

export function ZGauge({ z }: { z: number | null }) {
  if (z === null) return <span className="muted">–</span>
  const clamped = Math.max(-3, Math.min(3, z))
  return (
    <span className="zgauge" title={`${z.toFixed(2)} standard deviations from trend`}>
      <span className="ztrack">
        <span className="ztick" style={{ left: '16.7%' }} />
        <span className="ztick mid" style={{ left: '50%' }} />
        <span className="ztick" style={{ left: '83.3%' }} />
        <span className={`zdot ${tone(z)}`} style={{ left: `${((clamped + 3) / 6) * 100}%` }} />
      </span>
      <span className="zval">{sigmas(z)}</span>
    </span>
  )
}

function Card({ title, hint, rows, render }: {
  title: string
  hint: string
  rows: LeaderRow[]
  render: (r: LeaderRow) => React.ReactNode
}) {
  return (
    <section className="card">
      <h3>{title}</h3>
      <p className="hint">{hint}</p>
      <ol>
        {rows.map((r) => (
          <li key={r.ticker}>
            <a href={`#/chart/${r.ticker}`}>{r.ticker}</a>
            {render(r)}
          </li>
        ))}
      </ol>
    </section>
  )
}

export default function LeaderboardView({ meta, shared }: { meta: Meta; shared: Shared }) {
  const [data, setData] = useState<Leaderboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [period, setPeriod] = usePersisted('moversPeriod', '1y')
  const [sortKey, setSortKey] = useState<SortKey>('z')
  const [desc, setDesc] = useState(true)
  const { denom, fit, trendYears, trendModel, bandYears } = shared
  const denomLabel = meta.denominators.find((d) => d.key === denom)?.label ?? denom
  const usesBands = trendModel === 'bands' || (trendModel === 'auto' && denom === 'ars')
  const trendHint = usesBands
    ? `${bandYears}y centered bands`
    : `${trendYears ? `${trendYears}y` : 'all-history'} ${fit} ${trendModel === 'mean' ? 'flat mean' : 'regression'}`

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    api
      .leaderboard({ denom, fit, trend_years: trendYears, model: trendModel, band_years: bandYears })
      .then((d) => alive && setData(d), (e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [denom, fit, trendYears, trendModel, bandYears])

  const rows = data?.rows ?? []
  const withPeriod = rows.filter((r) => r.changes[period] != null)
  const withZ = rows.filter((r) => r.z != null)
  const up = sorted(withPeriod, `chg:${period}`, true).slice(0, TOP_N)
  const down = sorted(withPeriod, `chg:${period}`, false).slice(0, TOP_N)
  const above = sorted(withZ, 'z', true).slice(0, TOP_N)
  const below = sorted(withZ, 'z', false).slice(0, TOP_N)
  const table = useMemo(() => sorted(rows, sortKey, desc), [rows, sortKey, desc])

  const header = (key: SortKey, label: string) => (
    <th
      key={key}
      className={`sortable ${key === 'ticker' ? '' : key === 'z' ? 'zcol' : 'num'} ${sortKey === key ? 'sorted' : ''}`}
      onClick={() => (sortKey === key ? setDesc(!desc) : (setSortKey(key), setDesc(key !== 'ticker')))}
    >
      {label}
      {sortKey === key ? (desc ? ' ▾' : ' ▴') : ''}
    </th>
  )

  return (
    <main className="page">
      <div className="toolbar">
        <Controls meta={meta} shared={shared} showTrendYears showModel />
        <label>
          Movers over
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            {meta.periods.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </label>
        {loading && <span className="muted">Loading{data ? '' : ' (first load downloads every stock, ~20s)'}…</span>}
      </div>
      {error && <div className="error">{error}</div>}
      {data && (
        <>
          <div className="cards">
            <Card title={`Top gainers, ${period}`} hint={denomLabel} rows={up}
              render={(r) => <span className={tone(r.changes[period])}>{pct(r.changes[period])}</span>} />
            <Card title={`Top losers, ${period}`} hint={denomLabel} rows={down}
              render={(r) => <span className={tone(r.changes[period])}>{pct(r.changes[period])}</span>} />
            <Card title="Most stretched above trend" hint={`${trendHint} · sell candidates`} rows={above}
              render={(r) => <ZGauge z={r.z} />} />
            <Card title="Most below trend" hint={`${trendHint} · buy candidates`} rows={below}
              render={(r) => <ZGauge z={r.z} />} />
          </div>

          <div className="table-wrap">
            <table className="grid">
              <thead>
                <tr>
                  {header('ticker', 'Ticker')}
                  <th className="num">Price ARS</th>
                  {meta.periods.map((p) => header(`chg:${p}`, p))}
                  {header('z', 'vs trend (σ)')}
                  {header('pct_from_trend', 'vs trend (%)')}
                  {header('annual_growth', 'Trend / yr')}
                  <th className="num">Fit span</th>
                </tr>
              </thead>
              <tbody>
                {table.map((r) => (
                  <tr key={r.ticker} onClick={() => (window.location.hash = `#/chart/${r.ticker}`)}>
                    <td className="ticker">
                      {r.ticker}
                      {meta.indices.includes(r.ticker) && <span className="tag">index</span>}
                    </td>
                    <td className="num">{num(r.price_ars)}</td>
                    {meta.periods.map((p) => (
                      <td key={p} className={`num ${tone(r.changes[p])}`}>{pct(r.changes[p], 0)}</td>
                    ))}
                    <td><ZGauge z={r.z} /></td>
                    <td className={`num ${tone(r.pct_from_trend)}`}>{pct(r.pct_from_trend, 0)}</td>
                    <td className={`num ${tone(r.annual_growth)}`}>{pct(r.annual_growth)}</td>
                    <td className="num muted">{r.trend_years ? `${r.trend_years}y` : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="footnote">
            All figures use the price in: {denomLabel}. Trend distance needs at
            least 2 years of history. Data is end-of-day and cached for 12 hours.
          </p>
        </>
      )}
    </main>
  )
}
