import { useState, useEffect, useCallback } from "react";

export interface CameraDevice {
  deviceId: string;
  label: string;
  isUSB: boolean;
}

export const useCameraDevices = () => {
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
      const videoDevices = allDevices
        .filter(device => device.kind === "videoinput")
        .map(device => {
          const label = device.label || `Camera ${device.deviceId.slice(0, 8)}`;
          // Detect USB cameras by common naming patterns
          const isUSB = 
            label.toLowerCase().includes("usb") ||
            label.toLowerCase().includes("phone") ||
            label.toLowerCase().includes("android") ||
            label.toLowerCase().includes("iphone") ||
            label.toLowerCase().includes("webcam") ||
            label.toLowerCase().includes("droidcam") ||
            label.toLowerCase().includes("iriun") ||
            label.toLowerCase().includes("camo") ||
            label.toLowerCase().includes("epoccam") ||
            (!label.toLowerCase().includes("front") && 
             !label.toLowerCase().includes("back") &&
             !label.toLowerCase().includes("facetime") &&
             !label.toLowerCase().includes("integrated"));

          return {
            deviceId: device.deviceId,
            label,
            isUSB,
          };
        });

      setDevices(videoDevices);
      
      // Auto-select first USB device if available, otherwise first device
      // Only auto-select if no device is currently selected
      setSelectedDeviceId(prev => {
        if (prev) return prev; // Keep existing selection
        if (videoDevices.length === 0) return "";
        const usbDevice = videoDevices.find(d => d.isUSB);
        return usbDevice?.deviceId || videoDevices[0].deviceId;
      });
    } catch (error) {
      console.error("Error enumerating devices:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshDevices();
    
    // Listen for device changes (plug/unplug)
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
