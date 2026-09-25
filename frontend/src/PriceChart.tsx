import {
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
import { useEffect, useRef } from 'react'
import type { ChartData } from './api'
import type { Anchor, TrendLine } from './drawings'
import { linePoints } from './drawings'
import { multipleOfLast, num, pctOfLast } from './format'
import type { Theme } from './theme'
import { movingAverage, withOpacity, type MaConfig } from './indicators'

/** How the price axis is labelled, relative to the latest close. */
export type AxisLabel = 'price' | 'pct' | 'x'

export type ChartOptions = {
  candles: boolean
  logAxis: boolean
  showVolume: boolean
  axisLabel: AxisLabel
  sigmaLevels: number[]
  mas: MaConfig[]
  lines: TrendLine[]
  pending: Anchor | null
}

const BAND_STYLE: Record<number, LineStyle> = { 1: LineStyle.Dotted, 2: LineStyle.Dashed, 3: LineStyle.LargeDashed }

function palette(theme: Theme) {
  return theme === 'dark'
    ? { bg: '#131722', text: '#b2b5be', grid: '#1e222d', border: '#2a2e39', up: '#26a69a', down: '#ef5350', mid: '#2962ff', band: '#f0b90b' }
    : { bg: '#ffffff', text: '#434651', grid: '#f0f3fa', border: '#d1d4dc', up: '#089981', down: '#f23645', mid: '#2962ff', band: '#e8a200' }
}

function timeToIso(t: Time): string {
  if (typeof t === 'string') return t
  if (typeof t === 'number') return new Date(t * 1000).toISOString().slice(0, 10)
  return `${t.year}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`
}

export default function PriceChart({ data, options, theme, onPick }: {
  data: ChartData
  theme: Theme
  options: ChartOptions
  onPick?: (anchor: Anchor) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const chart = useRef<IChartApi | null>(null)
  const series = useRef<ISeriesApi<SeriesType>[]>([])
  const main = useRef<ISeriesApi<SeriesType> | null>(null)
  const pickRef = useRef(onPick)
  pickRef.current = onPick

  useEffect(() => {
    const el = container.current!
    const api = createChart(el, {
      autoSize: true,
      layout: { attributionLogo: false },
      crosshair: { mode: CrosshairMode.Normal },
      localization: { priceFormatter: num },
    })
    api.subscribeClick((p) => {
      if (p.time === undefined || !p.point || !main.current) return
      const price = main.current.coordinateToPrice(p.point.y)
      if (price !== null) pickRef.current?.({ time: timeToIso(p.time), price })
    })
    chart.current = api
    return () => {
      api.remove()
      chart.current = null
      series.current = []
    }
  }, [])

  useEffect(() => {
    const c = palette(theme)
    chart.current?.applyOptions({
      layout: { background: { type: ColorType.Solid, color: c.bg }, textColor: c.text },
      grid: { vertLines: { color: c.grid }, horzLines: { color: c.grid } },
      rightPriceScale: { borderColor: c.border },
      timeScale: { borderColor: c.border },
    })
  }, [theme])

  useEffect(() => {
    const api = chart.current
    if (!api) return
    const c = palette(theme)
    const last = data.bars.at(-1)?.close ?? 1
    const formatter =
      options.axisLabel === 'pct'
        ? (v: number) => pctOfLast(v, last)
        : options.axisLabel === 'x'
          ? (v: number) => multipleOfLast(v, last)
          : num
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
      scaleMargins: { top: 0.08, bottom: options.showVolume ? 0.22 : 0.06 },
    })

    if (options.candles) {
      main.current = add(api.addSeries(CandlestickSeries, {
        upColor: c.up, downColor: c.down, borderUpColor: c.up, borderDownColor: c.down,
        wickUpColor: c.up, wickDownColor: c.down, priceFormat,
      }))
      main.current.setData(data.bars.map((b) => ({ time: b.time, open: b.open, high: b.high, low: b.low, close: b.close })))
    } else {
      main.current = add(api.addSeries(LineSeries, { color: c.mid, lineWidth: 2, priceFormat }))
      main.current.setData(data.bars.map((b) => ({ time: b.time, value: b.close })))
    }

    if (options.showVolume) {
      const vol = add(api.addSeries(HistogramSeries, { priceScaleId: 'vol', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false }))
      api.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
      vol.setData(data.bars.map((b) => ({
        time: b.time,
        value: b.volume ?? 0,
        color: (b.close >= b.open ? c.up : c.down) + '55',
      })))
    }

    const closes = data.bars.map((b) => b.close)
    for (const ma of options.mas) {
      const { values, provisionalFrom } = movingAverage(closes, ma.type, ma.period)
      const style = {
        color: withOpacity(ma.color, ma.opacity ?? 1), lineWidth: ma.width ?? 1, priceFormat,
        lastValueVisible: false, priceLineVisible: false, crosshairMarkerVisible: false,
      }
      const points = (from: number, to: number) =>
        data.bars.slice(from, to).flatMap((b, k) => {
          const v = values[from + k]
          return v === null ? [] : [{ time: b.time, value: v }]
        })
      add(api.addSeries(LineSeries, { ...style, title: `${ma.type} ${ma.period}` }))
        .setData(points(0, provisionalFrom + 1))
      if (provisionalFrom < data.bars.length - 1) {
        // Dotted tail: these bars lack their full future window and will be revised.
        add(api.addSeries(LineSeries, { ...style, lineStyle: LineStyle.Dotted }))
          .setData(points(provisionalFrom, data.bars.length))
      }
    }

    const ch = data.channel
    if (ch) {
      const cut = ch.provisional_from
      const line = (key: string, color: string, style: LineStyle, width: 1 | 2) => {
        const pts = ch.times
          .map((t, i) => ({ time: t, value: ch.lines[key][i] }))
          // A linear fit's lower bands can go negative, which a log axis cannot draw.
          .filter((p) => !options.logAxis || p.value > 0)
        const opts = {
          lineStyle: style, lineWidth: width, priceFormat, lastValueVisible: false,
          priceLineVisible: false, crosshairMarkerVisible: false,
        }
        const firm = cut ? pts.filter((p) => p.time <= cut) : pts
        add(api.addSeries(LineSeries, { ...opts, color })).setData(firm)
        if (cut) {
          // Centered bands: this stretch lacks its future half-window and will be revised.
          const tail = pts.filter((p) => p.time >= (firm.at(-1)?.time ?? cut))
          add(api.addSeries(LineSeries, { ...opts, color: color + '66' })).setData(tail)
        }
      }
      line('mid', c.mid, LineStyle.Solid, 2)
      for (const k of options.sigmaLevels) {
        line(`+${k}`, c.band, BAND_STYLE[k], 1)
        line(`-${k}`, c.band, BAND_STYLE[k], 1)
      }
    }

    const times = data.bars.map((b) => b.time)
    for (const tl of options.lines) {
      add(api.addSeries(LineSeries, {
        color: tl.color, lineWidth: 2, priceFormat, lastValueVisible: false, priceLineVisible: false,
        crosshairMarkerVisible: false, pointMarkersVisible: false,
      })).setData(linePoints(tl, times, options.logAxis))
    }
    if (options.pending) {
      const nearest = times.find((t) => t >= options.pending!.time) ?? times[times.length - 1]
      add(api.addSeries(LineSeries, {
        color: c.mid, lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 4,
        priceFormat, lastValueVisible: false, priceLineVisible: false,
      })).setData([{ time: nearest, value: options.pending.price }])
    }
  }, [data, options, theme])

  useEffect(() => {
    chart.current?.timeScale().fitContent()
  }, [data.ticker, data.denominator])

  return <div className="chart" ref={container} />
}
