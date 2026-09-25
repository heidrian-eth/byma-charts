import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  type Time,
} from 'lightweight-charts'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChartData } from './api'
import { DrawingLayer, type Hit, type Measure } from './drawingLayer'
import { BarClock, type Anchor, type Drawing, type Tool } from './drawings'
import { multipleOfLast, num, pctOfLast } from './format'
import { Icon } from './icons'
import { movingAverage, withOpacity, type MaConfig } from './indicators'
import type { Theme } from './theme'

/** How the price axis is labelled, relative to the latest close. */
export type AxisLabel = 'price' | 'pct' | 'x'
export type ChartType = 'candles' | 'hollow' | 'bars' | 'line' | 'area'
export type RangeKey = '6m' | '1y' | '3y' | '5y' | '10y' | '20y' | 'all'

export const RANGES: { key: RangeKey; label: string; years: number }[] = [
  { key: '6m', label: '6M', years: 0.5 },
  { key: '1y', label: '1Y', years: 1 },
  { key: '3y', label: '3Y', years: 3 },
  { key: '5y', label: '5Y', years: 5 },
  { key: '10y', label: '10Y', years: 10 },
  { key: '20y', label: '20Y', years: 20 },
  { key: 'all', label: 'All', years: 0 },
]

export type ChartOptions = {
  chartType: ChartType
  logAxis: boolean
  showVolume: boolean
  showChannel: boolean
  axisLabel: AxisLabel
  sigmaLevels: number[]
  mas: MaConfig[]
}

export type LegendInfo = { title: string; interval: string; unit: string; channel: string }
export type LegendAction =
  | { kind: 'ma'; id: number; action: 'toggle' | 'settings' | 'remove' }
  | { kind: 'channel' | 'volume'; action: 'toggle' | 'settings' | 'remove' }

export type DrawingProps = {
  drawings: Drawing[]
  hidden: boolean
  tool: Tool
  magnet: boolean
  onChange: (next: Drawing[]) => void
  onToolDone: () => void
  onPick: (tool: 'pickStart' | 'pickEnd', anchor: Anchor) => void
  nextColor: string
}

const BAND_STYLE: Record<number, LineStyle> = { 1: LineStyle.Dotted, 2: LineStyle.Dashed, 3: LineStyle.LargeDashed }
export const FONT = '-apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif'
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function palette(theme: Theme) {
  return theme === 'dark'
    ? { bg: '#131722', text: '#b2b5be', grid: '#1e222d', up: '#089981', down: '#f23645', accent: '#2962ff', band: '#f0b90b', cross: '#758696', crossLabel: '#363a45' }
    : { bg: '#ffffff', text: '#131722', grid: '#f0f3fa', up: '#089981', down: '#f23645', accent: '#2962ff', band: '#e8a200', cross: '#9598a1', crossLabel: '#131722' }
}

function timeToIso(t: Time): string {
  if (typeof t === 'string') return t
  if (typeof t === 'number') return new Date(t * 1000).toISOString().slice(0, 10)
  return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`
}

/** TradingView's crosshair date: "Fri 25 Sep '26". */
function crosshairDate(t: Time): string {
  const iso = timeToIso(t)
  const d = new Date(`${iso}T12:00:00Z`)
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} '${iso.slice(2, 4)}`
}

function yearsBefore(iso: string, years: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() - Math.round(years * 12))
  return d.toISOString().slice(0, 10)
}

function volume(v: number | null | undefined): string {
  if (v === null || v === undefined) return '–'
  const abs = Math.abs(v)
  if (abs >= 1e9) return `${(v / 1e9).toFixed(2)} B`
  if (abs >= 1e6) return `${(v / 1e6).toFixed(2)} M`
  if (abs >= 1e3) return `${(v / 1e3).toFixed(2)} K`
  return v.toFixed(0)
}

