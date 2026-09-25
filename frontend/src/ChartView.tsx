import { useEffect, useMemo, useState } from 'react'
import { api, type ChartData, type Interval, type Meta } from './api'
import type { Shared } from './App'
import Controls, { BAND_YEARS, TREND_MODELS } from './Controls'
import { num, pct, sigmas, tone } from './format'
import type { Anchor, TrendLine } from './drawings'
import { MA_TYPES, type MaConfig, type MaType } from './indicators'
import { ZGauge } from './LeaderboardView'
import { readStored, usePersisted, writeStored } from './persist'
import SigmaMosaic from './SigmaMosaic'
import PriceChart, { type AxisLabel, type ChartOptions } from './PriceChart'

type Window = { start?: string; end?: string }
const WINDOW_PRESETS = [3, 5, 10, 15, 20]
const MA_COLORS = ['#ff9800', '#ab47bc', '#26c6da', '#8d6e63', '#ec407a']
const LINE_COLORS = ['#00bcd4', '#e91e63', '#8bc34a', '#ff5722', '#9c27b0']
const DEFAULT_MAS: MaConfig[] = [
  { id: 1, type: 'SMA', period: 10, color: MA_COLORS[0] },
  { id: 2, type: 'SMA', period: 40, color: MA_COLORS[1] },
]

function yearsAgo(years: number): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() - years)
  return d.toISOString().slice(0, 10)
}

