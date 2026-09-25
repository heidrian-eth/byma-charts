import type { ReactNode } from 'react'

function Svg({ children, size = 28 }: { children: ReactNode; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" fill="none" stroke="currentColor" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  )
}

export const Icon = {
  menu: <Svg><path d="M6 9h16M6 14h16M6 19h16" /></Svg>,
  search: <Svg size={18}><circle cx="12.5" cy="12.5" r="5.5" /><path d="m17 17 5 5" /></Svg>,
  candles: <Svg><path d="M10 5v3M10 20v3M18 8v3M18 18v3" /><rect x="7.5" y="8" width="5" height="12" rx="0.5" fill="currentColor" /><rect x="15.5" y="11" width="5" height="7" rx="0.5" /></Svg>,
  hollow: <Svg><path d="M10 5v3M10 20v3M18 8v3M18 18v3" /><rect x="7.5" y="8" width="5" height="12" rx="0.5" /><rect x="15.5" y="11" width="5" height="7" rx="0.5" /></Svg>,
  bars: <Svg><path d="M10 6v16M7 9h3M10 19h3M18 9v12M15 11h3M18 18h3" /></Svg>,
  line: <Svg><path d="m5 19 6-7 5 4 7-9" /></Svg>,
  area: <Svg><path d="m5 19 6-7 5 4 7-9" /><path d="M5 22v-3l6-7 5 4 7-9v15z" fill="currentColor" fillOpacity={0.2} stroke="none" /></Svg>,
  indicators: <Svg><path d="M6 20 11 13l4 4 7-10" /><path d="M18 7h4v4" /></Svg>,
  cross: <Svg><path d="M14 5v7M14 16v7M5 14h7M16 14h7" /></Svg>,
  trend: <Svg><path d="m7.5 20.5 13-13" /><circle cx="6" cy="22" r="1.8" /><circle cx="22" cy="6" r="1.8" /></Svg>,
  hline: <Svg><path d="M4 14h20" /><circle cx="14" cy="14" r="1.8" /></Svg>,
  ruler: <Svg><path d="m6 19 13-13 3 3L9 22z" /><path d="m10 15 2 2M13 12l2 2M16 9l2 2" /></Svg>,
  magnet: <Svg><path d="M8 7v7a6 6 0 0 0 12 0V7h-4v7a2 2 0 0 1-4 0V7z" /><path d="M8 10h4M16 10h4" /></Svg>,
  eye: <Svg><path d="M4 14s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6z" /><circle cx="14" cy="14" r="3" /></Svg>,
  eyeOff: <Svg><path d="M4 14s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6z" /><path d="m6 22 16-16" /></Svg>,
  trash: <Svg><path d="M7 9h14M11 9V7h6v2M9 9l1 13h8l1-13" /></Svg>,
  gear: <Svg size={18}><circle cx="14" cy="14" r="3" /><path d="M14 5v3M14 20v3M5 14h3M20 14h3M7.6 7.6l2.1 2.1M18.3 18.3l2.1 2.1M7.6 20.4l2.1-2.1M18.3 9.7l2.1-2.1" /></Svg>,
  close: <Svg size={18}><path d="m8 8 12 12M20 8 8 20" /></Svg>,
  watchlist: <Svg><rect x="6" y="5" width="16" height="18" rx="2" /><path d="M10 10h8M10 14h8M10 18h5" /></Svg>,
  details: <Svg><circle cx="14" cy="14" r="9" /><path d="M14 13v6M14 9.5v.5" /></Svg>,
  channel: <Svg><path d="m4 18 20-8M4 23l20-8M4 13l20-8" strokeDasharray="0" /></Svg>,
  layers: <Svg><path d="m14 6 9 5-9 5-9-5z" /><path d="m5 15 9 5 9-5" /></Svg>,
  trophy: <Svg><path d="M9 6h10v5a5 5 0 0 1-10 0z" /><path d="M9 8H6v2a3 3 0 0 0 3 3M19 8h3v2a3 3 0 0 1-3 3M14 16v4M10 22h8" /></Svg>,
  camera: <Svg><path d="M5 10h4l2-3h6l2 3h4v11H5z" /><circle cx="14" cy="15" r="3.5" /></Svg>,
  sun: <Svg><circle cx="14" cy="14" r="4" /><path d="M14 4v2M14 22v2M4 14h2M22 14h2M7 7l1.5 1.5M19.5 19.5 21 21M7 21l1.5-1.5M19.5 8.5 21 7" /></Svg>,
  moon: <Svg><path d="M20 17a8 8 0 0 1-9-11 8 8 0 1 0 9 11z" /></Svg>,
  refresh: <Svg><path d="M21 9a8 8 0 1 0 1 6" /><path d="M21 4v5h-5" /></Svg>,
  chevron: <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={1.3} aria-hidden><path d="m2 3.5 3 3 3-3" /></svg>,
  calendar: <Svg><rect x="6" y="7" width="16" height="15" rx="2" /><path d="M6 12h16M10 5v4M18 5v4" /></Svg>,
}
