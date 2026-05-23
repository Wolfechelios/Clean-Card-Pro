/**
 * Device Performance Tier Detection
 * 
 * Detects hardware capabilities and returns a performance tier
 * that scales concurrency, delays, and limits accordingly.
 * 
 * Desktop (e.g. Mac M3 Pro 36GB): max concurrency, minimal delays
 * Mobile: conservative settings to avoid thermal throttling
 */

export type PerformanceTier = "high" | "mid" | "low";

export interface TierConfig {
  tier: PerformanceTier;
  /** Max concurrent workers for queue processing */
  maxWorkers: number;
  /** Max in-flight frames for camera pipeline */
  maxInFlightFrames: number;
  /** Delay between bulk API calls (ms) */
  bulkApiDelayMs: number;
  /** Delay between queue jobs (ms) */
  jobDelayMs: number;
  /** Queue poll interval (ms) */
  pollIntervalMs: number;
  /** Max concurrent bulk API calls */
  bulkConcurrency: number;
  /** Image compression quality (0-1) */
  captureQuality: number;
}

const HIGH_TIER: TierConfig = {
  tier: "high",
  maxWorkers: 6,
  maxInFlightFrames: 6,
  bulkApiDelayMs: 20,
  jobDelayMs: 5,
  pollIntervalMs: 15,
  bulkConcurrency: 5,
  captureQuality: 0.98,
};

const MID_TIER: TierConfig = {
  tier: "mid",
  maxWorkers: 3,
  maxInFlightFrames: 3,
  bulkApiDelayMs: 100,
  jobDelayMs: 15,
  pollIntervalMs: 30,
  bulkConcurrency: 3,
  captureQuality: 0.95,
};

const LOW_TIER: TierConfig = {
  tier: "low",
  maxWorkers: 2,
  maxInFlightFrames: 2,
  bulkApiDelayMs: 400,
  jobDelayMs: 50,
  pollIntervalMs: 100,
  bulkConcurrency: 1,
  captureQuality: 0.90,
};

let cachedTier: TierConfig | null = null;

function detectTier(): TierConfig {
  const cores = navigator.hardwareConcurrency || 2;
  const memory = (navigator as any).deviceMemory as number | undefined; // GB, Chrome only
  const isTouchOnly = "ontouchstart" in window && navigator.maxTouchPoints > 0 && !window.matchMedia("(pointer: fine)").matches;
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || (window.navigator as any).standalone === true;
  const screenWidth = window.screen.width;

  // Heuristic scoring
  let score = 0;

  // Core count (most reliable signal)
  if (cores >= 10) score += 3;      // Desktop Apple Silicon, modern x86
  else if (cores >= 6) score += 2;   // Mid-range desktop or high-end mobile
  else if (cores >= 4) score += 1;   // Most phones

  // Memory (Chrome-only, undefined on Safari/Firefox)
  if (memory !== undefined) {
    if (memory >= 16) score += 3;
    else if (memory >= 8) score += 2;
    else if (memory >= 4) score += 1;
  } else {
    // No memory API = likely Safari/Firefox desktop, assume decent
    if (!isTouchOnly && screenWidth >= 1280) score += 2;
  }

  // Input method: fine pointer = mouse = likely desktop
  if (!isTouchOnly) score += 1;

  // Large screen = likely desktop
  if (screenWidth >= 1440) score += 1;

  // Running as PWA on mobile = constrain
  if (isStandalone && isTouchOnly) score -= 1;

  console.log(`[DeviceTier] cores=${cores} mem=${memory ?? "?"} touch=${isTouchOnly} screen=${screenWidth} → score=${score}`);

  if (score >= 5) return HIGH_TIER;
  if (score >= 3) return MID_TIER;
  return LOW_TIER;
}

export function getDeviceTier(): TierConfig {
  if (!cachedTier) {
    cachedTier = detectTier();
    console.log(`[DeviceTier] Detected: ${cachedTier.tier} (workers=${cachedTier.maxWorkers}, bulk=${cachedTier.bulkConcurrency})`);
  }
  return cachedTier;
}

/** Force re-detection (e.g. after display mode change) */
export function resetDeviceTier(): void {
  cachedTier = null;
}