export default function ChartView({ meta, ticker, shared }: { meta: Meta; ticker: string; shared: Shared }) {
  const { theme } = shared
  const { denom, fit, setFit, trendModel, bandYears } = shared
  const usesBands = trendModel === 'bands' || (trendModel === 'auto' && denom === 'ars')
  const logAxis = fit === 'log'
  const linesKey = `lines:${ticker}:${denom}`
  // One window for every stock and unit, so switching charts keeps the same comparison period.
  const [win, setWin] = usePersisted<Window>('channelWindow', {})
  const [interval, setBarInterval] = usePersisted<Interval>('interval', 'w')
  const [candles, setCandles] = usePersisted('candles', true)
  const [showVolume, setShowVolume] = usePersisted('showVolume', false)
  const [axisLabel, setAxisLabel] = usePersisted<AxisLabel>('axisLabel', 'price')
  const toggleAxis = (mode: AxisLabel) => setAxisLabel(axisLabel === mode ? 'price' : mode)
  const [showChannel, setShowChannel] = usePersisted('showChannel', true)
  const [sigmaLevels, setSigmaLevels] = usePersisted('sigmaLevels', [1, 2, 3])
  const [mas, setMas] = usePersisted<MaConfig[]>('mas', DEFAULT_MAS)
  const [picking, setPicking] = useState<'start' | 'end' | 'line' | null>(null)
  const [pending, setPending] = useState<Anchor | null>(null)
  const [lines, setLines] = useState<TrendLine[]>(() => readStored(linesKey, []))
  const [data, setData] = useState<ChartData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tickerInput, setTickerInput] = useState(ticker)

  useEffect(() => {
    setLines(readStored(linesKey, []))
    setPending(null)
  }, [linesKey])

  const saveLines = (next: TrendLine[]) => {
    setLines(next)
    writeStored(linesKey, next)
  }

  const updateWin = setWin

  useEffect(() => {
    let alive = true
    setError(null)
    api
      .chart(ticker, { denom, interval, fit, start: win.start, end: win.end, model: trendModel, band_years: bandYears })
      .then((d) => alive && setData(d), (e: Error) => alive && setError(e.message))
    return () => {
      alive = false
    }
  }, [ticker, denom, interval, fit, win.start, win.end, trendModel, bandYears])

  const options: ChartOptions = useMemo(
    () => ({ candles, logAxis, showVolume, axisLabel, sigmaLevels, mas, lines, pending }),
    [candles, logAxis, showVolume, axisLabel, sigmaLevels, mas, lines, pending],
  )
  const shown = useMemo(
    () => (data && !showChannel ? { ...data, channel: null } : data),
    [data, showChannel],
  )

  const onPick = (anchor: Anchor) => {
    if (picking === 'line') {
      if (!pending) return setPending(anchor)
      const id = Math.max(0, ...lines.map((l) => l.id)) + 1
      saveLines([...lines, { id, a: pending, b: anchor, extend: false, color: LINE_COLORS[lines.length % LINE_COLORS.length] }])
      setPending(null)
      setPicking(null)
      return
    }
    if (picking === 'start') updateWin({ ...win, start: anchor.time })
    if (picking === 'end') updateWin({ ...win, end: anchor.time })
    setPicking(null)
  }

  const toggleDraw = () => {
    setPending(null)
    setPicking(picking === 'line' ? null : 'line')
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPicking(null)
        setPending(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const go = (t: string) => {
    const clean = t.trim().toUpperCase()
    if (clean) window.location.hash = `#/chart/${clean}`
  }

  const updateMa = (id: number, patch: Partial<MaConfig>) =>
    setMas(mas.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  const addMa = () => {
    const id = Math.max(0, ...mas.map((m) => m.id)) + 1
    setMas([...mas, { id, type: 'SMA', period: 20, color: MA_COLORS[mas.length % MA_COLORS.length] }])
  }

  const ch = data?.channel
  const denomLabel = meta.denominators.find((d) => d.key === denom)?.label ?? denom

  return (
    <main className="page chart-page">
      <div className="toolbar">
        <form onSubmit={(e) => (e.preventDefault(), go(tickerInput))}>
          <input
            className="ticker-input"
            list="tickers"
            value={tickerInput}
            onChange={(e) => setTickerInput(e.target.value)}
            onBlur={() => tickerInput !== ticker && go(tickerInput)}
            aria-label="Ticker"
          />
          <datalist id="tickers">
            {meta.tickers.map((t) => <option key={t} value={t} />)}
          </datalist>
        </form>
        <Controls meta={meta} shared={shared} showFit={false} />
        <div className="seg" role="group" aria-label="Interval">
          {(['d', 'w', 'm'] as Interval[]).map((i) => (
            <button key={i} className={interval === i ? 'on' : ''} onClick={() => setBarInterval(i)}>
              {{ d: 'Daily', w: 'Weekly', m: 'Monthly' }[i]}
            </button>
          ))}
        </div>
        <div className="seg" role="group">
          <button className={candles ? 'on' : ''} onClick={() => setCandles(true)}>Candles</button>
          <button className={!candles ? 'on' : ''} onClick={() => setCandles(false)}>Line</button>
        </div>
        <div className="seg" role="group" title="Sets both the price axis and the regression fit">
          <button className={logAxis ? 'on' : ''} onClick={() => setFit('log')}>Log</button>
          <button className={!logAxis ? 'on' : ''} onClick={() => setFit('lin')}>Linear</button>
        </div>
        <div className="seg" role="group" aria-label="Axis labels">
          <button
            className={axisLabel === 'pct' ? 'on' : ''}
            onClick={() => toggleAxis('pct')}
            title="Label the price axis as % of the latest price (latest = 100%)"
          >
            %
          </button>
          <button
            className={axisLabel === 'x' ? 'on' : ''}
            onClick={() => toggleAxis('x')}
            title="Label the price axis as multiples of the latest price: 2x above, 1/2x below"
          >
            x
          </button>
        </div>
        <button className={`ghost ${picking === 'line' ? 'on' : ''}`} onClick={toggleDraw} title="Click two points on the chart">
          ╱ Draw line
        </button>
        <label className="check"><input type="checkbox" checked={showVolume} onChange={(e) => setShowVolume(e.target.checked)} />Volume</label>
      </div>

      <div className="chart-layout">
        <div className={`chart-box ${picking ? 'picking' : ''}`}>
          {error && <div className="error">{error}</div>}
          {picking && (
            <div className="pick-hint">
              {picking === 'line'
                ? pending ? 'Click the second point (Esc to cancel)' : 'Click the first point (Esc to cancel)'
                : `Click the chart to set the channel ${picking}`}
            </div>
          )}
          {shown && <PriceChart data={shown} options={options} theme={theme} onPick={picking ? onPick : undefined} />}
          {!shown && !error && <div className="loading">Loading {ticker}…</div>}
        </div>

        <aside className="side">
          <section>
            <h3>{ticker} <span className="muted">· {denomLabel}</span></h3>
            {data && (
              <div className="stat-grid">
                {Object.entries(data.changes).map(([p, v]) => (
                  <div key={p}><span className="muted">{p}</span><b className={tone(v)}>{pct(v)}</b></div>
                ))}
              </div>
            )}
          </section>

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

          <section>
            <h4>
              <label className="check"><input type="checkbox" checked={showChannel} onChange={(e) => setShowChannel(e.target.checked)} />{usesBands ? 'Centered bands' : trendModel === 'mean' ? 'Flat mean' : 'Regression channel'}</label>
            </h4>
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
            <div className="seg small">
              {[1, 2, 3].map((k) => (
                <button
                  key={k}
                  className={sigmaLevels.includes(k) ? 'on' : ''}
                  onClick={() => setSigmaLevels(sigmaLevels.includes(k) ? sigmaLevels.filter((x) => x !== k) : [...sigmaLevels, k].sort())}
                >
                  {k}σ
                </button>
              ))}
            </div>
            <div className="seg small model-seg" role="group" aria-label="Trend model">
              {TREND_MODELS.map((m) => (
                <button key={m.value} className={trendModel === m.value ? 'on' : ''} onClick={() => shared.setTrendModel(m.value)} title={m.hint}>
                  {m.label}
                </button>
              ))}
            </div>
            {usesBands ? (
              <>
                <div className="presets">
                  {BAND_YEARS.map((y) => (
                    <button key={y} className={`ghost ${bandYears === y ? 'on' : ''}`} onClick={() => shared.setBandYears(y)}>{y}y window</button>
                  ))}
                </div>
                <p className="hint">Mean and σ over a window centered on each bar. The last half-window only has past data, so it's drawn faded and will move as new bars arrive.</p>
              </>
            ) : (
            <>
            <div className="presets">
              {WINDOW_PRESETS.map((y) => (
                <button key={y} className="ghost" onClick={() => updateWin({ start: yearsAgo(y) })}>{y}y</button>
              ))}
              <button className="ghost" onClick={() => updateWin({})}>All</button>
            </div>
            <div className="window-inputs">
              <label>
                From
                <input type="date" value={win.start ?? ''} onChange={(e) => updateWin({ ...win, start: e.target.value || undefined })} />
              </label>
              <button className={`ghost ${picking === 'start' ? 'on' : ''}`} onClick={() => setPicking(picking === 'start' ? null : 'start')} title="Pick on chart">⌖</button>
              <label>
                To
                <input type="date" value={win.end ?? ''} onChange={(e) => updateWin({ ...win, end: e.target.value || undefined })} />
              </label>
              <button className={`ghost ${picking === 'end' ? 'on' : ''}`} onClick={() => setPicking(picking === 'end' ? null : 'end')} title="Pick on chart">⌖</button>
            </div>
            <p className="hint">Empty "To" means up to today. Lines extend past "To" so you can see where price went after the fit.</p>
            </>
            )}
          </section>

          <section>
            <h4>Lines</h4>
            {lines.length === 0 && <p className="hint">Use "Draw line" and click two points. Lines are saved per stock and price unit.</p>}
            {lines.map((l) => (
              <div className="ma-row" key={l.id}>
                <input type="color" value={l.color} onChange={(e) => saveLines(lines.map((x) => (x.id === l.id ? { ...x, color: e.target.value } : x)))} />
                <span className="line-label">{l.a.time} → {l.b.time}</span>
                <label className="check" title="Extend to the right">
                  <input type="checkbox" checked={l.extend} onChange={(e) => saveLines(lines.map((x) => (x.id === l.id ? { ...x, extend: e.target.checked } : x)))} />→
                </label>
                <button className="ghost" onClick={() => saveLines(lines.filter((x) => x.id !== l.id))} aria-label="Remove">✕</button>
              </div>
            ))}
            {lines.length > 1 && <button className="ghost" onClick={() => saveLines([])}>Clear all</button>}
          </section>

          <section>
            <h4>Moving averages <span className="muted">(periods in bars)</span></h4>
            {mas.map((m) => (
              <div className="ma-item" key={m.id}>
                <div className="ma-row">
                  <input type="color" value={m.color} onChange={(e) => updateMa(m.id, { color: e.target.value })} aria-label="Color" />
                  <select value={m.type} onChange={(e) => updateMa(m.id, { type: e.target.value as MaType })}>
                    {MA_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={2}
                    max={500}
                    value={m.period}
                    onChange={(e) => updateMa(m.id, { period: Math.max(2, Number(e.target.value) || 2) })}
                    aria-label="Period"
                  />
                  <button className="ghost" onClick={() => setMas(mas.filter((x) => x.id !== m.id))} aria-label="Remove">✕</button>
                </div>
                <div className="ma-row ma-style">
                  <label title="Opacity">
                    <span className="muted">Opacity</span>
                    <input
                      type="range"
                      min={10}
                      max={100}
                      step={5}
                      value={Math.round((m.opacity ?? 1) * 100)}
                      onChange={(e) => updateMa(m.id, { opacity: Number(e.target.value) / 100 })}
                    />
                    <span className="muted">{Math.round((m.opacity ?? 1) * 100)}%</span>
                  </label>
                  <div className="seg small" role="group" aria-label="Line width">
                    {([1, 2, 3, 4] as const).map((w) => (
                      <button key={w} className={(m.width ?? 1) === w ? 'on' : ''} onClick={() => updateMa(m.id, { width: w })} title={`${w}px`}>
                        <span className="width-swatch" style={{ height: w }} />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
            <button className="ghost" onClick={addMa}>+ Add average</button>
          </section>
        </aside>
      </div>
    </main>
  )
}
