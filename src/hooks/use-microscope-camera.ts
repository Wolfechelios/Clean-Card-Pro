import { useState, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { isMicroscopeDevice, measureSharpness, MicroscopeDevice } from "@/lib/microscope/types";
import { getScannerSettings } from "@/hooks/use-scanner-settings";

export type ResolutionPreset = "max" | "4k" | "1080p" | "720p";

export const RESOLUTION_PRESETS: { value: ResolutionPreset; label: string; width: number; height: number }[] = [
  { value: "max", label: "Max (10MP+)", width: 4000, height: 3000 },
  { value: "4k", label: "4K UHD", width: 3840, height: 2160 },
  { value: "1080p", label: "1080p", width: 1920, height: 1080 },
  { value: "720p", label: "720p (Fast)", width: 1280, height: 720 },
];

export function useMicroscopeCamera() {
  const [devices, setDevices] = useState<MicroscopeDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [cameraReady, setCameraReady] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [sharpness, setSharpness] = useState(0);
  const [resolution, setResolution] = useState({ width: 0, height: 0 });
  const [resolutionPreset, setResolutionPreset] = useState<ResolutionPreset>("max");

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sharpnessIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const refreshDevices = useCallback(async () => {
    try {
      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
        tempStream.getTracks().forEach(t => t.stop());
      } catch { /* permission already granted or denied */ }

      const allDevices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = allDevices.filter(d => d.kind === "videoinput");

      const mapped: MicroscopeDevice[] = videoInputs.map(d => ({
        deviceId: d.deviceId,
        label: d.label || `Camera ${d.deviceId.slice(0, 8)}`,
        isMicroscope: isMicroscopeDevice(d.label || ""),
      }));

      // Sort: microscopes first
      mapped.sort((a, b) => (b.isMicroscope ? 1 : 0) - (a.isMicroscope ? 1 : 0));
      setDevices(mapped);

      // Auto-select saved or first microscope
      const settings = getScannerSettings();
      const savedId = (settings as any).preferredMicroscopeDeviceId;
      if (savedId && mapped.some(d => d.deviceId === savedId)) {
        setSelectedDeviceId(savedId);
      } else {
        const micro = mapped.find(d => d.isMicroscope);
        if (micro) setSelectedDeviceId(micro.deviceId);
        else if (mapped.length > 0) setSelectedDeviceId(mapped[0].deviceId);
      }
    } catch (err) {
      console.error("Failed to enumerate microscope devices:", err);
    }
  }, []);

  const startCamera = useCallback(async (deviceId?: string, preset?: ResolutionPreset) => {
    try {
      setCameraError(null);
      setIsInitializing(true);

      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }

      const targetId = deviceId || selectedDeviceId;
      if (!targetId) throw new Error("No device selected");

      const activePreset = preset || resolutionPreset;
      const presetConfig = RESOLUTION_PRESETS.find(p => p.value === activePreset) || RESOLUTION_PRESETS[0];

      // Build constraint sets starting from the selected preset downward
      const allPresets = RESOLUTION_PRESETS;
      const startIdx = allPresets.findIndex(p => p.value === activePreset);
      const constraintSets = allPresets.slice(startIdx >= 0 ? startIdx : 0).map(p => ({
        video: { deviceId: { exact: targetId }, width: { ideal: p.width }, height: { ideal: p.height }, frameRate: { ideal: activePreset === "max" ? 15 : 30 } },
        audio: false as const,
      }));
      // Always add a bare fallback
      constraintSets.push({ video: { deviceId: targetId } as any, audio: false as const });

      let stream: MediaStream | null = null;
      for (const c of constraintSets) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(c);
          break;
        } catch { continue; }
      }

      if (!stream) throw new Error("Failed to access microscope camera");
      if (!videoRef.current) throw new Error("Video element not ready");

      videoRef.current.srcObject = stream;
      videoRef.current.playsInline = true;
      videoRef.current.autoplay = true;
      videoRef.current.muted = true;

      await new Promise<void>((resolve) => {
        if (!videoRef.current) return resolve();
        videoRef.current.onloadedmetadata = () => resolve();
        setTimeout(resolve, 5000);
      });

      try { await videoRef.current.play(); } catch { /* needs interaction */ }

      streamRef.current = stream;
      const vw = videoRef.current.videoWidth;
      const vh = videoRef.current.videoHeight;
      setResolution({ width: vw, height: vh });
      setCameraReady(true);
      setIsInitializing(false);

      const dev = devices.find(d => d.deviceId === targetId);
      toast.success(`Microscope connected: ${dev?.label || "External Camera"} (${vw}×${vh})`);
    } catch (error: any) {
      setIsInitializing(false);
      setCameraReady(false);
      const msg = error.message || "Failed to access microscope";
      setCameraError(msg);
      toast.error(msg);
    }
  }, [selectedDeviceId, devices, resolutionPreset]);

  const changeResolution = useCallback(async (preset: ResolutionPreset) => {
    setResolutionPreset(preset);
    if (cameraReady && selectedDeviceId) {
      await startCamera(selectedDeviceId, preset);
    }
  }, [cameraReady, selectedDeviceId, startCamera]);

  const stopCamera = useCallback(() => {
    if (sharpnessIntervalRef.current) {
      clearInterval(sharpnessIntervalRef.current);
      sharpnessIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
    setCameraError(null);
    setSharpness(0);
  }, []);

  // Live sharpness meter
  useEffect(() => {
    if (!cameraReady || !videoRef.current) return;

    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
    }

    sharpnessIntervalRef.current = setInterval(() => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas || video.readyState < 2) return;

      canvas.width = Math.min(video.videoWidth, 640);
      canvas.height = Math.min(video.videoHeight, 480);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const s = measureSharpness(canvas);
      setSharpness(s);
    }, 500);

    return () => {
      if (sharpnessIntervalRef.current) {
        clearInterval(sharpnessIntervalRef.current);
        sharpnessIntervalRef.current = null;
      }
    };
  }, [cameraReady]);

  const capturePhoto = useCallback(async (): Promise<File | null> => {
    if (!videoRef.current || !cameraReady) {
      toast.error("Microscope not ready");
      return null;
    }

    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return null;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error("Blob failed")), "image/png");
    });

    return new File([blob], `microscope-${Date.now()}.png`, { type: "image/png" });
  }, [cameraReady]);

  useEffect(() => {
    refreshDevices();
    navigator.mediaDevices.addEventListener("devicechange", refreshDevices);
    return () => {
      navigator.mediaDevices.removeEventListener("devicechange", refreshDevices);
      stopCamera();
    };
  }, [refreshDevices, stopCamera]);

  return {
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    cameraReady,
    isInitializing,
    cameraError,
    sharpness,
    resolution,
    resolutionPreset,
    videoRef,
    startCamera,
    stopCamera,
    capturePhoto,
    refreshDevices,
    changeResolution,
  };
}
