import type { Channel, FitMode, Interval } from './api'
import type { Shared } from './App'
import { BAND_YEARS, TREND_MODELS } from './Controls'
import type { Tool } from './drawings'
import { num, pct, sigmas, tone } from './format'
import { ZGauge } from './LeaderboardView'
import SigmaMosaic from './SigmaMosaic'

export type Window = { start?: string; end?: string }
const WINDOW_PRESETS = [3, 5, 10, 15, 20]

function yearsAgo(years: number): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() - years)
  return d.toISOString().slice(0, 10)
}

export default function TrendPanel({ ticker, shared, channel, fit, interval, win, setWin, tool, setTool, showChannel, setShowChannel, sigmaLevels, setSigmaLevels }: {
  ticker: string
  shared: Shared
  channel: Channel | null | undefined
  fit: FitMode
  interval: Interval
  win: Window
  setWin: (w: Window) => void
  tool: Tool
  setTool: (t: Tool) => void
  showChannel: boolean
  setShowChannel: (v: boolean) => void
  sigmaLevels: number[]
  setSigmaLevels: (v: number[]) => void
}) {
  const { denom, trendModel, bandYears } = shared
  const usesBands = trendModel === 'bands' || (trendModel === 'auto' && denom === 'ars')
  const ch = channel
  const pick = (t: 'pickStart' | 'pickEnd') => setTool(tool === t ? 'cursor' : t)

  return (
    <div className="panel-scroll">
      <div className="panel-head">
        <h3>Trend channel</h3>
        <label className="switch" title="Show on chart">
          <input type="checkbox" checked={showChannel} onChange={(e) => setShowChannel(e.target.checked)} />
          <span />
        </label>
      </div>
      <div className="pad">
        {ch ? (
          <>
            <ZGauge z={ch.z} />
            <dl className="facts">
              <dt>Last vs trend</dt><dd className={tone(ch.pct_from_trend)}>{pct(ch.pct_from_trend)} ({sigmas(ch.z)})</dd>
              {ch.annual_growth !== null && (<><dt>Trend growth</dt><dd className={tone(ch.annual_growth)}>{pct(ch.annual_growth)} / yr</dd></>)}
              <dt>1σ width</dt><dd>{fit === 'log' ? `±${pct(Math.exp(ch.sigma) - 1).slice(1)}` : `±${num(ch.sigma)}`}</dd>
              {ch.model !== 'bands' ? (
                <><dt>{ch.model === 'mean' ? 'Averaged over' : 'Fitted on'}</dt><dd>{ch.start} → {ch.end}</dd></>
              ) : (
                <><dt>Provisional from</dt><dd>{ch.provisional_from}</dd></>
              )}
            </dl>
          </>
        ) : (
          <p className="muted">Not enough data in the window.</p>
        )}

        <div className="field-label">Model</div>
        <div className="seg small full" role="group" aria-label="Trend model">
          {TREND_MODELS.map((m) => (
            <button key={m.value} className={trendModel === m.value ? 'on' : ''} onClick={() => shared.setTrendModel(m.value)} title={m.hint}>
              {m.label}
            </button>
          ))}
        </div>

        <div className="field-label">Bands</div>
        <div className="seg small" role="group">
          {[1, 2, 3].map((k) => (
            <button
              key={k}
              className={sigmaLevels.includes(k) ? 'on' : ''}
              onClick={() => setSigmaLevels(sigmaLevels.includes(k) ? sigmaLevels.filter((x) => x !== k) : [...sigmaLevels, k].sort())}
            >
              ±{k}σ
            </button>
          ))}
        </div>

        {usesBands ? (
          <>
            <div className="field-label">Centered window</div>
            <div className="seg small" role="group">
              {BAND_YEARS.map((y) => (
                <button key={y} className={bandYears === y ? 'on' : ''} onClick={() => shared.setBandYears(y)}>{y}y</button>
              ))}
            </div>
            <p className="hint">Mean and σ over a window centered on each bar. The last half-window only has past data, so it's drawn faded and will move as new bars arrive.</p>
          </>
        ) : (
          <>
            <div className="field-label">Fit window <span className="muted">· same for every chart</span></div>
            <div className="seg small" role="group">
              {WINDOW_PRESETS.map((y) => (
                <button key={y} onClick={() => setWin({ start: yearsAgo(y) })}>{y}y</button>
              ))}
              <button className={!win.start && !win.end ? 'on' : ''} onClick={() => setWin({})}>All</button>
            </div>
            <div className="window-inputs">
              <label>
                From
                <input type="date" value={win.start ?? ''} onChange={(e) => setWin({ ...win, start: e.target.value || undefined })} />
              </label>
              <button className={`icon-btn ${tool === 'pickStart' ? 'on' : ''}`} onClick={() => pick('pickStart')} title="Pick on chart">⌖</button>
              <label>
                To
                <input type="date" value={win.end ?? ''} onChange={(e) => setWin({ ...win, end: e.target.value || undefined })} />
              </label>
              <button className={`icon-btn ${tool === 'pickEnd' ? 'on' : ''}`} onClick={() => pick('pickEnd')} title="Pick on chart">⌖</button>
            </div>
            <p className="hint">Empty "To" means up to today. Lines extend past "To" so you can see where price went after the fit.</p>
          </>
        )}
      </div>

      <SigmaMosaic
        ticker={ticker}
        interval={interval}
        fit={fit}
        start={win.start}
        end={win.end}
        model={trendModel}
        bandYears={bandYears}
        current={denom}
        onSelect={shared.setDenom}
      />
    </div>
  )
}
