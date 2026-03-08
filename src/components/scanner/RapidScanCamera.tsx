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
  Save,
  Eye,
  SunDim,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";

import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { insertCardDual } from "@/lib/localCards";
import {
  detectSupport,
  getVideoTrack,
  setFocusPoint,
  setTorch,
  type MediaSupport,
} from "@/lib/mediaControls";
import {
  idbAdd,
  idbCount,
  idbDelete,
  idbListMetaFast,
  idbClear,
  type QueueItemMeta,
} from "@/lib/idbQueue";
import { compressImageForQueue } from "@/lib/imageCompressor";
import { applyFastAutofocus, applyAutoColorBalance, applyAntiGlare, compensateForStackHeight } from "@/lib/camera-optimizations";
import { DEFAULT_TUNING, nextAutoCaptureState, rgbaToGray, meanAbsDiff, type AutoCaptureState } from "@/lib/visionAutoCapture";
import { useQueueProcessor } from "@/lib/queueProcessor";
import { getRecentScans, clearAllRecentScans, removeRecentScan, updateRecentScan } from "@/lib/recentScans";
import { useCameraZoom } from "@/hooks/use-camera-zoom";
import { useClarityZoom } from "@/hooks/use-clarity-zoom";
import { ZoomControls } from "./ZoomControls";
import { ScannedCardList } from "./ScannedCardList";
import { useIsMobile } from "@/hooks/use-mobile";
import { useNativeCamera } from "@/hooks/use-native-camera";
import { useGlobalProcessControl } from "@/hooks/use-global-process-control";
import { getScannerSettings, useScannerSettings } from "@/hooks/use-scanner-settings";
import { hapticTap } from "@/lib/haptics";
import { useVoiceCommand } from "@/hooks/use-voice-command";
import { useCameraDevices } from "@/hooks/use-camera-devices";
import { CameraDeviceSelector } from "./CameraDeviceSelector";
import { WhiteBalanceControl } from "./WhiteBalanceControl";
import { useGpuOffloadStream } from "@/hooks/use-gpu-offload-stream";
import { makeVideoFrameEncoder } from "@/lib/gpuOffload/frameEncoder";
import { playKachingBeep, playShutterBeep } from "@/lib/audioBeeps";

// ─────────────────────────────────────────────────────────────────────────────
// TUNING
// ─────────────────────────────────────────────────────────────────────────────

const QUEUE_MAX = 500; // large buffer - uses IndexedDB (device storage)

