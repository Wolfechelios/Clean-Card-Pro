import { useState, useEffect, useCallback } from "react";

export type LensType = "wide" | "ultrawide" | "telephoto" | "macro" | "depth" | "standard" | "usb" | "unknown";

export interface CameraDevice {
  deviceId: string;
  label: string;
  isUSB: boolean;
  lensType: LensType;
  lensLabel: string;
}

/**
 * Classify a rear camera lens based on its label and capabilities.
 * Mobile OS labels vary: Android often includes focal-length hints,
 * iOS uses generic "Back Camera" with index hints.
 */
function classifyLens(label: string, index: number, totalRear: number): { lensType: LensType; lensLabel: string } {
  const l = label.toLowerCase();

  // Explicit label matches (Android often exposes these)
  if (l.includes("ultrawide") || l.includes("ultra-wide") || l.includes("ultra wide")) {
    return { lensType: "ultrawide", lensLabel: "Ultra Wide" };
  }
  if (l.includes("telephoto") || l.includes("tele")) {
    return { lensType: "telephoto", lensLabel: "Telephoto" };
  }
  if (l.includes("macro")) {
    return { lensType: "macro", lensLabel: "Macro" };
  }
  if (l.includes("depth")) {
    return { lensType: "depth", lensLabel: "Depth" };
  }
  if (l.includes("wide") && !l.includes("ultra")) {
    return { lensType: "wide", lensLabel: "Wide" };
  }

  // Focal-length hints (some Android devices include mm values)
  const focalMatch = l.match(/(\d+(?:\.\d+)?)\s*mm/);
  if (focalMatch) {
    const focal = parseFloat(focalMatch[1]);
    if (focal <= 16) return { lensType: "ultrawide", lensLabel: `Ultra Wide (${focal}mm)` };
    if (focal <= 35) return { lensType: "wide", lensLabel: `Wide (${focal}mm)` };
    if (focal >= 50) return { lensType: "telephoto", lensLabel: `Telephoto (${focal}mm)` };
  }

  // Positional heuristic for multi-lens phones (iOS "Back Camera 0/1/2")
  // Common ordering: 0=wide, 1=ultrawide, 2=telephoto (iPhone Pro style)
  if (totalRear >= 3) {
    if (index === 0) return { lensType: "wide", lensLabel: "Wide (Main)" };
    if (index === 1) return { lensType: "ultrawide", lensLabel: "Ultra Wide" };
    if (index === 2) return { lensType: "telephoto", lensLabel: "Telephoto" };
    if (index === 3) return { lensType: "macro", lensLabel: "Macro / Depth" };
  } else if (totalRear === 2) {
    if (index === 0) return { lensType: "wide", lensLabel: "Wide (Main)" };
    if (index === 1) return { lensType: "ultrawide", lensLabel: "Ultra Wide" };
  }

  return { lensType: "standard", lensLabel: "Standard" };
}

type FacingModeGuess = "user" | "environment" | "unknown";

function getFacingFromLabel(label: string): FacingModeGuess {
  const l = label.toLowerCase();
  if (l.includes("front") || l.includes("facetime") || l.includes("selfie") || l.includes("user")) {
    return "user";
  }
  if (l.includes("back") || l.includes("rear") || l.includes("environment") || l.includes("world")) {
    return "environment";
  }
  return "unknown";
}

interface ProbeResult {
  facing: FacingModeGuess;
  maxResolution: number; // width * height from capabilities
}

async function probeDeviceFacingMode(deviceId: string): Promise<ProbeResult> {
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: { exact: deviceId },
        width: { ideal: 320 },
        height: { ideal: 240 },
      },
      audio: false,
    });

    const track = stream.getVideoTracks()[0];
    const settingsFacing = track?.getSettings?.().facingMode;

    // Get max resolution from capabilities for heuristic use
    const capabilities = (track as any)?.getCapabilities?.();
    const maxWidth = capabilities?.width?.max ?? 0;
    const maxHeight = capabilities?.height?.max ?? 0;
    const maxResolution = maxWidth * maxHeight;

    if (settingsFacing === "user" || settingsFacing === "environment") {
      return { facing: settingsFacing, maxResolution };
    }

    const capFacingModes = Array.isArray(capabilities?.facingMode)
      ? capabilities.facingMode
      : [];

    const hasEnvironment = capFacingModes.includes("environment");
    const hasUser = capFacingModes.includes("user");

    if (hasEnvironment && hasUser) return { facing: "unknown", maxResolution };
    if (hasUser) return { facing: "user", maxResolution };
    if (hasEnvironment) return { facing: "environment", maxResolution };

    return { facing: "unknown", maxResolution };
  } catch {
    return { facing: "unknown", maxResolution: 0 };
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
  }
}

function isRearCamera(label: string, facingMode: FacingModeGuess = "unknown"): boolean {
  if (facingMode === "environment") return true;
  if (facingMode === "user") return false;
  return getFacingFromLabel(label) === "environment";
}

