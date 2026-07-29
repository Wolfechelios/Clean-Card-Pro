import type { CaptureProfile } from "../rapidScan/captureProfiles";

export type CameraLikeDevice = {
  kind: string;
  deviceId: string;
  label: string;
};

export type ProfileCameraCapabilities = {
  exposureCompensation?: {
    min?: number;
    max?: number;
    step?: number;
  };
};

export function isBlockedCameraLabel(label: string): boolean {
  const normalized = label.toLowerCase();
  return (
    normalized.includes("camo") ||
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

export function buildVideoConstraints(deviceId?: string): MediaTrackConstraints {
  const size = { width: { ideal: 1920 }, height: { ideal: 1080 } };
  return deviceId ? { deviceId: { exact: deviceId }, ...size } : size;
}

export function buildProfileConstraints(
  profile: Readonly<CaptureProfile>,
  capabilities: ProfileCameraCapabilities,
): MediaTrackConstraints {
  const range = capabilities.exposureCompensation;
  if (
    !range ||
    typeof range.min !== "number" ||
    typeof range.max !== "number" ||
    !Number.isFinite(range.min) ||
    !Number.isFinite(range.max)
  ) {
    return {};
  }

  const exposureCompensation = Math.min(
    range.max,
    Math.max(range.min, profile.exposureCompensation),
  );
  const constraint = { exposureCompensation } as MediaTrackConstraintSet & {
    exposureCompensation: number;
  };
  return { advanced: [constraint] };
}

export function shouldRetryDefaultCamera(error: unknown, hadSelectedDevice: boolean): boolean {
  if (!hadSelectedDevice) return false;
  const name =
    typeof error === "object" && error && "name" in error
      ? String((error as { name?: unknown }).name || "")
      : "";
  return name === "OverconstrainedError" || name === "NotFoundError";
}

export async function getCameraStreamWithFallback(
  mediaDevices: Pick<MediaDevices, "getUserMedia">,
  selectedDeviceId?: string,
): Promise<{ stream: MediaStream; usedFallback: boolean }> {
  try {
    const stream = await mediaDevices.getUserMedia({
      video: buildVideoConstraints(selectedDeviceId),
      audio: false,
    });
    return { stream, usedFallback: false };
  } catch (error) {
    if (!shouldRetryDefaultCamera(error, Boolean(selectedDeviceId))) throw error;
    const stream = await mediaDevices.getUserMedia({
      video: buildVideoConstraints(),
      audio: false,
    });
    return { stream, usedFallback: true };
  }
}
