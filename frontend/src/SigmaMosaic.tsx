import { useEffect, useState } from 'react'
import { api, type FitMode, type Interval, type SigmaTile, type TrendModel } from './api'
import { pct, sigmas } from './format'

const SHORT: Record<string, string> = {
  ars: 'Nominal pesos',
  ars_real: 'Constant pesos',
  usd_official: 'USD official',
  usd_official_real: 'USD official, real',
  usd_ccl: 'USD CCL',
  usd_ccl_real: 'USD CCL, real',
  merval: 'vs Merval',
  iab: 'vs General Index',
}

/** Above trend shades red, below shades green, fully saturated at 3 sigma. */
function shade(z: number): string {
  const strength = Math.min(1, Math.abs(z) / 3)
  const color = z > 0 ? 'var(--down)' : 'var(--up)'
  return `color-mix(in srgb, ${color} ${Math.round(strength * 45)}%, transparent)`
}

export default function SigmaMosaic({ ticker, interval, fit, start, end, model, bandYears, current, onSelect }: {
  ticker: string
  interval: Interval
  fit: FitMode
  start?: string
  end?: string
  model: TrendModel
  bandYears: number
  current: string
  onSelect: (denom: string) => void
}) {
  const [tiles, setTiles] = useState<SigmaTile[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api
      .sigmas(ticker, { interval, fit, start, end, model, band_years: bandYears })
      .then((d) => alive && (setTiles(d.tiles), setError(null)), (e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [ticker, interval, fit, start, end, model, bandYears])

  return (
    <section>
      <h4>Distance from trend <span className="muted">· every unit, same window</span></h4>
      {error && <p className="hint">{error}</p>}
      <div className="mosaic">
        {(tiles ?? []).map((t) => (
          <button
            key={t.denominator}
            className={`tile ${t.denominator === current ? 'current' : ''}`}
            style={t.z !== undefined ? { background: shade(t.z) } : undefined}
            onClick={() => onSelect(t.denominator)}
            title={t.error ?? `${t.label}: ${t.model === 'bands' ? 'centered bands' : `${t.model === 'mean' ? 'flat mean' : 'regression'} ${t.start} → ${t.end}`}`}
          >
            <span className="tile-label">
              {SHORT[t.denominator] ?? t.label}
              {t.model === 'bands' && <span title="Centered bands"> ≈</span>}
            </span>
            {t.z !== undefined ? (
              <>
                <b className="tile-z">{sigmas(t.z)}</b>
                <span className="tile-pct">{pct(t.pct_from_trend)}</span>
              </>
            ) : (
              <span className="muted">n/a</span>
            )}
          </button>
        ))}
      </div>
    </section>
  )
}
