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
import { isIPhone17Class } from "@/lib/deviceClass";
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
  DollarSign,
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
  idbCountQueued,
  idbDelete,
  idbListMetaFast,
  idbClear,
  type QueueItemMeta,
} from "@/lib/idbQueue";
import { compressImageForQueue } from "@/lib/imageCompressor";
import { applyFastAutofocus, applyAutoColorBalance, applyAntiGlare } from "@/lib/camera-optimizations";
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
import { getMultiFrameAnalyzer, resetMultiFrameAnalyzer, type MultiFrameResult } from "@/lib/foilTrainer/multiFrameAnalyzer";
import { FoilDetectionOverlay } from "./FoilDetectionOverlay";
import { getScannerSettings, useScannerSettings, type ScannerSettings } from "@/hooks/use-scanner-settings";
import { getScanEngineProfile } from "@/lib/performance/scanProfiles";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { hapticTap } from "@/lib/haptics";
import { useVoiceCommand } from "@/hooks/use-voice-command";
import { useCameraDevices } from "@/hooks/use-camera-devices";
import { CameraDeviceSelector } from "./CameraDeviceSelector";
import { WhiteBalanceControl } from "./WhiteBalanceControl";
import { playKachingBeep, playShutterBeep, playJackpotBeep, warmUpAudio } from "@/lib/audioBeeps";

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
  psa10Price?: number | null;
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
  const engineProfile = useMemo(() => getScanEngineProfile(settings.scanEngineProfile), [settings.scanEngineProfile]);
  const queueMax = engineProfile.queueMax;
  const isMobile = useIsMobile();


  // Camera devices (for selecting different lenses/optics)
  const {
    devices: cameraDevices,
    selectedDeviceId,
    setSelectedDeviceId,
    isLoading: devicesLoading,
    refreshDevices,
  } = useCameraDevices();

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
  // iOS-only: silently retry once if the track dies right after start
  const iosRestartAttemptedRef = useRef(false);
  const iosStartedAtRef = useRef(0);

  const [cameraOn, setCameraOn] = useState(false);
  const [support, setSupport] = useState<MediaSupport>({ torch: false, focus: false, zoom: false });
  const [torchOn, setTorchOn] = useState(false);
  const [torchDimmer, setTorchDimmer] = useState(100);
  const [statusLine, setStatusLine] = useState("Tap Start to begin");
  const [busyCapture, setBusyCapture] = useState(false);
  const [flashActive, setFlashActive] = useState(false);

  // Foil detection
  const [foilResult, setFoilResult] = useState<MultiFrameResult | null>(null);
  const foilAnalyzerRef = useRef(getMultiFrameAnalyzer());

  // Auto-timer
  const [autoTimerActive, setAutoTimerActive] = useState(false);
  const autoTimerRef = useRef<NodeJS.Timeout | null>(null);
  const [autoTimerCountdown, setAutoTimerCountdown] = useState(0);

  const autoTimerSeconds = settings.autoTimerIntervalSeconds ?? 2;

  useEffect(() => {
    if (!cameraOn) {
      setStatusLine(`${engineProfile.label} ready — ${engineProfile.targetResolution} target, queue ${queueMax}, ${engineProfile.maxWorkers} worker${engineProfile.maxWorkers === 1 ? "" : "s"}`);
    }
  }, [cameraOn, engineProfile, queueMax]);

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

    // iOS: defer the RAF readback loop to avoid pressuring the freshly
    // started camera track during its warm-up window.
    const isIOSAuto = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const startTimer = setTimeout(() => {
      raf = requestAnimationFrame(tick);
    }, isIOSAuto ? 1500 : 0);

    return () => {
      clearTimeout(startTimer);
      if (raf) cancelAnimationFrame(raf);
      autoCapturePrevGrayRef.current = null;
    };
  }, [isNative, settings.autoCaptureEnabled, cameraOn, busyCapture, captureNow]);

  // Background foil detection — sample frames every ~500ms during camera use
  useEffect(() => {
    if (isNative || !cameraOn || !settings.foilDetectionEnabled) return;
    const analyzer = foilAnalyzerRef.current;
    let raf = 0;
    let lastSample = 0;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const v = videoRef.current;
      if (!v || v.readyState < 2) return;
      const now = performance.now();
      if (now - lastSample < 500) return;
      lastSample = now;

      analyzer.addFrame(v);
      const result = analyzer.analyze();
      setFoilResult(result);
    };

    analyzer.reset();
    setFoilResult(null);
    // iOS: delay foil sampling until after the camera warm-up window
    const isIOSFoil = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const startTimer = setTimeout(() => {
      raf = requestAnimationFrame(tick);
    }, isIOSFoil ? 1500 : 0);

    return () => {
      clearTimeout(startTimer);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [isNative, cameraOn, settings.foilDetectionEnabled]);

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


  // Global queue processor - single source of truth for queue state
  const queueProcessor = useQueueProcessor();
  
  // Queue meta from processor (single source of truth - no local duplicate state)
  const queueMeta = queueProcessor.queueMeta;
  const isAnomalyPaused = queueProcessor.isPausedByAnomaly;
  const queuedItemsCount = useMemo(() => queueMeta.filter((q) => q.status === "queued").length, [queueMeta]);
  const processingItemsCount = useMemo(() => queueMeta.filter((q) => q.status === "processing").length, [queueMeta]);
  const bufferedItemsCount = queuedItemsCount + processingItemsCount;

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

  // Number of completed cards still missing a price
  const missingPriceCount = useMemo(() => {
    return cards.filter(
      (c) => c.status === "completed" && (c.value == null) && c.cardName
    ).length;
  }, [cards]);

  const [findingPrices, setFindingPrices] = useState(false);

  // Manually fetch prices for any completed cards missing them.
  // Hits fetch-card-prices, then updates UI state, recentScans, and DB row if saved.
  const findPricesNow = useCallback(async () => {
    if (findingPrices) return;
    const targets = cards.filter(
      (c) => c.status === "completed" && c.value == null && c.cardName
    );
    if (targets.length === 0) {
      toast.info("All scanned cards already have prices");
      return;
    }
    setFindingPrices(true);
    toast.loading(`Looking up ${targets.length} prices...`, { id: "find-prices" });
    let updated = 0;
    const BATCH = 4;
    try {
      for (let i = 0; i < targets.length; i += BATCH) {
        const batch = targets.slice(i, i + BATCH);
        await Promise.all(
          batch.map(async (card) => {
            updateCard(card.id, { priceFetching: true });
            try {
              const { data, error } = await supabase.functions.invoke(
                "fetch-card-prices",
                {
                  body: {
                    cardName: card.cardName,
                    cardSet: card.cardSet ?? null,
                    cardNumber: card.cardNumber ?? null,
                    gameType: card.gameType ?? null,
                    sportType: card.sportType ?? null,
                    condition: null,
                  },
                }
              );
              if (error) throw error;
              const raw = money((data as any)?.raw ?? (data as any)?.suggested ?? null);
              const psa10 = money((data as any)?.psa10 ?? null);
              updateCard(card.id, {
                value: raw,
                psa10Price: psa10,
                priceFetching: false,
              });
              try {
                updateRecentScan(card.id, { price: raw, psa10Price: psa10 });
              } catch {}
              if (card.dbId && raw != null) {
                try {
                  await supabase
                    .from("cards")
                    .update({
                      current_price_raw: raw,
                      current_price_psa10: psa10,
                      suggested_price: raw,
                      last_price_update: new Date().toISOString(),
                    })
                    .eq("id", card.dbId);
                } catch {}
              }
              if (raw != null) updated++;
            } catch (e) {
              console.warn("[FindPrices] Lookup failed for", card.cardName, e);
              updateCard(card.id, { priceFetching: false });
            }
          })
        );
      }
      toast.success(`Found prices for ${updated} of ${targets.length} cards`, {
        id: "find-prices",
      });
    } catch (e) {
      console.error("[FindPrices] Batch failed:", e);
      toast.error("Price lookup failed", { id: "find-prices" });
    } finally {
      setFindingPrices(false);
    }
  }, [cards, findingPrices, updateCard]);

  // ───────────────────────────────────────────────────────────────────────────
  // CAMERA
  // ───────────────────────────────────────────────────────────────────────────

  async function startCamera() {
    warmUpAudio(); // unlock AudioContext on user gesture
    if (cameraOn || startingCameraRef.current) return;
    
    startingCameraRef.current = true;

    try {
      const buildConstraints = (w: number, h: number): MediaStreamConstraints => {
        const video: MediaTrackConstraints = {
          width: { ideal: w },
          height: { ideal: h },
          frameRate: { ideal: 30, max: 60 },
        };
        if (selectedDeviceId) {
          video.deviceId = { exact: selectedDeviceId };
        } else {
          video.facingMode = "environment";
        }
        return { video, audio: false };
      };

      // NEVER put advanced focus/exposure/whiteBalance modes in getUserMedia —
      // iOS WebKit silently ends the track if any one is unsupported, which
      // made the viewfinder go black after ~1s.
      // Default to 1080p everywhere — 4K on iOS WebKit has been ending the
      // track silently a few hundred ms after start. We can re-enable 4K
      // once we gate it behind a capability check.
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(buildConstraints(1920, 1080));
      } catch (overErr) {
        console.warn("[Camera] 1080p getUserMedia failed, falling back to 720p", overErr);
        stream = await navigator.mediaDevices.getUserMedia(buildConstraints(1280, 720));
      }

      streamRef.current = stream;
      trackRef.current = getVideoTrack(stream);
      setSupport(detectSupport(trackRef.current));

      // Auto-recover if the track dies right after start (iOS WebKit edge case).
      // CRITICAL: only react if the ending track is still the active one —
      // StrictMode (dev) and re-mounts can end a previous stream after a new
      // one is already live, which would otherwise flip cameraOn to false.
      const track = trackRef.current;
      if (track) {
        const handleEnded = () => {
          if (trackRef.current !== track) {
            console.log("[Camera] stale track ended (ignored)");
            return;
          }
          console.warn("[Camera] active track ended unexpectedly");
          setCameraOn(false);
          setStatusLine("Camera dropped — tap Start to retry");
        };
        track.addEventListener?.("ended", handleEnded);
        track.addEventListener?.("mute", () => {
          if (trackRef.current === track) console.warn("[Camera] active track muted");
        });
      }
      // Tells us in console exactly when the iPhone iOS lifecycle hits each step.
      console.log(`[Camera] getUserMedia ok, track=${track?.id?.slice(0, 8)} live=${track?.readyState}`);

      const v = videoRef.current;
      if (!v) {
        startingCameraRef.current = false;
        return;
      }

      if (v.srcObject) {
        const oldStream = v.srcObject as MediaStream;
        if (oldStream !== stream) oldStream.getTracks().forEach(t => t.stop());
      }

      v.srcObject = stream;

      await new Promise<void>((resolve, reject) => {
        const onCanPlay = () => {
          v.removeEventListener('canplay', onCanPlay);
          v.removeEventListener('error', onError);
          resolve();
        };
        const onError = (_e: Event) => {
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

      const settings0 = track?.getSettings?.();
      console.log(`[Camera] started ${settings0?.width ?? "?"}×${settings0?.height ?? "?"} @ ${settings0?.frameRate ?? "?"}fps`);

      setCameraOn(true);
      setStatusLine("Camera live — tap Capture for each card");

      useGlobalProcessControl.getState().setScannerActive(true);

      const isIOSStart = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      iosStartedAtRef.current = Date.now();
      // After 4s of stable preview on iOS, allow the silent-retry budget to reset
      // so a later genuine drop can still self-heal once.
      if (isIOSStart) {
        setTimeout(() => {
          if (trackRef.current === track && track?.readyState === "live") {
            iosRestartAttemptedRef.current = false;
          }
        }, 4000);
      }

      // On iOS, defer capability probes until after the camera warm-up window
      // so getCapabilities() doesn't compete with the stream stabilizing.
      const runCapabilityProbes = () => {
        detectZoomCapabilities();
        clarityZoom.reset();
      };
      if (isIOSStart) {
        setTimeout(runCapabilityProbes, 800);
      } else {
        runCapabilityProbes();
      }

      // Apply mode constraints AFTER the stream is live, each isolated so a
      // single unsupported key cannot kill the track.
      // CRITICAL: iOS 26 WebKit (iPhone 17 Pro) terminates the MediaStreamTrack
      // a few seconds after start if we hammer it with advanced applyConstraints
      // — even when individually wrapped. iOS rear cameras default to continuous
      // AF/AE/AWB, so we skip the whole block on iOS.
      const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (!isIOS) {
        const safeApply = async (set: MediaTrackConstraintSet) => {
          try { await track?.applyConstraints?.({ advanced: [set] }); } catch {}
        };
        await safeApply({ focusMode: "continuous" } as MediaTrackConstraintSet);
        await safeApply({ exposureMode: "continuous" } as MediaTrackConstraintSet);
        await safeApply({ whiteBalanceMode: "continuous" } as MediaTrackConstraintSet);

        if (settings.manualFocusLock) {
          await safeApply({ focusMode: "manual" } as MediaTrackConstraintSet);
        } else {
          try {
            await applyFastAutofocus(stream, true);
          } catch {
            await safeApply({ focusMode: "continuous" } as MediaTrackConstraintSet);
          }
        }
      }
    } catch (err: any) {
      setStatusLine(`Camera error: ${err?.message ?? err}`);
      toast.error("Camera failed to start");
    } finally {
      startingCameraRef.current = false;
    }
  }

  async function stopCamera() {
    stopAutoTimer();

    if (torchOn) {
      await setTorch(trackRef.current, false);
      setTorchOn(false);
    }

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    trackRef.current = null;
    setCameraOn(false);
    iosRestartAttemptedRef.current = false;

    useGlobalProcessControl.getState().setScannerActive(false);

    // Clear video element to release decoder resources (important on mobile)
    if (videoRef.current) {
      try { (videoRef.current as any).srcObject = null; } catch {}
    }

    const queuedCount = await idbCountQueued();
    if (queuedCount > 0) {
      setStatusLine(`Camera stopped — pricing ${queuedCount} captured card${queuedCount === 1 ? "" : "s"}`);
      setOverlay({ label: `Pricing ${queuedCount} captured card${queuedCount === 1 ? "" : "s"}…` });
      ensureWorkersRunning();
    } else {
      setStatusLine("Camera stopped");
    }
  }

  // Cleanup: stop camera & timers on unmount.
  // CRITICAL: if the user navigates away mid-scan without pressing Stop,
  // any queued captures would otherwise sit in IndexedDB forever and never
  // get processed/priced. Kick off the queue processor on unmount so the
  // images they snapped get identified in the background.
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
      // Fire-and-forget: drain anything the user captured before leaving
      idbCountQueued()
        .then((n) => {
          if (n > 0) {
            console.log(`[RapidScan] Unmount with ${n} queued items — starting processor`);
            useQueueProcessor.getState().start();
          }
        })
        .catch(() => {});
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

  // Auto-focus on camera start (non-iOS only — iOS terminates the track
  // when we issue extra applyConstraints calls right after start).
  useEffect(() => {
    if (!cameraOn || !trackRef.current) return;
    if (/iPhone|iPad|iPod/i.test(navigator.userAgent)) return;

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
    if (isAnomalyPaused) {
      toast.error("Rapid scan is paused — resume or clear the bad batch first.");
      return;
    }
    if (busyCapture) return;
    setBusyCapture(true);
    triggerFlash();
    triggerHaptics();
    playShutterSound();

    try {
      const current = await idbCount();
      if (current >= queueMax) {
        toast.error(`Buffer full (${queueMax}). Let it process or clear.`);
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

      const compressedBlob = await compressImageForQueue(
        result.blob,
        isIPhone17Class()
          ? { maxWidth: 2400, maxHeight: 2400, quality: 0.92 }
          : undefined,
      );

      await idbAdd({
        id,
        createdAt: Date.now(),
        status: "queued",
        blob: compressedBlob,
        mime: compressedBlob.type || "image/jpeg",
        filename: "card.jpg",
      });

      setStatusLine("Captured — pricing will run after you stop");
      setOverlay({ label: "Captured…" });

      // Progressive zoom-out after each snap to keep card in frame
      try {
        if (zoomCapabilities.supported && typeof zoomLevel === "number") {
          const minZ = zoomCapabilities.min ?? 1;
          const nextZ = Math.max(minZ, zoomLevel - 0.035);
          if (nextZ !== zoomLevel) setZoom(nextZ);
        }
      } catch {
        // ignore zoom errors
      }

      requestRefreshMeta();
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
    if (isAnomalyPaused) {
      toast.error("Rapid scan is paused — resume or clear the bad batch first.");
      return;
    }
    if (!cameraOn) return;
    if (busyCapture) return;
    setBusyCapture(true);
    triggerFlash();
    triggerHaptics();
    playShutterSound();

    try {
      const current = await idbCount();
      if (current >= queueMax) {
        toast.error(`Buffer full (${queueMax}). Let it process or clear.`);
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

      // iPhone 17 Pro captures in Display P3 wide gamut. Drawing a P3 video
      // into a default (sRGB) canvas desaturates/shifts colors. Request a
      // P3 canvas on capable devices so the JPEG matches the live preview.
      const iphone17 = isIPhone17Class();
      let ctx = c.getContext("2d", {
        willReadFrequently: false,
        colorSpace: iphone17 ? "display-p3" : "srgb",
      } as CanvasRenderingContext2DSettings) as CanvasRenderingContext2D | null;
      if (!ctx) {
        // Fallback for browsers that reject the colorSpace option
        ctx = c.getContext("2d", { willReadFrequently: false });
      }
      if (!ctx) throw new Error("Canvas not available");

      ctx.drawImage(v, 0, 0, w, h);

      // ── Blank/whiteout frame guard ──
      // Sample a small downscale and reject frames that are nearly uniform white
      // (camera not focused on a card, blown-out highlights, lens covered, etc.).
      try {
        const sw = 64, sh = 64;
        const probe = document.createElement("canvas");
        probe.width = sw; probe.height = sh;
        const pctx = probe.getContext("2d", { willReadFrequently: true });
        if (pctx) {
          pctx.drawImage(c, 0, 0, sw, sh);
          const { data } = pctx.getImageData(0, 0, sw, sh);
          let sum = 0, sumSq = 0; const n = sw * sh;
          for (let i = 0; i < data.length; i += 4) {
            const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
            sum += lum; sumSq += lum * lum;
          }
          const mean = sum / n;
          const variance = sumSq / n - mean * mean;
          const std = Math.sqrt(Math.max(0, variance));
          // Whiteout: very bright AND very low variance (no card edges/text/art).
          if (mean > 225 && std < 12) {
            toast.error("Blank frame — point at a card and try again");
            setBusyCapture(false);
            return;
          }
          // Blackout: lens covered.
          if (mean < 18 && std < 10) {
            toast.error("Dark frame — check the lens and try again");
            setBusyCapture(false);
            return;
          }
        }
      } catch {
        // If probing fails, fall through and capture anyway.
      }

      // iPhone 17 class has best-in-class ISP — skip JS color/glare passes
      // because they soften the edges OCR depends on.
      if (!iphone17) {
        applyAutoColorBalance(ctx, c, 0.5);
        applyAntiGlare(ctx, c, 0.2);
      }


      if (settings.autoZoomEnabled) {
        clarityZoom.analyzeAndAdjustZoom(v).catch(() => {});
      }

      const captureQuality = iphone17 ? 0.98 : 0.95;
      const blob: Blob | null = await new Promise((resolve) =>
        c.toBlob(resolve, "image/jpeg", captureQuality)
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

      // On iPhone 17 class, keep more detail for OCR (longer edge ~2400px @ q0.92).
      const compressedBlob = await compressImageForQueue(
        blob,
        iphone17
          ? { maxWidth: 2400, maxHeight: 2400, quality: 0.92 }
          : undefined,
      );
      
      await idbAdd({
        id,
        createdAt: Date.now(),
        status: "queued",
        blob: compressedBlob,
        mime: compressedBlob.type || "image/jpeg",
        filename: "card.jpg",
      });

      setStatusLine("Captured — pricing will run after you stop");
      setOverlay({ label: "Captured…" });

      // Progressive zoom-out after each snap to keep card in frame
      try {
        if (zoomCapabilities.supported && typeof zoomLevel === "number") {
          const minZ = zoomCapabilities.min ?? 1;
          const nextZ = Math.max(minZ, zoomLevel - 0.035);
          if (nextZ !== zoomLevel) setZoom(nextZ);
        }
      } catch {
        // ignore zoom errors
      }

      requestRefreshMeta();
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
    if (isAnomalyPaused) {
      toast.error("Rapid scan is paused — resume or clear the bad batch first.");
      return;
    }
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
  }, [cameraOn, isNative, autoTimerSeconds, isAnomalyPaused]);

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

  useEffect(() => {
    if (!isAnomalyPaused) return;
    if (autoTimerActive) {
      stopAutoTimer();
    }
    setStatusLine("Queue paused — repeated identical identifications detected");
    setOverlay({ label: "Rapid scan paused" });
  }, [isAnomalyPaused, autoTimerActive, stopAutoTimer]);

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
      psa10Price: card.psa10Price,
      imageUrl: card.imageUrl,
      isInLibrary: card.isInLibrary,
      libraryQuantity: card.libraryQuantity,
      dbId: card.dbId,
      priceFetching: false,
      year: card.year,
      team: card.team,
      manufacturer: card.manufacturer,
    });

    // Play sound for high-value cards
    if (typeof card.value === "number" && card.value >= 50) {
      playJackpotBeep();
    } else if (typeof card.value === "number" && card.value >= 15) {
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

  // Sync cards from recent-scan-added events (background queue processing).
  // Uses upsert semantics so background-completed scans (e.g. captured from
  // another route or while this component was unmounted) appear in the list.
  useEffect(() => {
    const handleRecentScanAdded = () => {
      const recentScans = getRecentScans();
      if (recentScans.length === 0) return;
      setCards((prev) => {
        const byId = new Map(prev.map((c) => [c.id, c]));
        for (const scan of recentScans) {
          const patch: Partial<ScannedCard> = {
            status: "completed",
            cardName: scan.card_name,
            cardSet: scan.card_set || undefined,
            cardNumber: scan.card_number || undefined,
            playerName: scan.player_name || undefined,
            rarity: scan.rarity || undefined,
            gameType: scan.gameType || undefined,
            sportType: scan.sportType || undefined,
            value: scan.price ?? undefined,
            psa10Price: scan.psa10Price ?? undefined,
            imageUrl: scan.image_url,
            isInLibrary: scan.isInLibrary,
            libraryQuantity: scan.libraryQuantity,
            dbId: scan.dbId || undefined,
            priceFetching: false,
            year: scan.year || undefined,
            team: scan.team || undefined,
            manufacturer: scan.manufacturer || undefined,
          };
          const existing = byId.get(scan.id);
          if (existing) {
            byId.set(scan.id, { ...existing, ...patch });
          } else {
            // Inject scans processed in background (different route/unmounted)
            byId.set(scan.id, {
              id: scan.id,
              preview: scan.image_url,
              ...patch,
            } as ScannedCard);
          }
        }
        // Preserve recentScans ordering (newest first); append any in-session
        // cards not present in recentScans (still queued/processing).
        const ordered: ScannedCard[] = [];
        const consumed = new Set<string>();
        for (const scan of recentScans) {
          const c = byId.get(scan.id);
          if (c) { ordered.push(c); consumed.add(scan.id); }
        }
        for (const c of prev) {
          if (!consumed.has(c.id)) ordered.push(c);
        }
        return ordered;
      });
    };

    window.addEventListener("recent-scan-added", handleRecentScanAdded);
    // Also hydrate on mount from any scans processed while unmounted
    handleRecentScanAdded();

    return () => {
      window.removeEventListener("recent-scan-added", handleRecentScanAdded);
    };
  }, [updateCard]);

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

        // Clear the card from the rapid-scan queue/list once it's safely in the library
        await removeCard(id);
      } catch (e: any) {
        console.error(e);
        updateCard(id, { priceFetching: false });
        toast.error(e?.message ?? "Failed to save");
      }
    },
    [cards, updateCard, userId, removeCard]
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
        // Clear from rapid scan queue once persisted
        await removeCard(c.id);
      } catch (e: any) {
        console.error(`Failed to add ${c.cardName}:`, e);
        updateCard(c.id, { priceFetching: false });
      }
    }

    toast.success(`Added ${added} of ${newCards.length} cards to library`, { id: "bulk-add" });
  }, [cards, updateCard, userId, removeCard]);

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
    queueProcessor.stop();
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
    queueProcessor.resume();
    await refreshMeta();
    setOverlay(null);
    toast.success("Cleared");
  }, [queueProcessor, refreshMeta]);

  const handleResumeAfterAnomaly = useCallback(async () => {
    queueProcessor.resume();
    queueProcessor.start();
    setStatusLine("Queue resumed — processing queued cards");
    toast.success("Rapid scan resumed");
    await refreshMeta();
  }, [queueProcessor, refreshMeta]);

  const handleClearBadBatch = useCallback(async () => {
    await clearAll();
    setStatusLine("Bad batch cleared — ready for new scans");
  }, [clearAll]);

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
      {/* ── Compact top bar ── */}
      <div className="flex flex-col gap-3 px-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Select
            value={settings.gameTypeFilter}
            onValueChange={(val) => updateSettings({ gameTypeFilter: val as ScannerSettings["gameTypeFilter"] })}
          >
            <SelectTrigger className="h-8 w-[130px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto Detect</SelectItem>
              <SelectItem value="mtg">MTG</SelectItem>
              <SelectItem value="yugioh">Yu-Gi-Oh!</SelectItem>
              <SelectItem value="pokemon">Pokémon</SelectItem>
              <SelectItem value="sports">Sports</SelectItem>
              <SelectItem value="gpk">GPK</SelectItem>
              <SelectItem value="marvel">Marvel</SelectItem>
              <SelectItem value="onepiece">One Piece</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
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
              ? "Remove" 
              : settings.scanMode === "SAVE" 
              ? "Save" 
              : "Price"}
          </Badge>
          <Badge variant="outline" className="text-xs py-1 px-2">
            ${totalValue.toFixed(2)}
          </Badge>
          <Badge variant="outline" className="text-xs py-1 px-2 text-muted-foreground">
            {bufferedItemsCount} buffered
          </Badge>
        </div>

        <div className="flex rounded-lg border overflow-hidden">
          <Button
            variant={settings.scanMode === "SAVE" ? "default" : "ghost"}
            size="sm"
            className="rounded-none border-0 px-2.5 h-8"
            onClick={() => {
              updateSettings({ scanMode: "SAVE" });
              toast.info("Save Mode");
            }}
          >
            <Save className="h-4 w-4" />
          </Button>
          <Button
            variant={settings.scanMode === "SCAN_ONLY" ? "secondary" : "ghost"}
            size="sm"
            className="rounded-none border-0 border-x px-2.5 h-8"
            onClick={() => {
              updateSettings({ scanMode: "SCAN_ONLY" });
              toast.info("Price Mode");
            }}
          >
            <Eye className="h-4 w-4" />
          </Button>
          <Button
            variant={settings.scanMode === "REMOVE" ? "destructive" : "ghost"}
            size="sm"
            className="rounded-none border-0 px-2.5 h-8"
            onClick={() => {
              updateSettings({ scanMode: "REMOVE" });
              toast.info("Remove Mode");
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {!isNative && (
        <div className="rounded-xl border bg-card/80 p-3 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-0.5">
              <div className="text-sm font-semibold text-foreground">Camera Selection</div>
              <p className="text-xs text-muted-foreground">
                Choose Camo, iPad, USB, or built-in cameras before starting rapid scan.
              </p>
            </div>
            <CameraDeviceSelector
              devices={cameraDevices}
              selectedDeviceId={selectedDeviceId}
              onDeviceChange={async (deviceId) => {
                setSelectedDeviceId(deviceId);
                if (cameraOn) {
                  await stopCamera();
                  window.setTimeout(() => void startCamera(), 100);
                }
              }}
              onRefresh={refreshDevices}
              isLoading={devicesLoading}
              className="sm:items-end"
            />
          </div>
        </div>
      )}

      {/* Anomaly alert */}
      {isAnomalyPaused && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-0.5">
              <div className="text-sm font-semibold text-foreground">Rapid scan paused</div>
              <p className="text-xs text-muted-foreground">
                Repeated identical cards detected. Queue paused.
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void handleResumeAfterAnomaly()}>Resume</Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (window.confirm("Clear the current rapid scan batch?")) {
                    void handleClearBadBatch();
                  }
                }}
              >
                Clear Batch
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Viewfinder ── */}
      <div className={cn(
        "relative overflow-hidden rounded-2xl bg-black shadow-xl",
        settings.scanMode === "REMOVE" ? "ring-2 ring-destructive/50" : "ring-1 ring-primary/20"
      )}>
        <video
          ref={videoRef}
          className={cn(
            "w-full object-contain",
            "h-[60vh] min-h-[350px] max-h-[600px]",
            "sm:h-[55vh] sm:min-h-[400px] sm:max-h-[580px]",
            "md:h-[520px] md:min-h-0 md:max-h-none",
            "lg:h-[560px]",
            "landscape:h-[65vh] landscape:min-h-[280px] landscape:max-h-[480px]",
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

        {/* Alignment frame */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div 
            className="border-2 border-dashed border-white/30 rounded-lg relative"
            style={{ width: "min(80%, 320px)", aspectRatio: "5/7" }}
          >
            <div className="absolute -top-1.5 -left-1.5 w-8 h-8 border-t-[3px] border-l-[3px] border-primary/80 rounded-tl-lg" />
            <div className="absolute -top-1.5 -right-1.5 w-8 h-8 border-t-[3px] border-r-[3px] border-primary/80 rounded-tr-lg" />
            <div className="absolute -bottom-1.5 -left-1.5 w-8 h-8 border-b-[3px] border-l-[3px] border-primary/80 rounded-bl-lg" />
            <div className="absolute -bottom-1.5 -right-1.5 w-8 h-8 border-b-[3px] border-r-[3px] border-primary/80 rounded-br-lg" />
          </div>
        </div>

        {/* Foil detection overlay */}
        {settings.foilDetectionEnabled && cameraOn && (
          <FoilDetectionOverlay
            result={foilResult}
            frameCount={foilAnalyzerRef.current.frameCount}
            visible={true}
          />
        )}

        <canvas ref={canvasRef} className="hidden" />
        {flashActive && <div className="capture-flash" />}

        {/* Torch dimmer overlay */}
        {torchOn && torchDimmer < 100 && (
          <div 
            className="pointer-events-none absolute inset-0 bg-black/80 transition-opacity duration-200"
            style={{ opacity: (100 - torchDimmer) / 100 * 0.7 }}
          />
        )}

        {/* ── Overlay: top-left camera selector pill ── */}
        {!isNative && cameraOn && (
          <div className="absolute top-3 left-3 z-10">
            <CameraDeviceSelector
              devices={cameraDevices}
              selectedDeviceId={selectedDeviceId}
              onDeviceChange={async (deviceId) => {
                setSelectedDeviceId(deviceId);
                if (cameraOn) {
                  await stopCamera();
                  window.setTimeout(() => void startCamera(), 100);
                }
              }}
              onRefresh={refreshDevices}
              isLoading={devicesLoading}
              className="rounded-xl bg-black/60 p-2 backdrop-blur-sm"
            />
          </div>
        )}

        {/* ── Overlay: right-side zoom controls ── */}
        {cameraOn && zoomCapabilities.supported && (
          <div className="absolute top-1/2 right-3 z-10 -translate-y-1/2 flex flex-col items-center gap-2 rounded-full bg-black/60 backdrop-blur-sm p-2">
            <button
              type="button"
              onClick={() => {
                const max = zoomCapabilities.max ?? 5;
                setZoom(Math.min(max, (zoomLevel || 1) + 0.5));
              }}
              disabled={zoomLevel >= (zoomCapabilities.max ?? 5)}
              className="h-9 w-9 rounded-full bg-white/15 text-white text-lg font-bold flex items-center justify-center hover:bg-white/25 disabled:opacity-40"
              aria-label="Zoom in"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => setZoom(1)}
              className="text-[11px] text-white font-semibold tabular-nums px-1"
              aria-label="Reset zoom"
            >
              {(zoomLevel || 1).toFixed(1)}×
            </button>
            <button
              type="button"
              onClick={() => {
                const min = zoomCapabilities.min ?? 1;
                setZoom(Math.max(min, (zoomLevel || 1) - 0.5));
              }}
              disabled={zoomLevel <= (zoomCapabilities.min ?? 1)}
              className="h-9 w-9 rounded-full bg-white/15 text-white text-lg font-bold flex items-center justify-center hover:bg-white/25 disabled:opacity-40"
              aria-label="Zoom out"
            >
              −
            </button>
            {usingDigitalZoom && (
              <span className="text-[9px] text-white/60 -mt-1">digital</span>
            )}
          </div>
        )}

        {/* ── Overlay: autofocus trigger ── */}
        {cameraOn && support.focus && (
          <button
            type="button"
            onClick={async () => {
              const track = trackRef.current;
              if (!track?.applyConstraints) return;
              try {
                // Nudge AF: switch to manual then back to continuous to retrigger lock.
                await track.applyConstraints({ advanced: [{ focusMode: "manual" } as any] });
                await new Promise((r) => setTimeout(r, 60));
                await track.applyConstraints({ advanced: [{ focusMode: "continuous" } as any] });
                triggerHaptics();
                setOverlay({ label: "Focusing…" });
              } catch {
                // ignore
              }
            }}
            className="absolute top-3 right-3 z-10 h-10 px-3 rounded-full bg-black/60 backdrop-blur-sm text-white text-xs font-semibold flex items-center gap-1.5 hover:bg-black/80"
            aria-label="Refocus"
            title="Tap to refocus (or tap anywhere on the preview)"
          >
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
            AF
          </button>
        )}




        {/* Voice capture pill */}
        {settings.voiceCaptureEnabled && (
          <div className="absolute top-3 left-3 z-10" style={{ left: !isNative && cameraDevices.length > 1 ? 'auto' : undefined, right: !isNative && cameraDevices.length > 1 ? '3.5rem' : undefined }}>
            <div className="bg-black/60 backdrop-blur-sm rounded-full px-3 py-1.5 flex items-center gap-1.5">
              <span className="text-xs text-white font-medium">Voice</span>
              <span className={cn("text-[10px]", voice.listening ? "text-emerald-300" : "text-white/50")}>
                {voice.supported ? (voice.listening ? "●" : "○") : "—"}
              </span>
            </div>
          </div>
        )}

        {/* ── Overlay: bottom status gradient ── */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent p-3 pt-8">
          <div className="flex items-end justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs text-white/70">{statusLine}</div>
              <div className="truncate text-sm font-semibold text-white">
                {overlay?.label ? overlay.label : ""}
              </div>
              {overlay?.value != null && (
                <div className="text-xs text-white/80">
                  ${overlay.value.toFixed(2)}{" "}
                  {overlay.isInLibrary ? `• In library ×${Math.max(overlay.libraryQuantity || 1, 1)}` : "• New"}
                </div>
              )}
            </div>
            <div className="text-right text-[10px] text-white/50 shrink-0">
              {cameraOn ? "Pinch to zoom • Tap to focus • Stop to price" : ""}
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom capture bar ── */}
      <div className="flex items-center justify-center gap-4 py-2">
        {/* Left: Auto-timer toggle + speed selector */}
        {!isNative && cameraOn ? (
          <div className="relative shrink-0">
            <Button
              onClick={autoTimerActive ? stopAutoTimer : startAutoTimer}
              variant={autoTimerActive ? "destructive" : "outline"}
              size="icon"
              className="h-14 w-14 rounded-full"
              disabled={isAnomalyPaused}
              title={autoTimerActive ? "Stop auto-capture" : `Auto every ${autoTimerSeconds}s`}
            >
              {autoTimerActive ? (
                <div className="flex flex-col items-center">
                  <TimerOff className="h-5 w-5" />
                  <span className="text-[10px] mt-0.5 font-semibold">{autoTimerCountdown}s</span>
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <Timer className="h-5 w-5" />
                  <span className="text-[10px] mt-0.5">{autoTimerSeconds}s</span>
                </div>
              )}
            </Button>
            {/* Speed selector badge — tap to cycle */}
            {!autoTimerActive && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const speeds: number[] = [1, 1.1, 1.25, 1.5, 2, 5];
                  const idx = speeds.indexOf(autoTimerSeconds as any);
                  const next = speeds[(idx + 1) % speeds.length];
                  updateSettings({ autoTimerIntervalSeconds: next });
                }}
                className="absolute -top-1 -right-1 bg-primary text-primary-foreground rounded-full h-5 min-w-5 px-1 text-[9px] font-bold flex items-center justify-center shadow-md"
                title="Tap to change speed"
              >
                {autoTimerSeconds}s
              </button>
            )}
          </div>
        ) : <div className="w-14" />}

        {/* Center: Large capture / start button */}
        <button
          onTouchStart={() => warmUpAudio()}
          onMouseDown={() => warmUpAudio()}
          onClick={isNative ? captureWithNativeCamera : (cameraOn ? captureAndEnqueue : startCamera)}
          disabled={isNative ? isAnomalyPaused : (cameraOn ? (busyCapture || autoTimerActive || isAnomalyPaused) : false)}
          className={cn(
            "relative h-20 w-20 rounded-full transition-all duration-200 shrink-0",
            "flex items-center justify-center",
            "disabled:opacity-40 disabled:cursor-not-allowed",
            "active:scale-95",
            cameraOn
              ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/40"
              : "bg-secondary text-secondary-foreground border-2 border-primary/50 hover:border-primary"
          )}
        >
          {/* Pulsing ring when camera is ready */}
          {cameraOn && !busyCapture && !autoTimerActive && (
            <span className="absolute inset-0 rounded-full border-2 border-primary/60 animate-pulse" />
          )}
          {busyCapture ? (
            <Loader2 className="h-8 w-8 animate-spin" />
          ) : cameraOn ? (
            <Camera className="h-8 w-8" />
          ) : (
            <Camera className="h-8 w-8" />
          )}
        </button>

        {/* Right: Stop + torch controls */}
        {cameraOn ? (
          <div className="flex items-center gap-3 shrink-0">
            <Button
              variant="destructive"
              size="icon"
              className="h-14 w-14 rounded-full"
              onClick={stopCamera}
              title="Stop camera and start pricing"
            >
              <CameraOff className="h-5 w-5" />
            </Button>
            {!isNative && (
              <Button
                variant={torchOn ? "secondary" : "outline"}
                size="icon"
                className="h-14 w-14 rounded-full"
                onClick={toggleTorch}
                disabled={!support.torch}
                title={support.torch ? "Toggle flash" : "Flash not supported"}
              >
                {torchOn ? <FlashlightOff className="h-5 w-5" /> : <Flashlight className="h-5 w-5" />}
              </Button>
            )}
          </div>
        ) : <div className="w-14" />}
      </div>

      {/* Start/stop label */}
      {!cameraOn && !isNative && (
        <div className="text-center text-sm text-muted-foreground -mt-2">
          Tap to start camera
        </div>
      )}

      {/* ── Status strip ── */}
      <div className="flex items-center justify-between px-2 text-xs text-muted-foreground">
        <span>
          Captured waiting: {queuedItemsCount} • Pricing now: {processingItemsCount}
        </span>
        <div className="flex items-center gap-2">
          {!isNative && cameraOn && zoomLevel > 1 && (
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setZoom(1)}>
              Reset {zoomLevel.toFixed(1)}×
            </Button>
          )}
          <Button 
            variant="ghost" 
            size="sm"
            className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
            onClick={() => {
              if (window.confirm("Clear all queued cards?")) {
                if (window.confirm("Are you SURE? This cannot be undone.")) {
                  clearAll();
                }
              }
            }}
          >
            <Trash2 className="h-3 w-3 mr-1" /> Clear
          </Button>
        </div>
      </div>

      {/* ── Find Prices Now button ── */}
      {cards.some((c) => c.status === "completed") && (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-lg border border-border bg-card/50 px-3 py-2">
          <div className="text-xs text-muted-foreground">
            {missingPriceCount > 0
              ? `${missingPriceCount} scanned ${missingPriceCount === 1 ? "card has" : "cards have"} no price yet`
              : "All scanned cards have prices"}
          </div>
          <Button
            size="sm"
            variant={missingPriceCount > 0 ? "default" : "outline"}
            onClick={findPricesNow}
            disabled={findingPrices || missingPriceCount === 0}
          >
            {findingPrices ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <DollarSign className="h-4 w-4 mr-1" />
            )}
            Find Prices Now {missingPriceCount > 0 ? `(${missingPriceCount})` : ""}
          </Button>
        </div>
      )}

      {/* ── Scanned cards list ── */}
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
