import { useEffect, useState } from 'react'
import { usePersisted } from './persist'

export type ThemeChoice = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

const query = () => window.matchMedia('(prefers-color-scheme: dark)')

/** The user's choice plus the theme it resolves to; keeps <html data-theme> in sync. */
export function useTheme(): [ThemeChoice, (t: ThemeChoice) => void, Theme] {
  const [choice, setChoice] = usePersisted<ThemeChoice>('theme', 'system')
  const [systemDark, setSystemDark] = useState(() => query().matches)

  useEffect(() => {
    const mq = query()
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (choice === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', choice)
  }, [choice])

  const resolved: Theme = choice === 'system' ? (systemDark ? 'dark' : 'light') : choice
  return [choice, setChoice, resolved]
}
