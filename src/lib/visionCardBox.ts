// src/lib/visionCardBox.ts
export type CardBox = {
  present: boolean
  bbox?: { x0: number; y0: number; x1: number; y1: number } // sample coords
  debug: {
    edgeDensity: number
    bboxCoverage: number
    aspect: number
  }
}

/**
 * Extremely fast "card-ish rectangle present" detector on grayscale samples.
 * Uses neighbor gradients + bbox coverage/aspect tests.
 */
export function detectCardBox(
  gray: Uint8Array,
  w: number,
  h: number,
  opts?: {
    edgeThreshold?: number
    minEdgeDensity?: number
    minCoverage?: number
    aspectMin?: number
    aspectMax?: number
    marginPx?: number
    minEdgeCount?: number
  }
): CardBox {
  const edgeThreshold = opts?.edgeThreshold ?? 22
  const minEdgeDensity = opts?.minEdgeDensity ?? 0.035
  const minCoverage = opts?.minCoverage ?? 0.35
  const aspectMin = opts?.aspectMin ?? 0.60
  const aspectMax = opts?.aspectMax ?? 0.95
  const marginPx = opts?.marginPx ?? 2
  const minEdgeCount = opts?.minEdgeCount ?? 50

  let edgeCount = 0
  let x0 = w, y0 = h, x1 = 0, y1 = 0

  for (let y = 1; y < h - 1; y++) {
    const row = y * w
    for (let x = 1; x < w - 1; x++) {
      const i = row + x
      const gx = Math.abs(gray[i + 1] - gray[i - 1])
      const gy = Math.abs(gray[i + w] - gray[i - w])
      const g = gx + gy
      if (g >= edgeThreshold) {
        edgeCount++
        if (x < x0) x0 = x
        if (y < y0) y0 = y
        if (x > x1) x1 = x
        if (y > y1) y1 = y
      }
    }
  }

  const area = w * h
  const edgeDensity = edgeCount / Math.max(1, area)

  if (edgeCount < minEdgeCount || edgeDensity < minEdgeDensity) {
    return { present: false, debug: { edgeDensity, bboxCoverage: 0, aspect: 0 } }
  }

  x0 = clampInt(x0 - marginPx, 0, w - 1)
  y0 = clampInt(y0 - marginPx, 0, h - 1)
  x1 = clampInt(x1 + marginPx, 0, w - 1)
  y1 = clampInt(y1 + marginPx, 0, h - 1)

  const bw = Math.max(1, x1 - x0 + 1)
  const bh = Math.max(1, y1 - y0 + 1)
  const bboxCoverage = (bw * bh) / Math.max(1, area)
  const aspect = bw / bh

  const present =
    bboxCoverage >= minCoverage &&
    aspect >= aspectMin &&
    aspect <= aspectMax

  return {
    present,
    bbox: { x0, y0, x1, y1 },
    debug: { edgeDensity, bboxCoverage, aspect },
  }
}

function clampInt(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n))
}
