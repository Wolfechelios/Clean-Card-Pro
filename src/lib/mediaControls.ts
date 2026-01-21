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
    };
  } catch {
    return { torch: false, zoom: false, focus: false, whiteBalanceMode: false, colorTemperature: false };
  }
}

export async function setTorch(track: MediaStreamTrack | null, enabled: boolean) {
  if (!track?.applyConstraints) return;
  try {
    await track.applyConstraints({ advanced: [{ torch: enabled } as any] });
  } catch {
    // ignore
  }
}

// Tap-to-focus is not consistently exposed on the web. We keep this as a no-op
// fallback to avoid crashes if a caller uses it.
export async function setFocusPoint(_track: MediaStreamTrack | null, _x01: number, _y01: number) {
  // Some platforms support ImageCapture (not reliable). For now: no-op.
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