type ScannedCard = {
  id: string;
  preview: string;
  status: "queued" | "uploading" | "processing" | "completed" | "error";
  cardName?: string;
  cardSet?: string;
  cardNumber?: string;
  playerName?: string;
  rarity?: string;
  gameType?: string;
  sportType?: string;
  value?: number | null;
  error?: string;
  dbId?: string;
  priceFetching?: boolean;
  libraryQuantity?: number;
  isInLibrary?: boolean;
  imageUrl?: string;
  addedToLibraryThisSession?: boolean;
  year?: string;
  team?: string;
  manufacturer?: string;
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
  const isMobile = useIsMobile();

  // Local Accelerator (Mac/PC) live overlay
  const gpu = useGpuOffloadStream({ autoConnect: false });
  const frameEncoderRef = useRef<ReturnType<typeof makeVideoFrameEncoder> | null>(null);
  const streamRafRef = useRef<number | null>(null);
  const lastEncodeAtRef = useRef(0);

  // Camera devices (for selecting different lenses/optics)
  const {
    devices: cameraDevices,
    selectedDeviceId,
    setSelectedDeviceId,
    isLoading: devicesLoading,
    refreshDevices,
  } = useCameraDevices();

  // Extra safety filter for Rapid Scan: never show explicitly front-facing options.
  const rearOnlyCameraDevices = useMemo(
    () =>
      cameraDevices.filter(
        (device) => !/(^|\W)(front|facetime|selfie|user)(\W|$)/i.test(device.label)
      ),
    [cameraDevices]
  );

  useEffect(() => {
    if (!rearOnlyCameraDevices.length) return;
    if (!selectedDeviceId || rearOnlyCameraDevices.some((d) => d.deviceId === selectedDeviceId)) return;
    setSelectedDeviceId(rearOnlyCameraDevices[0].deviceId);
  }, [rearOnlyCameraDevices, selectedDeviceId, setSelectedDeviceId]);

  // Camera
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  // Auto-capture stability detector (optional)
  const autoCaptureStateRef = useRef<AutoCaptureState>({
    phase: "idle",
    stableFrames: 0,
    lastCaptureAt: 0,
    lastDiff: 0,
  });
  const autoCapturePrevGrayRef = useRef<Uint8Array | null>(null);
  const autoCaptureLastSampleAtRef = useRef<number>(0);
  const startingCameraRef = useRef(false);

  // Stack Focus Assist state
  const stackCaptureCountRef = useRef(0);
  const stackCompensatingRef = useRef(false);
  const lastStackCompensationRef = useRef(0);

  const [cameraOn, setCameraOn] = useState(false);
  const [support, setSupport] = useState<MediaSupport>({ torch: false, focus: false, zoom: false });
  const [torchOn, setTorchOn] = useState(false);
  const [torchDimmer, setTorchDimmer] = useState(100); // 100 = full brightness, 0 = max dimming overlay
  const [statusLine, setStatusLine] = useState("Tap Start to begin");
  const [busyCapture, setBusyCapture] = useState(false);
  // Capture UX
  const [flashActive, setFlashActive] = useState(false);

  // Auto-timer
  const [autoTimerActive, setAutoTimerActive] = useState(false);
  const autoTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [autoTimerCountdown, setAutoTimerCountdown] = useState(0);

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
      captureNow();
    },
  });

  // Optional hands-free auto-capture: triggers a capture when motion settles and the view becomes stable.
  useEffect(() => {
    if (isNative) return;
    if (!settings.autoCaptureEnabled) return;
    if (!cameraOn) return;

    let raf = 0;
    const tuning = DEFAULT_TUNING;
    const sampleCanvas = document.createElement("canvas");
    sampleCanvas.width = tuning.sampleW;
    sampleCanvas.height = tuning.sampleH;
    const sctx = sampleCanvas.getContext("2d", { willReadFrequently: true });
    if (!sctx) return;

    autoCapturePrevGrayRef.current = null;
    autoCaptureStateRef.current = {
      phase: "idle",
      stableFrames: 0,
      lastCaptureAt: 0,
      lastDiff: 0,
    };
    autoCaptureLastSampleAtRef.current = 0;

    const tick = () => {
      raf = requestAnimationFrame(tick);

      const v = videoRef.current;
      if (!v) return;
      if (v.readyState < 2) return;
      if (busyCapture) return;

      const now = performance.now();
      if (now - autoCaptureLastSampleAtRef.current < 120) return;
      autoCaptureLastSampleAtRef.current = now;

      try {
        sctx.drawImage(v, 0, 0, tuning.sampleW, tuning.sampleH);
        const frame = sctx.getImageData(0, 0, tuning.sampleW, tuning.sampleH);
        const gray = rgbaToGray(frame.data);

        const prev = autoCapturePrevGrayRef.current;
        autoCapturePrevGrayRef.current = gray;

        if (!prev) return;

        const diff = meanAbsDiff(prev, gray);
        const prevState = autoCaptureStateRef.current;
        const res = nextAutoCaptureState(prevState, diff, Date.now(), tuning);
        autoCaptureStateRef.current = res.state;

        if (res.shouldCapture) {
          captureNow();
        }
      } catch {
        // ignore frame sampling errors
      }
    };

    raf = requestAnimationFrame(tick);

    return () => {
      if (raf) cancelAnimationFrame(raf);
      autoCapturePrevGrayRef.current = null;
    };
  }, [isNative, settings.autoCaptureEnabled, cameraOn, busyCapture, captureNow]);

  // Zoom
  const {
    zoomLevel,
    zoomCapabilities,
    usingDigitalZoom,
    detectZoomCapabilities,
    setZoom,
    zoomIn,
    zoomOut,
  } = useCameraZoom({ streamRef });

  // Smart auto zoom-out based on image clarity (for card stacking)
  const clarityZoom = useClarityZoom({
    zoomLevel,
    minZoom: zoomCapabilities.min,
    setZoom,
    enabled: settings.autoZoomEnabled !== false,
  });

  // UI list - hydrate from persistent recentScans on mount
  const [cards, setCards] = useState<ScannedCard[]>(() => {
    const stored = getRecentScans();
    return stored.map(s => ({
      id: s.id,
      preview: s.image_url,
      status: "completed" as const,
      cardName: s.card_name,
      cardSet: s.card_set ?? undefined,
      cardNumber: s.card_number ?? undefined,
      playerName: s.player_name ?? undefined,
      rarity: s.rarity ?? undefined,
      gameType: s.gameType ?? undefined,
      sportType: s.sportType ?? undefined,
      value: s.price,
      dbId: s.dbId ?? undefined,
      isInLibrary: s.isInLibrary ?? false,
      libraryQuantity: s.libraryQuantity ?? 0,
      imageUrl: s.image_url,
      priceFetching: false,
      year: s.year ?? undefined,
      team: s.team ?? undefined,
      manufacturer: s.manufacturer ?? undefined,
    }));
  });
  const CARD_LIST_RENDER_LIMIT = 30;
  const [showAllCards, setShowAllCards] = useState(false);
  const [renderedCount, setRenderedCount] = useState(CARD_LIST_RENDER_LIMIT);

  // Incremental rendering guard: avoids rendering thousands of DOM nodes at once
  useEffect(() => {
    if (!showAllCards) {
      setRenderedCount(CARD_LIST_RENDER_LIMIT);
      return;
    }
    setRenderedCount((prev) => Math.max(prev, Math.min(cards.length, CARD_LIST_RENDER_LIMIT * 2)));
  }, [showAllCards, cards.length]);

  const loadMoreCards = useCallback(() => {
    setRenderedCount((prev) => Math.min(cards.length, prev + 50));
  }, [cards.length]);

  const cardsToRender = useMemo(() => {
    if (!showAllCards) return cards.slice(0, CARD_LIST_RENDER_LIMIT);
    return cards.slice(0, renderedCount);
  }, [cards, showAllCards, renderedCount]);

  const [overlay, setOverlay] = useState<LastOverlay | null>(null);

  // Initialize frame encoder once (browser-only)
  useEffect(() => {
    try {
      frameEncoderRef.current = makeVideoFrameEncoder();
    } catch {
      frameEncoderRef.current = null;
    }
  }, []);

  // Auto connect/disconnect based on settings + camera state
  useEffect(() => {
    const shouldUse = cameraOn && settings.gpuOffloadEnabled && settings.gpuPreferForLive;
    if (shouldUse) gpu.connect();
    else gpu.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraOn, settings.gpuOffloadEnabled, settings.gpuPreferForLive]);

  // Streaming loop (throttled) for live preview overlay
  useEffect(() => {
    const shouldStream =
      cameraOn &&
      settings.gpuOffloadEnabled &&
      settings.gpuPreferForLive &&
      gpu.status === "connected";

    if (!shouldStream) {
      if (streamRafRef.current) cancelAnimationFrame(streamRafRef.current);
      streamRafRef.current = null;
      return;
    }

    const v = videoRef.current;
    if (!v) return;

    const encoder = frameEncoderRef.current ?? (frameEncoderRef.current = makeVideoFrameEncoder());
    const minGap = 1000 / Math.max(2, Math.min(30, settings.gpuStreamMaxFps || 12));

    const tick = () => {
      const now = Date.now();
      if (now - lastEncodeAtRef.current >= minGap) {
        lastEncodeAtRef.current = now;
        const jpeg = encoder(v);
        if (jpeg) gpu.sendFrame(jpeg);
      }
      streamRafRef.current = requestAnimationFrame(tick);
    };

    streamRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (streamRafRef.current) cancelAnimationFrame(streamRafRef.current);
      streamRafRef.current = null;
    };
  }, [cameraOn, gpu.status, settings.gpuOffloadEnabled, settings.gpuPreferForLive, settings.gpuStreamMaxFps]);

  // Global queue processor - single source of truth for queue state
  const queueProcessor = useQueueProcessor();
  
  // Queue meta from processor (single source of truth - no local duplicate state)
  const queueMeta = queueProcessor.queueMeta;

  // ───────────────────────────────────────────────────────────────────────────
  // INIT
  // ───────────────────────────────────────────────────────────────────────────

  useEffect(() => {
    supabase.auth
      .getUser()
      .then(({ data }) => setUserId(data.user?.id ?? null))
      .catch(() => setUserId(null));
  }, []);

  // Refresh queue metadata via the processor's method
  const refreshMeta = useCallback(async () => {
    await queueProcessor.refreshQueue();
  }, [queueProcessor.refreshQueue]);

  // Throttled meta refresh
  const lastMetaRefreshAtRef = useRef(0);
  const metaRefreshTimerRef = useRef<number | null>(null);

  const requestRefreshMeta = useCallback(() => {
    const MIN_INTERVAL_MS = 900;
    const now = Date.now();
    const elapsed = now - lastMetaRefreshAtRef.current;

    if (elapsed >= MIN_INTERVAL_MS) {
      lastMetaRefreshAtRef.current = now;
      refreshMeta();
      return;
    }

    if (metaRefreshTimerRef.current != null) return;

    metaRefreshTimerRef.current = window.setTimeout(() => {
      metaRefreshTimerRef.current = null;
      lastMetaRefreshAtRef.current = Date.now();
      refreshMeta();
    }, Math.max(0, MIN_INTERVAL_MS - elapsed));
  }, [refreshMeta]);

  useEffect(() => {
    refreshMeta();
    return () => {
      if (metaRefreshTimerRef.current != null) {
        window.clearTimeout(metaRefreshTimerRef.current);
        metaRefreshTimerRef.current = null;
      }
    };
  }, [refreshMeta]);


  // ───────────────────────────────────────────────────────────────────────────
  // HELPERS: STATE UPDATE
  // ───────────────────────────────────────────────────────────────────────────

  const updateCard = useCallback((id: string, patch: Partial<ScannedCard>) => {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const removeCard = useCallback(async (id: string) => {
    setCards((prev) => {
      const target = prev.find((c) => c.id === id);
      if (target?.preview) {
        try {
          URL.revokeObjectURL(target.preview);
        } catch {}
      }
      return prev.filter((c) => c.id !== id);
    });
    removeRecentScan(id);
    try {
      await idbDelete(id);
    } catch {
      // ignore
    }
    await refreshMeta();
  }, [refreshMeta]);

  // Total value of completed cards
  const totalValue = useMemo(() => {
    return cards.reduce((sum, c) => sum + (c.status === "completed" ? c.value || 0 : 0), 0);
  }, [cards]);

  // ───────────────────────────────────────────────────────────────────────────
  // CAMERA
  // ───────────────────────────────────────────────────────────────────────────

  async function startCamera() {
    if (cameraOn || startingCameraRef.current) return;
    
    startingCameraRef.current = true;

    try {
      const videoConstraints: MediaTrackConstraints = {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      };
      
      if (selectedDeviceId) {
        videoConstraints.deviceId = { exact: selectedDeviceId };
      } else {
        videoConstraints.facingMode = "environment";
      }
      
      const constraints: MediaStreamConstraints = {
        video: videoConstraints,
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      trackRef.current = getVideoTrack(stream);
      setSupport(detectSupport(trackRef.current));

      if (settings.manualFocusLock) {
        try {
          const track = trackRef.current;
          await track?.applyConstraints?.({ advanced: [{ focusMode: "manual" } as MediaTrackConstraintSet] });
        } catch {
          // ignore
        }
      }

      const v = videoRef.current;
      if (!v) {
        startingCameraRef.current = false;
        return;
      }
      
      if (v.srcObject) {
        const oldStream = v.srcObject as MediaStream;
        oldStream.getTracks().forEach(t => t.stop());
      }
      
      v.srcObject = stream;
      
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
        
        if (v.readyState >= 3) {
          v.removeEventListener('canplay', onCanPlay);
          v.removeEventListener('error', onError);
          resolve();
        }
      });
      
      try {
        await v.play();
      } catch (playErr: any) {
        if (playErr?.name !== 'AbortError') {
          throw playErr;
        }
      }

      setCameraOn(true);
      setStatusLine("Camera live — tap Capture for each card");
      
      useGlobalProcessControl.getState().setScannerActive(true);
      stackCaptureCountRef.current = 0;

      detectZoomCapabilities();
      clarityZoom.reset();

      try {
        await applyFastAutofocus(stream, true);
      } catch {
        try {
          await trackRef.current?.applyConstraints({
            advanced: [{ focusMode: "continuous" } as any],
          });
        } catch {}
      }
    } catch (err: any) {
      setStatusLine(`Camera error: ${err?.message ?? err}`);
      toast.error("Camera failed to start");
    } finally {
      startingCameraRef.current = false;
    }
  }

  async function stopCamera() {
    if (torchOn) {
      await setTorch(trackRef.current, false);
      setTorchOn(false);
    }

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    trackRef.current = null;
    setCameraOn(false);
    setStatusLine("Camera stopped");
    
    useGlobalProcessControl.getState().setScannerActive(false);

    // Clear video element to release decoder resources (important on mobile)
    if (videoRef.current) {
      try { (videoRef.current as any).srcObject = null; } catch {}
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // STACK FOCUS ASSIST
  // ───────────────────────────────────────────────────────────────────────────

  const runStackCompensation = useCallback(async () => {
    // Guards: don't run if already compensating, camera restarting, or too soon
    if (stackCompensatingRef.current) return;
    if (startingCameraRef.current) return;
    if (busyCapture) return;

    const now = Date.now();
    const cooldownMs = (settings.stackFocusPulseMs || 120) * 4;
    if (now - lastStackCompensationRef.current < cooldownMs) return;

    stackCompensatingRef.current = true;
    lastStackCompensationRef.current = now;
    setStatusLine("Stack focus assist: refocusing…");

    try {
      const strategy = await compensateForStackHeight(
        trackRef.current,
        {
          backoutCards: settings.stackFocusBackoutCards || 3,
          pulseMs: settings.stackFocusPulseMs || 120,
          zoomFallbackStep: settings.stackFocusZoomFallbackStep || 0.10,
        },
        zoomCapabilities.supported
          ? { zoomLevel, zoomMin: zoomCapabilities.min, setZoom }
          : undefined,
        (video) => clarityZoom.analyzeAndAdjustZoom(video).then(() => {}),
        videoRef.current,
      );
      console.log(`[StackFocusAssist] Completed via ${strategy}`);
      setStatusLine(`Stack adjusted (${strategy}) — keep scanning`);
    } catch (e) {
      console.warn("[StackFocusAssist] Error:", e);
      setStatusLine("Camera live — tap Capture for each card");
    } finally {
      stackCompensatingRef.current = false;
    }
  }, [busyCapture, settings, zoomCapabilities, zoomLevel, setZoom, clarityZoom]);


  useEffect(() => {
    return () => {
      try {
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
          trackRef.current = null;
        }
        useGlobalProcessControl.getState().setScannerActive(false);
      } catch {}
    };
  }, []);

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
      
      if (support.focus) {
        await setFocusPoint(trackRef.current, { x, y });
      }
      
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
          // Ignore
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
    if (!support.torch) return;
    const next = !torchOn;
    const ok = await setTorch(trackRef.current, next);
    if (ok) setTorchOn(next);
  }

  // ───────────────────────────────────────────────────────────────────────────
  // SHUTTER SOUND
  // ───────────────────────────────────────────────────────────────────────────

  const playShutterSound = useCallback(() => {
    playShutterBeep();
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
      const localUrl = URL.createObjectURL(result.blob);

      setCards((prev) => [
        {
          id,
          preview: localUrl,
          status: "queued",
          priceFetching: true,
          isInLibrary: false,
          libraryQuantity: 0,
        },
        ...prev,
      ]);

      const compressedBlob = await compressImageForQueue(result.blob);

      await idbAdd({
        id,
        createdAt: Date.now(),
        status: "queued",
        blob: compressedBlob,
        mime: compressedBlob.type || "image/jpeg",
        filename: "card.jpg",
      });

      setStatusLine("Captured — processing in background");
      setOverlay({ label: "Captured…" });

      // Stack Focus Assist — periodic compensation replaces per-shot zoom-out
      if (settings.stackFocusAssistEnabled) {
        stackCaptureCountRef.current += 1;
        if (stackCaptureCountRef.current >= (settings.stackFocusEveryCards || 8)) {
          stackCaptureCountRef.current = 0;
          runStackCompensation();
        }
      }

      requestRefreshMeta();
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
      const c = canvasRef.current;
      if (!v || !c) {
        setBusyCapture(false);
        return;
      }

      const w = v.videoWidth || 1920;
      const h = v.videoHeight || 1080;
      c.width = w;
      c.height = h;

      const ctx = c.getContext("2d", { willReadFrequently: false });
      if (!ctx) throw new Error("Canvas not available");

      ctx.drawImage(v, 0, 0, w, h);
      applyAutoColorBalance(ctx, c, 0.5);
      applyAntiGlare(ctx, c, 0.2);

      if (settings.autoZoomEnabled) {
        clarityZoom.analyzeAndAdjustZoom(v).catch(() => {});
      }

      const blob: Blob | null = await new Promise((resolve) =>
        c.toBlob(resolve, "image/jpeg", 0.95)
      );
      if (!blob) throw new Error("Failed to capture image");

      const id = safeUUID();

      const localUrl = URL.createObjectURL(blob);
      setCards((prev) => [
        {
          id,
          preview: localUrl,
          status: "queued",
          priceFetching: true,
          isInLibrary: false,
          libraryQuantity: 0,
        },
        ...prev,
      ]);

      const compressedBlob = await compressImageForQueue(blob);
      
      await idbAdd({
        id,
        createdAt: Date.now(),
        status: "queued",
        blob: compressedBlob,
        mime: compressedBlob.type || "image/jpeg",
        filename: "card.jpg",
      });

      setStatusLine("Captured — processing in background");
      setOverlay({ label: "Captured…" });

      // Stack Focus Assist — periodic compensation replaces per-shot zoom-out
      if (settings.stackFocusAssistEnabled) {
        stackCaptureCountRef.current += 1;
        if (stackCaptureCountRef.current >= (settings.stackFocusEveryCards || 8)) {
          stackCaptureCountRef.current = 0;
          runStackCompensation();
        }
      }

      requestRefreshMeta();
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
    
    captureAndEnqueue();
    
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
    queueProcessor.start();
  }

  // Sync UI state from processor's last processed card
  useEffect(() => {
    if (!queueProcessor.lastProcessedCard) return;

    const card = queueProcessor.lastProcessedCard;
    updateCard(card.id, {
      status: "completed",
      cardName: card.cardName,
      cardSet: card.cardSet,
      cardNumber: card.cardNumber,
      playerName: card.playerName || (card.sportType ? card.cardName : undefined),
      rarity: card.rarity,
      gameType: card.gameType,
      sportType: card.sportType,
      value: card.value,
      imageUrl: card.imageUrl,
      isInLibrary: card.isInLibrary,
      libraryQuantity: card.libraryQuantity,
      dbId: card.dbId,
      priceFetching: false,
      year: card.year,
      team: card.team,
      manufacturer: card.manufacturer,
    });

    // Play ka-ching sound for cards worth $10+
    if (typeof card.value === "number" && card.value >= 10) {
      playKachingBeep();
    }

    setOverlay({
      label: card.cardName,
      value: card.value,
      isInLibrary: card.isInLibrary,
      libraryQuantity: card.libraryQuantity,
    });

    requestRefreshMeta();
  }, [queueProcessor.lastProcessedCard, updateCard, requestRefreshMeta]);

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
          addedToLibraryThisSession: true,
        });
        updateRecentScan(id, { dbId: inserted.id, isInLibrary: true, libraryQuantity: Math.max((c.libraryQuantity || 0) + 1, 1) });

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

    const newCards = cards.filter((c) => c.status === "completed" && c.cardName && !c.addedToLibraryThisSession);
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
          addedToLibraryThisSession: true,
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
  // REMOVE FROM LIBRARY (for remove mode)
  // ───────────────────────────────────────────────────────────────────────────

  const handleRemoveFromLibrary = useCallback(
    async (id: string, dbId: string) => {
      if (!userId) {
        toast.error("Login required");
        return;
      }

      try {
        updateCard(id, { priceFetching: true });

        const { error } = await supabase.from("cards").delete().eq("id", dbId);
        if (error) throw error;

        updateCard(id, {
          dbId: undefined,
          isInLibrary: false,
          libraryQuantity: 0,
          priceFetching: false,
        });

        toast.success("Removed from collection");
      } catch (e: any) {
        console.error(e);
        updateCard(id, { priceFetching: false });
        toast.error(e?.message ?? "Failed to remove");
      }
    },
    [updateCard, userId]
  );

  const handleRemoveAllFromLibrary = useCallback(async () => {
    if (!userId) {
      toast.error("Login required");
      return;
    }

    const libraryCards = cards.filter((c) => c.status === "completed" && c.isInLibrary && c.dbId);
    if (libraryCards.length === 0) {
      toast.info("No cards to remove");
      return;
    }

    toast.loading(`Removing ${libraryCards.length} cards from collection...`, { id: "bulk-remove" });

    let removed = 0;
    for (const c of libraryCards) {
      try {
        updateCard(c.id, { priceFetching: true });

        const { error } = await supabase.from("cards").delete().eq("id", c.dbId!);
        if (error) throw error;

        updateCard(c.id, {
          dbId: undefined,
          isInLibrary: false,
          libraryQuantity: 0,
          priceFetching: false,
        });

        removed++;
      } catch (e: any) {
        console.error(`Failed to remove ${c.cardName}:`, e);
        updateCard(c.id, { priceFetching: false });
      }
    }

    toast.success(`Removed ${removed} of ${libraryCards.length} cards`, { id: "bulk-remove" });
  }, [cards, updateCard, userId]);

  // ───────────────────────────────────────────────────────────────────────────
  // CLEAR
  // ───────────────────────────────────────────────────────────────────────────

  const clearAll = useCallback(async () => {
    setCards((prev) => {
      prev.forEach((p) => {
        try {
          URL.revokeObjectURL(p.preview);
        } catch {}
      });
      return [];
    });
    clearAllRecentScans();
    await idbClear();
    await refreshMeta();
    setOverlay(null);
    toast.success("Cleared");
  }, [refreshMeta]);

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
      <Card className={cn("p-4", settings.scanMode === "REMOVE" && "border-destructive/50")}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Badge 
              variant={
                settings.scanMode === "REMOVE" 
                  ? "destructive" 
                  : settings.scanMode === "SAVE" 
                  ? "default" 
                  : "secondary"
              }
            >
              {settings.scanMode === "REMOVE" 
                ? "Remove Mode" 
                : settings.scanMode === "SAVE" 
                ? "Save Mode" 
                : "Scan & Price"}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {settings.scanMode === "REMOVE" 
                ? "Scan cards to find and remove from collection" 
                : settings.scanMode === "SAVE"
                ? "Scans are saved to your collection"
                : "Preview only, nothing saved"}
            </span>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            {/* 3-way mode toggle */}
            <div className="flex rounded-lg border overflow-hidden">
              <Button
                variant={settings.scanMode === "SAVE" ? "default" : "ghost"}
                size="default"
                className="rounded-none border-0 px-3 sm:px-4 h-11 sm:h-10"
                onClick={() => {
                  updateSettings({ scanMode: "SAVE" });
                  toast.info("Save Mode — cards added to collection");
                }}
              >
                <Save className="h-5 w-5 sm:h-4 sm:w-4 sm:mr-1.5" />
                <span className="hidden sm:inline">Save</span>
              </Button>
              <Button
                variant={settings.scanMode === "SCAN_ONLY" ? "secondary" : "ghost"}
                size="default"
                className="rounded-none border-0 border-x px-3 sm:px-4 h-11 sm:h-10"
                onClick={() => {
                  updateSettings({ scanMode: "SCAN_ONLY" });
                  toast.info("Scan & Price — preview only");
                }}
              >
                <Eye className="h-5 w-5 sm:h-4 sm:w-4 sm:mr-1.5" />
                <span className="hidden sm:inline">Price</span>
              </Button>
              <Button
                variant={settings.scanMode === "REMOVE" ? "destructive" : "ghost"}
                size="default"
                className="rounded-none border-0 px-3 sm:px-4 h-11 sm:h-10"
                onClick={() => {
                  updateSettings({ scanMode: "REMOVE" });
                  toast.info("Remove Mode — scan to delete cards");
                }}
              >
                <Trash2 className="h-5 w-5 sm:h-4 sm:w-4 sm:mr-1.5" />
                <span className="hidden sm:inline">Remove</span>
              </Button>
            </div>
            <Badge variant="outline" className="hidden sm:inline-flex text-sm py-1.5 px-3">
              Buffer: {queueMeta.filter((q) => q.status === "queued" || q.status === "processing").length}/{QUEUE_MAX}
            </Badge>
            <Badge variant="outline" className="text-sm py-1.5 px-3">Total: ${totalValue.toFixed(2)}</Badge>
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_300px] landscape:grid-cols-[1fr_260px]">
          {/* Camera preview */}
          <div className="relative overflow-hidden rounded-xl border-2 border-primary/30 bg-black touch-none shadow-lg">
            <video
              ref={videoRef}
              className={cn(
                "w-full object-contain cursor-crosshair",
                "h-[65vh] min-h-[400px] max-h-[700px]",
                "sm:h-[60vh] sm:min-h-[420px] sm:max-h-[650px]",
                "md:h-[560px] md:min-h-0 md:max-h-none",
                "lg:h-[600px]",
                "landscape:h-[70vh] landscape:min-h-[300px] landscape:max-h-[500px]",
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
            
            {/* Trading card alignment frame overlay */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div 
                className="border-2 border-dashed border-white/40 rounded-lg relative"
                style={{
                  width: "min(85%, 340px)",
                  aspectRatio: "5/7",
                }}
              >
                <div className="absolute -top-1 -left-1 w-6 h-6 border-t-2 border-l-2 border-white/70 rounded-tl" />
                <div className="absolute -top-1 -right-1 w-6 h-6 border-t-2 border-r-2 border-white/70 rounded-tr" />
                <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-2 border-l-2 border-white/70 rounded-bl" />
                <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-2 border-r-2 border-white/70 rounded-br" />
              </div>
            </div>
            <canvas ref={canvasRef} className="hidden" />

            {flashActive && <div className="capture-flash" />}

            {/* Torch dimmer overlay */}
            {torchOn && torchDimmer < 100 && (
              <div 
                className="pointer-events-none absolute inset-0 bg-black/80 transition-opacity duration-200"
                style={{ opacity: (100 - torchDimmer) / 100 * 0.7 }}
              />
            )}

            {/* Pinch zoom indicator */}
            {cameraOn && zoomCapabilities.supported && zoomLevel > 1 && (
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

            {/* Local Accelerator status */}
            {settings.gpuOffloadEnabled && settings.gpuPreferForLive && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10">
                <div className="bg-black/70 rounded-lg px-3 py-2 min-w-[240px]">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div
                        className={cn(
                          "h-2 w-2 rounded-full",
                          gpu.status === "connected" && "bg-emerald-400",
                          gpu.status === "connecting" && "bg-yellow-400",
                          (gpu.status === "disconnected" || gpu.status === "error") && "bg-red-400"
                        )}
                      />
                      <span className="text-[10px] text-white/90 font-semibold">BOOST</span>
                      <span className="text-[10px] text-white/70">{gpu.status}</span>
                    </div>
                    <div className="text-[10px] text-white/70">
                      {gpu.perf.rttMs != null ? `${Math.round(gpu.perf.rttMs)}ms` : "—"}
                    </div>
                  </div>

                  <div className="mt-1 flex items-center justify-between text-[10px] text-white/70">
                    <span>out {gpu.perf.fpsOut}fps • in {gpu.perf.fpsIn}fps</span>
                    <span>dropped {gpu.perf.dropped}</span>
                  </div>

                  {gpu.lastResult?.card?.name && (
                    <div className="mt-1">
                      <div className="truncate text-[11px] text-white font-medium">
                        {gpu.lastResult.card.name}
                      </div>
                      <div className="text-[10px] text-white/80">
                        {gpu.lastResult.card.value != null ? `$${Number(gpu.lastResult.card.value).toFixed(2)}` : ""}
                        {gpu.lastResult.card.rarity ? ` • ${gpu.lastResult.card.rarity}` : ""}
                        {typeof gpu.lastResult.card.confidence === "number" ? ` • ${Math.round(gpu.lastResult.card.confidence * 100)}%` : ""}
                      </div>
                    </div>
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
          <div className="space-y-4">
            <div className="rounded-xl border p-4">
              <div className="text-base font-semibold mb-4">Camera</div>

              <div className="space-y-4">
                {/* Camera/Optic selector */}
                {!isNative && rearOnlyCameraDevices.length > 1 && (
                  <div className="space-y-2">
                    <label className="text-sm text-muted-foreground">Select Camera/Lens</label>
                    <CameraDeviceSelector
                      devices={rearOnlyCameraDevices}
                      selectedDeviceId={selectedDeviceId}
                      onDeviceChange={async (deviceId) => {
                        setSelectedDeviceId(deviceId);
                        if (cameraOn) {
                          await stopCamera();
                          setTimeout(() => startCamera(), 100);
                        }
                      }}
                      onRefresh={refreshDevices}
                      isLoading={devicesLoading}
                    />
                  </div>
                )}
                
                <div className="flex items-center gap-3">
                  <Button
                    onClick={isNative ? captureWithNativeCamera : (cameraOn ? stopCamera : startCamera)}
                    variant={cameraOn ? "secondary" : "default"}
                    size="lg"
                    className="w-full h-14 text-base"
                  >
                    {isNative ? (
                      <>
                        <Camera className="mr-2 h-6 w-6" /> Capture with Native Camera
                      </>
                    ) : cameraOn ? (
                      <>
                        <CameraOff className="mr-2 h-6 w-6" /> Stop
                      </>
                    ) : (
                      <>
                        <Camera className="mr-2 h-6 w-6" /> Start
                      </>
                    )}
                  </Button>

                  {!isNative && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="lg"
                        className="h-14 w-14"
                        onClick={toggleTorch}
                        disabled={!cameraOn || !support.torch}
                        title={support.torch ? "Toggle flash" : "Flash not supported"}
                      >
                        {torchOn ? <FlashlightOff className="h-6 w-6" /> : <Flashlight className="h-6 w-6" />}
                      </Button>
                      {/* Torch dimmer slider */}
                      {torchOn && support.torch && (
                        <div className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2 h-14">
                          <SunDim className="h-4 w-4 text-muted-foreground shrink-0" />
                          <Slider
                            value={[torchDimmer]}
                            onValueChange={([v]) => setTorchDimmer(v)}
                            min={20}
                            max={100}
                            step={5}
                            className="w-20"
                          />
                          <span className="text-xs text-muted-foreground w-8">{torchDimmer}%</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* White Balance */}
                {!isNative && cameraOn && (
                  <WhiteBalanceControl streamRef={streamRef} variant="panel" />
                )}

                {!isNative && cameraOn && (
                  <div className="flex gap-3">
                    <Button
                      onClick={captureAndEnqueue}
                      disabled={!cameraOn || busyCapture || autoTimerActive}
                      size="lg"
                      className="flex-1 h-20 text-xl font-bold"
                    >
                      {busyCapture ? <Loader2 className="mr-3 h-8 w-8 animate-spin" /> : <Camera className="mr-3 h-8 w-8" />}
                      CAPTURE
                    </Button>
                    <Button
                      onClick={autoTimerActive ? stopAutoTimer : startAutoTimer}
                      variant={autoTimerActive ? "destructive" : "secondary"}
                      size="lg"
                      className="h-20 w-20"
                      title={autoTimerActive ? "Stop auto-capture" : `Start auto-capture every ${autoTimerSeconds}s`}
                    >
                      {autoTimerActive ? (
                        <div className="flex flex-col items-center">
                          <TimerOff className="h-7 w-7" />
                          <span className="text-sm mt-1 font-semibold">{autoTimerCountdown}s</span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center">
                          <Timer className="h-7 w-7" />
                          <span className="text-sm mt-1 font-semibold">{autoTimerSeconds}s</span>
                        </div>
                      )}
                    </Button>

                    <Button
                      variant="outline"
                      size="lg"
                      className="h-20 w-20"
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
                        <span className="text-sm font-semibold">Interval</span>
                        <span className="text-lg font-bold">{autoTimerSeconds}s</span>
                      </div>
                    </Button>
                  </div>
                )}

                {/* Zoom reset button */}
                {!isNative && cameraOn && zoomLevel > 1 && (
                  <Button
                    variant="outline"
                    size="default"
                    onClick={() => setZoom(1)}
                    className="w-full h-12 text-base"
                  >
                    Reset Zoom ({zoomLevel.toFixed(1)}×)
                  </Button>
                )}

                {/* Clear button with double confirmation */}
                <div className="pt-4 mt-4 border-t flex justify-end">
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
                    className="h-10 px-4 text-sm text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4 mr-2" /> Clear All
                  </Button>
                </div>

                <div className="text-sm text-muted-foreground mt-3">
                  {isNative 
                    ? "Tap capture to use your device's native camera for best quality." 
                    : "Tip: Tap the video to focus (if supported). Zoom in a bit for sharp text. Keep the card steady and fill the frame."}
                </div>
              </div>
            </div>

            <div className="rounded-xl border p-4">
              <div className="text-base font-semibold">Buffer status</div>
              <div className="mt-2 text-sm text-muted-foreground">
                Queued: {queueMeta.filter((q) => q.status === "queued").length} • Processing: {queueMeta.filter((q) => q.status === "processing").length}
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* Scanned list */}
      {cards.length > CARD_LIST_RENDER_LIMIT && (
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Showing {showAllCards ? Math.min(renderedCount, cards.length) : Math.min(cards.length, CARD_LIST_RENDER_LIMIT)} of {cards.length}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAllCards((v) => !v)}
          >
            {showAllCards ? "Show less" : `Show all (${cards.length})`}
          </Button>
          {showAllCards && renderedCount < cards.length && (
            <Button
              variant="ghost"
              size="sm"
              onClick={loadMoreCards}
            >
              Load more (+50)
            </Button>
          )}
        </div>
      )}

      <ScannedCardList
        cards={cardsToRender}
        onCardUpdate={(id, updates) => updateCard(id, updates as any)}
        onCardDelete={(id) => removeCard(id)}
        scanMode={true}
        removeMode={settings.scanMode === "REMOVE"}
        onAddToLibrary={(id) => handleAddToLibrary(id)}
        onAddAllToLibrary={handleAddAllToLibrary}
        onRemoveFromLibrary={handleRemoveFromLibrary}
        onRemoveAllFromLibrary={handleRemoveAllFromLibrary}
        onReorder={(orderedIds) => {
          setCards((prev) => {
            const byId = new Map(prev.map((c) => [c.id, c]));
            const completed = prev.filter((c) => c.status === "completed");
            const rest = prev.filter((c) => c.status !== "completed");
            const nextCompleted = orderedIds.map((id) => byId.get(id)).filter(Boolean) as any[];
            const missing = completed.filter((c) => !orderedIds.includes(c.id));
            return [...rest, ...nextCompleted, ...missing];
          });
        }}
      />
    </div>
  );
}
