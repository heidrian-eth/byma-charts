import type { Drawing } from './drawings'
import { Icon } from './icons'
import { withOpacity, type MaConfig } from './indicators'
import { num } from './format'

export default function ObjectsPanel({ drawings, setDrawings, mas, setMas, onMaSettings, onAddIndicator }: {
  drawings: Drawing[]
  setDrawings: (d: Drawing[]) => void
  mas: MaConfig[]
  setMas: (m: MaConfig[]) => void
  onMaSettings: (id: number) => void
  onAddIndicator: () => void
}) {
  const patch = (id: number, p: Partial<Drawing>) => setDrawings(drawings.map((d) => (d.id === id ? { ...d, ...p } : d)))
  return (
    <div className="panel-scroll">
      <div className="panel-head">
        <h3>Object tree</h3>
      </div>

      <div className="tree-group">
        <div className="tree-title">
          Indicators
          <button className="icon-btn small" onClick={onAddIndicator} title="Add indicator">+</button>
        </div>
        {mas.length === 0 && <p className="hint pad">None yet.</p>}
        {mas.map((m) => (
          <div key={m.id} className={`tree-row ${m.hidden ? 'dim' : ''}`}>
            <span className="swatch" style={{ background: withOpacity(m.color, m.opacity ?? 1) }} />
            <span className="tree-name" onDoubleClick={() => onMaSettings(m.id)}>{m.type} {m.period}</span>
            <button className="icon-btn small" onClick={() => setMas(mas.map((x) => (x.id === m.id ? { ...x, hidden: !x.hidden } : x)))} title={m.hidden ? 'Show' : 'Hide'}>{m.hidden ? Icon.eyeOff : Icon.eye}</button>
            <button className="icon-btn small" onClick={() => onMaSettings(m.id)} title="Settings">{Icon.gear}</button>
            <button className="icon-btn small" onClick={() => setMas(mas.filter((x) => x.id !== m.id))} title="Remove">{Icon.close}</button>
          </div>
        ))}
      </div>

      <div className="tree-group">
        <div className="tree-title">
          Drawings <span className="muted">· saved per stock and unit</span>
        </div>
        {drawings.length === 0 && <p className="hint pad">Pick a tool on the left toolbar. Select a line to drag it; Delete removes it.</p>}
        {drawings.map((d) => (
          <div key={d.id} className="tree-row">
            <input type="color" value={d.color} onChange={(e) => patch(d.id, { color: e.target.value })} aria-label="Color" />
            <span className="tree-name">
              {d.kind === 'hline' ? `Horizontal ${num(d.a.price)}` : `${d.a.time} → ${d.b.time}`}
            </span>
            {d.kind !== 'hline' && (
              <button className={`icon-btn small ${d.extend ? 'on' : ''}`} onClick={() => patch(d.id, { extend: !d.extend })} title="Extend right">→</button>
            )}
            <button className="icon-btn small" onClick={() => setDrawings(drawings.filter((x) => x.id !== d.id))} title="Remove">{Icon.close}</button>
          </div>
        ))}
        {drawings.length > 1 && <button className="link-btn" onClick={() => setDrawings([])}>Remove all drawings</button>}
      </div>
    </div>
  )
}
