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

// Extended fallback ladder for high-res microscopes
const HIGH_RES_FALLBACKS = [
  { width: 4000, height: 3000 },  // 12MP
  { width: 3840, height: 2880 },  // ~11MP
  { width: 3648, height: 2736 },  // 10MP
  { width: 3264, height: 2448 },  // 8MP
  { width: 2592, height: 1944 },  // 5MP
  { width: 2048, height: 1536 },  // 3MP
];

export interface ActualResolution {
  width: number;
  height: number;
}

export interface DeviceCapabilities {
  maxWidth: number;
  maxHeight: number;
}

export function useMicroscopeCamera() {
  const [devices, setDevices] = useState<MicroscopeDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");
  const [cameraReady, setCameraReady] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [sharpness, setSharpness] = useState(0);
  const [requestedResolution, setRequestedResolution] = useState<ActualResolution>({ width: 0, height: 0 });
  const [actualResolution, setActualResolution] = useState<ActualResolution>({ width: 0, height: 0 });
  const [deviceCapabilities, setDeviceCapabilities] = useState<DeviceCapabilities | null>(null);
  const [resolutionPreset, setResolutionPreset] = useState<ResolutionPreset>("max");
  const [fellBack, setFellBack] = useState(false);

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

      mapped.sort((a, b) => (b.isMicroscope ? 1 : 0) - (a.isMicroscope ? 1 : 0));
      setDevices(mapped);

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

  const buildConstraintSets = useCallback((targetId: string, preset: ResolutionPreset) => {
    const sets: Array<{ video: MediaTrackConstraints; audio: false }> = [];

    if (preset === "max") {
      // Try each high-res fallback with exact width/height first, then ideal
      for (const res of HIGH_RES_FALLBACKS) {
        sets.push({
          video: {
            deviceId: { exact: targetId },
            width: { exact: res.width },
            height: { exact: res.height },
            frameRate: { ideal: 15 },
          },
          audio: false,
        });
      }
      // Then ideal-based fallbacks
      for (const res of HIGH_RES_FALLBACKS) {
        sets.push({
          video: {
            deviceId: { exact: targetId },
            width: { ideal: res.width },
            height: { ideal: res.height },
            frameRate: { ideal: 15 },
          },
          audio: false,
        });
      }
    } else {
      const presetConfig = RESOLUTION_PRESETS.find(p => p.value === preset);
      if (presetConfig) {
        // Try exact first
        sets.push({
          video: {
            deviceId: { exact: targetId },
            width: { exact: presetConfig.width },
            height: { exact: presetConfig.height },
            frameRate: { ideal: 30 },
          },
          audio: false,
        });
        // Then ideal
        sets.push({
          video: {
            deviceId: { exact: targetId },
            width: { ideal: presetConfig.width },
            height: { ideal: presetConfig.height },
            frameRate: { ideal: 30 },
          },
          audio: false,
        });
      }
    }

    // Add remaining presets as fallbacks
    const allPresets = RESOLUTION_PRESETS;
    const startIdx = allPresets.findIndex(p => p.value === preset);
    for (let i = (startIdx >= 0 ? startIdx + 1 : 1); i < allPresets.length; i++) {
      sets.push({
        video: {
          deviceId: { exact: targetId },
          width: { ideal: allPresets[i].width },
          height: { ideal: allPresets[i].height },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });
    }

    // Bare fallback
    sets.push({ video: { deviceId: targetId } as any, audio: false });

    return sets;
  }, []);

  const readTrackResolution = useCallback((stream: MediaStream) => {
    const track = stream.getVideoTracks()[0];
    if (!track) return { width: 0, height: 0, caps: null };

    const settings = track.getSettings();
    const actual = { width: settings.width || 0, height: settings.height || 0 };

    let caps: DeviceCapabilities | null = null;
    if (track.getCapabilities) {
      try {
        const c = track.getCapabilities();
        if (c.width && c.height) {
          const maxW = typeof c.width === "object" ? (c.width as any).max || 0 : 0;
          const maxH = typeof c.height === "object" ? (c.height as any).max || 0 : 0;
          if (maxW > 0 && maxH > 0) {
            caps = { maxWidth: maxW, maxHeight: maxH };
          }
        }
      } catch { /* getCapabilities not supported */ }
    }

    return { ...actual, caps };
  }, []);

  const startCamera = useCallback(async (deviceId?: string, preset?: ResolutionPreset) => {
    try {
      setCameraError(null);
      setIsInitializing(true);
      setFellBack(false);

      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }

      const targetId = deviceId || selectedDeviceId;
      if (!targetId) throw new Error("No device selected");

      const activePreset = preset || resolutionPreset;
      const presetConfig = RESOLUTION_PRESETS.find(p => p.value === activePreset) || RESOLUTION_PRESETS[0];
      setRequestedResolution({ width: presetConfig.width, height: presetConfig.height });

      const constraintSets = buildConstraintSets(targetId, activePreset);

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

      // Read actual resolution from track.getSettings()
      const { width: tw, height: th, caps } = readTrackResolution(stream);
      const vw = tw || videoRef.current.videoWidth;
      const vh = th || videoRef.current.videoHeight;

      setActualResolution({ width: vw, height: vh });
      if (caps) setDeviceCapabilities(caps);

      // Detect if we fell back below the requested resolution
      if (vw < presetConfig.width || vh < presetConfig.height) {
        setFellBack(true);
      }

      setCameraReady(true);
      setIsInitializing(false);

      const dev = devices.find(d => d.deviceId === targetId);
      toast.success(`Microscope connected: ${dev?.label || "External Camera"} (${vw}×${vh})`);

      // Re-read after a short delay in case the track renegotiates
      setTimeout(() => {
        if (streamRef.current) {
          const updated = readTrackResolution(streamRef.current);
          const uw = updated.width || vw;
          const uh = updated.height || vh;
          if (uw !== vw || uh !== vh) {
            setActualResolution({ width: uw, height: uh });
            setFellBack(uw < presetConfig.width || uh < presetConfig.height);
          }
        }
      }, 1500);
    } catch (error: any) {
      setIsInitializing(false);
      setCameraReady(false);
      const msg = error.message || "Failed to access microscope";
      setCameraError(msg);
      toast.error(msg);
    }
  }, [selectedDeviceId, devices, resolutionPreset, buildConstraintSets, readTrackResolution]);

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
    setActualResolution({ width: 0, height: 0 });
    setRequestedResolution({ width: 0, height: 0 });
    setDeviceCapabilities(null);
    setFellBack(false);
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
    resolution: actualResolution,
    requestedResolution,
    actualResolution,
    deviceCapabilities,
    fellBack,
    resolutionPreset,
    videoRef,
    startCamera,
    stopCamera,
    capturePhoto,
    refreshDevices,
    changeResolution,
  };
}
