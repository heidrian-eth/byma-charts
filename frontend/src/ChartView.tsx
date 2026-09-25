import type { IChartApi } from 'lightweight-charts'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type ChartData, type Interval, type LeaderRow, type Meta } from './api'
import type { Shared } from './App'
import { TREND_MODELS } from './Controls'
import { IndicatorsDialog, MaSettings, SymbolSearch, type IndicatorChoice } from './dialogs'
import type { Anchor, Drawing, Tool } from './drawings'
import { Icon } from './icons'
import type { MaConfig } from './indicators'
import ObjectsPanel from './ObjectsPanel'
import { readStored, usePersisted, writeStored } from './persist'
import PriceChart, { RANGES, type AxisLabel, type ChartOptions, type ChartType, type LegendAction, type RangeKey } from './PriceChart'
import { SHORT_LABELS } from './SigmaMosaic'
import TodayPanel from './TodayPanel'
import TrendPanel, { type Window } from './TrendPanel'
import { Dropdown, MenuItem } from './ui'
import Watchlist from './Watchlist'

type Panel = 'watchlist' | 'trend' | 'objects' | null

const MA_COLORS = ['#ff9800', '#ab47bc', '#26c6da', '#8d6e63', '#ec407a']
const LINE_COLORS = ['#e91e63', '#00bcd4', '#4caf50', '#ff5722', '#9c27b0']
const DEFAULT_MAS: MaConfig[] = [
  { id: 1, type: 'SMA', period: 10, color: MA_COLORS[0] },
  { id: 2, type: 'SMA', period: 40, color: MA_COLORS[1] },
]
const INTERVALS: { value: Interval; label: string; long: string }[] = [
  { value: 'd', label: '1D', long: '1 day' },
  { value: 'w', label: '1W', long: '1 week' },
  { value: 'm', label: '1M', long: '1 month' },
]
const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: 'bars', label: 'Bars' },
  { value: 'candles', label: 'Candles' },
  { value: 'hollow', label: 'Hollow candles' },
  { value: 'line', label: 'Line' },
  { value: 'area', label: 'Area' },
]
const TYPE_ICON: Record<ChartType, React.ReactNode> = {
  candles: Icon.candles, hollow: Icon.hollow, bars: Icon.bars, line: Icon.line, area: Icon.area,
}
const TOOLS: { tool: Tool; icon: React.ReactNode; label: string; key?: string }[] = [
  { tool: 'cursor', icon: Icon.cross, label: 'Cross' },
  { tool: 'trend', icon: Icon.trend, label: 'Trend line', key: 'Alt+T' },
  { tool: 'hline', icon: Icon.hline, label: 'Horizontal line', key: 'Alt+H' },
  { tool: 'measure', icon: Icon.ruler, label: 'Measure', key: 'Shift+click' },
]

function useClock(): string {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  const offset = -now.getTimezoneOffset() / 60
  return `${now.toLocaleTimeString('en-GB')} UTC${offset >= 0 ? '+' : ''}${offset}`
}

