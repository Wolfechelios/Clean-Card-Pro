import type { CaptureProfileId } from "./contracts";

export type CaptureProfile = {
  id: CaptureProfileId;
  label: string;
  exposureCompensation: number;
  contrast: number;
  highlightCompression: number;
  glareScoring: boolean;
  burstFrames: number;
  autoMinSharpness: number;
  autoMaxGlareRatio: number;
  autoCooldownMs: number;
};

const captureProfiles: Record<CaptureProfileId, CaptureProfile> = {
  standard: {
    id: "standard",
    label: "Standard / Matte",
    exposureCompensation: 0,
    contrast: 1.05,
    highlightCompression: 0,
    glareScoring: false,
    burstFrames: 1,
    autoMinSharpness: 36,
    autoMaxGlareRatio: 1,
    autoCooldownMs: 250,
  },
  sleeved: {
    id: "sleeved",
    label: "Sleeved",
    exposureCompensation: -0.2,
    contrast: 1.08,
    highlightCompression: 0.15,
    glareScoring: true,
    burstFrames: 2,
    autoMinSharpness: 38,
    autoMaxGlareRatio: 0.12,
    autoCooldownMs: 250,
  },
  foil: {
    id: "foil",
    label: "Foil / Holographic",
    exposureCompensation: -0.45,
    contrast: 1.15,
    highlightCompression: 0.35,
    glareScoring: true,
    burstFrames: 3,
    autoMinSharpness: 40,
    autoMaxGlareRatio: 0.08,
    autoCooldownMs: 250,
  },
  "chrome-prizm": {
    id: "chrome-prizm",
    label: "Chrome / Prizm",
    exposureCompensation: -0.6,
    contrast: 1.18,
    highlightCompression: 0.45,
    glareScoring: true,
    burstFrames: 3,
    autoMinSharpness: 42,
    autoMaxGlareRatio: 0.06,
    autoCooldownMs: 250,
  },
  "absolute-high-gloss": {
    id: "absolute-high-gloss",
    label: "Absolute / High Gloss",
    exposureCompensation: -0.5,
    contrast: 1.15,
    highlightCompression: 0.4,
    glareScoring: true,
    burstFrames: 3,
    autoMinSharpness: 42,
    autoMaxGlareRatio: 0.06,
    autoCooldownMs: 250,
  },
  custom: {
    id: "custom",
    label: "Custom",
    exposureCompensation: 0,
    contrast: 1,
    highlightCompression: 0,
    glareScoring: true,
    burstFrames: 1,
    autoMinSharpness: 40,
    autoMaxGlareRatio: 0.1,
    autoCooldownMs: 250,
  },
};

for (const profile of Object.values(captureProfiles)) {
  Object.freeze(profile);
}

export const CAPTURE_PROFILES: Readonly<Record<CaptureProfileId, Readonly<CaptureProfile>>> =
  Object.freeze(captureProfiles);

export function getCaptureProfile(profileId: CaptureProfileId): Readonly<CaptureProfile> {
  return CAPTURE_PROFILES[profileId];
}
