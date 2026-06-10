import type { CameraCaptureProfile, ScanMode } from "./cardVisionTypes";

export const PRO_SINGLE_CARD_PROFILE: CameraCaptureProfile = {
  label: "high resolution card macro profile",
  mode: "single-card",
  facingMode: "environment",
  idealWidth: 4032,
  idealHeight: 3024,
  aspectRatio: 4 / 3,
  zoomHint: 1,
  advanced: [
    { focusMode: "continuous" } as MediaTrackConstraintSet & Record<string, unknown>,
    { exposureMode: "continuous" } as MediaTrackConstraintSet & Record<string, unknown>,
    { whiteBalanceMode: "continuous" } as MediaTrackConstraintSet & Record<string, unknown>,
  ],
};

export const PRO_BINDER_PROFILE: CameraCaptureProfile = {
  label: "high resolution binder wide profile",
  mode: "binder-page",
  facingMode: "environment",
  idealWidth: 4032,
  idealHeight: 3024,
  aspectRatio: 4 / 3,
  zoomHint: 0.5,
  advanced: [...PRO_SINGLE_CARD_PROFILE.advanced],
};

export function getProCaptureConstraints(mode: ScanMode = "single-card"): MediaStreamConstraints {
  const profile = mode === "binder-page" ? PRO_BINDER_PROFILE : PRO_SINGLE_CARD_PROFILE;
  return {
    audio: false,
    video: {
      facingMode: { ideal: profile.facingMode },
      width: { ideal: profile.idealWidth },
      height: { ideal: profile.idealHeight },
      aspectRatio: { ideal: profile.aspectRatio },
      advanced: profile.advanced,
    },
  };
}

export async function applyProTrackTuning(track: MediaStreamTrack, mode: ScanMode = "single-card") {
  const profile = mode === "binder-page" ? PRO_BINDER_PROFILE : PRO_SINGLE_CARD_PROFILE;
  const capabilities = track.getCapabilities?.() as MediaTrackCapabilities & { zoom?: { min: number; max: number } };
  const constraints: MediaTrackConstraints = { advanced: [...profile.advanced] };

  if (capabilities?.zoom) {
    const targetZoom = Math.min(capabilities.zoom.max, Math.max(capabilities.zoom.min, profile.zoomHint));
    constraints.advanced = [...(constraints.advanced ?? []), { zoom: targetZoom } as MediaTrackConstraintSet];
  }

  try {
    await track.applyConstraints(constraints);
  } catch (error) {
    console.warn("[CardVision] Camera tuning partially unsupported on this browser", error);
  }
}
