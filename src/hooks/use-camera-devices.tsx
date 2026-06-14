import { useState, useEffect, useCallback } from "react";

export type LensType =
  | "wide"
  | "ultrawide"
  | "telephoto"
  | "macro"
  | "depth"
  | "standard"
  | "usb"
  | "continuity"
  | "epoccam"
  | "droidcam"
  | "iriun"
  | "unknown";

function isBlockedCameraLabel(label: string): boolean {
  const normalized = label.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  return normalized.includes("camo") || normalized.includes("reincubate");
}

function classifyPhoneCam(label: string): { lensType: LensType; lensLabel: string } | null {
  const l = label.toLowerCase();
  if (l.includes("continuity") || l.includes("desk view")) {
    return { lensType: "continuity", lensLabel: "Continuity Camera" };
  }
  if (l.includes("epoccam")) return { lensType: "epoccam", lensLabel: "EpocCam" };
  if (l.includes("droidcam")) return { lensType: "droidcam", lensLabel: "DroidCam" };
  if (l.includes("iriun")) return { lensType: "iriun", lensLabel: "Iriun Webcam" };
  return null;
}

export interface CameraDevice {
  deviceId: string;
  label: string;
  isUSB: boolean;
  lensType: LensType;
  lensLabel: string;
}

function classifyLens(label: string, index: number, totalRear: number): { lensType: LensType; lensLabel: string } {
  const l = label.toLowerCase();
  if (l.includes("ultrawide") || l.includes("ultra-wide") || l.includes("ultra wide")) {
    return { lensType: "ultrawide", lensLabel: "Ultra Wide" };
  }
  if (l.includes("telephoto") || l.includes("tele")) return { lensType: "telephoto", lensLabel: "Telephoto" };
  if (l.includes("macro")) return { lensType: "macro", lensLabel: "Macro" };
  if (l.includes("depth")) return { lensType: "depth", lensLabel: "Depth" };
  if (l.includes("wide") && !l.includes("ultra")) return { lensType: "wide", lensLabel: "Wide" };

  const focalMatch = l.match(/(\d+(?:\.\d+)?)\s*mm/);
  if (focalMatch) {
    const focal = parseFloat(focalMatch[1]);
    if (focal <= 16) return { lensType: "ultrawide", lensLabel: `Ultra Wide (${focal}mm)` };
    if (focal <= 35) return { lensType: "wide", lensLabel: `Wide (${focal}mm)` };
    if (focal >= 50) return { lensType: "telephoto", lensLabel: `Telephoto (${focal}mm)` };
  }

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

function isRearCamera(label: string): boolean {
  const l = label.toLowerCase();
  if (l.includes("front") || l.includes("facetime") || l.includes("selfie") || l.includes("user")) return false;
  if (l.includes("back") || l.includes("rear") || l.includes("environment")) return true;
  return true;
}

function isUSBDevice(label: string, isIOS = false): boolean {
  const l = label.toLowerCase();
  if (isIOS) return false;
  return (
    l.includes("usb") ||
    l.includes("phone") ||
    l.includes("android") ||
    l.includes("iphone") ||
    l.includes("ipad") ||
    l.includes("continuity") ||
    l.includes("desk view") ||
    l.includes("webcam") ||
    l.includes("droidcam") ||
    l.includes("iriun") ||
    l.includes("epoccam") ||
    (!l.includes("front") &&
      !l.includes("back") &&
      !l.includes("facetime") &&
      !l.includes("integrated") &&
      !l.includes("camera"))
  );
}

function isIOSWebKitLike(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export const useCameraDevices = () => {
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  const [selectedDeviceIdState, setSelectedDeviceIdState] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const isIOS = isIOSWebKitLike();
  const selectedDeviceId = isIOS ? "" : selectedDeviceIdState;

  const setSelectedDeviceId = useCallback((deviceId: string) => {
    if (isIOSWebKitLike()) {
      setSelectedDeviceIdState("");
      return;
    }
    setSelectedDeviceIdState(deviceId);
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      setIsLoading(true);
      const onIOS = isIOSWebKitLike();

      if (!onIOS) {
        try {
          const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
          tempStream.getTracks().forEach((track) => track.stop());
        } catch (error) {
          console.log("Initial permission request:", error);
        }
      }

      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = allDevices.filter((device) => {
        if (device.kind !== "videoinput") return false;
        return !isBlockedCameraLabel(device.label || "");
      });
      const rearIndices: number[] = [];
      videoInputs.forEach((device, index) => {
        const label = device.label || `Camera ${device.deviceId.slice(0, 8) || index + 1}`;
        if (isRearCamera(label)) rearIndices.push(index);
      });

      let rearCounter = 0;
      const videoDevices = videoInputs.map((device, index) => {
        const label = device.label || `Camera ${device.deviceId.slice(0, 8) || index + 1}`;
        if (isBlockedCameraLabel(label)) return null;

        const usb = isUSBDevice(label, onIOS);
        const rear = isRearCamera(label);
        let lensType: LensType = "unknown";
        let lensLabel = label;

        if (usb) {
          const phoneCam = classifyPhoneCam(label);
          lensType = phoneCam?.lensType || "usb";
          lensLabel = phoneCam?.lensLabel || label;
        } else if (rear) {
          const classification = classifyLens(label, rearCounter, rearIndices.length);
          lensType = classification.lensType;
          lensLabel = classification.lensLabel;
          rearCounter += 1;
        }

        if (!rear && !usb) return null;
        return { deviceId: device.deviceId, label, isUSB: usb, lensType, lensLabel };
      }).filter(Boolean) as CameraDevice[];

      setDevices((previous) => {
        const signature = (items: CameraDevice[]) => items.map((device) => `${device.deviceId}|${device.label}`).sort().join("~~");
        return signature(previous) === signature(videoDevices) ? previous : videoDevices;
      });

      setSelectedDeviceIdState((previous) => {
        if (onIOS) return "";
        if (previous && videoDevices.some((device) => device.deviceId === previous)) return previous;
        if (!videoDevices.length) return "";
        return (videoDevices.find((device) => device.lensType === "wide") || videoDevices[0]).deviceId;
      });
    } catch (error) {
      console.error("Error enumerating devices:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshDevices();
    const mediaDevices = navigator.mediaDevices;
    mediaDevices?.addEventListener?.("devicechange", refreshDevices);
    const onFocus = () => refreshDevices();
    const onVisibility = () => {
      if (document.visibilityState === "visible") refreshDevices();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    const poll = isIOSWebKitLike()
      ? null
      : window.setInterval(() => {
          if (document.visibilityState === "visible") refreshDevices();
        }, 4000);

    return () => {
      mediaDevices?.removeEventListener?.("devicechange", refreshDevices);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      if (poll != null) window.clearInterval(poll);
    };
  }, [refreshDevices]);

  return { devices, selectedDeviceId, setSelectedDeviceId, isLoading, refreshDevices };
};