export default function ChartView({ meta, ticker, shared }: { meta: Meta; ticker: string; shared: Shared }) {
  const { theme, denom, fit, setFit, trendModel, bandYears } = shared
  const logAxis = fit === 'log'
  const drawingsKey = `lines:${ticker}:${denom}`
  // One window for every stock and unit, so switching charts keeps the same comparison period.
  const [win, setWin] = usePersisted<Window>('channelWindow', {})
  const [interval, setBarInterval] = usePersisted<Interval>('interval', 'w')
  const [chartType, setChartType] = usePersisted<ChartType>('chartType', readStored('candles', true) ? 'candles' : 'line')
  const [showVolume, setShowVolume] = usePersisted('showVolume', false)
  const [axisLabel, setAxisLabel] = usePersisted<AxisLabel>('axisLabel', 'price')
  const [showChannel, setShowChannel] = usePersisted('showChannel', true)
  const [sigmaLevels, setSigmaLevels] = usePersisted('sigmaLevels', [1, 2, 3])
  const [mas, setMas] = usePersisted<MaConfig[]>('mas', DEFAULT_MAS)
  const [panel, setPanel] = usePersisted<Panel>('panel', 'watchlist')
  const [range, setRange] = usePersisted<RangeKey>('range', 'all')
  const [rangeNonce, setRangeNonce] = useState(0)
  const [magnet, setMagnet] = usePersisted('magnet', false)
  const [drawingsHidden, setDrawingsHidden] = useState(false)
  const [tool, setTool] = useState<Tool>('cursor')
  const [drawings, setDrawingsState] = useState<Drawing[]>(() => readStored(drawingsKey, []))
  const [data, setData] = useState<ChartData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<LeaderRow[] | null>(null)
  const [rowsError, setRowsError] = useState<string | null>(null)
  const [search, setSearch] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'indicators' | { ma: number } | null>(null)
  const [autoScale, setAutoScale] = useState(true)
  const chartApi = useRef<IChartApi | null>(null)
  const clock = useClock()

  useEffect(() => setDrawingsState(readStored(drawingsKey, [])), [drawingsKey])
  const setDrawings = useCallback((next: Drawing[]) => {
    setDrawingsState(next)
    writeStored(drawingsKey, next)
  }, [drawingsKey])

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

  useEffect(() => {
    let alive = true
    api
      .leaderboard({ denom, trend_years: shared.trendYears, fit, model: trendModel, band_years: bandYears })
      .then((d) => alive && (setRows(d.rows), setRowsError(null)), (e: Error) => alive && setRowsError(e.message))
    return () => {
      alive = false
    }
  }, [denom, shared.trendYears, fit, trendModel, bandYears])

  const go = useCallback((t: string) => {
    const clean = t.trim().toUpperCase()
    setSearch(null)
    if (clean) window.location.hash = `#/chart/${clean}`
  }, [])

  // TradingView habits: typing a letter opens symbol search; Alt+T / Alt+H pick drawing tools.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input, select, textarea, .overlay')) return
      if (e.altKey && e.code === 'KeyT') setTool('trend')
      else if (e.altKey && e.code === 'KeyH') setTool('hline')
      else if (e.altKey && e.code === 'KeyR') setRangeNonce((n) => n + 1)
      else if (e.key === 'Escape') setTool('cursor')
      else if (!e.ctrlKey && !e.metaKey && !e.altKey && /^[a-zA-Z]$/.test(e.key)) {
        setSearch(e.key.toUpperCase())
        e.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const options: ChartOptions = useMemo(
    () => ({ chartType, logAxis, showVolume, showChannel, axisLabel, sigmaLevels, mas }),
    [chartType, logAxis, showVolume, showChannel, axisLabel, sigmaLevels, mas],
  )

  const onPick = useCallback((t: 'pickStart' | 'pickEnd', a: Anchor) => {
    setWin(t === 'pickStart' ? { ...win, start: a.time } : { ...win, end: a.time })
    setTool('cursor')
  }, [win, setWin])

  const updateMa = (id: number, patch: Partial<MaConfig>) => setMas(mas.map((m) => (m.id === id ? { ...m, ...patch } : m)))

  const onLegend = (a: LegendAction) => {
    if (a.kind === 'ma') {
      if (a.action === 'toggle') updateMa(a.id, { hidden: !mas.find((m) => m.id === a.id)?.hidden })
      if (a.action === 'remove') setMas(mas.filter((m) => m.id !== a.id))
      if (a.action === 'settings') setDialog({ ma: a.id })
    } else if (a.kind === 'channel') {
      if (a.action === 'toggle') setShowChannel(!showChannel)
      if (a.action === 'settings') setPanel('trend')
    } else if (a.action === 'toggle' || a.action === 'remove') setShowVolume(false)
  }

  const addIndicator = (c: IndicatorChoice) => {
    if (c.kind === 'channel') setShowChannel(true)
    else if (c.kind === 'volume') setShowVolume(true)
    else {
      const id = Math.max(0, ...mas.map((m) => m.id)) + 1
      setMas([...mas, { id, type: c.type, period: 20, color: MA_COLORS[mas.length % MA_COLORS.length] }])
    }
    setDialog(null)
  }

  const screenshot = () => {
    const canvas = chartApi.current?.takeScreenshot()
    if (!canvas) return
    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png')
    a.download = `${ticker}-${denom}-${new Date().toISOString().slice(0, 10)}.png`
    a.click()
  }

  const resetScale = () => {
    chartApi.current?.priceScale('right').applyOptions({ autoScale: true })
    setAutoScale(true)
  }

  const unitLabel = meta.denominators.find((d) => d.key === denom)?.label ?? denom
  const intervalInfo = INTERVALS.find((i) => i.value === interval)!
  const ch = data?.channel
  const modelLabel = ch ? { regression: 'Regression', mean: 'Flat mean', bands: 'Centered bands' }[ch.model] : ''
  const channelLabel = ch
    ? `${modelLabel} · ${logAxis ? 'log' : 'linear'} · ${ch.model === 'bands' ? `${bandYears}y window` : `${ch.start.slice(0, 4)}–${ch.end.slice(0, 4)}`}`
    : ''
  const maDialog = dialog && typeof dialog === 'object' ? mas.find((m) => m.id === dialog.ma) : undefined
  const togglePanel = (p: Panel) => setPanel(panel === p ? null : p)

  return (
    <div className={`tv ${panel ? '' : 'no-panel'}`}>
      <header className="tv-header">
        <Dropdown label={Icon.menu} title="Menu" className="menu-btn" caret={false}>
          {(close) => (
            <>
              <MenuItem icon={Icon.trophy} onClick={() => ((window.location.hash = '#/'), close())}>Leaderboard</MenuItem>
              <MenuItem icon={Icon.refresh} onClick={() => (shared.refresh(), close())}>
                {shared.refreshing ? 'Refreshing…' : 'Refresh all data'}
              </MenuItem>
              <div className="menu-sep" />
              <div className="menu-caption">Theme</div>
              {(['system', 'light', 'dark'] as const).map((t) => (
                <MenuItem key={t} active={shared.themeChoice === t} onClick={() => (shared.setThemeChoice(t), close())}>
                  {t[0].toUpperCase() + t.slice(1)}
                </MenuItem>
              ))}
            </>
          )}
        </Dropdown>
        <button className="tb symbol" onClick={() => setSearch('')} title="Symbol search (or just start typing)">
          {Icon.search}
          <span>{ticker}</span>
        </button>
        <span className="tb-sep" />
        {INTERVALS.map((i) => (
          <button key={i.value} className={`tb text ${interval === i.value ? 'on' : ''}`} onClick={() => setBarInterval(i.value)} title={i.long}>
            {i.label}
          </button>
        ))}
        <span className="tb-sep" />
        <Dropdown label={TYPE_ICON[chartType]} title="Chart type">
          {(close) => CHART_TYPES.map((t) => (
            <MenuItem key={t.value} icon={TYPE_ICON[t.value]} active={chartType === t.value} onClick={() => (setChartType(t.value), close())}>
              {t.label}
            </MenuItem>
          ))}
        </Dropdown>
        <span className="tb-sep" />
        <button className="tb" onClick={() => setDialog('indicators')} title="Indicators">
          {Icon.indicators}
          <span>Indicators</span>
        </button>
        <span className="tb-sep" />
        <Dropdown label={<span className="tb-label"><span className="muted">Price in</span> {unitLabel}</span>} title="Price unit">
          {(close) => meta.denominators.map((d) => (
            <MenuItem key={d.key} active={denom === d.key} onClick={() => (shared.setDenom(d.key), close())}>{d.label}</MenuItem>
          ))}
        </Dropdown>
        <Dropdown label={<span className="tb-label"><span className="muted">Trend</span> {TREND_MODELS.find((m) => m.value === trendModel)?.label}</span>} title="Trend model">
          {(close) => TREND_MODELS.map((m) => (
            <MenuItem key={m.value} active={trendModel === m.value} onClick={() => (shared.setTrendModel(m.value), close())} hint={m.hint}>
              {m.label}
            </MenuItem>
          ))}
        </Dropdown>
        <span className="tb-grow" />
        <button className="tb" onClick={() => shared.setThemeChoice(theme === 'dark' ? 'light' : 'dark')} title="Toggle dark mode">
          {theme === 'dark' ? Icon.sun : Icon.moon}
        </button>
        <button className="tb" onClick={screenshot} title="Download a snapshot of the chart">{Icon.camera}</button>
      </header>

      <nav className="tv-tools" aria-label="Drawing tools">
        {TOOLS.map((t) => (
          <button
            key={t.tool}
            className={`tool ${tool === t.tool ? 'on' : ''}`}
            onClick={() => setTool(tool === t.tool && t.tool !== 'cursor' ? 'cursor' : t.tool)}
            title={t.key ? `${t.label} (${t.key})` : t.label}
          >
            {t.icon}
          </button>
        ))}
        <span className="tool-sep" />
        <button className={`tool ${magnet ? 'on' : ''}`} onClick={() => setMagnet(!magnet)} title="Magnet: snap drawings to open, high, low or close">{Icon.magnet}</button>
        <button className={`tool ${drawingsHidden ? 'on' : ''}`} onClick={() => setDrawingsHidden(!drawingsHidden)} title={drawingsHidden ? 'Show drawings' : 'Hide drawings'}>
          {drawingsHidden ? Icon.eyeOff : Icon.eye}
        </button>
        <button
          className="tool"
          onClick={() => drawings.length > 0 && window.confirm(`Remove ${drawings.length} drawing(s) from ${ticker}?`) && setDrawings([])}
          title="Remove all drawings"
        >
          {Icon.trash}
        </button>
      </nav>

      <main className={`tv-chart ${tool !== 'cursor' ? 'drawing' : ''}`} onMouseUp={() => setAutoScale(chartApi.current?.priceScale('right').options().autoScale ?? true)}>
        {error && <div className="error">{error}</div>}
        {(tool === 'pickStart' || tool === 'pickEnd') && (
          <div className="pick-hint">Click the chart to set the fit window {tool === 'pickStart' ? 'start' : 'end'} (Esc to cancel)</div>
        )}
        {data && (
          <PriceChart
            data={data}
            options={options}
            theme={theme}
            legend={{ title: ticker, interval: intervalInfo.label, unit: unitLabel, channel: channelLabel }}
            range={range}
            rangeNonce={rangeNonce}
            onLegend={onLegend}
            onReady={(a) => (chartApi.current = a)}
            draw={{
              drawings, hidden: drawingsHidden, tool, magnet,
              onChange: setDrawings,
              onToolDone: () => setTool('cursor'),
              onPick,
              nextColor: LINE_COLORS[drawings.length % LINE_COLORS.length],
            }}
          />
        )}
        {!data && !error && <div className="loading">Loading {ticker}…</div>}
      </main>

      <footer className="tv-bottom">
        {RANGES.map((r) => (
          <button key={r.key} className={`tb text small ${range === r.key ? 'on' : ''}`} onClick={() => (setRange(r.key), setRangeNonce((n) => n + 1))} title={r.years ? `Show the last ${r.label}` : 'Show all history'}>
            {r.label}
          </button>
        ))}
        <span className="tb-grow" />
        <span className="clock">{clock}</span>
        <span className="tb-sep" />
        <button className={`tb text small ${axisLabel === 'pct' ? 'on' : ''}`} onClick={() => setAxisLabel(axisLabel === 'pct' ? 'price' : 'pct')} title="Label the price axis as % of the latest price (latest = 100%)">%</button>
        <button className={`tb text small ${axisLabel === 'x' ? 'on' : ''}`} onClick={() => setAxisLabel(axisLabel === 'x' ? 'price' : 'x')} title="Label the price axis as multiples of the latest price: 2x above, 1/2x below">x</button>
        <button className={`tb text small ${logAxis ? 'on' : ''}`} onClick={() => setFit(logAxis ? 'lin' : 'log')} title="Log scale; also fits the trend in log terms">log</button>
        <button className={`tb text small ${autoScale ? 'on' : ''}`} onClick={resetScale} title="Fit the price axis to the visible bars">auto</button>
      </footer>

      {panel && (
        <aside className="tv-panel">
          {panel === 'watchlist' && (
            <div className="split">
              <Watchlist rows={rows} indices={meta.indices} current={ticker} error={rowsError} />
              <TodayPanel
                ticker={ticker}
                isIndex={meta.indices.includes(ticker)}
                current={denom}
                onSelect={shared.setDenom}
                changes={data?.changes ?? null}
                unitLabel={SHORT_LABELS[denom] ?? unitLabel}
              />
            </div>
          )}
          {panel === 'trend' && (
            <TrendPanel
              ticker={ticker}
              shared={shared}
              channel={data?.channel}
              fit={fit}
              interval={interval}
              win={win}
              setWin={setWin}
              tool={tool}
              setTool={setTool}
              showChannel={showChannel}
              setShowChannel={setShowChannel}
              sigmaLevels={sigmaLevels}
              setSigmaLevels={setSigmaLevels}
            />
          )}
          {panel === 'objects' && (
            <ObjectsPanel
              drawings={drawings}
              setDrawings={setDrawings}
              mas={mas}
              setMas={setMas}
              onMaSettings={(id) => setDialog({ ma: id })}
              onAddIndicator={() => setDialog('indicators')}
            />
          )}
        </aside>
      )}

      <nav className="tv-rail" aria-label="Panels">
        <button className={`rail-btn ${panel === 'watchlist' ? 'on' : ''}`} onClick={() => togglePanel('watchlist')} title="Watchlist and details">{Icon.watchlist}</button>
        <button className={`rail-btn ${panel === 'trend' ? 'on' : ''}`} onClick={() => togglePanel('trend')} title="Trend channel and distance from trend">{Icon.channel}</button>
        <button className={`rail-btn ${panel === 'objects' ? 'on' : ''}`} onClick={() => togglePanel('objects')} title="Object tree: indicators and drawings">{Icon.layers}</button>
        <span className="tb-grow" />
        <a className="rail-btn" href="#/" title="Leaderboard">{Icon.trophy}</a>
      </nav>

      {search !== null && (
        <SymbolSearch tickers={meta.tickers} indices={meta.indices} rows={rows} initial={search} onPick={go} onClose={() => setSearch(null)} />
      )}
      {dialog === 'indicators' && <IndicatorsDialog onAdd={addIndicator} onClose={() => setDialog(null)} />}
      {maDialog && <MaSettings ma={maDialog} onChange={(p) => updateMa(maDialog.id, p)} onClose={() => setDialog(null)} />}
    </div>
  )
}
