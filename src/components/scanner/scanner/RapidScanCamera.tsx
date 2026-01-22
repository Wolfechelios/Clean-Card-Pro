// src/components/scanner/RapidScanCamera.tsx
// Rapid Scan (simple + stable): manual capture only (no auto-capture, no sliders).
// Features:
// - Clear, high-res photo capture from live camera preview
// - Zoom controls (if supported) + tap-to-focus (if supported)
// - Flash/torch toggle (if supported)
// - Persistent queue buffer (IndexedDB) so you can keep shooting while jobs process
// - Live "now scanning" preview overlay + running total value
// - List of scanned cards with price + whether it's already in your library

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Camera,
  CameraOff,
  Flashlight,
  FlashlightOff,
  Loader2,
  Trash2,
  Timer,
  TimerOff,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { insertCardDual } from "@/lib/localCards";
import {
  detectSupport,
  getVideoTrack,
  setFocusPoint,
  setTorch,
  setWhiteBalance,
  type MediaSupport,
} from "@/lib/mediaControls";
import {
  idbAdd,
  idbCount,
  idbDelete,
  idbGetAllMeta,
  idbClear,
  type QueueItemMeta,
} from "@/lib/idbQueue";
import { useQueueProcessor } from "@/lib/queueProcessor";
import { useCameraZoom } from "@/hooks/use-camera-zoom";
import { ZoomControls } from "./ZoomControls";
import { ScannedCardList } from "./ScannedCardList";
import { useNativeCamera } from "@/hooks/use-native-camera";
import { useGlobalProcessControl } from "@/hooks/use-global-process-control";
import { getScannerSettings, useScannerSettings } from "@/hooks/use-scanner-settings";
import { hapticTap } from "@/lib/haptics";
import { useVoiceCommand } from "@/hooks/use-voice-command";
import { captureWithPipeline } from "@/lib/capturePipeline";

// ─────────────────────────────────────────────────────────────────────────────
// TUNING
// ─────────────────────────────────────────────────────────────────────────────

const MAX_UI_CARDS = 120;
const QUEUE_MAX = 500; // large buffer - uses IndexedDB (device storage)

type ScannedCard = {
  id: string;
  preview: string;
  status: "queued" | "uploading" | "processing" | "completed" | "error";
  cardName?: string;
  cardSet?: string;
  cardNumber?: string;
  rarity?: string;
  value?: number | null;
  error?: string;
  dbId?: string;
  priceFetching?: boolean;
  libraryQuantity?: number;
  isInLibrary?: boolean;
  imageUrl?: string;
};

type LastOverlay = {
  label: string;
  value?: number | null;
  isInLibrary?: boolean;
  libraryQuantity?: number;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function safeUUID() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxx-xxxx-xxxx".replace(/x/g, () => ((Math.random() * 16) | 0).toString(16));
}

