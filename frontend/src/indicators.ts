export type MaType = 'SMA' | 'EMA' | 'Median' | 'cSMA' | 'cEMA' | 'cMedian'

export const MA_TYPES: { value: MaType; label: string }[] = [
  { value: 'SMA', label: 'SMA' },
  { value: 'EMA', label: 'EMA' },
  { value: 'Median', label: 'Median' },
  { value: 'cSMA', label: 'Centered SMA' },
  { value: 'cEMA', label: 'Centered EMA' },
  { value: 'cMedian', label: 'Centered median' },
]

export type MaConfig = {
  id: number
  type: MaType
  period: number
  color: string
  opacity?: number
  width?: 1 | 2 | 3 | 4
  hidden?: boolean
}

export function isCentered(type: MaType): boolean {
  return type.startsWith('c')
}

/** "#rrggbb" plus 0-1 opacity as an rgba() string. */
export function withOpacity(hex: string, opacity = 1): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${opacity})`
}

export type MaResult = {
  values: (number | null)[]
  /** First index whose value can still change as new bars arrive (centered types only). */
  provisionalFrom: number
}

export function movingAverage(values: number[], type: MaType, period: number): MaResult {
  const n = values.length
  const out: (number | null)[] = new Array(n).fill(null)
  if (period < 1 || n === 0) return { values: out, provisionalFrom: n }

  if (type === 'EMA') return { values: ema(values, period, true), provisionalFrom: n }
  if (type === 'cEMA') {
    // Forward then backward pass gives zero lag. Both ends are padded with an odd reflection
    // (the series mirrored through its end point), so the newest bars don't fall back to a
    // one-sided, lagging EMA.
    const pad = Math.min(n - 1, 2 * period)
    const head = Array.from({ length: pad }, (_, k) => 2 * values[0] - values[pad - k])
    const tail = Array.from({ length: pad }, (_, k) => 2 * values[n - 1] - values[n - 2 - k])
    const fwd = ema([...head, ...values, ...tail], period, false) as number[]
    const both = ema(fwd.reverse(), period, false).reverse()
    return { values: both.slice(pad, pad + n), provisionalFrom: Math.max(0, n - Math.ceil(period / 2)) }
  }

  const agg = type === 'SMA' || type === 'cSMA' ? mean : median
  if (!isCentered(type)) {
    for (let i = period - 1; i < n; i++) out[i] = agg(values.slice(i - period + 1, i + 1))
    return { values: out, provisionalFrom: n }
  }
  // Centered window of `period` bars; near either end it is truncated to the bars that exist.
  const before = Math.floor((period - 1) / 2)
  const after = period - 1 - before
  for (let i = 0; i < n; i++) {
    out[i] = agg(values.slice(Math.max(0, i - before), Math.min(n, i + after + 1)))
  }
  return { values: out, provisionalFrom: Math.max(0, n - after) }
}

function ema(values: number[], period: number, warmup: boolean): (number | null)[] {
  const k = 2 / (period + 1)
  const out: (number | null)[] = new Array(values.length).fill(null)
  let prev: number | null = null
  values.forEach((v, i) => {
    if (warmup && i < period - 1) return
    prev = prev === null ? (warmup ? mean(values.slice(0, period)) : v) : v * k + prev * (1 - k)
    out[i] = prev
  })
  return out
}

function mean(a: number[]): number {
  return a.reduce((s, v) => s + v, 0) / a.length
}

function median(a: number[]): number {
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
