export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–'
  return `${v > 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`
}

export function sigmas(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–'
  return `${v > 0 ? '+' : ''}${v.toFixed(2)}σ`
}

/** Four significant digits, so tiny ratios (stock / Merval) stay readable. */
export function num(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–'
  const abs = Math.abs(v)
  if (abs >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 })
  if (abs === 0) return '0'
  return v.toPrecision(4)
}

export function tone(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v) || v === 0) return ''
  return v > 0 ? 'up' : 'down'
}

/** A price as a multiple of the latest close: 2.5x above it, 1/2.5x below it. */
export function multipleOfLast(v: number, last: number): string {
  const r = v / last
  if (!Number.isFinite(r) || r <= 0) return '–'
  const fmt = (x: number) => (x >= 100 ? x.toFixed(0) : x.toPrecision(3))
  return r >= 1 ? `${fmt(r)}x` : `1/${fmt(1 / r)}x`
}

/** A price as a percentage of the latest close, which reads as 100%. */
export function pctOfLast(v: number, last: number): string {
  const p = (v / last) * 100
  if (!Number.isFinite(p)) return '–'
  if (Math.abs(p) >= 1000) return `${p.toLocaleString('en-US', { maximumFractionDigits: 0 })}%`
  return `${p.toPrecision(3)}%`
}