function money(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return null;
  return Math.round(n * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function RapidScanCamera() {
  const { settings, updateSettings } = useScannerSettings();

  // Camera
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const startingCameraRef = useRef(false);

  const [cameraOn, setCameraOn] = useState(false);
  const [support, setSupport] = useState<MediaSupport>({ torch: false, focus: false, zoom: false });
  const [torchOn, setTorchOn] = useState(false);
  const [statusLine, setStatusLine] = useState("Tap Start to begin");
  const [busyCapture, setBusyCapture] = useState(false);

  // Capture UX
  const [flashActive, setFlashActive] = useState(false);

  // Auto-timer
  const [autoTimerActive, setAutoTimerActive] = useState(false);
  const autoTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [autoTimerCountdown, setAutoTimerCountdown] = useState(0);

  // Auto-focus assist pulse
  const autoFocusRef = useRef<NodeJS.Timeout | null>(null);

  const autoTimerSeconds = settings.autoTimerIntervalSeconds ?? 2;

  const triggerFlash = useCallback(() => {
    if (!settings.flashOnCapture) return;
    setFlashActive(true);
    window.setTimeout(() => setFlashActive(false), 240);
  }, [settings.flashOnCapture]);

  const triggerHaptics = useCallback(() => {
    if (!settings.hapticsOnCapture) return;
    hapticTap(25);
  }, [settings.hapticsOnCapture]);

  // Auth/user
  const [userId, setUserId] = useState<string | null>(null);

  // Native camera for rapid scan
  const { isNative, takePhoto } = useNativeCamera();

  const captureNow = useCallback(async () => {
    if (busyCapture) return;
    if (isNative) {
      await captureWithNativeCamera();
      return;
    }
    if (!cameraOn) return;
    await captureAndEnqueue();
  }, [busyCapture, isNative, cameraOn]);

  const voice = useVoiceCommand({
    enabled: settings.voiceCaptureEnabled && (isNative || cameraOn),
    keyword: settings.voiceCaptureKeyword,
    onMatch: () => {
      // Prevent double-triggers from interim results
      captureNow();
    },
  });

  // Zoom
  const {
    zoomLevel,
    zoomCapabilities,
    usingDigitalZoom,
    detectZoomCapabilities,
    setZoom,
    zoomIn,
    zoomOut,
    resetZoom,
  } = useCameraZoom({ streamRef });

  // Queue meta for debug/health
  const [queueMeta, setQueueMeta] = useState<QueueItemMeta[]>([]);

  // UI list
  const [cards, setCards] = useState<ScannedCard[]>([]);

  // Prevent memory leaks from unreleased object URLs (common cause of crashes on mobile browsers).
  const objectUrlsRef = useRef<Set<string>>(new Set());

  const trackObjectUrl = useCallback((url: string) => {
    objectUrlsRef.current.add(url);
    return url;
  }, []);

  const revokeObjectUrl = useCallback((url?: string | null) => {
    if (!url) return;
    if (objectUrlsRef.current.has(url)) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      }
      objectUrlsRef.current.delete(url);
    }
  }, []);

  useEffect(() => {
    return () => {
      for (const url of objectUrlsRef.current) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // ignore
        }
      }
      objectUrlsRef.current.clear();
    };
  }, []);
  const cardsRef = useRef<ScannedCard[]>([]);
  const [overlay, setOverlay] = useState<LastOverlay | null>(null);

  // Global queue processor
  const queueProcessor = useQueueProcessor();

  // ───────────────────────────────────────────────────────────────────────────
  // INIT
  // ───────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    // Best-effort auth
    supabase.auth
      .getUser()
      .then(({ data }) => setUserId(data.user?.id ?? null))
      .catch(() => setUserId(null));
  }, []);

  const refreshMeta = useCallback(async () => {
    const all = await idbGetAllMeta();
    setQueueMeta(all);
  }, []);

  useEffect(() => {
    refreshMeta();
  }, [cards, refreshMeta, revokeObjectUrl]);

  useEffect(() => {
    cardsRef.current = cards;
  }, [cards]);

  // Cleanup object URLs on unmount to prevent leaks/crashes on long rapid-scan sessions
  useEffect(() => {
    return () => {
      try {
        (cardsRef.current || []).forEach((c) => {
          if (c.preview) URL.revokeObjectURL(c.preview);
        });
      } catch {
        // ignore
      }
    };
    // Intentionally run only on unmount; we revoke as we remove items too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // ───────────────────────────────────────────────────────────────────────────
  // HELPERS: STATE UPDATE
  // ───────────────────────────────────────────────────────────────────────────

  const updateCard = useCallback((id: string, patch: Partial<ScannedCard>) => {
    setCards((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        // If we got a remote imageUrl, swap preview off blob: URL to free memory.
        const next = { ...c, ...patch } as ScannedCard;
        const incomingUrl = (patch as any)?.imageUrl as string | undefined;
        if (incomingUrl && next.preview && next.preview.startsWith("blob:")) {
          try { URL.revokeObjectURL(next.preview); } catch {}
          next.preview = incomingUrl;
        }
        return next;
      })
    );
  }, []);

  const removeCard = useCallback(async (id: string) => {
    // revoke preview url to avoid leaking memory (this was a big crash source)
    setCards((prev) => {
      const found = prev.find((c) => c.id === id);
      revokeObjectUrl(found?.preview);
      return prev.filter((c) => c.id !== id);
    });
    // remove from queue if still exists
    try {
      await idbDelete(id);
    } catch {
      // ignore
    }
    await refreshMeta();
  }, [refreshMeta, revokeObjectUrl]);

  // Total value of completed cards
  const totalValue = useMemo(() => {
    return cards.reduce((sum, c) => sum + (c.status === "completed" ? c.value || 0 : 0), 0);
  }, [cards]);

  // ───────────────────────────────────────────────────────────────────────────
  // CAMERA
  // ───────────────────────────────────────────────────────────────────────────


  const measureLuma01 = useCallback((): number | null => {
    const v = videoRef.current;
    if (!v || v.readyState < 2) return null;

    // Create a tiny offscreen canvas once; downsample for speed.
    let c = lumaCanvasRef.current;
    if (!c) {
      c = document.createElement("canvas");
      c.width = 48;
      c.height = 48;
      lumaCanvasRef.current = c;
    }
    const ctx = c.getContext("2d", { willReadFrequently: true } as any);
    if (!ctx) return null;

    try {
      ctx.drawImage(v, 0, 0, c.width, c.height);
      const img = ctx.getImageData(0, 0, c.width, c.height).data;
      let sum = 0;
      // Sample every 4 pixels to keep it light.
      for (let i = 0; i < img.length; i += 16) {
        const r = img[i];
        const g = img[i + 1];
        const b = img[i + 2];
        // perceived luminance
        sum += 0.2126 * r + 0.7152 * g + 0.0722 * b;
      }
      const samples = img.length / 16;
      const avg = sum / samples; // 0..255
      return Math.max(0, Math.min(1, avg / 255));
    } catch {
      return null;
    }
  }, []);

  async function startCamera() {
    if (cameraOn || startingCameraRef.current) return;
    
    startingCameraRef.current = true;

    try {
      const constraints: MediaStreamConstraints = {
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      trackRef.current = getVideoTrack(stream);
      const sup = detectSupport(trackRef.current);
      setSupport(sup);

      // Lighting: White balance (best-effort, depends on browser/device)
      try {
        if (sup.whiteBalanceMode) {
          if (settings.whiteBalanceMode === "manual" && sup.colorTemperature) {
            await setWhiteBalance(trackRef.current, {
              mode: "manual",
              temperatureK: settings.whiteBalanceTemperatureK,
            });
          } else if (settings.whiteBalanceMode === "auto") {
            await setWhiteBalance(trackRef.current, { mode: "auto" });
          } else {
            // "continuous" is usually the most stable option when supported
            await setWhiteBalance(trackRef.current, { mode: "continuous" });
          }
        }
      } catch {
        // ignore
      }

      // Optional: manual focus lock (best-effort; many browsers ignore this)
      if (settings.manualFocusLock) {
        try {
          const track = trackRef.current;
          // Try common constraint shapes
          await track?.applyConstraints?.({ advanced: [{ focusMode: "manual" } as MediaTrackConstraintSet] });
        } catch {
          // ignore
        }
      }

      const v = videoRef.current;
      if (!v) {
        setBusyCapture(false);
        return;
      }
      if (!v) {
        startingCameraRef.current = false;
        return;
      }
      
      // Stop any existing stream first
      if (v.srcObject) {
        const oldStream = v.srcObject as MediaStream;
        oldStream.getTracks().forEach(t => t.stop());
      }
      
      v.srcObject = stream;
      
      // Wait for video to be ready before playing
      await new Promise<void>((resolve, reject) => {
        const onCanPlay = () => {
          v.removeEventListener('canplay', onCanPlay);
          v.removeEventListener('error', onError);
          resolve();
        };
        const onError = (e: Event) => {
          v.removeEventListener('canplay', onCanPlay);
          v.removeEventListener('error', onError);
          reject(new Error('Video failed to load'));
        };
        v.addEventListener('canplay', onCanPlay);
        v.addEventListener('error', onError);
        
        // If already ready, resolve immediately
        if (v.readyState >= 3) {
          v.removeEventListener('canplay', onCanPlay);
          v.removeEventListener('error', onError);
          resolve();
        }
      });
      
      // Now safe to play
      try {
        await v.play();
      } catch (playErr: any) {
        // Ignore AbortError from interrupted play - video is still working
        if (playErr?.name !== 'AbortError') {
          throw playErr;
        }
      }

      setCameraOn(true);
      setStatusLine("Camera live — tap Capture for each card");

      // Auto-focus assist: periodically refocus near center to keep cards sharp
      if (settings.autoFocusAssist && sup.focus) {
        if (autoFocusRef.current) {
          clearInterval(autoFocusRef.current);
          autoFocusRef.current = null;
        }
        autoFocusRef.current = setInterval(() => {
          const track = trackRef.current;
          if (!track) return;
          // Center focus point (0.5, 0.5)
          void setFocusPoint(track, 0.5, 0.5);
        }, 2500);
      }
      

      // Low light assist: sample frame brightness and nudge exposure/torch (best-effort)
      if (settings.lowLightAssistEnabled) {
        if (lowLightRef.current) {
          clearInterval(lowLightRef.current);
          lowLightRef.current = null;
        }
        // Set exposure mode to continuous if supported (more stable for moving light)
        if (sup.exposureMode) {
          void setExposureMode(trackRef.current, "continuous");
        }
        const caps = getExposureCompCaps(trackRef.current);
        // initialize exposureCompRef from current settings if available
        try {
          const current: any = trackRef.current?.getSettings?.() ?? {};
          if (typeof current.exposureCompensation === "number") {
            exposureCompRef.current = current.exposureCompensation;
          }
        } catch {
          // ignore
        }
        lowLightRef.current = setInterval(async () => {
          const luma = measureLuma01();
          if (luma == null) return;

          const target = Math.max(0.2, Math.min(0.85, (settings.lowLightTargetBrightness ?? 55) / 100));
          const deadband = 0.05;

          // Torch behavior: only in very low light
          if (settings.lowLightAllowTorch && sup.torch) {
            if (luma < 0.22 && !torchOn) {
              await setTorch(trackRef.current, true);
              setTorchOn(true);
            } else if (luma > 0.30 && torchOn) {
              await setTorch(trackRef.current, false);
              setTorchOn(false);
            }
          }

          // Exposure compensation nudges
          if (sup.exposureCompensation && caps) {
            const step = caps.step;
            let cur = exposureCompRef.current;
            if (typeof cur !== "number") cur = 0;
            let next = cur;
            if (luma < target - deadband) next = Math.min(caps.max, cur + step);
            if (luma > target + deadband) next = Math.max(caps.min, cur - step);
            if (next !== cur) {
              exposureCompRef.current = next;
              await setExposureCompensation(trackRef.current, next);
            }
          }
        }, 1500);
      }

      // Signal scanner active to pause expensive renders elsewhere
      useGlobalProcessControl.getState().setScannerActive(true);

      // Zoom capabilities
      detectZoomCapabilities();


      if (settings.autoZoomOnStart) {
        // Give the track a moment to report caps before applying zoom (mobile Safari can be slow).
        setTimeout(() => {
          try {
            setZoom(settings.autoZoomLevel ?? 2);
          } catch {
            // ignore
          }
        }, 200);
      }

      // Workers start automatically once you enqueue
    } catch (err: any) {
      setStatusLine(`Camera error: ${err?.message ?? err}`);
      toast.error("Camera failed to start");
    } finally {
      startingCameraRef.current = false;
    }
  }

  async function stopCamera() {
    if (lowLightRef.current) {
      clearInterval(lowLightRef.current);
      lowLightRef.current = null;
    }
    if (autoFocusRef.current) {
      clearInterval(autoFocusRef.current);
      autoFocusRef.current = null;
    }
    // torch off (best-effort)
    if (torchOn) {
      await setTorch(trackRef.current, false);
      setTorchOn(false);
    }

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    trackRef.current = null;
    setCameraOn(false);
    setStatusLine("Camera stopped");
    
    // Signal scanner inactive
    useGlobalProcessControl.getState().setScannerActive(false);
  }

  // Pinch-to-zoom state
  const pinchRef = useRef<{ initialDistance: number; initialZoom: number } | null>(null);

  const getDistance = useCallback((t1: React.Touch, t2: React.Touch) => {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.hypot(dx, dy);
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLVideoElement>) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const distance = getDistance(e.touches[0], e.touches[1]);
      pinchRef.current = { initialDistance: distance, initialZoom: zoomLevel };
    }
  }, [zoomLevel, getDistance]);

  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLVideoElement>) => {
    if (e.touches.length === 2 && pinchRef.current) {
      e.preventDefault();
      const distance = getDistance(e.touches[0], e.touches[1]);
      const scale = distance / pinchRef.current.initialDistance;
      const newZoom = Math.min(
        Math.max(pinchRef.current.initialZoom * scale, zoomCapabilities.min),
        zoomCapabilities.max
      );
      setZoom(newZoom);
    }
  }, [getDistance, zoomCapabilities, setZoom]);

  const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLVideoElement>) => {
    if (e.touches.length < 2) {
      pinchRef.current = null;
    }
  }, []);

  // Tap-to-focus with auto-focus trigger
  const handleVideoTap = useCallback(
    async (e: React.MouseEvent<HTMLVideoElement>) => {
      const rect = (e.target as HTMLVideoElement).getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width;
      const y = (e.clientY - rect.top) / rect.height;
      
      // Trigger focus point if supported
      if (support.focus) {
        await setFocusPoint(trackRef.current, { x, y });
      }
      
      // Also trigger a fast autofocus via constraint
      if (trackRef.current?.applyConstraints) {
        try {
          await trackRef.current.applyConstraints({
            advanced: [{ focusMode: "manual" } as any],
          });
          await new Promise((r) => setTimeout(r, 50));
          await trackRef.current.applyConstraints({
            advanced: [{ focusMode: "continuous" } as any],
          });
        } catch {
          // Ignore - some devices don't support focus mode changes
        }
      }
    },
    [support.focus]
  );

  // Auto-focus on camera start
  useEffect(() => {
    if (!cameraOn || !trackRef.current) return;
    
    const triggerAutoFocus = async () => {
      try {
        await trackRef.current?.applyConstraints({
          advanced: [{ focusMode: "continuous" } as any],
        });
      } catch {
        // Ignore
      }
    };
    
    triggerAutoFocus();
  }, [cameraOn]);

  async function toggleTorch() {
    if (!sup.torch) return;
    const next = !torchOn;
    const ok = await setTorch(trackRef.current, next);
    if (ok) setTorchOn(next);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // SHUTTER SOUND
  // ───────────────────────────────────────────────────────────────────────────

  const shutterAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    shutterAudioRef.current = new Audio("/sounds/shutter.mp3");
    shutterAudioRef.current.volume = 0.5;
  }, []);

  const playShutterSound = useCallback(() => {
    if (shutterAudioRef.current) {
      shutterAudioRef.current.currentTime = 0;
      shutterAudioRef.current.play().catch(() => {});
    }
  }, []);

  // ───────────────────────────────────────────────────────────────────────────
  // NATIVE CAMERA CAPTURE
  // ───────────────────────────────────────────────────────────────────────────

  async function captureWithNativeCamera() {
    if (busyCapture) return;
    setBusyCapture(true);
    triggerFlash();
    triggerHaptics();
    playShutterSound();

    try {
      const current = await idbCount();
      if (current >= QUEUE_MAX) {
        toast.error(`Buffer full (${QUEUE_MAX}). Let it process or clear.`);
        setBusyCapture(false);
        return;
      }

      const result = await takePhoto();
      if (!result) {
        toast.error("Native camera not available");
        setBusyCapture(false);
        return;
      }

      const id = safeUUID();
      const localUrl = trackObjectUrl(URL.createObjectURL(result.blob));

      setCards((prev) => {
        const next = [
          {
            id,
            preview: localUrl,
            status: "queued",
            priceFetching: true,
            isInLibrary: false,
            libraryQuantity: 0,
          },
          ...prev,
        ];

        // Prevent memory blow-ups on long rapid-scan sessions (blob: URLs hold the full image in RAM).
        if (next.length > MAX_UI_CARDS) {
          const overflow = next.slice(MAX_UI_CARDS);
          for (const c of overflow) {
            revokeObjectUrl(c?.preview);
          }
          return next.slice(0, MAX_UI_CARDS);
        }
        return next;
      });

      await idbAdd({
        id,
        createdAt: Date.now(),
        status: "queued",
        blob: result.blob,
        mime: result.blob.type || "image/jpeg",
        filename: "card.jpg",
      });

      setStatusLine("Captured — processing in background");
      setOverlay({ label: "Captured…" });

      await refreshMeta();
      ensureWorkersRunning();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "Native capture failed");
    } finally {
      setBusyCapture(false);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // WEB CAMERA CAPTURE (MANUAL)

  async function captureAndEnqueue() {
    if (!cameraOn) return;
    if (busyCapture) return;
    setBusyCapture(true);
    triggerFlash();
    triggerHaptics();
    playShutterSound();

    try {
      const current = await idbCount();
      if (current >= QUEUE_MAX) {
        toast.error(`Buffer full (${QUEUE_MAX}). Let it process or clear.`);
        setBusyCapture(false);
        return;
      }

      const v = videoRef.current;
      // Best-effort focus nudge right before capture
      if (settings.autoFocusAssist && sup.focus) {
        try {
          await setFocusPoint(trackRef.current, 0.5, 0.5);
        } catch {
          // ignore
        }
      }

      // Capture with tuned pipeline for speed or grading quality.
      const pipeline = await captureWithPipeline(v, {
        mode: settings.captureQualityMode,
        rapidMaxLongEdge: settings.rapidMaxLongEdge,
        rapidJpegQuality: settings.rapidJpegQuality,
        rapidPreferWebp: settings.rapidPreferWebp,
        gradingBurstFrames: settings.gradingBurstFrames,
        gradingMinSharpness: settings.gradingMinSharpness,
        gradingOutputFormat: settings.gradingOutputFormat,
        gradingJpegQuality: settings.gradingJpegQuality,
      });

      const blob = pipeline.blob;
      if (!blob) throw new Error("Failed to capture image");

      const id = safeUUID();

      // Local preview immediately
      const localUrl = trackObjectUrl(URL.createObjectURL(blob));
      setCards((prev) => {
        const next = [
          {
            id,
            preview: localUrl,
            status: "queued",
            priceFetching: true,
            isInLibrary: false,
            libraryQuantity: 0,
          },
          ...prev,
        ];

        // Prevent memory blow-ups on long rapid-scan sessions (blob: URLs hold the full image in RAM).
        if (next.length > MAX_UI_CARDS) {
          const overflow = next.slice(MAX_UI_CARDS);
          for (const c of overflow) {
            revokeObjectUrl(c?.preview);
          }
          return next.slice(0, MAX_UI_CARDS);
        }
        return next;
      });

      // Persist into queue
      await idbAdd({
        id,
        createdAt: Date.now(),
        status: "queued",
        blob,
        mime: pipeline.mime || blob.type || "image/jpeg",
        filename: pipeline.mime?.includes("png") ? "card.png" : pipeline.mime?.includes("webp") ? "card.webp" : "card.jpg",
      });

      setStatusLine("Captured — processing in background");
      setOverlay({ label: "Captured…" });

      await refreshMeta();
      ensureWorkersRunning();
    } catch (e: any) {
      console.error(e);
      toast.error(e?.message ?? "Capture failed");
    } finally {
      setBusyCapture(false);
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // AUTO-TIMER
  // ───────────────────────────────────────────────────────────────────────────

  const startAutoTimer = useCallback(() => {
    if (!cameraOn || isNative) return;
    setAutoTimerActive(true);
    setAutoTimerCountdown(autoTimerSeconds);
    
    // Capture immediately on start
    captureAndEnqueue();
    
    // Then capture every N seconds
    autoTimerRef.current = setInterval(() => {
      setAutoTimerCountdown((prev) => {
        if (prev <= 1) {
          captureAndEnqueue();
          return autoTimerSeconds;
        }
        return prev - 1;
      });
    }, 1000);
  }, [cameraOn, isNative, autoTimerSeconds]);

  const stopAutoTimer = useCallback(() => {
    setAutoTimerActive(false);
    setAutoTimerCountdown(0);
    if (autoTimerRef.current) {
      clearInterval(autoTimerRef.current);
      autoTimerRef.current = null;
    }
  }, []);

  // Cleanup timer on unmount or camera stop
  useEffect(() => {
    if (!cameraOn && autoTimerActive) {
      stopAutoTimer();
    }
  }, [cameraOn, autoTimerActive, stopAutoTimer]);

  useEffect(() => {
    return () => {
      if (autoTimerRef.current) {
        clearInterval(autoTimerRef.current);
      }
    };
  }, []);

  // ───────────────────────────────────────────────────────────────────────────
  // QUEUE PROCESSING (delegated to standalone processor)
  // ───────────────────────────────────────────────────────────────────────────

  function ensureWorkersRunning() {
    // Start the global queue processor
    queueProcessor.start();
  }

  // Sync UI state from processor completion events (concurrency-safe)
  useEffect(() => {
    const events = queueProcessor._consumeProcessedEvents?.();
    if (!events || events.length === 0) return;

    for (const card of events) {
      updateCard(card.id, {
        status: "completed",
        cardName: card.cardName,
        cardSet: card.cardSet,
        cardNumber: card.cardNumber,
        rarity: card.rarity,
        value: card.value,
        imageUrl: card.imageUrl,
        isInLibrary: card.isInLibrary,
        libraryQuantity: card.libraryQuantity,
        dbId: card.dbId,
        priceFetching: false,
      });
    }

    const last = events[events.length - 1];
    setOverlay({
      label: last.cardName,
      value: last.value,
      isInLibrary: last.isInLibrary,
      libraryQuantity: last.libraryQuantity,
    });

    refreshMeta();
  }, [queueProcessor.processedEvents, updateCard, refreshMeta]);

  // Sync processing state from global processor
  useEffect(() => {
    if (queueProcessor.currentItem) {
      updateCard(queueProcessor.currentItem, { status: "processing" });
    }
  }, [queueProcessor.currentItem, updateCard]);

  // ───────────────────────────────────────────────────────────────────────────
  // ADD TO LIBRARY (optional)
  // ───────────────────────────────────────────────────────────────────────────

  const handleAddToLibrary = useCallback(
    async (id: string) => {
      const c = cards.find((x) => x.id === id);
      if (!c) return;
      if (!userId) {
        toast.error("Login required to save to your library");
        return;
      }

      if (!c.cardName) {
        toast.error("Card not identified yet");
        return;
      }

      try {
        updateCard(id, { priceFetching: true });

        const inserted = await insertCardDual({
          user_id: userId,
          card_name: c.cardName,
          card_set: c.cardSet ?? null,
          card_number: c.cardNumber ?? null,
          rarity: c.rarity ?? null,
          image_url: c.imageUrl ?? null,
          current_price_raw: c.value ?? null,
          suggested_price: c.value ?? null,
        } as any);

        updateCard(id, {
          dbId: inserted.id,
          isInLibrary: true,
          libraryQuantity: Math.max((c.libraryQuantity || 0) + 1, 1),
          priceFetching: false,
        });

        toast.success("Saved to library");
      } catch (e: any) {
        console.error(e);
        updateCard(id, { priceFetching: false });
        toast.error(e?.message ?? "Failed to save");
      }
    },
    [cards, updateCard, userId]
  );

  const handleAddAllToLibrary = useCallback(async () => {
    if (!userId) {
      toast.error("Login required to save to your library");
      return;
    }

    const newCards = cards.filter((c) => c.status === "completed" && !c.dbId && c.cardName);
    if (newCards.length === 0) {
      toast.info("No new cards to add");
      return;
    }

    toast.loading(`Adding ${newCards.length} cards to library...`, { id: "bulk-add" });

    let added = 0;
    for (const c of newCards) {
      try {
        updateCard(c.id, { priceFetching: true });

        const inserted = await insertCardDual({
          user_id: userId,
          card_name: c.cardName!,
          card_set: c.cardSet ?? null,
          card_number: c.cardNumber ?? null,
          rarity: c.rarity ?? null,
          image_url: c.imageUrl ?? null,
          current_price_raw: c.value ?? null,
          suggested_price: c.value ?? null,
        } as any);

        updateCard(c.id, {
          dbId: inserted.id,
          isInLibrary: true,
          libraryQuantity: Math.max((c.libraryQuantity || 0) + 1, 1),
          priceFetching: false,
        });

        added++;
      } catch (e: any) {
        console.error(`Failed to add ${c.cardName}:`, e);
        updateCard(c.id, { priceFetching: false });
      }
    }

    toast.success(`Added ${added} of ${newCards.length} cards to library`, { id: "bulk-add" });
  }, [cards, updateCard, userId]);

  // ───────────────────────────────────────────────────────────────────────────
  // CLEAR
  // ───────────────────────────────────────────────────────────────────────────

  const clearAll = useCallback(async () => {
    setCards((prev) => {
      prev.forEach((p) => revokeObjectUrl(p.preview));
      return [];
    });
    await idbClear();
    await refreshMeta();
    setOverlay(null);
    toast.success("Cleared");
  }, [refreshMeta, revokeObjectUrl]);

  // ───────────────────────────────────────────────────────────────────────────
  // RENDER
  // ───────────────────────────────────────────────────────────────────────────

  return (
    <div
      className={cn(
        "space-y-4",
        settings.fullscreenScanMode && "fixed inset-0 z-50 bg-background p-2 sm:p-4 overflow-auto"
      )}
    >
      <Card className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">Rapid Scan</Badge>
            <span className="text-sm text-muted-foreground">Manual capture • buffered processing</span>
          </div>

          <div className="flex items-center gap-2">
            <Badge variant="outline" className="hidden sm:inline-flex">
              Buffer: {queueMeta.filter((q) => q.status === "queued" || q.status === "processing").length}/{QUEUE_MAX}
            </Badge>
            <Badge variant="outline">Total: ${totalValue.toFixed(2)}</Badge>
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-[1fr_320px]">
          {/* Camera preview */}
          <div className="relative overflow-hidden rounded-xl border bg-black touch-none">
            <video
              ref={videoRef}
              className={cn(
                "h-[360px] w-full object-cover cursor-crosshair",
                usingDigitalZoom && zoomLevel > 1 && "transition-transform duration-100"
              )}
              style={usingDigitalZoom && zoomLevel > 1 ? { transform: `scale(${zoomLevel})` } : undefined}
              onClick={handleVideoTap}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              playsInline
              muted
            />
            <canvas ref={canvasRef} className="hidden" />

            {flashActive && <div className="capture-flash" />}

            {/* Pinch zoom indicator */}
            {cameraOn && zoomCapabilities.supported && (
              <div className="absolute top-3 right-3 z-10">
                <div className="bg-black/70 rounded-full px-3 py-1.5 flex items-center gap-2">
                  <span className="text-xs text-white font-medium">
                    {zoomLevel.toFixed(1)}×
                  </span>
                  {usingDigitalZoom && (
                    <span className="text-[10px] text-white/60">digital</span>
                  )}
                </div>
              </div>
            )}

            {/* Voice capture */}
            {settings.voiceCaptureEnabled && (
              <div className="absolute top-3 left-3 z-10">
                <div className="bg-black/70 rounded-full px-3 py-1.5 flex items-center gap-2">
                  <span className="text-xs text-white font-medium">Voice</span>
                  <span className={cn("text-[10px]", voice.listening ? "text-emerald-300" : "text-white/60")}>
                    {voice.supported ? (voice.listening ? "listening" : "idle") : "unsupported"}
                  </span>
                </div>
              </div>
            )}

            {/* Overlay */}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3">
              <div className="flex items-end justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs text-white/80">{statusLine}</div>
                  <div className="truncate text-sm font-semibold text-white">
                    {overlay?.label ? overlay.label : ""}
                  </div>
                  {overlay?.value != null && (
                    <div className="text-xs text-white/90">
                      ${overlay.value.toFixed(2)}{" "}
                      {overlay.isInLibrary ? `• In library ×${Math.max(overlay.libraryQuantity || 1, 1)}` : "• Not in library"}
                    </div>
                  )}
                </div>

                <div className="text-right text-[10px] text-white/60">
                  {cameraOn && "Pinch to zoom • Tap to focus"}
                </div>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="space-y-3">
            <div className="rounded-xl border p-3">
              <div className="text-sm font-semibold mb-3">Camera</div>

              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Button
                    onClick={isNative ? captureWithNativeCamera : (cameraOn ? stopCamera : startCamera)}
                    variant={cameraOn ? "secondary" : "default"}
                    className="w-full"
                  >
                    {isNative ? (
                      <>
                        <Camera className="mr-2 h-4 w-4" /> Capture with Native Camera
                      </>
                    ) : cameraOn ? (
                      <>
                        <CameraOff className="mr-2 h-4 w-4" /> Stop
                      </>
                    ) : (
                      <>
                        <Camera className="mr-2 h-4 w-4" /> Start
                      </>
                    )}
                  </Button>

                  {!isNative && (
                    <Button
                      variant="outline"
                      onClick={toggleTorch}
                      disabled={!cameraOn || !sup.torch}
                      title={sup.torch ? "Toggle flash" : "Flash not supported"}
                    >
                      {torchOn ? <FlashlightOff className="h-4 w-4" /> : <Flashlight className="h-4 w-4" />}
                    </Button>
                  )}
                </div>

                {!isNative && cameraOn && (
                  <div className="flex gap-2">
                    <Button
                      onClick={captureAndEnqueue}
                      disabled={!cameraOn || busyCapture || autoTimerActive}
                      size="lg"
                      className="flex-1 h-16 text-lg font-bold"
                    >
                      {busyCapture ? <Loader2 className="mr-2 h-6 w-6 animate-spin" /> : <Camera className="mr-2 h-6 w-6" />}
                      CAPTURE
                    </Button>
                    <Button
                      onClick={autoTimerActive ? stopAutoTimer : startAutoTimer}
                      variant={autoTimerActive ? "destructive" : "secondary"}
                      size="lg"
                      className="h-16 px-4"
                    title={autoTimerActive ? "Stop auto-capture" : `Start auto-capture every ${autoTimerSeconds}s`}
                    >
                      {autoTimerActive ? (
                        <div className="flex flex-col items-center">
                          <TimerOff className="h-5 w-5" />
                          <span className="text-xs mt-0.5">{autoTimerCountdown}s</span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center">
                          <Timer className="h-5 w-5" />
                          <span className="text-xs mt-0.5">{autoTimerSeconds}s</span>
                        </div>
                      )}
                    </Button>

                    <Button
                      variant="outline"
                      size="lg"
                      className="h-16 px-3"
                      disabled={autoTimerActive}
                      onClick={() => {
                        const current = settings.autoTimerIntervalSeconds;
                        const next = current === 1 ? 1.5 : current === 1.5 ? 2 : current === 2 ? 5 : 1;
                        updateSettings({ autoTimerIntervalSeconds: next });
                        toast.info(`Auto-timer set to ${next}s`);
                      }}
                      title="Change auto-timer interval"
                    >
                      <div className="flex flex-col items-center">
                        <span className="text-xs font-semibold">Interval</span>
                        <span className="text-sm font-bold">{autoTimerSeconds}s</span>
                      </div>
                    </Button>
                  </div>
                )}

                {/* Zoom reset button - pinch controls are now on video */}
                {!isNative && cameraOn && zoomLevel > 1 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={resetZoom}
                    className="w-full"
                  >
                    Reset Zoom ({zoomLevel.toFixed(1)}×)
                  </Button>
                )}

                {/* Tiny clear button with double confirmation */}
                <div className="pt-6 mt-6 border-t flex justify-end">
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => {
                      if (window.confirm("Clear all queued cards?")) {
                        if (window.confirm("Are you SURE? This cannot be undone.")) {
                          clearAll();
                        }
                      }
                    }} 
                    className="h-6 px-2 text-[10px] text-muted-foreground/50 hover:text-destructive"
                  >
                    <Trash2 className="h-3 w-3 mr-1" /> clear
                  </Button>
                </div>

                <div className="text-xs text-muted-foreground">
                  {isNative 
                    ? "Tap capture to use your device's native camera for best quality." 
                    : "Tip: Tap the video to focus (if supported). Zoom in a bit for sharp text. Keep the card steady and fill the frame."}
                </div>
              </div>
            </div>

            <div className="rounded-xl border p-3">
              <div className="text-sm font-semibold">Buffer status</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Queued: {queueMeta.filter((q) => q.status === "queued").length} • Processing: {queueMeta.filter((q) => q.status === "processing").length}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Scanned list */}
      <ScannedCardList
        cards={cards}
        onCardUpdate={(id, updates) => updateCard(id, updates as any)}
        onCardDelete={(id) => removeCard(id)}
        scanMode={true}
        onAddToLibrary={(id) => handleAddToLibrary(id)}
        onAddAllToLibrary={handleAddAllToLibrary}
        onReorder={(orderedIds) => {
          setCards((prev) => {
            const byId = new Map(prev.map((c) => [c.id, c]));
            // Only reorder completed cards; keep non-completed at top
            const completed = prev.filter((c) => c.status === "completed");
            const rest = prev.filter((c) => c.status !== "completed");
            const nextCompleted = orderedIds.map((id) => byId.get(id)).filter(Boolean) as any[];
            // Fallback for any missing
            const missing = completed.filter((c) => !orderedIds.includes(c.id));
            return [...rest, ...nextCompleted, ...missing];
          });
        }}
      />
    </div>
  );
}
