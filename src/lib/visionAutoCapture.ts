// src/lib/visionAutoCapture.ts
// Lightweight motion/stability detector for auto-capture.
// Uses downscaled grayscale frames and mean absolute difference.

export type AutoCaptureTuning = {
  // downscale for analysis (lower = faster)
  sampleW: number
  sampleH: number

  // thresholds
  motionEnterThreshold: number // when scene changes enough to consider "new card entered"
  motionExitThreshold: number  // when scene changes enough to consider "card left"
  stableThreshold: number      // how still it must be to be "stable"

  // frame counts
  stableFramesRequired: number // how many stable frames before capture
  cooldownMs: number          // minimum time between captures
}

export const DEFAULT_TUNING: AutoCaptureTuning = {
  sampleW: 80,
  sampleH: 60,

  // These are deliberately conservative.
  // If it never triggers: LOWER enter/exit thresholds.
  // If it triggers too easily: RAISE thresholds.
  motionEnterThreshold: 12,
  motionExitThreshold: 14,
  stableThreshold: 3.8,

  stableFramesRequired: 10,
  cooldownMs: 700,
}

export type AutoCaptureState = {
  phase: "idle" | "seeing-motion" | "waiting-stable" | "captured"
  stableFrames: number
  lastCaptureAt: number
  lastDiff: number
}

// Convert RGBA image data to grayscale array (0..255)
export function rgbaToGray(data: Uint8ClampedArray): Uint8Array {
  const gray = new Uint8Array(data.length / 4)
  for (let i = 0, g = 0; i < data.length; i += 4, g++) {
    const r = data[i]
    const gg = data[i + 1]
    const b = data[i + 2]
    // standard luma approximation
    gray[g] = (r * 0.299 + gg * 0.587 + b * 0.114) | 0
  }
  return gray
}

// Mean absolute difference between two grayscale frames
export function meanAbsDiff(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length)
  if (n === 0) return 0
  let sum = 0
  for (let i = 0; i < n; i++) {
    sum += Math.abs(a[i] - b[i])
  }
  return sum / n
}

export function nextAutoCaptureState(
  prev: AutoCaptureState,
  diff: number,
  now: number,
  tuning: AutoCaptureTuning
): { state: AutoCaptureState; shouldCapture: boolean } {
  let state = { ...prev, lastDiff: diff }
  let shouldCapture = false

  const cooledDown = now - state.lastCaptureAt >= tuning.cooldownMs

  // Phases:
  // idle -> seeing-motion (new card enters)
  // seeing-motion -> waiting-stable (motion settles)
  // waiting-stable -> captured (once stableFramesRequired met)
  // captured -> idle (when exit motion detected)

  if (state.phase === "idle") {
    if (diff >= tuning.motionEnterThreshold && cooledDown) {
      state.phase = "seeing-motion"
      state.stableFrames = 0
    }
  } else if (state.phase === "seeing-motion") {
    // Once motion drops below stableThreshold, begin stability counting
    if (diff <= tuning.stableThreshold) {
      state.phase = "waiting-stable"
      state.stableFrames = 1
    }
  } else if (state.phase === "waiting-stable") {
    if (diff <= tuning.stableThreshold) {
      state.stableFrames++
      if (state.stableFrames >= tuning.stableFramesRequired && cooledDown) {
        // CAPTURE
        shouldCapture = true
        state.phase = "captured"
        state.lastCaptureAt = now
        state.stableFrames = 0
      }
    } else {
      // Not stable, reset counting
      state.stableFrames = 0
    }
  } else if (state.phase === "captured") {
    // Wait until the card leaves frame (big diff)
    if (diff >= tuning.motionExitThreshold) {
      state.phase = "idle"
      state.stableFrames = 0
    }
  }

  return { state, shouldCapture }
}
