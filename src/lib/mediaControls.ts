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

  const caps: any = track.getCapabilities?.() ?? {}
  const torch = !!caps.torch
  const zoom = typeof caps.zoom !== "undefined"

  // Focus support is inconsistent; we try the common capability flags
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
  point: { x: number; y: number } // normalized 0..1
) {
  if (!track?.applyConstraints) return false
  try {
    // Some Chrome/Android builds accept pointsOfInterest
    await track.applyConstraints({
      advanced: [{ pointsOfInterest: [{ x: clamp01(point.x), y: clamp01(point.y) }] }],
    } as any)
    return true
  } catch {
    // fallback: request continuous focus if supported
    try {
      await track.applyConstraints({ advanced: [{ focusMode: "continuous" }] } as any)
      return true
    } catch {
      return false
    }
  }
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n))
}

// ─── White Balance ──────────────────────────────────────────────────────────

export type WhiteBalanceSupport = {
  supported: boolean
  modes: string[] // e.g. ["continuous", "manual"]
  temperatureRange: { min: number; max: number; step: number } | null
}

export function detectWhiteBalanceSupport(track: MediaStreamTrack | null): WhiteBalanceSupport {
  if (!track) return { supported: false, modes: [], temperatureRange: null }

  const caps: any = track.getCapabilities?.() ?? {}
  const modes: string[] = caps.whiteBalanceMode ?? []
  const supported = modes.length > 0

  let temperatureRange: WhiteBalanceSupport["temperatureRange"] = null
  if (caps.colorTemperature) {
    temperatureRange = {
      min: caps.colorTemperature.min ?? 2500,
      max: caps.colorTemperature.max ?? 10000,
      step: caps.colorTemperature.step ?? 100,
    }
  }

  return { supported, modes, temperatureRange }
}

export async function setWhiteBalanceMode(
  track: MediaStreamTrack | null,
  mode: string
): Promise<boolean> {
  if (!track?.applyConstraints) return false
  try {
    await track.applyConstraints({ advanced: [{ whiteBalanceMode: mode }] } as any)
    return true
  } catch {
    return false
  }
}

export async function setColorTemperature(
  track: MediaStreamTrack | null,
  kelvin: number
): Promise<boolean> {
  if (!track?.applyConstraints) return false
  try {
    await track.applyConstraints({
      advanced: [{ whiteBalanceMode: "manual", colorTemperature: kelvin }],
    } as any)
    return true
  } catch {
    return false
  }
}
