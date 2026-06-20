// src/lib/visionCardRect.ts
// Lightweight "card rectangle present" detector for ROI images.
// Not perfect CV, but strong enough to kill most false triggers.
// Strategy:
// 1) Compute cheap gradient edges on downscaled ROI
// 2) Require enough edges
// 3) Find bounding box of edge pixels
// 4) Check bbox area coverage + aspect ratio (trading card-ish)
// 5) Check perimeter edge hit ratio (rect-like frame)

export type CardRectResult = {
  present: boolean
  bbox?: { x0: number; y0: number; x1: number; y1: number }
  debug?: {
    edgeDensity: number
    bboxCoverage: number
    aspect: number
    perimeterHitRatio: number
  }
}

export type CardRectTuning = {
  // edge threshold (higher = fewer edges)
  edgeThreshold: number

  // minimum edge density across ROI (0..1)
  minEdgeDensity: number

  // bbox coverage range vs ROI area (0..1)
  minBboxCoverage: number
  maxBboxCoverage: number

  // card-ish aspect ratio range (w/h). Trading card is ~0.714 in portrait.
  minAspect: number
  maxAspect: number

  // how much of bbox perimeter must be edges to count as rectangle-ish
  minPerimeterHitRatio: number
}

export const DEFAULT_CARD_RECT_TUNING: CardRectTuning = {
  edgeThreshold: 28,
  minEdgeDensity: 0.02,

  minBboxCoverage: 0.25,
  maxBboxCoverage: 0.95,

  minAspect: 0.55,
  maxAspect: 0.90,

  minPerimeterHitRatio: 0.32,
}

// gray is Uint8Array length w*h
export function detectCardRect(
  gray: Uint8Array,
  w: number,
  h: number,
  tuning: CardRectTuning = DEFAULT_CARD_RECT_TUNING
): CardRectResult {
  if (w < 10 || h < 10) return { present: false }

  // 1) Cheap edge map using abs(dx) + abs(dy)
  const edge = new Uint8Array(w * h)

  let edgeCount = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const gx = Math.abs(gray[i + 1] - gray[i - 1])
      const gy = Math.abs(gray[i + w] - gray[i - w])
      const mag = gx + gy
      if (mag >= tuning.edgeThreshold) {
        edge[i] = 1
        edgeCount++
      }
    }
  }

  const area = w * h
  const edgeDensity = edgeCount / area
  if (edgeDensity < tuning.minEdgeDensity) {
    return { present: false, debug: { edgeDensity, bboxCoverage: 0, aspect: 0, perimeterHitRatio: 0 } }
  }

  // 2) Bounding box of edge pixels
  let minX = w, minY = h, maxX = -1, maxY = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (edge[i]) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }

  if (maxX <= minX || maxY <= minY) return { present: false }

  const bw = maxX - minX + 1
  const bh = maxY - minY + 1
  const bboxCoverage = (bw * bh) / area
  const aspect = bw / bh

  if (bboxCoverage < tuning.minBboxCoverage || bboxCoverage > tuning.maxBboxCoverage) {
    return { present: false, bbox: { x0: minX, y0: minY, x1: maxX, y1: maxY }, debug: { edgeDensity, bboxCoverage, aspect, perimeterHitRatio: 0 } }
  }

  if (aspect < tuning.minAspect || aspect > tuning.maxAspect) {
    return { present: false, bbox: { x0: minX, y0: minY, x1: maxX, y1: maxY }, debug: { edgeDensity, bboxCoverage, aspect, perimeterHitRatio: 0 } }
  }

  // 3) Perimeter hit ratio (rect-like frame)
  // Sample the bbox perimeter and count how many pixels are edges (with small thickness).
  const thickness = 1
  const perimeterLen = 2 * (bw + bh) - 4
  let hits = 0
  let samples = 0

  function isEdge(x: number, y: number) {
    if (x < 0 || y < 0 || x >= w || y >= h) return false
    return edge[y * w + x] === 1
  }

  // top/bottom
  for (let x = minX; x <= maxX; x++) {
    for (let t = -thickness; t <= thickness; t++) {
      samples++
      if (isEdge(x, minY + t)) { hits++; break }
    }
    for (let t = -thickness; t <= thickness; t++) {
      samples++
      if (isEdge(x, maxY + t)) { hits++; break }
    }
  }

  // left/right
  for (let y = minY; y <= maxY; y++) {
    for (let t = -thickness; t <= thickness; t++) {
      samples++
      if (isEdge(minX + t, y)) { hits++; break }
    }
    for (let t = -thickness; t <= thickness; t++) {
      samples++
      if (isEdge(maxX + t, y)) { hits++; break }
    }
  }

  // Normalize hits to true perimeter (samples is inflated by thickness checks)
  const perimeterHitRatio = (hits / Math.max(1, samples))

  const present = perimeterHitRatio >= tuning.minPerimeterHitRatio

  return {
    present,
    bbox: { x0: minX, y0: minY, x1: maxX, y1: maxY },
    debug: { edgeDensity, bboxCoverage, aspect, perimeterHitRatio },
  }
}
