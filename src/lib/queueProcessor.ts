let scanInProgress = false
let allowScanning = false
let pendingScan: Blob | null = null

export function startScanning() {
  allowScanning = true
}

export function stopScanning() {
  allowScanning = false
  pendingScan = null
}

export async function requestScan(image: Blob) {
  if (!allowScanning) return

  if (scanInProgress) {
    pendingScan = image
    return
  }

  scanInProgress = true

  try {
    await processSingleCard(image)
  } catch (err) {
    console.error('Scan failed', err)
  } finally {
    scanInProgress = false

    if (allowScanning && pendingScan) {
      const next = pendingScan
      pendingScan = null
      requestScan(next)
    }
  }
}

async function processSingleCard(image: Blob) {
  const result = await recognizeCard(image)
  await saveResult(result)
}
