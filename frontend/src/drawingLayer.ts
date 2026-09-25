import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  Logical,
  PrimitiveHoveredItem,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts'
import { BarClock, days, type Anchor, type Drawing } from './drawings'
import { num } from './format'

type Pt = { x: number; y: number }
type MediaScope = { context: CanvasRenderingContext2D; mediaSize: { width: number; height: number } }
type Target = { useMediaCoordinateSpace<T>(f: (s: MediaScope) => T): T }

export type Measure = { a: Anchor; b: Anchor }
export type Hit = { id: number; part: 'a' | 'b' | 'line' }

export type LayerState = {
  drawings: Drawing[]
  hidden: boolean
  selected: number | null
  preview: Drawing | null
  measure: Measure | null
  clock: BarClock
  formatPrice: (v: number) => string
  colors: { up: string; down: string; text: string; bg: string; accent: string }
}

const HANDLE_RADIUS = 5
const HIT_PX = 6

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/** Pushes b out along a→b until it leaves a box of the given width. */
function extendRight(a: Pt, b: Pt, width: number): Pt {
  if (b.x <= a.x) return b
  const t = (width + 10 - a.x) / (b.x - a.x)
  return t > 1 ? { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) } : b
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

export class DrawingLayer implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null
  private series: ISeriesApi<SeriesType> | null = null
  private requestUpdate: (() => void) | null = null
  private state: LayerState
  private readonly views: IPrimitivePaneView[]
  private axisViews: ISeriesPrimitiveAxisView[] = []

  constructor(state: LayerState) {
    this.state = state
    this.views = [{ zOrder: () => 'top', renderer: (): IPrimitivePaneRenderer => ({ draw: (t) => this.draw(t as unknown as Target) }) }]
  }

  attached(p: SeriesAttachedParameter<Time>) {
    this.chart = p.chart as IChartApi
    this.series = p.series as ISeriesApi<SeriesType>
    this.requestUpdate = p.requestUpdate
  }

  detached() {
    this.chart = this.series = this.requestUpdate = null
  }

  set(patch: Partial<LayerState>) {
    this.state = { ...this.state, ...patch }
    this.updateAllViews()
    this.requestUpdate?.()
  }

  paneViews() {
    return this.views
  }

  priceAxisViews() {
    return this.axisViews
  }

  updateAllViews() {
    const s = this.state
    const labels: ISeriesPrimitiveAxisView[] = []
    if (!s.hidden) {
      for (const d of [...s.drawings, ...(s.preview ? [s.preview] : [])]) {
        if (d.kind !== 'hline') continue
        const y = this.y(d.a.price)
        if (y === null) continue
        labels.push({ coordinate: () => y, text: () => s.formatPrice(d.a.price), textColor: () => '#fff', backColor: () => d.color })
      }
    }
    this.axisViews = labels
  }

  x(time: string): number | null {
    return this.chart?.timeScale().logicalToCoordinate(this.state.clock.logical(time) as Logical) ?? null
  }

  y(price: number): number | null {
    return this.series?.priceToCoordinate(price) ?? null
  }

  toAnchor(x: number, y: number): Anchor | null {
    const logical = this.chart?.timeScale().coordinateToLogical(x)
    const price = this.series?.coordinateToPrice(y)
    if (logical === null || logical === undefined || price === null || price === undefined) return null
    return { time: this.state.clock.time(logical), price }
  }

  private points(d: Drawing): [Pt, Pt] | null {
    const ay = this.y(d.a.price)
    if (ay === null) return null
    if (d.kind === 'hline') return [{ x: -10, y: ay }, { x: 1e5, y: ay }]
    const ax = this.x(d.a.time)
    const bx = this.x(d.b.time)
    const by = this.y(d.b.price)
    if (ax === null || bx === null || by === null) return null
    return [{ x: ax, y: ay }, { x: bx, y: by }]
  }

  /** Topmost drawing part under the pointer: anchors of the selected line win over bodies. */
  hit(x: number, y: number): Hit | null {
    if (this.state.hidden) return null
    const p = { x, y }
    const all = [...this.state.drawings].reverse()
    const sel = all.find((d) => d.id === this.state.selected)
    if (sel && sel.kind !== 'hline') {
      const pts = this.points(sel)
      if (pts) {
        if (Math.hypot(x - pts[0].x, y - pts[0].y) <= HANDLE_RADIUS + 3) return { id: sel.id, part: 'a' }
        if (Math.hypot(x - pts[1].x, y - pts[1].y) <= HANDLE_RADIUS + 3) return { id: sel.id, part: 'b' }
      }
    }
    for (const d of all) {
      const pts = this.points(d)
      if (!pts) continue
      const end = d.extend ? extendRight(pts[0], pts[1], 1e5) : pts[1]
      if (distToSegment(p, pts[0], end) <= HIT_PX) return { id: d.id, part: 'line' }
    }
    return null
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const h = this.hit(x, y)
    if (!h) return null
    const d = this.state.drawings.find((x) => x.id === h.id)
    const cursorStyle = h.part !== 'line' ? 'move' : d?.kind === 'hline' ? 'ns-resize' : 'pointer'
    return { cursorStyle, externalId: `drawing-${h.id}`, zOrder: 'top' }
  }

  private draw(target: Target) {
    target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
      const s = this.state
      if (!s.hidden) {
        for (const d of s.drawings) this.drawLine(ctx, d, mediaSize.width, d.id === s.selected)
        if (s.preview) this.drawLine(ctx, s.preview, mediaSize.width, true)
      }
      if (s.measure) this.drawMeasure(ctx, s.measure)
    })
  }

  private drawLine(ctx: CanvasRenderingContext2D, d: Drawing, width: number, selected: boolean) {
    const pts = this.points(d)
    if (!pts) return
    const [a, b] = pts
    const end = d.extend && d.kind !== 'hline' ? extendRight(a, b, width) : b
    ctx.save()
    ctx.strokeStyle = d.color
    ctx.lineWidth = d.width ?? 2
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(end.x, end.y)
    ctx.stroke()
    if (selected && d.kind !== 'hline') {
      for (const p of [a, b]) {
        ctx.beginPath()
        ctx.arc(p.x, p.y, HANDLE_RADIUS, 0, Math.PI * 2)
        ctx.fillStyle = this.state.colors.bg
        ctx.fill()
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  private drawMeasure(ctx: CanvasRenderingContext2D, m: Measure) {
    const ax = this.x(m.a.time)
    const bx = this.x(m.b.time)
    const ay = this.y(m.a.price)
    const by = this.y(m.b.price)
    if (ax === null || bx === null || ay === null || by === null) return
    const up = m.b.price >= m.a.price
    const color = up ? this.state.colors.accent : this.state.colors.down
    const change = m.b.price / m.a.price - 1
    const bars = Math.round(this.state.clock.logical(m.b.time) - this.state.clock.logical(m.a.time))
    const span = Math.abs(days(m.b.time) - days(m.a.time))
    const years = span / 365.25
    const cagr = years >= 0.25 && m.a.price > 0 && m.b.price > 0 ? (m.b.price / m.a.price) ** (1 / years) - 1 : null
    const spanText = years >= 1 ? `${years.toFixed(1)}y` : `${Math.round(span)}d`
    const sign = (v: number) => (v >= 0 ? '+' : '−')
    const lines = [
      `${sign(change)}${num(Math.abs(m.b.price - m.a.price))} (${sign(change)}${Math.abs(change * 100).toFixed(2)}%)`,
      `${bars} bars, ${spanText}`,
      ...(cagr !== null ? [`${sign(cagr)}${Math.abs(cagr * 100).toFixed(1)}% / yr`] : []),
    ]

    ctx.save()
    ctx.fillStyle = color + '26'
    ctx.fillRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay))
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    const midX = (ax + bx) / 2
    const midY = (ay + by) / 2
    ctx.beginPath()
    ctx.moveTo(midX, ay)
    ctx.lineTo(midX, by)
    ctx.moveTo(ax, midY)
    ctx.lineTo(bx, midY)
    ctx.stroke()

    ctx.font = '12px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif'
    const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16
    const h = lines.length * 16 + 8
    const boxY = up ? Math.min(ay, by) - h - 6 : Math.max(ay, by) + 6
    roundRect(ctx, midX - w / 2, boxY, w, h, 4)
    ctx.fillStyle = color
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'
    lines.forEach((l, i) => ctx.fillText(l, midX, boxY + 6 + i * 16))
    ctx.restore()
  }
}
