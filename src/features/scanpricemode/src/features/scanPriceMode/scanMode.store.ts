// NEW FILE — does not touch existing logic

export type ScanMode = 'SAVE' | 'SCAN_ONLY'

let currentScanMode: ScanMode = 'SAVE'

export function getScanMode(): ScanMode {
  return currentScanMode
}

export function setScanMode(mode: ScanMode) {
  currentScanMode = mode
}

export function isScanOnlyMode() {
  return currentScanMode === 'SCAN_ONLY'
}
