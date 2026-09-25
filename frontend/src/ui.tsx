import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Icon } from './icons'

/** A header button that opens a floating menu; closes on outside click or Escape. */
export function Dropdown({ label, title, children, align = 'left', className = '', caret = true }: {
  label: ReactNode
  title?: string
  children: (close: () => void) => ReactNode
  align?: 'left' | 'right'
  className?: string
  caret?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={`dropdown ${className}`} ref={ref}>
      <button className={`tb ${open ? 'open' : ''}`} onClick={() => setOpen(!open)} title={title}>
        {label}
        {caret && <span className="caret">{Icon.chevron}</span>}
      </button>
      {open && <div className={`menu ${align}`}>{children(() => setOpen(false))}</div>}
    </div>
  )
}

export function MenuItem({ icon, children, active, onClick, hint }: {
  icon?: ReactNode
  children: ReactNode
  active?: boolean
  onClick: () => void
  hint?: ReactNode
}) {
  return (
    <button className={`menu-item ${active ? 'active' : ''}`} onClick={onClick}>
      {icon && <span className="menu-icon">{icon}</span>}
      <span className="menu-label">{children}</span>
      {hint && <span className="menu-hint">{hint}</span>}
    </button>
  )
}

export function Modal({ title, onClose, children, width = 480 }: {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  width?: number
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width }} role="dialog">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">{Icon.close}</button>
        </div>
        {children}
      </div>
    </div>
  )
}
