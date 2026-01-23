export type MediaSupport = {
  torch: boolean;
  focus: boolean;
  zoom: boolean;
  whiteBalanceMode?: boolean;
  colorTemperature?: boolean;
  exposureMode?: boolean;
  exposureCompensation?: boolean;
};

export function getVideoTrack(stream: MediaStream | null): MediaStreamTrack | null {
  if (!stream) return null;
  const [track] = stream.getVideoTracks();
  return track ?? null;
}

export function detectSupport(track: MediaStreamTrack | null): MediaSupport {
  if (!track) return { torch: false, focus: false, zoom: false };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const caps: any = track.getCapabilities?.() ?? {};
  return {
    torch: !!caps.torch,
    focus: !!caps.focusMode || !!caps.pointsOfInterest,
    zoom: typeof caps.zoom === "object" || typeof caps.zoom === "number",
    whiteBalanceMode: !!caps.whiteBalanceMode,
    colorTemperature: !!caps.colorTemperature,
    exposureMode: !!caps.exposureMode,
    exposureCompensation: !!caps.exposureCompensation,
  };
}

export async function setTorch(track: MediaStreamTrack | null, on: boolean): Promise<boolean> {
  if (!track?.applyConstraints) return false;
  try {
    await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
    return true;
  } catch {
    return false;
  }
}

// Accepts either (track, 0..1, 0..1) or (track, {x,y})
export async function setFocusPoint(
  track: MediaStreamTrack | null,
  xOrPoint: number | { x: number; y: number } | null,
  y?: number
): Promise<boolean> {
  if (!track?.applyConstraints) return false;
  const point =
    typeof xOrPoint === "number"
      ? { x: xOrPoint, y: y ?? 0.5 }
      : xOrPoint ?? { x: 0.5, y: 0.5 };

  try {
    // Some browsers accept pointsOfInterest; others ignore.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await track.applyConstraints({ advanced: [{ pointsOfInterest: [point] } as any] });
    return true;
  } catch {
    return false;
  }
}

export async function setWhiteBalance(
  track: MediaStreamTrack | null,
  opts: { mode: "auto" | "continuous" | "manual"; temperatureK?: number }
): Promise<boolean> {
  if (!track?.applyConstraints) return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const advanced: any = [{ whiteBalanceMode: opts.mode }];
    if (opts.mode === "manual" && typeof opts.temperatureK === "number") {
      advanced[0].colorTemperature = opts.temperatureK;
    }
    await track.applyConstraints({ advanced });
    return true;
  } catch {
    return false;
  }
}

export async function setExposureMode(track: MediaStreamTrack | null, mode: "continuous" | "manual" | "auto") {
  if (!track?.applyConstraints) return false;
  try {
    await track.applyConstraints({ advanced: [{ exposureMode: mode } as MediaTrackConstraintSet] });
    return true;
  } catch {
    return false;
  }
}

export function getExposureCompCaps(track: MediaStreamTrack | null): { min: number; max: number; step: number } | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const caps: any = track?.getCapabilities?.() ?? null;
  const c = caps?.exposureCompensation;
  if (!c || typeof c.min !== "number" || typeof c.max !== "number") return null;
  return { min: c.min, max: c.max, step: typeof c.step === "number" ? c.step : 0.5 };
}

export async function setExposureCompensation(track: MediaStreamTrack | null, value: number): Promise<boolean> {
  if (!track?.applyConstraints) return false;
  try {
    await track.applyConstraints({ advanced: [{ exposureCompensation: value } as MediaTrackConstraintSet] });
    return true;
  } catch {
    return false;
  }
}
