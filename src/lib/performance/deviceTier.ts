/**
 * Device Performance Tier Detection
 */

import { getActiveScanEngineProfile } from "@/lib/performance/scanProfiles";
import { isIPhone17Class } from "@/lib/deviceClass";

export type PerformanceTier = "high" | "mid" | "low";

export interface TierConfig {
  tier: PerformanceTier;
  maxWorkers: number;
  maxInFlightFrames: number;
  bulkApiDelayMs: number;
  jobDelayMs: number;
  pollIntervalMs: number;
  bulkConcurrency: number;
  captureQuality: number;
}

const HIGH_TIER: TierConfig = {
  tier: "high",
  maxWorkers: 8,
  maxInFlightFrames: 6,
  bulkApiDelayMs: 20,
  jobDelayMs: 5,
  pollIntervalMs: 15,
  bulkConcurrency: 5,
  captureQuality: 0.98,
};

const MID_TIER: TierConfig = {
  tier: "mid",
  maxWorkers: 5,
  maxInFlightFrames: 3,
  bulkApiDelayMs: 100,
  jobDelayMs: 15,
  pollIntervalMs: 30,
  bulkConcurrency: 3,
  captureQuality: 0.95,
};

const LOW_TIER: TierConfig = {
  tier: "low",
  maxWorkers: 4,
  maxInFlightFrames: 2,
  bulkApiDelayMs: 400,
  jobDelayMs: 50,
  pollIntervalMs: 100,
  bulkConcurrency: 1,
  captureQuality: 0.9,
};

let cachedTier: TierConfig | null = null;
let cachedProfileKey = "";

function detectTier(): TierConfig {
  const profile = getActiveScanEngineProfile();
  const cores = navigator.hardwareConcurrency || 2;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const isTouchOnly = "ontouchstart" in window && navigator.maxTouchPoints > 0 && !window.matchMedia("(pointer: fine)").matches;
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  const screenWidth = window.screen.width;

  let score = 0;
  if (cores >= 10) score += 3;
  else if (cores >= 6) score += 2;
  else if (cores >= 4) score += 1;

  if (memory !== undefined) {
    if (memory >= 16) score += 3;
    else if (memory >= 8) score += 2;
    else if (memory >= 4) score += 1;
  } else if (!isTouchOnly && screenWidth >= 1280) {
    score += 2;
  }

  if (!isTouchOnly) score += 1;
  if (screenWidth >= 1440) score += 1;
  if (isStandalone && isTouchOnly) score -= 1;
  if (profile.id === "ipad_mac_paired") score += 1;
  if (profile.id === "redmagic_standalone") score += 1;

  // iPhone 17 family (A19 / A19 Pro, iOS 26) — treat as high-tier mobile.
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const iosMatch = ua.match(/OS (\d+)_/);
  const iosMajor = iosMatch ? parseInt(iosMatch[1], 10) : 0;
  if (isIOS && iosMajor >= 26) score += 2;

  const base = score >= 5 ? HIGH_TIER : score >= 3 ? MID_TIER : LOW_TIER;

  // iPhone 17 Pro class — sensor noise is low and ISP is excellent; squeeze
  // every bit of fidelity out of capture + reduce inter-request delay.
  const iphone17 = isIPhone17Class();
  const tunedCaptureQuality = iphone17 ? 0.98 : base.captureQuality;
  const tunedBulkDelay = iphone17 ? Math.min(base.bulkApiDelayMs, 10) : base.bulkApiDelayMs;

  return {
    ...base,
    maxWorkers: Math.max(1, Math.min(base.maxWorkers, profile.maxWorkers)),
    maxInFlightFrames: Math.max(1, Math.min(base.maxInFlightFrames + (profile.maxInFlightFrames > base.maxInFlightFrames ? 1 : 0), profile.maxInFlightFrames)),
    bulkConcurrency: Math.max(1, Math.min(base.bulkConcurrency, profile.bulkConcurrency)),
    jobDelayMs: Math.max(profile.jobDelayMs, Math.min(base.jobDelayMs, profile.jobDelayMs)),
    pollIntervalMs: Math.max(8, Math.min(base.pollIntervalMs, profile.pollIntervalMs)),
    captureQuality: Math.min(tunedCaptureQuality, profile.compressionQuality),
    bulkApiDelayMs: tunedBulkDelay,
  };
}

export function getDeviceTier(): TierConfig {
  const profile = getActiveScanEngineProfile();
  if (!cachedTier || cachedProfileKey !== profile.id) {
    cachedProfileKey = profile.id;
    cachedTier = detectTier();
    console.log(`[DeviceTier] ${cachedTier.tier} using ${profile.shortLabel} (workers=${cachedTier.maxWorkers}, frames=${cachedTier.maxInFlightFrames})`);
  }
  return cachedTier;
}

export function resetDeviceTier(): void {
  cachedTier = null;
  cachedProfileKey = "";
}
