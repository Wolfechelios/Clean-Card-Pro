// src/lib/useLocalStorageState.ts
"use client"

import { useEffect, useState } from "react"

export function useLocalStorageState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw) setValue(JSON.parse(raw))
    } catch {
      // ignore
    } finally {
      setHydrated(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // ignore (storage full / blocked)
    }
  }, [key, value, hydrated])

  return { value, setValue, hydrated } as const
}
