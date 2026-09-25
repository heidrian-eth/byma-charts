import { useEffect, useState } from 'react'

const PREFIX = 'byma-charts:'

export function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

export function writeStored(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // Storage can be unavailable (private mode); settings just won't persist.
  }
}

export function usePersisted<T>(key: string, fallback: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => readStored(key, fallback))
  useEffect(() => writeStored(key, value), [key, value])
  return [value, setValue]
}
