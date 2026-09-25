import { useEffect, useState } from 'react'
import { api, type Changes, type Today } from './api'
import { num, pct, tone } from './format'
import { SHORT_LABELS } from './SigmaMosaic'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function longDate(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}, ${iso.slice(0, 4)}`
}

/** Green or red tint whose strength grows with the size of the move, like TradingView's performance tiles. */
function tint(v: number | null | undefined): string | undefined {
  if (v === null || v === undefined || !Number.isFinite(v)) return undefined
  const strength = Math.min(1, Math.abs(v) / 0.5)
  return `color-mix(in srgb, var(--${v >= 0 ? 'up' : 'down'}) ${Math.round(8 + strength * 22)}%, transparent)`
}

export default function TodayPanel({ ticker, isIndex, current, onSelect, changes, unitLabel }: {
  ticker: string
  isIndex: boolean
  current: string
  onSelect: (denom: string) => void
  changes: Changes | null
  unitLabel: string
}) {
  const [today, setToday] = useState<Today | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api.today(ticker).then((d) => alive && (setToday(d), setError(null)), (e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [ticker])

  const ars = today?.moves.find((m) => m.denominator === 'ars')?.change
  const absChange = today && ars !== undefined ? today.price - today.price / (1 + ars) : null

  return (
    <div className="details">
      <div className="details-head">
        <span className="details-sym">{ticker}</span>
        <span className="muted">{isIndex ? 'Index' : 'Stock'} · BYMA</span>
      </div>
      {today && (
        <>
          <div className="details-price">
            {num(today.price)}
            <span className="details-ccy">{isIndex ? 'pts' : 'ARS'}</span>
          </div>
          {absChange !== null && (
            <div className={`details-chg ${tone(ars)}`}>
              {absChange >= 0 ? '+' : '−'}{num(Math.abs(absChange))} <span>{pct(ars, 2)}</span>
            </div>
          )}
          <div className="details-note">
            <span className="dot" /> Close of {longDate(today.date)}, vs {longDate(today.previous_date)}
          </div>
        </>
      )}
      {error && <p className="hint">{error}</p>}

      <h4 className="details-sub">Today in every unit</h4>
      <div className="today-grid">
        {(today?.moves ?? []).map((m) => (
          <button
            key={m.denominator}
            className={`today-cell ${m.denominator === current ? 'current' : ''}`}
            onClick={() => onSelect(m.denominator)}
            title={
              m.error ??
              (m.stale ? `${m.label}: no ${today?.date} value yet (latest ${m.denominator_date}), so this is not a true move in this unit` : m.label)
            }
          >
            <span>{SHORT_LABELS[m.denominator] ?? m.label}</span>
            <b className={tone(m.change)}>
              {m.change !== undefined ? pct(m.change, 2) : 'n/a'}
              {m.stale && ' *'}
            </b>
          </button>
        ))}
      </div>
      {today?.moves.some((m) => m.stale) && <p className="hint">* No {today.date} value yet for that unit; hover for details.</p>}

      {changes && (
        <>
          <h4 className="details-sub">Performance <span className="muted">· {unitLabel}</span></h4>
          <div className="perf">
            {Object.entries(changes).map(([p, v]) => (
              <div key={p} className="perf-tile" style={{ background: tint(v) }}>
                <b className={tone(v)}>{pct(v)}</b>
                <span>{p.toUpperCase()}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
