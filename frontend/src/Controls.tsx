import type { FitMode, Meta, TrendModel } from './api'
import type { Shared } from './App'

export const TREND_YEARS = [0, 3, 5, 10, 15, 20, 25]
export const BAND_YEARS = [1, 2, 3, 5]
export const TREND_MODELS: { value: TrendModel; label: string; hint: string }[] = [
  { value: 'auto', label: 'Auto', hint: 'Centered bands for nominal pesos, regression for every other unit' },
  { value: 'regression', label: 'Regression', hint: 'One straight trend line over the window' },
  { value: 'mean', label: 'Mean', hint: 'Horizontal line at the window average, with its standard deviation' },
  { value: 'bands', label: 'Bands', hint: 'Centered Bollinger bands: rolling mean and std around each bar' },
]

export default function Controls({ meta, shared, showTrendYears = false, showFit = true, showModel = false }: {
  meta: Meta
  shared: Shared
  showTrendYears?: boolean
  showFit?: boolean
  showModel?: boolean
}) {
  return (
    <>
      <label>
        Price in
        <select value={shared.denom} onChange={(e) => shared.setDenom(e.target.value)}>
          {meta.denominators.map((d) => (
            <option key={d.key} value={d.key}>{d.label}</option>
          ))}
        </select>
      </label>
      {showFit && (
      <label title="Log fits a constant % growth trend; linear fits a constant amount per year">
        Scale
        <select value={shared.fit} onChange={(e) => shared.setFit(e.target.value as FitMode)}>
          <option value="log">Logarithmic</option>
          <option value="lin">Linear</option>
        </select>
      </label>
      )}
      {showModel && (
        <label title={TREND_MODELS.find((m) => m.value === shared.trendModel)?.hint}>
          Trend
          <select value={shared.trendModel} onChange={(e) => shared.setTrendModel(e.target.value as TrendModel)}>
            {TREND_MODELS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </label>
      )}
      {showModel && shared.trendModel !== 'regression' && (
        <label title="Length of the centered window">
          Band window
          <select value={shared.bandYears} onChange={(e) => shared.setBandYears(Number(e.target.value))}>
            {BAND_YEARS.map((y) => (
              <option key={y} value={y}>{y} years</option>
            ))}
          </select>
        </label>
      )}
      {showTrendYears && shared.trendModel !== 'bands' && (
        <label>
          Regression window
          <select value={shared.trendYears} onChange={(e) => shared.setTrendYears(Number(e.target.value))}>
            {TREND_YEARS.map((y) => (
              <option key={y} value={y}>{y ? `${y} years` : 'All history'}</option>
            ))}
          </select>
        </label>
      )}
    </>
  )
}
