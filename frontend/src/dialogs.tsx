import { useEffect, useRef, useState } from 'react'
import type { LeaderRow } from './api'
import { num, pct, tone } from './format'
import { MA_TYPES, type MaConfig, type MaType } from './indicators'
import { Modal } from './ui'

export function SymbolSearch({ tickers, indices, rows, initial, onPick, onClose }: {
  tickers: string[]
  indices: string[]
  rows: LeaderRow[] | null
  initial: string
  onPick: (t: string) => void
  onClose: () => void
}) {
  const [q, setQ] = useState(initial)
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const byTicker = new Map((rows ?? []).map((r) => [r.ticker, r]))
  const query = q.trim().toUpperCase()
  const matches = tickers
    .filter((t) => t.includes(query))
    .sort((a, b) => Number(!b.startsWith(query)) - Number(!a.startsWith(query)) || a.localeCompare(b))

  useEffect(() => input.current?.focus(), [])
  useEffect(() => setActive(0), [query])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') setActive(Math.min(matches.length - 1, active + 1))
    else if (e.key === 'ArrowUp') setActive(Math.max(0, active - 1))
    else if (e.key === 'Enter' && matches[active]) onPick(matches[active])
    else return
    e.preventDefault()
  }

  return (
    <Modal title="Symbol search" onClose={onClose} width={560}>
      <input
        ref={input}
        className="search-input"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={onKey}
        placeholder="Symbol, e.g. GGAL"
        spellCheck={false}
      />
      <div className="search-list">
        {matches.map((t, i) => {
          const r = byTicker.get(t)
          return (
            <button
              key={t}
              className={`search-row ${i === active ? 'active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => onPick(t)}
              ref={i === active ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
            >
              <span className="search-sym">{t}</span>
              <span className="muted">{indices.includes(t) ? 'Index' : 'Stock'}</span>
              <span className="search-num">{r ? num(r.price_ars) : ''}</span>
              <span className={`search-num ${tone(r?.day_change_ars)}`}>{r ? pct(r.day_change_ars, 2) : ''}</span>
              <span className="search-ex">BYMA</span>
            </button>
          )
        })}
        {matches.length === 0 && <p className="hint pad">No symbol matches “{q}”.</p>}
      </div>
    </Modal>
  )
}

export type IndicatorChoice = { kind: 'ma'; type: MaType } | { kind: 'channel' } | { kind: 'volume' }

const INDICATORS: { choice: IndicatorChoice; name: string; hint: string }[] = [
  { choice: { kind: 'channel' }, name: 'Trend channel', hint: 'Regression, flat mean or centered bands with σ lines' },
  ...MA_TYPES.map((t) => ({
    choice: { kind: 'ma' as const, type: t.value },
    name: `Moving average: ${t.label}`,
    hint: t.value.startsWith('c') ? 'No lag; the newest half-window is provisional' : 'Trailing window',
  })),
  { choice: { kind: 'volume' }, name: 'Volume', hint: 'Shares traded per bar' },
]

export function IndicatorsDialog({ onAdd, onClose }: { onAdd: (c: IndicatorChoice) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const list = INDICATORS.filter((i) => i.name.toLowerCase().includes(q.toLowerCase()))
  return (
    <Modal title="Indicators" onClose={onClose} width={520}>
      <input className="search-input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" />
      <div className="search-list">
        {list.map((i) => (
          <button key={i.name} className="search-row ind-row" onClick={() => onAdd(i.choice)}>
            <span>{i.name}</span>
            <span className="muted">{i.hint}</span>
          </button>
        ))}
      </div>
    </Modal>
  )
}

export function MaSettings({ ma, onChange, onClose }: { ma: MaConfig; onChange: (patch: Partial<MaConfig>) => void; onClose: () => void }) {
  const opacity = Math.round((ma.opacity ?? 1) * 100)
  return (
    <Modal title={`${ma.type} ${ma.period}`} onClose={onClose} width={380}>
      <div className="form">
        <h4>Inputs</h4>
        <label>
          Type
          <select value={ma.type} onChange={(e) => onChange({ type: e.target.value as MaType })}>
            {MA_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <label>
          Length <span className="muted">(bars)</span>
          <input type="number" min={2} max={500} value={ma.period} onChange={(e) => onChange({ period: Math.max(2, Number(e.target.value) || 2) })} />
        </label>
        <h4>Style</h4>
        <label>
          Color
          <input type="color" value={ma.color} onChange={(e) => onChange({ color: e.target.value })} />
        </label>
        <label>
          Opacity <span className="muted">{opacity}%</span>
          <input type="range" min={10} max={100} step={5} value={opacity} onChange={(e) => onChange({ opacity: Number(e.target.value) / 100 })} />
        </label>
        <label>
          Thickness
          <div className="seg small" role="group">
            {([1, 2, 3, 4] as const).map((w) => (
              <button key={w} className={(ma.width ?? 1) === w ? 'on' : ''} onClick={() => onChange({ width: w })} title={`${w}px`}>
                <span className="width-swatch" style={{ height: w }} />
              </button>
            ))}
          </div>
        </label>
      </div>
      <div className="modal-foot">
        <button className="primary" onClick={onClose}>Ok</button>
      </div>
    </Modal>
  )
}