function isUSBDevice(label: string): boolean {
  const l = label.toLowerCase();

  // Never classify explicitly front/back mobile lenses as USB cameras.
  if (
    l.includes("front") ||
    l.includes("back") ||
    l.includes("rear") ||
    l.includes("facetime") ||
    l.includes("selfie") ||
    l.includes("user")
  ) {
    return false;
  }

  return (
    l.includes("usb") ||
    l.includes("webcam") ||
    l.includes("droidcam") ||
    l.includes("iriun") ||
    l.includes("camo") ||
    l.includes("epoccam") ||
    l.includes("continuity camera") ||
    (!l.includes("integrated") && !l.includes("camera"))
  );
}

interface UseCameraDevicesOptions {
  allowUnknownAsRear?: boolean;
}

export const useCameraDevices = ({ allowUnknownAsRear }: UseCameraDevicesOptions = {}) => {
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);

  const refreshDevices = useCallback(async () => {
    try {
      setIsLoading(true);

      // Request permission first to get device labels
      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
        tempStream.getTracks().forEach(track => track.stop());
      } catch (e) {
        console.log("Initial permission request:", e);
      }

      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = allDevices.filter(device => device.kind === "videoinput");

      const shouldAllowUnknownAsRear = allowUnknownAsRear !== false || videoInputs.length === 1;

      // Probe each device to reliably remove front-facing cameras on multi-lens phones.
      const probeResults = await Promise.all(
        videoInputs.map(async (device) => {
          const label = device.label || `Camera ${device.deviceId.slice(0, 8)}`;
          const fromLabel = getFacingFromLabel(label);
          if (fromLabel !== "unknown") return { facing: fromLabel, maxResolution: 0 } as ProbeResult;
          return probeDeviceFacingMode(device.deviceId);
        })
      );

      // Resolution-based heuristic: if ALL probed cameras are "unknown" facing,
      // use resolution to discriminate front vs rear. Front cameras are typically
      // much lower resolution than rear cameras (e.g. 5MP vs 50MP).
      const unknownDevices = probeResults.filter(p => p.facing === "unknown" && p.maxResolution > 0);
      if (unknownDevices.length >= 2) {
        const maxRes = Math.max(...unknownDevices.map(p => p.maxResolution));
        const FRONT_CAMERA_THRESHOLD = 0.35; // front cam is usually <35% of rear max resolution
        for (const probe of probeResults) {
          if (probe.facing === "unknown" && probe.maxResolution > 0) {
            if (probe.maxResolution < maxRes * FRONT_CAMERA_THRESHOLD) {
              probe.facing = "user"; // classify low-res unknown as front camera
            }
          }
        }
      }

      // Separate rear cameras for positional classification
      const rearIndices: number[] = [];
      videoInputs.forEach((d, i) => {
        const label = d.label || `Camera ${d.deviceId.slice(0, 8)}`;
        const usb = isUSBDevice(label);
        const facing = probeResults[i]?.facing ?? "unknown";
        const rear = isRearCamera(label, facing) || (facing === "unknown" && shouldAllowUnknownAsRear);
        if (rear && !usb) rearIndices.push(i);
      });

      let rearCounter = 0;
      const videoDevices: CameraDevice[] = videoInputs.map((device, i) => {
        const label = device.label || `Camera ${device.deviceId.slice(0, 8)}`;
        const usb = isUSBDevice(label);
        const facing = probeResults[i]?.facing ?? "unknown";
        const rear = isRearCamera(label, facing) || (facing === "unknown" && shouldAllowUnknownAsRear);

        let lensType: LensType = "unknown";
        let lensLabel = label;

        if (usb) {
          lensType = "usb";
          lensLabel = label;
        } else if (rear) {
          const classification = classifyLens(label, rearCounter, rearIndices.length);
          lensType = classification.lensType;
          lensLabel = classification.lensLabel;
          rearCounter++;
        }

        // Skip front cameras entirely
        if (!rear && !usb) {
          return null;
        }

        return {
          deviceId: device.deviceId,
          label,
          isUSB: usb,
          lensType,
          lensLabel,
        };
      }).filter(Boolean) as CameraDevice[];

      setDevices(videoDevices);

      // Auto-select main wide lens or first device
      setSelectedDeviceId(prev => {
        if (prev && videoDevices.some(d => d.deviceId === prev)) return prev;
        if (videoDevices.length === 0) return "";
        const mainLens = videoDevices.find(d => d.lensType === "wide") || videoDevices[0];
        return mainLens.deviceId;
      });
    } catch (error) {
      console.error("Error enumerating devices:", error);
    } finally {
      setIsLoading(false);
    }
  }, [allowUnknownAsRear]);

  useEffect(() => {
    refreshDevices();

    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", refreshDevices);
    };
  }, [refreshDevices]);

  return {
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    isLoading,
    refreshDevices,
  };
};
