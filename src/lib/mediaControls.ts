// src/lib/mediaControls.ts
// Browser camera helpers used by Rapid Scan.
// Everything here is "best-effort" because support varies wildly across
// devices (especially iOS Safari).

export type MediaSupport = {
  torch: boolean;
  zoom: boolean;
  focus: boolean;
  whiteBalanceMode: boolean;
  colorTemperature: boolean;
  exposureCompensation: boolean;
  exposureMode: boolean;
};

export const DEFAULT_MEDIA_SUPPORT: MediaSupport = {
  torch: false,
  zoom: false,
  focus: false,
  whiteBalanceMode: false,
  colorTemperature: false,
  exposureCompensation: false,
  exposureMode: false,
};

export function getVideoTrack(stream: MediaStream | null | undefined): MediaStreamTrack | null {
  if (!stream) return null;
  const tracks = stream.getVideoTracks();
  return tracks?.[0] ?? null;
}

export function detectSupport(track: MediaStreamTrack | null): MediaSupport {
  try {
    const caps: any = track?.getCapabilities?.() ?? {};
    return {
      torch: !!caps.torch,
      zoom: typeof caps.zoom !== "undefined",
      focus: !!caps.focusMode || typeof caps.focusDistance !== "undefined",
      whiteBalanceMode: !!caps.whiteBalanceMode,
      colorTemperature: typeof caps.colorTemperature !== "undefined",
      exposureCompensation: typeof caps.exposureCompensation !== "undefined",
      exposureMode: typeof caps.exposureMode !== "undefined",
    };
  } catch {
    return DEFAULT_MEDIA_SUPPORT;
  }
}

export async function setTorch(track: MediaStreamTrack | null, enabled: boolean): Promise<boolean> {
  if (!track?.applyConstraints) return;
  try {
    await track.applyConstraints({ advanced: [{ torch: enabled } as any] });
    return true;
  } catch {
    // ignore
    return false;
  }
}

// Tap-to-focus is not consistently exposed on the web. We keep this as a no-op
// fallback to avoid crashes if a caller uses it.
export async function setFocusPoint(
  _track: MediaStreamTrack | null,
  _xOrPoint: number | { x: number; y: number },
  _y01?: number
): Promise<boolean> {
  // Some platforms support ImageCapture (not reliable). For now: no-op.
  return false;
}

export async function setWhiteBalance(
  track: MediaStreamTrack | null,
  opts: { mode?: "auto" | "continuous" | "manual"; temperatureK?: number }
) {
  if (!track?.applyConstraints) return;
  const advanced: any = {};
  if (opts.mode) advanced.whiteBalanceMode = opts.mode;
  if (typeof opts.temperatureK === "number") advanced.colorTemperature = Math.round(opts.temperatureK);
  try {
    await track.applyConstraints({ advanced: [advanced] });
  } catch {
    // ignore
  }
}


export function getExposureCompCaps(track: MediaStreamTrack | null): { min: number; max: number; step: number } | null {
  try {
    const caps: any = track?.getCapabilities?.() ?? {};
    if (typeof caps.exposureCompensation === 'undefined') return null;
    const c = caps.exposureCompensation;
    return {
      min: typeof c.min === 'number' ? c.min : -2,
      max: typeof c.max === 'number' ? c.max : 2,
      step: typeof c.step === 'number' && c.step > 0 ? c.step : 0.1,
    };
  } catch {
    return null;
  }
}

export async function setExposureMode(track: MediaStreamTrack | null, mode: 'auto' | 'continuous' | 'manual') {
  if (!track?.applyConstraints) return;
  try {
    await track.applyConstraints({ advanced: [{ exposureMode: mode } as any] });
  } catch {
    // ignore
  }
}

export async function setExposureCompensation(track: MediaStreamTrack | null, value: number) {
  if (!track?.applyConstraints) return;
  try {
    await track.applyConstraints({ advanced: [{ exposureCompensation: value } as any] });
  } catch {
    // ignore
  }
}
