export type Anchor = { time: string; price: number }
export type DrawingKind = 'trend' | 'hline'
export type Drawing = {
  id: number
  kind?: DrawingKind
  a: Anchor
  b: Anchor
  extend: boolean
  color: string
  width?: 1 | 2 | 3 | 4
}
/** Kept for lines saved before horizontal lines existed; they have no `kind`. */
export type TrendLine = Drawing

export type Tool = 'cursor' | 'trend' | 'hline' | 'measure' | 'pickStart' | 'pickEnd'

const DAY_MS = 86_400_000

export function days(iso: string): number {
  return Date.parse(iso) / DAY_MS
}

export function isoFromDays(d: number): string {
  return new Date(Math.round(d) * DAY_MS).toISOString().slice(0, 10)
}

/**
 * Maps calendar dates to fractional bar indexes and back. Dates between bars interpolate, and
 * dates past either end extrapolate at the average bar spacing, so anchors keep their date when
 * the bar interval changes.
 */
export class BarClock {
  private readonly d: number[]
  private readonly step: number

  constructor(times: string[]) {
    this.d = times.map(days)
    const n = this.d.length
    const k = Math.min(20, n - 1)
    this.step = k > 0 ? (this.d[n - 1] - this.d[n - 1 - k]) / k : 1
  }

  logical(iso: string): number {
    const d = this.d
    const t = days(iso)
    const n = d.length
    if (n === 0) return 0
    if (t <= d[0]) return (t - d[0]) / this.step
    if (t >= d[n - 1]) return n - 1 + (t - d[n - 1]) / this.step
    let lo = 0
    let hi = n - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (d[mid] <= t) lo = mid
      else hi = mid
    }
    return lo + (t - d[lo]) / (d[hi] - d[lo])
  }

  /** The date at a logical index; inside the data it snaps to the nearest bar. */
  time(logical: number): string {
    const d = this.d
    const n = d.length
    const i = Math.round(logical)
    if (i >= 0 && i < n) return isoFromDays(d[i])
    return isoFromDays(i < 0 ? d[0] + i * this.step : d[n - 1] + (i - n + 1) * this.step)
  }
}