export default function PriceChart({ data, options, theme, legend, range, rangeNonce, draw, onLegend, onReady }: {
  data: ChartData
  theme: Theme
  options: ChartOptions
  legend: LegendInfo
  range: RangeKey
  rangeNonce: number
  draw: DrawingProps
  onLegend: (a: LegendAction) => void
  onReady?: (api: IChartApi | null) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const chart = useRef<IChartApi | null>(null)
  const series = useRef<ISeriesApi<SeriesType>[]>([])
  const main = useRef<ISeriesApi<SeriesType> | null>(null)
  const layer = useRef<DrawingLayer | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const drawRef = useRef(draw)
  drawRef.current = draw
  const barsRef = useRef(data.bars)
  barsRef.current = data.bars
  const [selected, setSelected] = useState<number | null>(null)
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const c = palette(theme)
  const clock = useMemo(() => new BarClock(data.bars.map((b) => b.time)), [data.bars])
  const last = data.bars.at(-1)?.close ?? 1
  const formatter = useMemo(
    () => (options.axisLabel === 'pct' ? (v: number) => pctOfLast(v, last) : options.axisLabel === 'x' ? (v: number) => multipleOfLast(v, last) : num),
    [options.axisLabel, last],
  )
  const maValues = useMemo(() => {
    const closes = data.bars.map((b) => b.close)
    return new Map(options.mas.map((m) => [m.id, movingAverage(closes, m.type, m.period)]))
  }, [data.bars, options.mas])

  useEffect(() => {
    const el = container.current!
    const api = createChart(el, {
      autoSize: true,
      layout: { attributionLogo: false, fontFamily: FONT, fontSize: 12 },
      rightPriceScale: { borderVisible: false, entireTextOnly: true },
      timeScale: { borderVisible: false, rightOffset: 8, minBarSpacing: 0.05 },
      localization: { priceFormatter: num, timeFormatter: crosshairDate },
    })
    api.subscribeCrosshairMove((p) => {
      const n = barsRef.current.length
      setHover(p.point && p.logical !== undefined && p.logical >= 0 && p.logical < n ? Math.round(p.logical) : null)
    })
    chart.current = api
    onReady?.(api)
    return () => {
      onReady?.(null)
      api.remove()
      chart.current = null
      main.current = null
      layer.current = null
      series.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    chart.current?.applyOptions({
      layout: { background: { type: ColorType.Solid, color: c.bg }, textColor: c.text },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: c.cross, style: LineStyle.Dashed, labelBackgroundColor: c.crossLabel },
        horzLine: { color: c.cross, style: LineStyle.Dashed, labelBackgroundColor: c.crossLabel },
      },
    })
  }, [c.bg, c.text, c.grid, c.cross, c.crossLabel])

  useEffect(() => {
    const api = chart.current
    if (!api) return
    const priceFormat = { type: 'custom' as const, formatter, minMove: 1e-9 }
    api.applyOptions({ localization: { priceFormatter: formatter } })
    for (const s of series.current) api.removeSeries(s)
    series.current = []
    const add = <T extends SeriesType>(s: ISeriesApi<T>) => {
      series.current.push(s as unknown as ISeriesApi<SeriesType>)
      return s
    }

    api.priceScale('right').applyOptions({
      mode: options.logAxis ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal,
      scaleMargins: { top: 0.1, bottom: options.showVolume ? 0.2 : 0.08 },
    })

    const ohlc = data.bars.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close }))
    const closes = data.bars.map((b) => ({ time: b.time, value: b.close }))
    const t = options.chartType
    if (t === 'candles' || t === 'hollow') {
      main.current = add(api.addSeries(CandlestickSeries, {
        upColor: t === 'hollow' ? 'rgba(0,0,0,0)' : c.up, downColor: c.down, borderUpColor: c.up, borderDownColor: c.down,
        wickUpColor: c.up, wickDownColor: c.down, priceFormat,
      }))
      main.current.setData(ohlc)
    } else if (t === 'bars') {
      main.current = add(api.addSeries(BarSeries, { upColor: c.up, downColor: c.down, priceFormat }))
      main.current.setData(ohlc)
    } else if (t === 'area') {
      main.current = add(api.addSeries(AreaSeries, {
        lineColor: c.accent, lineWidth: 2, topColor: withOpacity(c.accent, 0.28), bottomColor: withOpacity(c.accent, 0.02), priceFormat,
      }))
      main.current.setData(closes)
    } else {
      main.current = add(api.addSeries(LineSeries, { color: c.accent, lineWidth: 2, priceFormat }))
      main.current.setData(closes)
    }

    if (options.showVolume) {
      const vol = add(api.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false }))
      api.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
      vol.setData(data.bars.map((b) => ({ time: b.time, value: b.volume ?? 0, color: (b.close >= b.open ? c.up : c.down) + '66' })))
    }

    for (const ma of options.mas) {
      if (ma.hidden) continue
      const { values, provisionalFrom } = maValues.get(ma.id)!
      const color = withOpacity(ma.color, ma.opacity ?? 1)
      const hasTail = provisionalFrom < data.bars.length - 1
      const style = { color, lineWidth: ma.width ?? 1, priceFormat, priceLineVisible: false, crosshairMarkerVisible: false }
      const points = (from: number, to: number) =>
        data.bars.slice(from, to).flatMap((b, k) => {
          const v = values[from + k]
          return v === null ? [] : [{ time: b.time, value: v }]
        })
      add(api.addSeries(LineSeries, { ...style, lastValueVisible: !hasTail })).setData(points(0, provisionalFrom + 1))
      if (hasTail) {
        // Dotted tail: these bars lack their full future window and will be revised.
        add(api.addSeries(LineSeries, { ...style, lineStyle: LineStyle.Dotted })).setData(points(provisionalFrom, data.bars.length))
      }
    }

    const ch = data.channel
    if (ch && options.showChannel) {
      const cut = ch.provisional_from
      const line = (key: string, color: string, style: LineStyle, width: 1 | 2) => {
        const pts = ch.times
          .map((time, i) => ({ time, value: ch.lines[key][i] }))
          // A linear fit's lower bands can go negative, which a log axis cannot draw.
          .filter((p) => !options.logAxis || p.value > 0)
        const opts = { lineStyle: style, lineWidth: width, priceFormat, lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false }
        const firm = cut ? pts.filter((p) => p.time <= cut) : pts
        add(api.addSeries(LineSeries, { ...opts, color })).setData(firm)
        if (cut) {
          // Centered bands: this stretch lacks its future half-window and will be revised.
          const tail = pts.filter((p) => p.time >= (firm.at(-1)?.time ?? cut))
          add(api.addSeries(LineSeries, { ...opts, color: color + '66' })).setData(tail)
        }
      }
      line('mid', c.accent, LineStyle.Solid, 2)
      for (const k of options.sigmaLevels) {
        line(`+${k}`, c.band, BAND_STYLE[k], 1)
        line(`-${k}`, c.band, BAND_STYLE[k], 1)
      }
    }

    const l = new DrawingLayer({
      drawings: drawRef.current.drawings, hidden: drawRef.current.hidden, selected: selectedRef.current, preview: null,
      measure: null, clock, formatPrice: num, colors: { up: c.up, down: c.down, text: c.text, bg: c.bg, accent: c.accent },
    })
    main.current.attachPrimitive(l)
    layer.current = l
  }, [data, options, theme, formatter, maValues, clock, c.up, c.down, c.accent, c.band, c.bg, c.text])

  useEffect(() => {
    layer.current?.set({ drawings: draw.drawings, hidden: draw.hidden, selected })
  }, [draw.drawings, draw.hidden, selected])

  const rangeSig = `${data.ticker}|${data.denominator}|${data.bars.length}`
  useEffect(() => {
    const api = chart.current
    const lastTime = data.bars.at(-1)?.time
    if (!api || !lastTime) return
    const years = RANGES.find((r) => r.key === range)?.years ?? 0
    const ts = api.timeScale()
    if (!years || data.bars[0].time >= yearsBefore(lastTime, years)) {
      ts.fitContent()
      return
    }
    const from = clock.logical(yearsBefore(lastTime, years))
    ts.setVisibleLogicalRange({ from, to: data.bars.length - 1 + 8 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeSig, range, rangeNonce])

  useInteractions({ container, chart, main, layer, drawRef, barsRef, clock, tool: draw.tool, setSelected, selectedRef })

  const i = hover ?? data.bars.length - 1
  const bar = data.bars[i]
  const prev = data.bars[i - 1]
  const chg = bar && prev ? bar.close - prev.close : null
  const barTone = bar && bar.close >= bar.open ? 'up' : 'down'
  const ch = data.channel
  const chIdx = ch && bar ? ch.times.indexOf(bar.time) : -1
  const chMid = ch && chIdx >= 0 ? ch.lines.mid[chIdx] : null
  const chUp = ch && chIdx >= 0 ? ch.lines['+1'][chIdx] : null
  const chZ = chMid !== null && chUp !== null && bar
    ? options.logAxis ? Math.log(bar.close / chMid) / Math.log(chUp / chMid) : (bar.close - chMid) / (chUp - chMid)
    : null

  return (
    <div className="chart-wrap">
      <div className="chart" ref={container} />
      <div className="legend">
        <div className="legend-main">
          <span className="legend-title">{legend.title}</span>
          <span className="legend-sep">·</span>
          <span>{legend.interval}</span>
          <span className="legend-sep">·</span>
          <span>{legend.unit}</span>
          {bar && (
            <span className={`legend-ohlc ${barTone}`}>
              <span><i>O</i>{num(bar.open)}</span>
              <span><i>H</i>{num(bar.high)}</span>
              <span><i>L</i>{num(bar.low)}</span>
              <span><i>C</i>{num(bar.close)}</span>
              {chg !== null && prev && (
                <span>{chg >= 0 ? '+' : '−'}{num(Math.abs(chg))} ({chg >= 0 ? '+' : '−'}{Math.abs((chg / prev.close) * 100).toFixed(2)}%)</span>
              )}
            </span>
          )}
        </div>
        {ch && (
          <LegendRow
            label={legend.channel}
            hidden={!options.showChannel}
            onAction={(action) => onLegend({ kind: 'channel', action })}
            removable={false}
          >
            {chMid !== null && <span style={{ color: c.accent }}>{num(chMid)}</span>}
            {chZ !== null && <span className={chZ > 0 ? 'down' : 'up'}>{chZ >= 0 ? '+' : '−'}{Math.abs(chZ).toFixed(2)}σ</span>}
          </LegendRow>
        )}
        {options.mas.map((m) => {
          const v = maValues.get(m.id)?.values[i]
          return (
            <LegendRow key={m.id} label={`${m.type} ${m.period}`} hidden={m.hidden} onAction={(action) => onLegend({ kind: 'ma', id: m.id, action })}>
              <span style={{ color: withOpacity(m.color, Math.max(0.6, m.opacity ?? 1)) }}>{v === null || v === undefined ? '–' : num(v)}</span>
            </LegendRow>
          )
        })}
        {options.showVolume && (
          <LegendRow label="Vol" onAction={(action) => onLegend({ kind: 'volume', action })} settings={false}>
            <span className={barTone}>{volume(bar?.volume)}</span>
          </LegendRow>
        )}
      </div>
    </div>
  )
}

function LegendRow({ label, hidden, onAction, children, removable = true, settings = true }: {
  label: string
  hidden?: boolean
  onAction: (a: 'toggle' | 'settings' | 'remove') => void
  children: React.ReactNode
  removable?: boolean
  settings?: boolean
}) {
  return (
    <div className={`legend-row ${hidden ? 'hidden' : ''}`}>
      <span className="legend-label" onDoubleClick={() => settings && onAction('settings')}>{label}</span>
      {!hidden && <span className="legend-values">{children}</span>}
      <span className="legend-actions">
        <button onClick={() => onAction('toggle')} title={hidden ? 'Show' : 'Hide'}>{hidden ? Icon.eyeOff : Icon.eye}</button>
        {settings && <button onClick={() => onAction('settings')} title="Settings">{Icon.gear}</button>}
        {removable && <button onClick={() => onAction('remove')} title="Remove">{Icon.close}</button>}
      </span>
    </div>
  )
}

/** Mouse handling for the drawing tools, so the chart behaves like TradingView's. */
function useInteractions({ container, chart, main, layer, drawRef, barsRef, clock, tool, setSelected, selectedRef }: {
  container: React.RefObject<HTMLDivElement | null>
  chart: React.RefObject<IChartApi | null>
  main: React.RefObject<ISeriesApi<SeriesType> | null>
  layer: React.RefObject<DrawingLayer | null>
  drawRef: React.RefObject<DrawingProps>
  barsRef: React.RefObject<ChartData['bars']>
  clock: BarClock
  tool: Tool
  setSelected: (id: number | null) => void
  selectedRef: React.RefObject<number | null>
}) {
  const clockRef = useRef(clock)
  clockRef.current = clock

  useEffect(() => {
    const el = container.current!
    let pending: Drawing | null = null
    let measure: (Measure & { done: boolean }) | null = null
    let drag: { hit: Hit; x: number; y: number; orig: Drawing; next: Drawing | null } | null = null
    let downAt: { x: number; y: number } | null = null

    const local = (e: MouseEvent) => {
      const r = el.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const inPane = (x: number, y: number) => {
      const api = chart.current
      return !!api && x >= 0 && x <= api.timeScale().width() && y >= 0 && y <= (api.paneSize(0)?.height ?? 0)
    }
    const snap = (a: Anchor): Anchor => {
      if (!drawRef.current.magnet) return a
      const bars = barsRef.current
      const b = bars[Math.round(clockRef.current.logical(a.time))]
      if (!b || b.time !== a.time) return a
      const best = [b.open, b.high, b.low, b.close].reduce((p, v) => (Math.abs(v - a.price) < Math.abs(p - a.price) ? v : p))
      return { ...a, price: best }
    }
    const anchorAt = (x: number, y: number) => {
      const a = layer.current?.toAnchor(x, y)
      return a ? snap(a) : null
    }
    const lockScroll = (lock: boolean) =>
      chart.current?.applyOptions({ handleScroll: !lock, handleScale: !lock })
    const nextId = () => Math.max(0, ...drawRef.current.drawings.map((d) => d.id)) + 1
    const commit = (d: Drawing) => {
      drawRef.current.onChange([...drawRef.current.drawings, d])
      setSelected(d.id)
      layer.current?.set({ preview: null })
      pending = null
      drawRef.current.onToolDone()
    }

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      const { x, y } = local(e)
      if (!inPane(x, y)) return
      const tool = drawRef.current.tool
      const anchor = anchorAt(x, y)
      if (!anchor) return
      downAt = { x, y }

      if (measure?.done) {
        measure = null
        layer.current?.set({ measure: null })
      }
      if (tool === 'measure' || (tool === 'cursor' && e.shiftKey)) {
        if (measure && !measure.done) {
          measure.done = true
          drawRef.current.onToolDone()
        } else {
          measure = { a: anchor, b: anchor, done: false }
          layer.current?.set({ measure })
        }
        e.stopPropagation()
        return
      }
      if (tool === 'pickStart' || tool === 'pickEnd') {
        drawRef.current.onPick(tool, anchor)
        e.stopPropagation()
        return
      }
      if (tool === 'hline') {
        commit({ id: nextId(), kind: 'hline', a: anchor, b: anchor, extend: true, color: drawRef.current.nextColor })
        e.stopPropagation()
        return
      }
      if (tool !== 'trend' && pending) pending = null
      if (tool === 'trend') {
        if (pending) commit({ ...pending, b: anchor })
        else {
          pending = { id: nextId(), kind: 'trend', a: anchor, b: anchor, extend: false, color: drawRef.current.nextColor }
          layer.current?.set({ preview: pending })
        }
        e.stopPropagation()
        return
      }

      const hit = layer.current?.hit(x, y)
      if (hit) {
        const orig = drawRef.current.drawings.find((d) => d.id === hit.id)
        if (!orig) return
        setSelected(hit.id)
        drag = { hit, x, y, orig, next: null }
        lockScroll(true)
        e.stopPropagation()
      } else if (selectedRef.current !== null) {
        setSelected(null)
      }
    }

    const onMove = (e: MouseEvent) => {
      const { x, y } = local(e)
      if (drag) {
        const { orig, hit } = drag
        const dx = x - drag.x
        const dy = y - drag.y
        const shift = (p: Anchor): Anchor | null => {
          const px = layer.current?.x(p.time)
          const py = main.current?.priceToCoordinate(p.price)
          return px === null || px === undefined || py === null || py === undefined ? null : anchorAt(px + dx, py + dy)
        }
        let next: Drawing = orig
        if (hit.part === 'a') next = { ...orig, a: anchorAt(x, y) ?? orig.a }
        else if (hit.part === 'b') next = { ...orig, b: anchorAt(x, y) ?? orig.b }
        else {
          const a = shift(orig.a)
          const b = orig.kind === 'hline' ? a : shift(orig.b)
          if (a && b) next = { ...orig, a, b }
        }
        const drawings = drawRef.current.drawings.map((d) => (d.id === orig.id ? next : d))
        layer.current?.set({ drawings })
        if (Math.abs(dx) + Math.abs(dy) > 2) drag.next = next
        return
      }
      if (!inPane(x, y)) return
      if (pending && drawRef.current.tool === 'trend') {
        const b = anchorAt(x, y)
        if (b) layer.current?.set({ preview: { ...pending, b } })
      }
      if (measure && !measure.done) {
        const b = anchorAt(x, y)
        if (b) {
          measure = { ...measure, b }
          layer.current?.set({ measure })
        }
      }
    }

    const onUp = (e: MouseEvent) => {
      const { x, y } = local(e)
      const dragged = downAt && Math.hypot(x - downAt.x, y - downAt.y) > 5
      downAt = null
      if (drag) {
        const next = drag.next
        if (next) drawRef.current.onChange(drawRef.current.drawings.map((d) => (d.id === next.id ? next : d)))
        drag = null
        lockScroll(false)
        return
      }
      // Press-drag-release draws in one gesture, like TradingView.
      if (dragged && pending && drawRef.current.tool === 'trend') {
        const b = anchorAt(x, y)
        if (b) commit({ ...pending, b })
      }
      if (dragged && measure && !measure.done) {
        measure.done = true
        drawRef.current.onToolDone()
      }
    }

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input, select, textarea')) return
      if (e.key === 'Escape') {
        pending = null
        measure = null
        layer.current?.set({ preview: null, measure: null })
        setSelected(null)
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRef.current !== null) {
        const id = selectedRef.current
        drawRef.current.onChange(drawRef.current.drawings.filter((d) => d.id !== id))
        setSelected(null)
      }
    }

    el.addEventListener('mousedown', onDown, true)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('keydown', onKey)
    return () => {
      el.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      window.removeEventListener('keydown', onKey)
    }
  }, [container, chart, main, layer, drawRef, barsRef, setSelected, selectedRef])

  useEffect(() => {
    chart.current?.applyOptions({ handleScroll: tool === 'cursor', handleScale: tool === 'cursor' })
    if (tool !== 'trend') layer.current?.set({ preview: null })
  }, [tool, chart, layer])
}
