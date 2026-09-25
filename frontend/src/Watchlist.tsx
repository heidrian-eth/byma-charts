import { useEffect, useRef } from 'react'
import type { LeaderRow } from './api'
import { num, pct, sigmas, tone } from './format'
import { usePersisted } from './persist'

type SortKey = 'ticker' | 'price' | 'chg' | 'z'

const COLUMNS: { key: SortKey; label: string; title: string }[] = [
  { key: 'ticker', label: 'Symbol', title: 'Ticker' },
  { key: 'price', label: 'Last', title: 'Last close in pesos' },
  { key: 'chg', label: 'Chg%', title: "Today's move in pesos" },
  { key: 'z', label: 'σ', title: 'Distance from trend in the current price unit' },
]

function value(r: LeaderRow, key: SortKey): number | string | null {
  return key === 'ticker' ? r.ticker : key === 'price' ? r.price_ars : key === 'chg' ? r.day_change_ars : r.z
}

export default function Watchlist({ rows, indices, current, error }: {
  rows: LeaderRow[] | null
  indices: string[]
  current: string
  error: string | null
}) {
  const body = useRef<HTMLDivElement>(null)
  const loaded = rows !== null
  // Only when the symbol changes or the list first loads, so the user's own scrolling sticks.
  useEffect(() => {
    body.current?.querySelector(`[data-ticker="${current}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [current, loaded])
  const [sort, setSort] = usePersisted<{ key: SortKey; desc: boolean }>('watchSort', { key: 'ticker', desc: false })
  const sorted = [...(rows ?? [])].sort((a, b) => {
    const va = value(a, sort.key)
    const vb = value(b, sort.key)
    if (va === null) return 1
    if (vb === null) return -1
    const c = typeof va === 'string' ? va.localeCompare(vb as string) : va - (vb as number)
    return sort.desc ? -c : c
  })
  const sections = [
    { name: 'Indices', rows: sorted.filter((r) => indices.includes(r.ticker)) },
    { name: 'Stocks', rows: sorted.filter((r) => !indices.includes(r.ticker)) },
  ]

  return (
    <div className="watchlist">
      <div className="panel-head">
        <h3>Watchlist</h3>
        <span className="muted">{rows ? `${rows.length} symbols` : ''}</span>
      </div>
      <div className="wl-cols">
        {COLUMNS.map((c) => (
          <button
            key={c.key}
            title={c.title}
            className={sort.key === c.key ? 'sorted' : ''}
            onClick={() => setSort({ key: c.key, desc: sort.key === c.key ? !sort.desc : c.key !== 'ticker' })}
          >
            {c.label}
            {sort.key === c.key && (sort.desc ? ' ↓' : ' ↑')}
          </button>
        ))}
      </div>
      <div className="wl-body" ref={body}>
        {error && <p className="hint pad">{error}</p>}
        {!rows && !error && <p className="hint pad">Loading…</p>}
        {sections.map((s) => s.rows.length > 0 && (
          <div key={s.name}>
            <div className="wl-section">{s.name}</div>
            {s.rows.map((r) => (
              <a
                key={r.ticker}
                href={`#/chart/${r.ticker}`}
                className={`wl-row ${r.ticker === current ? 'current' : ''}`}
                data-ticker={r.ticker}
              >
                <span className="wl-sym">{r.ticker}</span>
                <span>{num(r.price_ars)}</span>
                <span className={tone(r.day_change_ars)}>{pct(r.day_change_ars, 2)}</span>
                <span className={r.z === null ? 'muted' : r.z > 0 ? 'down' : 'up'}>{r.z === null ? '–' : sigmas(r.z).replace('σ', '')}</span>
              </a>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
