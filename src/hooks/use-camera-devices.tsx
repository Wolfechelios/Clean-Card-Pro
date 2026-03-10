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

async function probeDeviceFacingMode(deviceId: string): Promise<FacingModeGuess> {
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

    if (settingsFacing === "user" || settingsFacing === "environment") {
      return settingsFacing;
    }

    const capabilities = (track as any)?.getCapabilities?.();
    const capFacingModes = Array.isArray(capabilities?.facingMode)
      ? capabilities.facingMode
      : [];

    const hasEnvironment = capFacingModes.includes("environment");
    const hasUser = capFacingModes.includes("user");

    // Some devices expose both values in capabilities for every camera.
    // Treat ambiguous capability data as unknown instead of defaulting to rear.
    if (hasEnvironment && hasUser) return "unknown";
    if (hasUser) return "user";
    if (hasEnvironment) return "environment";

    return "unknown";
  } catch {
    return "unknown";
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

      const shouldAllowUnknownAsRear = allowUnknownAsRear ?? videoInputs.length === 1;

      // Probe each device to reliably remove front-facing cameras on multi-lens phones.
      const deviceFacingModes = await Promise.all(
        videoInputs.map(async (device) => {
          const label = device.label || `Camera ${device.deviceId.slice(0, 8)}`;
          const fromLabel = getFacingFromLabel(label);
          if (fromLabel !== "unknown") return fromLabel;
          return probeDeviceFacingMode(device.deviceId);
        })
      );

      // Separate rear cameras for positional classification
      const rearIndices: number[] = [];
      videoInputs.forEach((d, i) => {
        const label = d.label || `Camera ${d.deviceId.slice(0, 8)}`;
        const usb = isUSBDevice(label);
        const facingMode = deviceFacingModes[i] ?? "unknown";
        const rear = isRearCamera(label, facingMode) || (facingMode === "unknown" && shouldAllowUnknownAsRear);
        if (rear && !usb) rearIndices.push(i);
      });

      let rearCounter = 0;
      const videoDevices: CameraDevice[] = videoInputs.map((device, i) => {
        const label = device.label || `Camera ${device.deviceId.slice(0, 8)}`;
        const usb = isUSBDevice(label);
        const facingMode = deviceFacingModes[i] ?? "unknown";
        const rear = isRearCamera(label, facingMode) || (facingMode === "unknown" && allowUnknownAsRear);

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
  }, []);

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
