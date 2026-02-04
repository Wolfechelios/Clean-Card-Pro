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
  idbListMetaFast,
  idbClear,
  type QueueItemMeta,
} from "@/lib/idbQueue";
import { useQueueProcessor } from "@/lib/queueProcessor";
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
import kachingSound from "@/assets/kaching.wav";

// Ka-ching sound for $10+ cards
let kachingAudio: HTMLAudioElement | null = null;
function playKachingSound() {
  try {
    if (!kachingAudio) {
      kachingAudio = new Audio(kachingSound);
      kachingAudio.volume = 0.8;
    }
    kachingAudio.currentTime = 0;
    kachingAudio.play().catch(() => {});
  } catch {
    // Ignore audio errors
  }
}

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
  const isMobile = useIsMobile();

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
  } = useCameraZoom({ streamRef });

  // Smart auto zoom-out based on image clarity (for card stacking)
  const clarityZoom = useClarityZoom({
    zoomLevel,
    minZoom: zoomCapabilities.min,
    setZoom,
    enabled: settings.autoZoomEnabled !== false, // enabled by default
  });

  // Queue meta for debug/health
  const [queueMeta, setQueueMeta] = useState<QueueItemMeta[]>([]);

  // UI list
  const [cards, setCards] = useState<ScannedCard[]>([]);
  const [showAllCards, setShowAllCards] = useState(false);
  const CARD_LIST_RENDER_LIMIT = 30;
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
    // Use fast meta loading that doesn't load blobs - much faster for large queues
    const all = await idbListMetaFast();
    setQueueMeta(all);
  }, []);

  // Throttled meta refresh: avoids hammering IndexedDB every capture/worker tick.
  const lastMetaRefreshAtRef = useRef(0);
  const metaRefreshTimerRef = useRef<number | null>(null);

  const requestRefreshMeta = useCallback(() => {
    const MIN_INTERVAL_MS = 900;
    const now = Date.now();
    const elapsed = now - lastMetaRefreshAtRef.current;

    // Refresh immediately if enough time has passed.
    if (elapsed >= MIN_INTERVAL_MS) {
      lastMetaRefreshAtRef.current = now;
      refreshMeta();
      return;
    }

    // Otherwise, schedule a single refresh.
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
    // remove from list (and free any object URL preview)
    setCards((prev) => {
      const target = prev.find((c) => c.id === id);
      if (target?.preview) {
        try {
          URL.revokeObjectURL(target.preview);
        } catch {}
      }
      return prev.filter((c) => c.id !== id);
    });
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

      // Reset clarity zoom tracking on camera start
      clarityZoom.reset();

      // Force autofocus on camera start
      try {
        await trackRef.current?.applyConstraints({
          advanced: [{ focusMode: "continuous" } as any],
        });
      } catch {}

      // Workers start automatically once you enqueue
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

      // Make capture resolution match the actual camera feed.
      const w = v.videoWidth || 1920;
      const h = v.videoHeight || 1080;
      c.width = w;
      c.height = h;

      const ctx = c.getContext("2d", { willReadFrequently: false });
      if (!ctx) throw new Error("Canvas not available");

      // Draw current frame
      ctx.drawImage(v, 0, 0, w, h);

      // Check clarity and auto zoom-out if needed (for card stacks)
      if (settings.autoZoomEnabled) {
        clarityZoom.analyzeAndAdjustZoom(v).catch(() => {});
      }

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

  // Sync UI state from processor's last processed card
  useEffect(() => {
    if (!queueProcessor.lastProcessedCard) return;

    const card = queueProcessor.lastProcessedCard;
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

    // Play ka-ching sound for cards worth $10+
    if (typeof card.value === "number" && card.value >= 10) {
      playKachingSound();
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

          <div className="flex items-center gap-2">
            {/* 3-way mode toggle */}
            <div className="flex rounded-md border overflow-hidden">
              <Button
                variant={settings.scanMode === "SAVE" ? "default" : "ghost"}
                size="sm"
                className="rounded-none border-0 px-2.5"
                onClick={() => {
                  updateSettings({ scanMode: "SAVE" });
                  toast.info("Save Mode — cards added to collection");
                }}
              >
                <Save className="h-3.5 w-3.5 sm:mr-1" />
                <span className="hidden sm:inline">Save</span>
              </Button>
              <Button
                variant={settings.scanMode === "SCAN_ONLY" ? "secondary" : "ghost"}
                size="sm"
                className="rounded-none border-0 border-x px-2.5"
                onClick={() => {
                  updateSettings({ scanMode: "SCAN_ONLY" });
                  toast.info("Scan & Price — preview only");
                }}
              >
                <Eye className="h-3.5 w-3.5 sm:mr-1" />
                <span className="hidden sm:inline">Price</span>
              </Button>
              <Button
                variant={settings.scanMode === "REMOVE" ? "destructive" : "ghost"}
                size="sm"
                className="rounded-none border-0 px-2.5"
                onClick={() => {
                  updateSettings({ scanMode: "REMOVE" });
                  toast.info("Remove Mode — scan to delete cards");
                }}
              >
                <Trash2 className="h-3.5 w-3.5 sm:mr-1" />
                <span className="hidden sm:inline">Remove</span>
              </Button>
            </div>
            <Badge variant="outline" className="hidden sm:inline-flex">
              Buffer: {queueMeta.filter((q) => q.status === "queued" || q.status === "processing").length}/{QUEUE_MAX}
            </Badge>
            <Badge variant="outline">Total: ${totalValue.toFixed(2)}</Badge>
          </div>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_300px] landscape:grid-cols-[1fr_260px]">
          {/* Camera preview - maximized for trading card scanning */}
          <div className="relative overflow-hidden rounded-xl border-2 border-primary/30 bg-black touch-none shadow-lg">
            <video
              ref={videoRef}
              className={cn(
                // Trading card optimized: fill most of viewport for easy framing
                "w-full object-cover cursor-crosshair",
                // Mobile: very tall for easy card alignment (70-75% of viewport)
                "h-[72vh] min-h-[450px] max-h-[800px]",
                // Tablet: still large but bounded
                "sm:h-[68vh] sm:min-h-[480px] sm:max-h-[720px]",
                // Desktop: generous fixed height for precision
                "md:h-[560px] md:min-h-0 md:max-h-none",
                "lg:h-[600px]",
                // Landscape: maximize horizontal space
                "landscape:h-[75vh] landscape:min-h-[320px] landscape:max-h-[520px]",
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
                {/* Corner markers for precise alignment */}
                <div className="absolute -top-1 -left-1 w-6 h-6 border-t-2 border-l-2 border-white/70 rounded-tl" />
                <div className="absolute -top-1 -right-1 w-6 h-6 border-t-2 border-r-2 border-white/70 rounded-tr" />
                <div className="absolute -bottom-1 -left-1 w-6 h-6 border-b-2 border-l-2 border-white/70 rounded-bl" />
                <div className="absolute -bottom-1 -right-1 w-6 h-6 border-b-2 border-r-2 border-white/70 rounded-br" />
              </div>
            </div>
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
                    onClick={() => setZoom(1)}
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
      {cards.length > CARD_LIST_RENDER_LIMIT && (
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            Showing {showAllCards ? cards.length : Math.min(cards.length, CARD_LIST_RENDER_LIMIT)} of {cards.length}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAllCards((v) => !v)}
          >
            {showAllCards ? "Show less" : `Show all (${cards.length})`}
          </Button>
        </div>
      )}

      <ScannedCardList
        cards={showAllCards ? cards : cards.slice(0, CARD_LIST_RENDER_LIMIT)}
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
