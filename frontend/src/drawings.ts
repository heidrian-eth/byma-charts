export type Anchor = { time: string; price: number }
export type TrendLine = { id: number; a: Anchor; b: Anchor; extend: boolean; color: string }

const DAY_MS = 86_400_000

function days(iso: string): number {
  return Date.parse(iso) / DAY_MS
}

/**
 * Price of the line at each given bar time. Anchors are fixed (date, price) pairs; the path
 * between them is interpolated in the axis's own space so it renders straight on screen.
 */
export function linePoints(line: TrendLine, times: string[], logAxis: boolean): { time: string; value: number }[] {
  const [p, q] = line.a.time <= line.b.time ? [line.a, line.b] : [line.b, line.a]
  const t0 = days(p.time)
  const span = days(q.time) - t0
  if (span <= 0) return []
  const useLog = logAxis && p.price > 0 && q.price > 0
  const y0 = useLog ? Math.log(p.price) : p.price
  const y1 = useLog ? Math.log(q.price) : q.price
  const out: { time: string; value: number }[] = []
  for (const t of times) {
    if (t < p.time || (!line.extend && t > q.time)) continue
    const y = y0 + ((y1 - y0) * (days(t) - t0)) / span
    const value = useLog ? Math.exp(y) : y
    if (!logAxis || value > 0) out.push({ time: t, value })
  }
  return out
}
