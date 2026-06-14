import { getActiveScanEngineProfile } from "@/lib/performance/scanProfiles";

export type MemoryConfig = {
  maxInFlightFrames: number;
  reuseBuffers: boolean;
  zeroCopyIntent: boolean;
  ramBufferImages: number;
  queueWriteBatchSize: number;
};

export function getMemoryConfig(): MemoryConfig {
  const profile = getActiveScanEngineProfile();
  return {
    maxInFlightFrames: profile.maxInFlightFrames,
    reuseBuffers: true,
    zeroCopyIntent: true,
    ramBufferImages: profile.ramBufferImages,
    queueWriteBatchSize: Math.max(8, Math.floor(profile.ramBufferImages / 12)),
  };
}

export const MEMORY_CONFIG = getMemoryConfig();
