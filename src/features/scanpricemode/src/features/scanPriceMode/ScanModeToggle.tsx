import { getScanMode, setScanMode } from './scanMode.store'
import { useState } from 'react'

export function ScanModeToggle() {
  const [mode, setMode] = useState(getScanMode())

  function toggle() {
    const next = mode === 'SAVE' ? 'SCAN_ONLY' : 'SAVE'
    setScanMode(next)
    setMode(next)
  }

  return (
    <button onClick={toggle}>
      Mode: {mode === 'SAVE' ? 'Save Mode' : 'Scan & Price'}
    </button>
  )
}
