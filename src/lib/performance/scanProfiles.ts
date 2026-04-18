import { Capacitor } from "@capacitor/core";
import { getScannerSettings, type ScannerSettings } from "@/hooks/use-scanner-settings";

export type ScanEngineProfileId = "balanced_default" | "ipad_mac_paired" | "redmagic_standalone";

export type ScanEngineProfile = {
  id: ScanEngineProfileId;
  label: string;
  shortLabel: string;
  description: string;
  role: string;
  queueMax: number;
  frameProcessEvery: number;
  captureCooldownMs: number;
  targetResolution: "720p" | "1080p";
  maxWorkers: number;
  maxInFlightFrames: number;
  bulkConcurrency: number;
  pollIntervalMs: number;
  jobDelayMs: number;
  ramBufferImages: number;
  compressionQuality: number;
  preferContinuityCamera: boolean;
};

export const SCAN_ENGINE_PROFILES: Record<ScanEngineProfileId, ScanEngineProfile> = {
  balanced_default: {
    id: "balanced_default",
    label: "Balanced Default",
    shortLabel: "Balanced",
    description: "General-purpose profile for laptops, phones, and mixed camera setups.",
    role: "Safe baseline",
    queueMax: 500,
    frameProcessEvery: 3,
    captureCooldownMs: 0,
    targetResolution: "1080p",
    maxWorkers: 6,
    maxInFlightFrames: 6,
    bulkConcurrency: 4,
    pollIntervalMs: 20,
    jobDelayMs: 5,
    ramBufferImages: 500,
    compressionQuality: 0.94,
    preferContinuityCamera: false,
  },
  ipad_mac_paired: {
    id: "ipad_mac_paired",
    label: "iPad + MacBook Paired",
    shortLabel: "iPad + Mac",
    description: "Optimized for Continuity Camera input on the MacBook, with the Mac handling the heavy lifting.",
    role: "High-quality paired capture",
    queueMax: 500,
    frameProcessEvery: 4,
    captureCooldownMs: 0,
    targetResolution: "1080p",
    maxWorkers: 6,
    maxInFlightFrames: 8,
    bulkConcurrency: 6,
    pollIntervalMs: 15,
    jobDelayMs: 5,
    ramBufferImages: 500,
    compressionQuality: 0.96,
    preferContinuityCamera: true,
  },
  redmagic_standalone: {
    id: "redmagic_standalone",
    label: "RedMagic Standalone",
    shortLabel: "RedMagic",
    description: "Aggressive mobile profile for a high-memory Android device scanning on its own.",
    role: "Fast standalone mobile",
    queueMax: 500,
    frameProcessEvery: 2,
    captureCooldownMs: 0,
    targetResolution: "720p",
    maxWorkers: 5,
    maxInFlightFrames: 6,
    bulkConcurrency: 4,
    pollIntervalMs: 18,
    jobDelayMs: 5,
    ramBufferImages: 500,
    compressionQuality: 0.93,
    preferContinuityCamera: false,
  },
};

export function getScanEngineProfile(profileId?: ScanEngineProfileId | null): ScanEngineProfile {
  const requested = profileId ?? getScannerSettings().scanEngineProfile;
  return SCAN_ENGINE_PROFILES[requested ?? "balanced_default"] ?? SCAN_ENGINE_PROFILES.balanced_default;
}

export function getActiveScanEngineProfile(settings?: Partial<ScannerSettings>): ScanEngineProfile {
  const explicit = settings?.scanEngineProfile;
  if (explicit && SCAN_ENGINE_PROFILES[explicit]) {
    return SCAN_ENGINE_PROFILES[explicit];
  }

  const persisted = getScannerSettings().scanEngineProfile;
  if (persisted && SCAN_ENGINE_PROFILES[persisted]) {
    return SCAN_ENGINE_PROFILES[persisted];
  }

  const isNativeAndroid = Capacitor.getPlatform() === "android";
  if (isNativeAndroid) {
    return SCAN_ENGINE_PROFILES.redmagic_standalone;
  }

  return SCAN_ENGINE_PROFILES.balanced_default;
}
