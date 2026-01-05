// src/lib/mediaControls.ts
"use client"

export type MediaSupport = {
  torch: boolean
  focus: boolean
  zoom: boolean
}

export function getVideoTrack(stream: MediaStream | null) {
  if (!stream) return null
  const track = stream.getVideoTracks?.()?.[0] ?? null
  return track
}

export function detectSupport(track: MediaStreamTrack | null): MediaSupport {
  if (!track) return { torch: false, focus: false, zoom: false }

  const caps: any = (track.getCapabilities?.() ?? {}) as any
  const torch = !!caps.torch
  const zoom = typeof caps.zoom !== "undefined"
  // Focus is messy across browsers. We'll attempt "pointsOfInterest" or focusMode.
  const focus =
    typeof caps.focusMode !== "undefined" ||
    typeof caps.pointsOfInterest !== "undefined" ||
    typeof caps.focusDistance !== "undefined"

  return { torch, focus, zoom }
}

export async function setTorch(track: MediaStreamTrack | null, on: boolean) {
  if (!track?.applyConstraints) return false
  try {
    await track.applyConstraints({ advanced: [{ torch: on }] } as any)
    return true
  } catch {
    return false
  }
}

export async function setFocusPoint(
  track: MediaStreamTrack | null,
  point: { x: number; y: number } // 0..1
) {
  if (!track?.applyConstraints) return false
  try {
    // Chrome/Android sometimes accepts pointsOfInterest
    await track.applyConstraints({
      advanced: [
        {
          pointsOfInterest: [{ x: clamp01(point.x), y: clamp01(point.y) }],
        },
      ],
    } as any)
    return true
  } catch {
    // fallback: try continuous focusMode if available
    try {
      await track.applyConstraints({
        advanced: [{ focusMode: "continuous" }],
      } as any)
      return true
    } catch {
      return false
    }
  }
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n))
}
