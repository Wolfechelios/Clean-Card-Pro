// src/lib/useLocalStorageState.ts
"use client"

import { useEffect, useMemo, useState } from "react"

type Setter<T> = (next: T | ((prev: T) => T)) => void

export function useLocalStorageState<T>(key: string, defaultValue: T) {
  const isBrowser = typeof window !== "undefined"

  const read = (): T => {
    if (!isBrowser) return defaultValue
    try {
      const raw = window.localStorage.getItem(key)
      if (raw === null) return defaultValue
      return JSON.parse(raw) as T
    } catch {
      return defaultValue
    }
  }

  const [value, setValueState] = useState<T>(() => read())

  const setValue: Setter<T> = (next) => {
    setValueState((prev) => {
      const v = typeof next === "function" ? (next as any)(prev) : next
      try {
        window.localStorage.setItem(key, JSON.stringify(v))
      } catch {
        // ignore storage quota / private mode issues
      }
      return v
    })
  }

  useEffect(() => {
    if (!isBrowser) return

    const onStorage = (e: StorageEvent) => {
      if (e.key !== key) return
      setValueState(read())
    }

    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return useMemo(() => ({ value, setValue }), [value])
}
