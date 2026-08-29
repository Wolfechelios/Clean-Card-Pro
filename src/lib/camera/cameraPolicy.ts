export type CameraLikeDevice = {
  kind: string;
  deviceId: string;
  label: string;
};

export function isBlockedCameraLabel(label: string): boolean {
  const normalized = label.toLowerCase();
  return (
    normalized.includes("external-camera") ||
    normalized.includes("reincubate") ||
    normalized.includes("facebook") ||
    normalized.includes("portal") ||
    normalized.includes("messenger")
  );
}

export function filterCameraDevices<T extends CameraLikeDevice>(devices: T[]): T[] {
  return devices.filter(
    (device) => device.kind === "videoinput" && !isBlockedCameraLabel(device.label),
  );
}

/** Advanced hints that both iOS Safari and Android Chrome silently ignore when unsupported. */
const FOCUS_HINTS = [
  { focusMode: "continuous" },
  { exposureMode: "continuous" },
  { whiteBalanceMode: "continuous" },
] as unknown as MediaTrackConstraintSet[];

type Rung = { width: number; height: number };

/** High → low. Card text needs real sensor pixels, so we ask for 4K first. */
export const RESOLUTION_LADDER: Rung[] = [
  { width: 3840, height: 2160 },
  { width: 2560, height: 1440 },
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
];

export function buildVideoConstraints(deviceId?: string, rung?: Rung): MediaTrackConstraints {
  const size = rung
    ? { width: { ideal: rung.width }, height: { ideal: rung.height }, frameRate: { ideal: 30 } }
    : { width: { ideal: 1920 }, height: { ideal: 1080 } };

  const base: MediaTrackConstraints = {
    ...size,
    advanced: FOCUS_HINTS,
  };

  return deviceId
    ? { deviceId: { exact: deviceId }, ...base }
    : { facingMode: { ideal: "environment" }, ...base };
}

export function shouldRetryDefaultCamera(error: unknown, hadSelectedDevice: boolean): boolean {
  if (!hadSelectedDevice) return false;
  const name =
    typeof error === "object" && error && "name" in error
      ? String((error as { name?: unknown }).name || "")
      : "";
  return name === "OverconstrainedError" || name === "NotFoundError";
}

function isHardFailure(error: unknown): boolean {
  const name =
    typeof error === "object" && error && "name" in error
      ? String((error as { name?: unknown }).name || "")
      : "";
  // Permission / hardware problems will not be solved by a lower resolution.
  return name === "NotAllowedError" || name === "SecurityError" || name === "NotReadableError";
}

async function openWithLadder(
  mediaDevices: Pick<MediaDevices, "getUserMedia">,
  deviceId?: string,
): Promise<MediaStream> {
  let lastError: unknown = new Error("Camera unavailable");

  for (const rung of RESOLUTION_LADDER) {
    try {
      return await mediaDevices.getUserMedia({ video: buildVideoConstraints(deviceId, rung), audio: false });
    } catch (error) {
      lastError = error;
      if (isHardFailure(error)) throw error;
    }
  }

  // Last resort: let the browser pick everything.
  try {
    return await mediaDevices.getUserMedia({
      video: deviceId ? { deviceId: { exact: deviceId } } : true,
      audio: false,
    });
  } catch {
    throw lastError;
  }
}

export async function getCameraStreamWithFallback(
  mediaDevices: Pick<MediaDevices, "getUserMedia">,
  selectedDeviceId?: string,
): Promise<{ stream: MediaStream; usedFallback: boolean }> {
  try {
    const stream = await openWithLadder(mediaDevices, selectedDeviceId);
    return { stream, usedFallback: false };
  } catch (error) {
    if (!shouldRetryDefaultCamera(error, Boolean(selectedDeviceId))) throw error;
    const stream = await openWithLadder(mediaDevices);
    return { stream, usedFallback: true };
  }
}

/**
 * Ask the hardware for the sharpest continuous image it can give us.
 * Every hint is applied individually so one unsupported key (very common on
 * iOS Safari) does not discard the rest.
 */
export async function applySharpnessConstraints(track: MediaStreamTrack | null): Promise<void> {
  if (!track?.applyConstraints) return;
  const caps = (track.getCapabilities?.() ?? {}) as Record<string, unknown>;

  const hints: Record<string, unknown>[] = [];
  const modeSupported = (key: string, mode: string) => {
    const value = caps[key];
    return Array.isArray(value) ? value.includes(mode) : false;
  };

  if (modeSupported("focusMode", "continuous")) hints.push({ focusMode: "continuous" });
  if (modeSupported("exposureMode", "continuous")) hints.push({ exposureMode: "continuous" });
  if (modeSupported("whiteBalanceMode", "continuous")) hints.push({ whiteBalanceMode: "continuous" });

  const range = (key: string) => caps[key] as { max?: number; min?: number } | undefined;
  const sharpness = range("sharpness");
  if (sharpness?.max !== undefined) hints.push({ sharpness: sharpness.max });
  const iso = range("iso");
  if (iso?.min !== undefined) hints.push({ iso: iso.min });

  for (const hint of hints) {
    try {
      await track.applyConstraints({ advanced: [hint as MediaTrackConstraintSet] });
    } catch {
      // Unsupported on this lens/browser — skip quietly.
    }
  }
}

/** Point autofocus + exposure at a normalized (0-1) location, then hand control back. */
export async function focusAtPoint(
  track: MediaStreamTrack | null,
  x: number,
  y: number,
): Promise<boolean> {
  if (!track?.applyConstraints) return false;
  const caps = (track.getCapabilities?.() ?? {}) as Record<string, unknown>;
  const focusModes = Array.isArray(caps.focusMode) ? (caps.focusMode as string[]) : [];
  const exposureModes = Array.isArray(caps.exposureMode) ? (caps.exposureMode as string[]) : [];

  let applied = false;

  if (Array.isArray(caps.pointsOfInterest) || "pointsOfInterest" in caps) {
    try {
      await track.applyConstraints({
        advanced: [{ pointsOfInterest: [{ x, y }] } as unknown as MediaTrackConstraintSet],
      });
      applied = true;
    } catch {
      /* ignore */
    }
  }

  const singleShot = focusModes.includes("single-shot")
    ? "single-shot"
    : focusModes.includes("manual")
      ? null
      : null;

  if (singleShot) {
    try {
      await track.applyConstraints({
        advanced: [{ focusMode: singleShot } as unknown as MediaTrackConstraintSet],
      });
      applied = true;
    } catch {
      /* ignore */
    }
  }

  if (exposureModes.includes("single-shot")) {
    try {
      await track.applyConstraints({
        advanced: [{ exposureMode: "single-shot" } as unknown as MediaTrackConstraintSet],
      });
      applied = true;
    } catch {
      /* ignore */
    }
  }

  // Return to continuous tracking so the next card is sharp without a tap.
  window.setTimeout(() => {
    void applySharpnessConstraints(track);
  }, 2500);

  return applied;
}
