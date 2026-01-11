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
  type MediaSupport,
} from "@/lib/mediaControls";
import {
  idbAdd,
  idbCount,
  idbDelete,
  idbGetNextQueued,
  idbGetAll,
  idbUpdateMeta,
  idbClear,
  type QueueItemMeta,
} from "@/lib/idbQueue";
import { withRetry } from "@/lib/retry";
import { useCameraZoom } from "@/hooks/use-camera-zoom";
import { ZoomControls } from "./ZoomControls";
import { ScannedCardList } from "./ScannedCardList";
import { useNativeCamera } from "@/hooks/use-native-camera";
import { useGlobalProcessControl } from "@/hooks/use-global-process-control";
import { getScannerSettings, useScannerSettings } from "@/hooks/use-scanner-settings";
import { hapticTap } from "@/lib/haptics";
import { useVoiceCommand } from "@/hooks/use-voice-command";

// ─────────────────────────────────────────────────────────────────────────────
// TUNING
// ─────────────────────────────────────────────────────────────────────────────

const QUEUE_MAX = 500; // large buffer - uses IndexedDB (device storage)
const WORKER_THREADS = 3; // Process 3 cards in parallel
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24; // 24h
const JOB_DELAY_MS = 800; // Delay between jobs to avoid API rate limits

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
  const [overlay, setOverlay] = useState<LastOverlay | null>(null);

  // Worker controls
  const workersRunning = useRef(false);
  const stopWorkers = useRef(false);

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
    const all = await idbGetAll();
    setQueueMeta(all.map(({ blob: _blob, ...rest }) => rest));
  }, []);

  useEffect(() => {
    refreshMeta();
  }, [refreshMeta]);


  // ───────────────────────────────────────────────────────────────────────────
  // HELPERS: STATE UPDATE
  // ───────────────────────────────────────────────────────────────────────────

  const updateCard = useCallback((id: string, patch: Partial<ScannedCard>) => {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const removeCard = useCallback(async (id: string) => {
    // remove from list
    setCards((prev) => prev.filter((c) => c.id !== id));
    // remove from queue if still exists
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
      const constraints: MediaStreamConstraints = {
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      trackRef.current = getVideoTrack(stream);
      setSupport(detectSupport(trackRef.current));

      // Optional: manual focus lock (best-effort; many browsers ignore this)
      if (settings.manualFocusLock) {
        try {
          const track = trackRef.current;
          // Try common constraint shapes
          await track?.applyConstraints?.({ advanced: [{ focusMode: "manual" }] });
        } catch {
          // ignore
        }
      }

      const v = videoRef.current;
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
      
      // Signal scanner active to pause expensive renders elsewhere
      useGlobalProcessControl.getState().setScannerActive(true);

      // Zoom capabilities
      detectZoomCapabilities();

      // Workers start automatically once you enqueue
    } catch (err: any) {
      setStatusLine(`Camera error: ${err?.message ?? err}`);
      toast.error("Camera failed to start");
    } finally {
      startingCameraRef.current = false;
    }
  }

  async function stopCamera() {
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
    if (!support.torch) return;
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
      const c = canvasRef.current;
      if (!v || !c) {
        setBusyCapture(false);
        return;
      }

      // Make capture resolution match the actual camera feed.
      const w = v.videoWidth || 1920;
      const h = v.videoHeight || 1080;
      c.width = w;
      c.height = h;

      const ctx = c.getContext("2d", { willReadFrequently: false });
      if (!ctx) throw new Error("Canvas not available");

      // Draw current frame
      ctx.drawImage(v, 0, 0, w, h);

      // Convert to high-quality JPEG
      const blob: Blob | null = await new Promise((resolve) =>
        c.toBlob(resolve, "image/jpeg", 0.92)
      );
      if (!blob) throw new Error("Failed to capture image");

      const id = safeUUID();

      // Local preview immediately
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

      // Persist into queue
      await idbAdd({
        id,
        createdAt: Date.now(),
        status: "queued",
        blob,
        mime: blob.type || "image/jpeg",
        filename: "card.jpg",
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
  // WORKERS (QUEUE PROCESSING)
  // ───────────────────────────────────────────────────────────────────────────

  function ensureWorkersRunning() {
    if (workersRunning.current) return;
    workersRunning.current = true;
    stopWorkers.current = false;
    for (let i = 0; i < WORKER_THREADS; i++) workerLoop();
  }

  async function workerLoop() {
    while (!stopWorkers.current) {
      const next = await idbGetNextQueued();
      if (!next) {
        await sleep(200);
        continue;
      }

      try {
        await idbUpdateMeta(next.id, { status: "processing" });
        updateCard(next.id, { status: "processing" });
        await refreshMeta();

        // Upload
        updateCard(next.id, { status: "uploading" });
        const filePath = `cards/${next.id}.jpg`;
        const file = new File([next.blob], next.filename, { type: next.mime });

        await withRetry(async () => {
          const res = await supabase.storage
            .from("card-images")
            .upload(filePath, file, { upsert: false });
          if (res.error) throw new Error(res.error.message);
          return res.data;
        });

        // Signed URL
        const imageUrl = await withRetry(async () => {
          const res = await supabase.storage
            .from("card-images")
            .createSignedUrl(filePath, SIGNED_URL_TTL_SECONDS);
          if (res.error) throw new Error(res.error.message);
          if (!res.data?.signedUrl) throw new Error("Signed URL missing");
          return res.data.signedUrl;
        });

        updateCard(next.id, { imageUrl });

        // Identify (fast) - edge function has its own retries, so minimal client retries
        const identify = await withRetry(
          async () => {
            const res = await supabase.functions.invoke("rapid-card-identify", { body: { imageUrl } });
            if (res.error) throw new Error(res.error.message);
            if (!res.data?.success) throw new Error(res.data?.error || "Identify failed");
            return res.data.cardData as any;
          },
          {
            retries: 2, // Reduced - edge function already has 5 retries
            baseMs: 2000, // Longer delay between client retries
            maxMs: 10000,
            shouldRetry: (e) => /timeout|network|502|503|504/i.test(String(e?.message ?? e)), // Don't retry 429 here - let edge function handle it
          }
        );

        const cardName: string = identify?.card_name || "Unknown Card";
        const cardSet: string | null = identify?.card_set ?? null;
        const cardNumber: string | null = identify?.card_number ?? null;
        const rarity: string | null = identify?.rarity ?? null;
        const gameType: string | null = identify?.game_type ?? null;
        const sportType: string | null = identify?.sport_type ?? null;

        updateCard(next.id, {
          cardName,
          cardSet: cardSet || undefined,
          cardNumber: cardNumber || undefined,
          rarity: rarity || undefined,
          priceFetching: true,
        });

        setOverlay({ label: cardName });

        // Price
        let rawPrice: number | null = null;
        try {
          const p = await supabase.functions.invoke("fetch-card-prices", {
            body: {
              cardName,
              cardSet,
              cardNumber,
              gameType,
              sportType,
            },
          });
          if (!p.error && p.data) {
            rawPrice = money(p.data.raw ?? p.data.suggested ?? null);
          }
        } catch {
          rawPrice = null;
        }

        // Library check (if logged in)
        let ownedCount = 0;
        let isInLibrary = false;
        let existingId: string | undefined = undefined;
        if (userId) {
          try {
            const { count } = await supabase
              .from("cards")
              .select("id", { count: "exact", head: true })
              .eq("user_id", userId)
              .ilike("card_name", cardName);

            ownedCount = count || 0;
            isInLibrary = ownedCount > 0;

            if (isInLibrary) {
              const { data } = await supabase
                .from("cards")
                .select("id")
                .eq("user_id", userId)
                .ilike("card_name", cardName)
                .limit(1);
              existingId = data?.[0]?.id;
            }
          } catch {
            ownedCount = 0;
            isInLibrary = false;
          }
        }

        updateCard(next.id, {
          status: "completed",
          value: rawPrice,
          priceFetching: false,
          isInLibrary,
          libraryQuantity: ownedCount,
          dbId: existingId,
        });
        setOverlay({ label: cardName, value: rawPrice, isInLibrary, libraryQuantity: ownedCount });

        await idbDelete(next.id);
        await refreshMeta();
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        console.error("Rapid scan job failed:", msg);
        updateCard(next.id, { status: "error", error: msg, priceFetching: false });
        try {
          await idbUpdateMeta(next.id, { status: "error", error: msg });
        } catch {}
        await refreshMeta();
      }

      await sleep(JOB_DELAY_MS); // Throttle to prevent rate limit avalanche
    }
  }

  useEffect(() => {
    return () => {
      stopWorkers.current = true;
      workersRunning.current = false;
    };
  }, []);

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
                      disabled={!cameraOn || !support.torch}
                      title={support.torch ? "Toggle flash" : "Flash not supported"}
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
                        const next = current === 1 ? 2 : current === 2 ? 5 : 1;
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
