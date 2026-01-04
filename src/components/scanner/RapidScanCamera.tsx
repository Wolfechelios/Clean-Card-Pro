import { useState, useRef, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { insertCardDual } from "@/lib/localCards";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Camera, SwitchCamera, X, CheckCircle, Loader2, Pause, Play, Zap, Usb, Smartphone, RefreshCw, DollarSign, ImagePlus, Eye, Library } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useCameraDevices } from "@/hooks/use-camera-devices";
import { CameraDeviceSelector } from "./CameraDeviceSelector";
import { ScannedCardList } from "./ScannedCardList";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCameraZoom } from "@/hooks/use-camera-zoom";
import { ZoomControls } from "./ZoomControls";
import { isNativePlatform } from "@/lib/platform";
import {
  getMaxCameraConstraints,
  applyFastAutofocus,
  triggerFastFocus,
} from "@/lib/camera-optimizations";

interface RapidScanCameraProps {
  userId: string;
  onComplete: () => void;
}

interface CapturedCard {
  id: string;
  blob: Blob;
  preview: string;
  status: 'queued' | 'uploading' | 'processing' | 'completed' | 'error';
  cardName?: string;
  cardSet?: string;
  cardNumber?: string;
  rarity?: string;
  value?: number | null;
  error?: string;
  dbId?: string;
  priceFetching?: boolean;
  // Scan mode fields
  libraryQuantity?: number;
  isInLibrary?: boolean;
  imageUrl?: string;
  gameType?: string;
  sportType?: string;
  confidence?: number;
}

const MAX_CAPTURES = 100;

export const RapidScanCamera = ({ userId, onComplete }: RapidScanCameraProps) => {
  const [isActive, setIsActive] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<'environment' | 'user'>('environment');
  const [cameraMode, setCameraMode] = useState<'device' | 'usb'>('device');
  const [captures, setCaptures] = useState<CapturedCard[]>([]);
  const [processing, setProcessing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  // Auto-capture (Android Chrome friendly): one-shot per card, re-arms on movement/change
  const [autoCaptureEnabled, setAutoCaptureEnabled] = useState(true);
  const autoCaptureEnabledRef = useRef(true);
  const [autoHint, setAutoHint] = useState<string>("Hold steady");
  const autoHintRef = useRef<string>("Hold steady");
  const autoStateRef = useRef<"ARMED" | "LOCKED">("ARMED");
  const stableMsRef = useRef(0);
  const lastShotAtRef = useRef(0);
  const lockedSinceRef = useRef(0);
  const lastSampleAtRef = useRef(0);
  const prevGrayRef = useRef<Uint8Array | null>(null);
  const prevHashRef = useRef<bigint | null>(null);
  const isCapturingRef = useRef(false);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sampleCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const capturePhotoRef = useRef<(() => Promise<void>) | null>(null);
  const [flashEnabled, setFlashEnabled] = useState(false);
  const [flashSupported, setFlashSupported] = useState(false);
  const [isRefreshingPrices, setIsRefreshingPrices] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  // Scan Mode: price check without adding to collection
  const [scanMode, setScanMode] = useState(false);
  const scanModeRef = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const processingQueueRef = useRef<string[]>([]);
  const isProcessingRef = useRef(false);
  const capturesRef = useRef<CapturedCard[]>([]);
  const shutterSoundRef = useRef<HTMLAudioElement | null>(null);
  const errorSoundRef = useRef<HTMLAudioElement | null>(null);

  // Initialize sounds
  useEffect(() => {
    shutterSoundRef.current = new Audio('/sounds/shutter.mp3');
    shutterSoundRef.current.volume = 0.5;
    errorSoundRef.current = new Audio('/sounds/error.mp3');
    errorSoundRef.current.volume = 0.6;
    return () => {
      shutterSoundRef.current = null;
      errorSoundRef.current = null;
    };
  }, []);

  useEffect(() => {
    autoCaptureEnabledRef.current = autoCaptureEnabled;
  }, [autoCaptureEnabled]);

  useEffect(() => {
    scanModeRef.current = scanMode;
  }, [scanMode]);

  const { devices, selectedDeviceId, setSelectedDeviceId, isLoading: devicesLoading, refreshDevices } = useCameraDevices();
  
  // Zoom controls
  const { zoomLevel, zoomCapabilities, usingDigitalZoom, detectZoomCapabilities, setZoom, zoomIn, zoomOut, resetZoom } = useCameraZoom({
    streamRef,
  });
  
  // Pinch-to-zoom + tap-to-focus helpers (works even when hardware zoom/focus constraints are limited)
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStartRef = useRef<{ dist: number; zoom: number } | null>(null);
  const focusHideTimerRef = useRef<number | null>(null);
  const [focusRing, setFocusRing] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    return () => {
      if (focusHideTimerRef.current) {
        window.clearTimeout(focusHideTimerRef.current);
        focusHideTimerRef.current = null;
      }
    };
  }, []);

  const showFocusRing = (x: number, y: number) => {
    setFocusRing({ x, y });
    if (focusHideTimerRef.current) window.clearTimeout(focusHideTimerRef.current);
    focusHideTimerRef.current = window.setTimeout(() => setFocusRing(null), 650);
  };


const setAutoHintSafe = (hint: string) => {
  if (autoHintRef.current !== hint) {
    autoHintRef.current = hint;
    setAutoHint(hint);
  }
};

const hammingDistance64 = (a: bigint, b: bigint) => {
  let x = a ^ b;
  let c = 0;
  while (x) {
    c++;
    x &= (x - 1n);
  }
  return c;
};

  const handlePointerDown = async (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isActive) return;

    const el = e.currentTarget;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // Some browsers may throw; ignore
    }

    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    // If we now have 2 pointers: begin pinch
    if (pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      pinchStartRef.current = { dist, zoom: zoomLevel };
      return;
    }

    // Single pointer: treat as tap-to-focus
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    showFocusRing(x, y);

    if (streamRef.current) {
      await triggerFastFocus(streamRef.current);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isActive) return;
    if (!pointersRef.current.has(e.pointerId)) return;

    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 2 && pinchStartRef.current) {
      const pts = Array.from(pointersRef.current.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const scale = dist / Math.max(1, pinchStartRef.current.dist);
      const target = pinchStartRef.current.zoom * scale;
      // Fire-and-forget; hook clamps
      void setZoom(target);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchStartRef.current = null;
  };

  // Filter USB vs regular devices
  const usbDevices = devices.filter(d => d.isUSB);
  const regularDevices = devices.filter(d => !d.isUSB);
  const hasUSBDevices = usbDevices.length > 0;

  const startCamera = async (deviceId?: string) => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }

      const targetDeviceId = deviceId || selectedDeviceId;
      const isUSBMode = cameraMode === 'usb';

      // Use maximum quality camera constraints (8K/4K support)
      const constraintOptions = getMaxCameraConstraints(cameraFacing, targetDeviceId);

      let stream: MediaStream | null = null;
      let lastError: Error | null = null;

      for (const constraints of constraintOptions) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          break;
        } catch (err: any) {
          lastError = err;
          console.warn('Constraint failed, trying fallback:', err.name);
        }
      }

      if (!stream) {
        throw lastError || new Error('Failed to access camera');
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.setAttribute('playsinline', 'true');
        videoRef.current.setAttribute('webkit-playsinline', 'true');
        streamRef.current = stream;
        
        await new Promise<void>((resolve, reject) => {
          const video = videoRef.current;
          if (!video) {
            reject(new Error('Video element not found'));
            return;
          }
          
          video.onloadedmetadata = () => {
            video.play()
              .then(() => {
                console.log('Camera started:', video.videoWidth, 'x', video.videoHeight);
                resolve();
              })
              .catch(() => resolve()); // Continue anyway - some browsers need user interaction
          };
          
          video.onerror = () => reject(new Error('Video error'));
          setTimeout(() => resolve(), 3000);
        });
        
        setIsActive(true);
        // Apply fast continuous autofocus
        await applyFastAutofocus(stream);
        detectZoomCapabilities();
        // Check flash support
        checkFlashSupport(stream);
        
        // Log actual resolution
        const settings = stream.getVideoTracks()[0]?.getSettings?.();
        console.log(`Rapid scan camera: ${settings?.width}x${settings?.height}`);
        // Silent start - no toast on mobile for cleaner UX
      }
    } catch (error: any) {
      console.error("Camera error:", error);
      const messages: Record<string, string> = {
        NotAllowedError: "Camera permission denied. Please allow camera access.",
        NotFoundError: "No camera found on this device.",
        NotReadableError: "Camera is in use by another application.",
        OverconstrainedError: "Camera doesn't support requested settings.",
      };
      toast.error(messages[error.name] || `Camera error: ${error.message}`);
    }
  };

  // Check flash/torch support when camera starts
  const checkFlashSupport = async (stream: MediaStream) => {
    try {
      const track = stream.getVideoTracks()[0];
      if (!track) return;

      const capabilities = track.getCapabilities?.() as any;
      
      if (capabilities?.torch === true || capabilities?.torch !== undefined) {
        setFlashSupported(true);
        console.log('Flash/torch IS supported');
      } else {
        setFlashSupported(false);
        console.log('Flash/torch NOT supported by this camera');
      }
    } catch (e) {
      console.log('Flash check failed:', e);
      setFlashSupported(false);
    }
  };

  // Toggle flash/torch for dim lighting
  const toggleFlash = async () => {
    if (!streamRef.current) {
      toast.error('Camera not active');
      return;
    }
    
    try {
      const track = streamRef.current.getVideoTracks()[0];
      if (!track) {
        toast.error('No video track found');
        return;
      }

      const capabilities = track.getCapabilities?.() as any;
      console.log('Toggle flash - capabilities:', capabilities);
      
      if (!capabilities?.torch) {
        toast.info('Flash not available on this camera');
        setFlashSupported(false);
        return;
      }

      const newFlashState = !flashEnabled;
      console.log('Setting torch to:', newFlashState);
      
      await track.applyConstraints({
        advanced: [{ torch: newFlashState } as any]
      });
      
      setFlashEnabled(newFlashState);
      setFlashSupported(true);
      toast.success(newFlashState ? '🔦 Flash ON' : 'Flash OFF');
    } catch (e: any) {
      console.error('Flash toggle failed:', e);
      toast.error('Failed to toggle flash: ' + (e.message || 'Unknown error'));
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsActive(false);
    setFlashEnabled(false);
    setFlashSupported(false);
  };

  // Keyboard shutter trigger for USB mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isActive && (e.code === 'Space' || e.code === 'Enter' || e.key === 'VolumeUp' || e.key === 'VolumeDown')) {
        e.preventDefault();
        capturePhoto();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isActive]);

  // Handle mode change
  const handleModeChange = (mode: string) => {
    setCameraMode(mode as 'device' | 'usb');
    if (isActive) {
      stopCamera();
    }
    // Auto-select first device of the chosen mode
    const targetDevices = mode === 'usb' ? usbDevices : regularDevices;
    if (targetDevices.length > 0) {
      setSelectedDeviceId(targetDevices[0].deviceId);
    }
  };

  const toggleCamera = () => {
    const newFacing = cameraFacing === 'environment' ? 'user' : 'environment';
    setCameraFacing(newFacing);
    if (isActive) {
      stopCamera();
      setTimeout(() => startCamera(), 100);
    }
  };

  const handleDeviceChange = (deviceId: string) => {
    setSelectedDeviceId(deviceId);
    if (isActive) {
      stopCamera();
      setTimeout(() => startCamera(deviceId), 100);
    }
  };

  // Reusable canvas for faster captures
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const captureCtxRef = useRef<CanvasRenderingContext2D | null>(null);

  const capturePhoto = async () => {
    if (isCapturingRef.current) return;
    isCapturingRef.current = true;

    // If auto is on, lock immediately so we don't spam the same card while it sits there
    if (autoCaptureEnabledRef.current) {
      autoStateRef.current = "LOCKED";
      stableMsRef.current = 0;
      lastShotAtRef.current = performance.now ? performance.now() : Date.now();
      lockedSinceRef.current = lastShotAtRef.current;
      setAutoHintSafe("Capturing…");
    }

    try {
      if (!videoRef.current || captures.length >= MAX_CAPTURES) {
        if (captures.length >= MAX_CAPTURES) {
          toast.warning(`Maximum ${MAX_CAPTURES} cards reached`);
        }
        return;
      }

      const video = videoRef.current;

      // Validate video is actually streaming
      if (video.videoWidth === 0 || video.videoHeight === 0 || video.readyState < 2) {
        toast.error("Camera not ready. Please wait for video to load.");
        return;
      }

      // FAST PATH: Fire-and-forget focus - don't wait for it
      if (streamRef.current) {
        triggerFastFocus(streamRef.current).catch(() => {});
      }

      // Reuse canvas for faster captures (avoid GC overhead)
      if (!captureCanvasRef.current) {
        captureCanvasRef.current = document.createElement("canvas");
      }
      const canvas = captureCanvasRef.current;

      // Crop to card aspect ratio (5:7) WITHOUT upscaling (the previous math could create huge canvases)
      const TARGET_RATIO = 5 / 7;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const videoRatio = vw / vh;

      let cropW = vw;
      let cropH = vh;
      let cropX = 0;
      let cropY = 0;

      if (videoRatio > TARGET_RATIO) {
        cropH = vh;
        cropW = Math.round(vh * TARGET_RATIO);
        cropX = Math.round((vw - cropW) / 2);
      } else {
        cropW = vw;
        cropH = Math.round(vw / TARGET_RATIO);
        cropY = Math.round((vh - cropH) / 2);
      }

      // Digital zoom cropping if hardware zoom unavailable
      const effectiveZoom = usingDigitalZoom ? zoomLevel : 1;
      if (effectiveZoom > 1) {
        const zw = cropW / effectiveZoom;
        const zh = cropH / effectiveZoom;
        cropX += (cropW - zw) / 2;
        cropY += (cropH - zh) / 2;
        cropW = zw;
        cropH = zh;
      }

      // Downscale output for rapid scanning speed (huge impact on shutter latency)
      const MAX_OUT_W = 1600;
      const MAX_OUT_H = 2240;
      const scale = Math.min(1, MAX_OUT_W / cropW, MAX_OUT_H / cropH);
      const outW = Math.max(1, Math.round(cropW * scale));
      const outH = Math.max(1, Math.round(cropH * scale));

      // Only resize canvas if dimensions changed
      if (canvas.width !== outW || canvas.height !== outH) {
        canvas.width = outW;
        canvas.height = outH;
        captureCtxRef.current = null; // Force context refresh
      }

      if (!captureCtxRef.current) {
        captureCtxRef.current = canvas.getContext("2d", {
          alpha: false,
          desynchronized: true,
          willReadFrequently: false,
        });
      }
      const ctx = captureCtxRef.current;
      if (!ctx) throw new Error("Failed to create canvas context");

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "low";

      // Draw cropped + downscaled frame
      ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, outW, outH);

      // Play shutter sound immediately for responsive feel
      if (shutterSoundRef.current) {
        shutterSoundRef.current.currentTime = 0;
        shutterSoundRef.current.play().catch(() => {});
      }

      // Haptic feedback immediately
      if ("vibrate" in navigator) {
        navigator.vibrate(30);
      }

      // Encode JPEG (await so we don't overlap encodes and tank performance)
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Failed to encode image"))),
          "image/jpeg",
          0.88
        );
      });

      const id = `capture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const preview = URL.createObjectURL(blob);

      const newCapture: CapturedCard = {
        id,
        blob,
        preview,
        status: "queued",
      };

      setCaptures((prev) => {
        const updated = [...prev, newCapture];
        capturesRef.current = updated;
        return updated;
      });
      processingQueueRef.current.push(id);

      // Start background processing if not already running
      if (!isProcessingRef.current) {
        processQueue();
      }
    } catch (e: any) {
      console.error("Rapid capture error:", e);
      toast.error(e?.message || "Failed to capture photo");
    } finally {
      isCapturingRef.current = false;
    }
  };

  // Keep latest capture function in a ref for auto-loop
  useEffect(() => {
    capturePhotoRef.current = capturePhoto;
  }, [capturePhoto]);


  // Auto-shutter loop: capture once when stable + sharp, then require movement/change to re-arm
  useEffect(() => {
    if (!isActive || !autoCaptureEnabled) {
      autoStateRef.current = "ARMED";
      stableMsRef.current = 0;
      lastSampleAtRef.current = 0;
      lockedSinceRef.current = 0;
      prevHashRef.current = null;
      prevGrayRef.current = null;
      setAutoHintSafe(autoCaptureEnabled ? "Hold steady" : "Manual");
      return;
    }

    // Lazy init sample canvas/context
    if (!sampleCanvasRef.current) {
      const c = document.createElement("canvas");
      c.width = 96;
      c.height = 96;
      sampleCanvasRef.current = c;
      sampleCtxRef.current = c.getContext("2d", {
        willReadFrequently: true,
      }) as CanvasRenderingContext2D | null;
    }

    const SIZE = 96;
    const SAMPLE_EVERY_MS = 70; // ~14fps sampling, light on CPU
    const STABLE_REQUIRED_MS = 320;
    const COOLDOWN_MS = 1200;

    // Tuned looser for real-world handheld scanning (prevents "never triggers")
    const STABLE_DIFF = 10;
    const RESET_DIFF = 12;
    const HASH_RESET_HAMMING = 10;
    const MIN_SHARPNESS = 0.12;
    const LOCK_TIMEOUT_MS = 6000;

    let raf = 0;
    let stopped = false;

    const computeMetrics = () => {
      const video = videoRef.current;
      const ctx = sampleCtxRef.current;
      const canvas = sampleCanvasRef.current;
      if (!video || !ctx || !canvas) return null;
      if (video.videoWidth === 0 || video.videoHeight === 0 || video.readyState < 2) return null;

      // Sample a centered ROI
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const sw = Math.max(1, Math.floor(vw * 0.6));
      const sh = Math.max(1, Math.floor(vh * 0.6));
      const sx = Math.floor((vw - sw) / 2);
      const sy = Math.floor((vh - sh) / 2);

      try {
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, SIZE, SIZE);
      } catch {
        return null;
      }

      let img: ImageData;
      try {
        img = ctx.getImageData(0, 0, SIZE, SIZE);
      } catch {
        return null;
      }

      const data = img.data;
      const n = SIZE * SIZE;

      let gray = prevGrayRef.current;
      if (!gray || gray.length !== n) {
        gray = new Uint8Array(n);
        prevGrayRef.current = gray;
        // Initialize with current frame to avoid instant triggers
        for (let i = 0, p = 0; i < n; i++, p += 4) {
          const r = data[p],
            g = data[p + 1],
            b = data[p + 2];
          gray[i] = (r * 38 + g * 75 + b * 15) >> 7;
        }
        return { diff: 999, hash: 0n, sharp: 0 };
      }

      // Build current grayscale and compute diff + sharpness in one pass
      let diffSum = 0;
      let gradSum = 0;

      // Precompute mean for hash
      let meanSum = 0;
      const cur = new Uint8Array(n);

      for (let i = 0, p = 0; i < n; i++, p += 4) {
        const r = data[p],
          g = data[p + 1],
          b = data[p + 2];
        const v = (r * 38 + g * 75 + b * 15) >> 7;
        cur[i] = v;
        meanSum += v;
        diffSum += Math.abs(v - gray[i]);
      }

      // Sharpness: average gradient magnitude
      for (let y = 0; y < SIZE - 1; y++) {
        const row = y * SIZE;
        for (let x = 0; x < SIZE - 1; x++) {
          const i = row + x;
          const v = cur[i];
          gradSum += Math.abs(v - cur[i + 1]) + Math.abs(v - cur[i + SIZE]);
        }
      }

      // Swap prev
      gray.set(cur);

      const diff = diffSum / n;

      const gradCount = (SIZE - 1) * (SIZE - 1);
      const sharp = gradSum / (gradCount * 255 * 2);

      const mean = meanSum / n;

      // 64-bit average hash from an 8x8 sampling grid
      const step = Math.floor(SIZE / 8);
      const half = Math.floor(step / 2);
      let hash = 0n;
      let bit = 63n;

      for (let gy = 0; gy < 8; gy++) {
        const y = Math.min(SIZE - 1, gy * step + half);
        for (let gx = 0; gx < 8; gx++) {
          const x = Math.min(SIZE - 1, gx * step + half);
          const v = cur[y * SIZE + x];
          if (v > mean) {
            hash |= 1n << bit;
          }
          bit--;
        }
      }

      return { diff, hash, sharp };
    };

    const loop = (now: number) => {
      if (stopped) return;
      raf = requestAnimationFrame(loop);

      if (!autoCaptureEnabledRef.current) return;
      if (!isActive) return;
      if (isPausedRef.current) return;
      if (isCapturingRef.current) return;
      if (capturesRef.current.length >= MAX_CAPTURES) return;

      if (now - lastSampleAtRef.current < SAMPLE_EVERY_MS) return;
      lastSampleAtRef.current = now;

      const m = computeMetrics();
      if (!m) return;

      const { diff, hash, sharp } = m;

      // Locked: wait for movement, fingerprint change, or timeout
      if (autoStateRef.current === "LOCKED") {
        if (lockedSinceRef.current && now - lockedSinceRef.current > LOCK_TIMEOUT_MS) {
          autoStateRef.current = "ARMED";
          stableMsRef.current = 0;
          lockedSinceRef.current = 0;
          setAutoHintSafe("Hold steady");
          prevHashRef.current = hash;
          return;
        }

        const prev = prevHashRef.current;
        const changed = prev !== null && hammingDistance64(hash, prev) >= HASH_RESET_HAMMING;
        const moved = diff > RESET_DIFF;

        if (moved || changed) {
          autoStateRef.current = "ARMED";
          stableMsRef.current = 0;
          lockedSinceRef.current = 0;
          setAutoHintSafe("Hold steady");
        } else {
          setAutoHintSafe("Move card to scan next");
        }

        prevHashRef.current = hash;
        return;
      }

      // Armed: look for stable + sharp
      const inCooldown = now - lastShotAtRef.current < COOLDOWN_MS;
      if (inCooldown) {
        stableMsRef.current = 0;
        setAutoHintSafe("Hold steady");
        prevHashRef.current = hash;
        return;
      }

      const stable = diff < STABLE_DIFF;
      const sharpEnough = sharp >= MIN_SHARPNESS;

      if (stable && sharpEnough) {
        stableMsRef.current += SAMPLE_EVERY_MS;
        const pct = Math.min(100, Math.round((stableMsRef.current / STABLE_REQUIRED_MS) * 100));
        setAutoHintSafe(pct >= 100 ? "Capturing…" : `Hold steady ${pct}%`);

        if (stableMsRef.current >= STABLE_REQUIRED_MS) {
          autoStateRef.current = "LOCKED";
          stableMsRef.current = 0;
          lastShotAtRef.current = now;
          lockedSinceRef.current = now;
          setAutoHintSafe("Capturing…");
          capturePhotoRef.current?.();
        }
      } else {
        stableMsRef.current = 0;
        setAutoHintSafe(sharpEnough ? "Hold steady" : "Adjust distance / focus");
      }

      prevHashRef.current = hash;
    };

    raf = requestAnimationFrame(loop);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [isActive, autoCaptureEnabled]);

  const togglePause = () => {
    const newPaused = !isPausedRef.current;
    isPausedRef.current = newPaused;
    setIsPaused(newPaused);
    
    if (!newPaused && processingQueueRef.current.length > 0) {
      toast.info('Processing resumed');
      setTimeout(() => processQueue(), 100);
    } else if (newPaused) {
      toast.info('Processing paused');
    }
  };

  const CONCURRENT_LIMIT = 10; // Process 10 cards at a time for speed

  const processSingleCard = async (captureId: string, blob: Blob): Promise<void> => {
    try {
      setCaptures(prev => {
        const updated = prev.map(c => c.id === captureId ? { ...c, status: 'uploading' as const } : c);
        capturesRef.current = updated;
        return updated;
      });

      const fileName = `${userId}/${captureId}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('card-images')
        .upload(`cards/${fileName}`, blob, {
          cacheControl: '3600',
          upsert: false,
        });

      if (uploadError) throw uploadError;

      const { data: signedUrlData } = await supabase.storage
        .from('card-images')
        .createSignedUrl(`cards/${fileName}`, 31536000);

      if (!signedUrlData?.signedUrl) throw new Error('Failed to get signed URL');

      setCaptures(prev => {
        const updated = prev.map(c => c.id === captureId ? { ...c, status: 'processing' as const } : c);
        capturesRef.current = updated;
        return updated;
      });

      await processCardAnalysis(captureId, signedUrlData.signedUrl);

    } catch (error: any) {
      console.error('Processing error:', error);
      // Play error sound
      if (errorSoundRef.current) {
        errorSoundRef.current.currentTime = 0;
        errorSoundRef.current.play().catch(() => {});
      }
      setCaptures(prev => {
        const updated = prev.map(c => c.id === captureId ? { ...c, status: 'error' as const, error: error.message } : c);
        capturesRef.current = updated;
        return updated;
      });
    }
  };

  const processQueue = async () => {
    if (isProcessingRef.current) return;
    if (isPausedRef.current) {
      setProcessing(false);
      return;
    }

    if (processingQueueRef.current.length === 0) {
      setProcessing(false);
      return;
    }

    isProcessingRef.current = true;
    setProcessing(true);

    while (processingQueueRef.current.length > 0 && !isPausedRef.current) {
      // Get next batch of cards to process concurrently
      const batchIds = processingQueueRef.current.slice(0, CONCURRENT_LIMIT);
      
      // Get blob data for each card in batch from ref (synchronous read)
      const batchItems: { id: string; blob: Blob }[] = [];
      for (const id of batchIds) {
        const capture = capturesRef.current.find(c => c.id === id);
        if (capture) {
          batchItems.push({ id, blob: capture.blob });
        }
      }

      // Remove batch from queue
      processingQueueRef.current = processingQueueRef.current.slice(batchIds.length);

      // Process batch concurrently
      await Promise.all(
        batchItems.map(item => processSingleCard(item.id, item.blob))
      );
    }

    isProcessingRef.current = false;
    setProcessing(false);
    
    if (!isPausedRef.current) {
      const completed = capturesRef.current.filter(c => c.status === 'completed').length;
      const errors = capturesRef.current.filter(c => c.status === 'error').length;
      
      if (completed > 0 || errors > 0) {
        toast.success(`Complete: ${completed} cards saved${errors > 0 ? `, ${errors} failed` : ''}`);
      }
    }
  };

  // Fetch and update pricing for a card
  const fetchPricingForCard = async (cardId: string, cardData: any) => {
    // Set loading state for this card
    setCaptures(prev => {
      const updated = prev.map(c => c.dbId === cardId ? { ...c, priceFetching: true } : c);
      capturesRef.current = updated;
      return updated;
    });

    try {
      const { data: pricing, error } = await supabase.functions.invoke('fetch-card-prices', {
        body: {
          cardName: cardData?.card_name,
          cardSet: cardData?.card_set,
          cardNumber: cardData?.card_number,
          gameType: cardData?.game_type,
          sportType: cardData?.sport_type,
        }
      });

      if (error) throw error;

      if (pricing) {
        // Update card in database
        await supabase.from('cards').update({
          current_price_raw: pricing.raw,
          current_price_psa9: pricing.psa9,
          current_price_psa10: pricing.psa10,
          suggested_price: pricing.suggested,
          ebay_listing_url: pricing.ebayUrl,
          last_price_update: new Date().toISOString(),
        }).eq('id', cardId);

        // Update UI with price and clear loading state
        setCaptures(prev => {
          const updated = prev.map(c => c.dbId === cardId ? { 
            ...c, 
            value: pricing.suggested || pricing.raw,
            priceFetching: false,
          } : c);
          capturesRef.current = updated;
          return updated;
        });
      } else {
        // Clear loading state if no pricing data
        setCaptures(prev => {
          const updated = prev.map(c => c.dbId === cardId ? { ...c, priceFetching: false } : c);
          capturesRef.current = updated;
          return updated;
        });
      }
    } catch (err) {
      console.error('Pricing fetch error for card:', cardId, err);
      // Clear loading state on error
      setCaptures(prev => {
        const updated = prev.map(c => c.dbId === cardId ? { ...c, priceFetching: false } : c);
        capturesRef.current = updated;
        return updated;
      });
    }
  };

  // Retry all failed cards
  const retryFailedCards = async () => {
    const failedCards = captures.filter(c => c.status === 'error');
    if (failedCards.length === 0) {
      toast.info('No failed cards to retry');
      return;
    }

    setIsRetrying(true);
    toast.info(`Retrying ${failedCards.length} failed cards...`);

    // Reset status to queued and add to processing queue
    setCaptures(prev => {
      const updated = prev.map(c => 
        c.status === 'error' ? { ...c, status: 'queued' as const, error: undefined } : c
      );
      capturesRef.current = updated;
      return updated;
    });

    // Add failed card IDs back to queue
    for (const card of failedCards) {
      processingQueueRef.current.push(card.id);
    }

    setIsRetrying(false);

    // Start processing if not already
    if (!isProcessingRef.current) {
      processQueue();
    }
  };

  // Batch refresh all prices for completed cards
  const refreshAllPrices = async () => {
    const completedCards = captures.filter(c => c.status === 'completed' && c.dbId);
    if (completedCards.length === 0) {
      toast.info('No completed cards to refresh prices for');
      return;
    }

    setIsRefreshingPrices(true);
    toast.info(`Refreshing prices for ${completedCards.length} cards...`);

    let successCount = 0;
    let errorCount = 0;

    // Process in batches of 5 to avoid overwhelming the API
    const batchSize = 5;
    for (let i = 0; i < completedCards.length; i += batchSize) {
      const batch = completedCards.slice(i, i + batchSize);
      
      await Promise.all(batch.map(async (card) => {
        try {
          await fetchPricingForCard(card.dbId!, {
            card_name: card.cardName,
            card_set: card.cardSet,
            card_number: card.cardNumber,
          });
          successCount++;
        } catch (err) {
          console.error('Batch price refresh error:', err);
          errorCount++;
        }
      }));
    }

    setIsRefreshingPrices(false);
    if (errorCount > 0) {
      toast.warning(`Refreshed ${successCount} prices, ${errorCount} failed`);
    } else {
      toast.success(`Successfully refreshed ${successCount} card prices`);
    }
  };

  const processCardAnalysis = async (captureId: string, imageUrl: string) => {
    try {
      // Use rapid identification endpoint (faster model, no pricing)
      const identifyResult = await supabase.functions.invoke('rapid-card-identify', { 
        body: { imageUrl } 
      });

      if (identifyResult.error) throw identifyResult.error;

      const cardData = identifyResult.data?.cardData;
      const cardName = cardData?.card_name || 'Unknown Card';
      const cardSet = cardData?.card_set;
      const cardNumber = cardData?.card_number;

      // Check for existing copies in library
      let libraryQuantity = 0;
      let isInLibrary = false;
      
      if (cardName && cardName !== 'Unknown Card') {
        let query = supabase
          .from('cards')
          .select('id', { count: 'exact' })
          .eq('user_id', userId)
          .ilike('card_name', cardName);
        
        if (cardSet) {
          query = query.ilike('card_set', cardSet);
        }
        if (cardNumber) {
          query = query.eq('card_number', cardNumber);
        }
        
        const { count } = await query;
        libraryQuantity = count || 0;
        isInLibrary = libraryQuantity > 0;
      }

      // In Scan Mode: don't insert to library, just show data
      if (scanModeRef.current) {
        // Fetch pricing immediately for scan mode
        setCaptures(prev => {
          const updated = prev.map(c => c.id === captureId ? { 
            ...c, 
            status: 'completed' as const, 
            cardName: cardName,
            cardSet: cardSet,
            cardNumber: cardNumber,
            rarity: cardData?.rarity,
            gameType: cardData?.game_type,
            sportType: cardData?.sport_type,
            confidence: cardData?.confidence,
            imageUrl: imageUrl,
            value: null,
            libraryQuantity,
            isInLibrary,
            priceFetching: true,
          } : c);
          capturesRef.current = updated;
          return updated;
        });

        // Fetch pricing directly (no db update in scan mode)
        try {
          const { data: pricing } = await supabase.functions.invoke('fetch-card-prices', {
            body: {
              cardName,
              cardSet,
              cardNumber,
              gameType: cardData?.game_type,
              sportType: cardData?.sport_type,
            }
          });

          setCaptures(prev => {
            const updated = prev.map(c => c.id === captureId ? { 
              ...c, 
              value: pricing?.suggested || pricing?.raw || null,
              priceFetching: false,
            } : c);
            capturesRef.current = updated;
            return updated;
          });
        } catch (priceErr) {
          console.error('Scan mode pricing error:', priceErr);
          setCaptures(prev => {
            const updated = prev.map(c => c.id === captureId ? { ...c, priceFetching: false } : c);
            capturesRef.current = updated;
            return updated;
          });
        }
        return;
      }

      // Normal mode: insert to library
      const insertedCard = await insertCardDual({
        user_id: userId,
        card_name: cardName,
        card_set: cardSet,
        card_number: cardNumber,
        rarity: cardData?.rarity,
        game_type: cardData?.game_type,
        sport_type: cardData?.sport_type,
        image_url: imageUrl,
        thumbnail_url: imageUrl,
        ocr_confidence: cardData?.confidence || 0,
      });

      // Fetch pricing in background (don't block completion)
      fetchPricingForCard(insertedCard.id, cardData).catch(console.error);

      setCaptures(prev => {
        const updated = prev.map(c => c.id === captureId ? { 
          ...c, 
          status: 'completed' as const, 
          cardName: cardName,
          cardSet: cardSet,
          cardNumber: cardNumber,
          rarity: cardData?.rarity,
          value: null, // Will update when pricing returns
          dbId: insertedCard?.id,
          libraryQuantity: libraryQuantity + 1, // Just added one
          isInLibrary: true,
        } : c);
        capturesRef.current = updated;
        return updated;
      });

    } catch (error: any) {
      console.error('Card analysis error:', error);
      setCaptures(prev => {
        const updated = prev.map(c => c.id === captureId ? { ...c, status: 'error' as const, error: error.message } : c);
        capturesRef.current = updated;
        return updated;
      });
    }
  };

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, []);

  useEffect(() => {
    if (captures.length > 0 && !isProcessingRef.current && processingQueueRef.current.length > 0 && !isPaused) {
      processQueue();
    }
  }, [captures.length, isPaused]);

  const handleCardUpdate = useCallback((captureId: string, updates: Partial<CapturedCard>) => {
    setCaptures(prev => {
      const updated = prev.map(c => c.id === captureId ? { ...c, ...updates } : c);
      capturesRef.current = updated;
      return updated;
    });
  }, []);

  const handleCardDelete = useCallback((captureId: string) => {
    setCaptures(prev => {
      const updated = prev.filter(c => c.id !== captureId);
      capturesRef.current = updated;
      return updated;
    });
    // Also remove from processing queue if queued
    processingQueueRef.current = processingQueueRef.current.filter(id => id !== captureId);
  }, []);

  // Add a scan-mode card to the library
  const handleAddToLibrary = useCallback(async (captureId: string) => {
    const capture = capturesRef.current.find(c => c.id === captureId);
    if (!capture || !capture.imageUrl) {
      toast.error('Cannot add card - missing data');
      return;
    }

    // Set loading state
    setCaptures(prev => {
      const updated = prev.map(c => c.id === captureId ? { ...c, priceFetching: true } : c);
      capturesRef.current = updated;
      return updated;
    });

    try {
      const insertedCard = await insertCardDual({
        user_id: userId,
        card_name: capture.cardName || 'Unknown Card',
        card_set: capture.cardSet,
        card_number: capture.cardNumber,
        rarity: capture.rarity,
        game_type: capture.gameType,
        sport_type: capture.sportType,
        image_url: capture.imageUrl,
        thumbnail_url: capture.imageUrl,
        ocr_confidence: capture.confidence || 0,
        suggested_price: capture.value,
      });

      // Update the card to show it's now in library
      setCaptures(prev => {
        const updated = prev.map(c => c.id === captureId ? { 
          ...c, 
          dbId: insertedCard.id,
          isInLibrary: true,
          libraryQuantity: (c.libraryQuantity || 0) + 1,
          priceFetching: false,
        } : c);
        capturesRef.current = updated;
        return updated;
      });

      toast.success('Card added to library!');
    } catch (error: any) {
      console.error('Failed to add card to library:', error);
      toast.error('Failed to add card to library');
      setCaptures(prev => {
        const updated = prev.map(c => c.id === captureId ? { ...c, priceFetching: false } : c);
        capturesRef.current = updated;
        return updated;
      });
    }
  }, [userId]);

  const completedCount = captures.filter(c => c.status === 'completed').length;
  const errorCount = captures.filter(c => c.status === 'error').length;
  const processingCount = captures.filter(c => c.status === 'processing').length;
  const uploadingCount = captures.filter(c => c.status === 'uploading').length;
  const queuedCount = captures.filter(c => c.status === 'queued').length;
  const progress = captures.length > 0 ? (completedCount / captures.length) * 100 : 0;

  return (
    <div className="w-full max-w-4xl mx-auto space-y-2 md:space-y-4">
      {/* Minimal Header - Hidden on mobile when camera active */}
      <div className={`${isActive ? 'hidden md:block' : ''}`}>
        <Card>
          <CardContent className="py-3 md:pt-6">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <h3 className="text-lg md:text-2xl font-bold truncate">Rapid Scan</h3>
                <Badge variant={processing ? "default" : "secondary"} className="text-sm md:text-lg px-2 md:px-4 py-1">
                  {captures.length}/{MAX_CAPTURES}
                </Badge>
              </div>
              <div className="flex items-center gap-3">
                {/* Scan Mode Toggle */}
                <div className="flex items-center gap-2">
                  <div 
                    className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium transition-colors ${
                      scanMode 
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300' 
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {scanMode ? <Eye className="h-3 w-3" /> : <Library className="h-3 w-3" />}
                    <span className="hidden sm:inline">{scanMode ? 'Scan Mode' : 'Library Mode'}</span>
                  </div>
                  <Switch
                    checked={scanMode}
                    onCheckedChange={setScanMode}
                    className="data-[state=checked]:bg-amber-500"
                  />
                </div>
                {/* Camera Mode Toggle - Compact on mobile */}
                <Tabs value={cameraMode} onValueChange={handleModeChange}>
                  <TabsList className="h-8">
                    <TabsTrigger value="device" className="text-xs px-2">
                      <Smartphone className="h-3 w-3" />
                    </TabsTrigger>
                    <TabsTrigger value="usb" className="text-xs px-2" disabled={!hasUSBDevices}>
                      <Usb className="h-3 w-3" />
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>
            </div>
            {scanMode && (
              <div className="mt-2 text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <Eye className="h-3 w-3" />
                <span>Scan Mode: Cards won't be added to library until you confirm</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Camera Viewfinder - Full screen on mobile */}
      <Card className="overflow-hidden md:rounded-lg rounded-none md:mx-0 -mx-4">
        <CardContent className="p-0">
          {/* Device Selector - Hidden on mobile when scanning */}
          {(cameraMode === 'usb' ? usbDevices : devices).length > 1 && (
            <div className="hidden md:block p-4 border-b bg-background/80">
              <CameraDeviceSelector
                devices={cameraMode === 'usb' ? usbDevices : devices}
                selectedDeviceId={selectedDeviceId}
                onDeviceChange={handleDeviceChange}
                onRefresh={refreshDevices}
                isLoading={devicesLoading}
              />
            </div>
          )}
          
          <div className="relative bg-black">
            {/* Video container - Fullscreen feel on mobile */}
            <div
                className="relative mx-auto md:max-w-md w-full overflow-hidden touch-none"
                style={{ aspectRatio: '5/7' }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
              >
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
                style={
                  usingDigitalZoom && zoomLevel !== 1
                    ? { transform: `scale(${zoomLevel})`, transformOrigin: 'center center' }
                    : undefined
                }
              />
              
              {/* Minimal Corner Guides Only */}
              <div className="absolute inset-0 pointer-events-none">
                <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 140" preserveAspectRatio="none">
                  {/* Top-left corner */}
                  <path d="M 8 8 L 8 18 M 8 8 L 18 8" stroke="white" strokeWidth="0.6" fill="none" opacity="0.7"/>
                  {/* Top-right corner */}
                  <path d="M 92 8 L 92 18 M 92 8 L 82 8" stroke="white" strokeWidth="0.6" fill="none" opacity="0.7"/>
                  {/* Bottom-left corner */}
                  <path d="M 8 132 L 8 122 M 8 132 L 18 132" stroke="white" strokeWidth="0.6" fill="none" opacity="0.7"/>
                  {/* Bottom-right corner */}
                  <path d="M 92 132 L 92 122 M 92 132 L 82 132" stroke="white" strokeWidth="0.6" fill="none" opacity="0.7"/>
                </svg>
              </div>


              {/* Tap-to-focus ring */}
              {focusRing && (
                <div
                  className="absolute pointer-events-none border-2 border-white/80 rounded-full"
                  style={{
                    width: 56,
                    height: 56,
                    left: Math.max(0, focusRing.x - 28),
                    top: Math.max(0, focusRing.y - 28),
                    boxShadow: '0 0 0 2px rgba(0,0,0,0.35)',
                  }}
                />
              )}

              {/* Mobile: Floating count badge - top right */}
              <div className="md:hidden absolute top-3 right-3">
                <Badge variant="secondary" className="bg-black/60 text-white border-0 text-sm px-2 py-1 backdrop-blur-sm">
                  {captures.length}/{MAX_CAPTURES}
                </Badge>
              </div>

              {/* Zoom Controls - Repositioned for mobile */}
              <div className="absolute top-3 left-3">
                <ZoomControls
                  zoomLevel={zoomLevel}
                  minZoom={zoomCapabilities.min}
                  maxZoom={zoomCapabilities.max}
                  supported={zoomCapabilities.supported}
                  onZoomIn={zoomIn}
                  onZoomOut={zoomOut}
                  onZoomChange={setZoom}
                  onReset={resetZoom}
                  variant="overlay"
                />
              </div>

              {/* Mobile-Optimized Controls - Bottom bar */}
              <div className="absolute bottom-0 left-0 right-0 pb-safe">
                <div className="bg-gradient-to-t from-black/90 via-black/60 to-transparent pt-12 pb-4 px-4">
                  {autoCaptureEnabled && (
                    <div className="text-center text-white/85 text-xs mb-2 select-none">
                      {autoHint}
                    </div>
                  )}
                  <div className="flex items-center justify-between max-w-md mx-auto">
                    {/* Left controls - smaller */}
                    <div className="flex items-center gap-1">
                      <Button
                        variant={autoCaptureEnabled ? "secondary" : "ghost"}
                        size="icon"
                        onClick={() => setAutoCaptureEnabled(v => !v)}
                        className="text-white bg-black/40 hover:bg-black/55 border-0 h-10 w-10"
                      >
                        <span className="text-[10px] font-bold tracking-wide">{autoCaptureEnabled ? "AUTO" : "MAN"}</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={toggleCamera}
                        className="text-white hover:bg-white/20 h-10 w-10"
                      >
                        <SwitchCamera className="h-5 w-5" />
                      </Button>
                      
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={toggleFlash}
                        className={`h-10 w-10 ${
                          flashEnabled 
                            ? 'text-yellow-400 bg-yellow-400/30' 
                            : flashSupported 
                              ? 'text-white hover:bg-white/20' 
                              : 'text-white/30'
                        }`}
                      >
                        <Zap className={`h-5 w-5 ${flashEnabled ? 'fill-yellow-400' : ''}`} />
                      </Button>
                    </div>
                    
                    {/* Center - Shutter button - Compact */}
                    <Button
                      size="icon"
                      onClick={capturePhoto}
                      disabled={captures.length >= MAX_CAPTURES}
                      className="rounded-full h-14 w-14 md:h-16 md:w-16 bg-white hover:bg-white/90 text-black shadow-lg"
                    >
                      <Camera className="h-6 w-6 md:h-7 md:w-7" />
                    </Button>

                    {/* Right controls */}
                    <div className="flex items-center gap-1">
                      {captures.length > 0 ? (
                        <Button
                          size="sm"
                          onClick={() => {
                            if (processingQueueRef.current.length > 0 || queuedCount > 0) {
                              setIsPaused(false);
                              processQueue();
                            }
                            stopCamera();
                            setTimeout(() => onComplete(), 300);
                          }}
                          className="bg-green-600 hover:bg-green-700 text-white h-10 px-3 text-sm font-medium"
                        >
                          Done
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            stopCamera();
                            onComplete();
                          }}
                          className="text-white hover:bg-white/20 h-10 w-10"
                        >
                          <X className="h-5 w-5" />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Compact Progress Section - Mobile optimized */}
      {captures.length > 0 && (
        <Card className="md:mx-0 -mx-4 rounded-none md:rounded-lg">
          <CardContent className="py-3 md:pt-6 md:space-y-4 space-y-2">
            <div className="flex justify-between items-center gap-2">
              <div className="flex gap-3 md:gap-6 text-xs md:text-sm font-medium flex-wrap">
                <span className="text-success flex items-center gap-1">
                  <CheckCircle className="h-3 w-3 md:h-4 md:w-4" />
                  {completedCount}
                </span>
                {(processingCount > 0 || uploadingCount > 0) && (
                  <span className="text-blue-500 flex items-center gap-1">
                    <Loader2 className="h-3 w-3 md:h-4 md:w-4 animate-spin" />
                    {processingCount + uploadingCount}
                  </span>
                )}
                {queuedCount > 0 && (
                  <span className="text-muted-foreground">
                    +{queuedCount}
                  </span>
                )}
                {errorCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={retryFailedCards}
                    disabled={isRetrying}
                    className="text-destructive hover:text-destructive gap-1 h-auto p-0"
                  >
                    {isRetrying ? (
                      <Loader2 className="h-3 w-3 md:h-4 md:w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3 md:h-4 md:w-4" />
                    )}
                    {errorCount}
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm md:text-lg font-bold tabular-nums">{Math.round(progress)}%</span>
                {completedCount > 0 && queuedCount === 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={refreshAllPrices}
                    disabled={isRefreshingPrices}
                    className="gap-1 h-8 px-2 md:px-3 text-xs md:text-sm"
                  >
                    {isRefreshingPrices ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <DollarSign className="h-3 w-3" />
                    )}
                    <span className="hidden md:inline">{isRefreshingPrices ? 'Refreshing...' : 'Prices'}</span>
                  </Button>
                )}
                {queuedCount > 0 && (
                  <Button
                    size="sm"
                    variant={isPaused ? "default" : "outline"}
                    onClick={togglePause}
                    className="h-8 px-2 md:px-3"
                  >
                    {isPaused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                  </Button>
                )}
              </div>
            </div>
            <Progress value={progress} className="h-2 md:h-3" />
          </CardContent>
        </Card>
      )}

      {/* Capture Grid */}
      {captures.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Captured Cards</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-64">
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {captures.map((capture) => (
                  <div 
                    key={capture.id} 
                    className="relative rounded-lg overflow-hidden border-2 bg-card transition-all"
                  >
                    <div className="relative" style={{ aspectRatio: '5/7' }}>
                      <img 
                        src={capture.preview} 
                        alt="Captured card"
                        className="w-full h-full object-cover"
                      />
                      {capture.status !== 'completed' && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
                          {(capture.status === 'uploading' || capture.status === 'processing' || capture.status === 'queued') && (
                            <Loader2 className="h-8 w-8 text-white animate-spin" />
                          )}
                          {capture.status === 'error' && (
                            <X className="h-8 w-8 text-red-500" />
                          )}
                        </div>
                      )}
                      {capture.status === 'completed' && (
                        <>
                          {/* Library quantity badge - top right */}
                          {capture.libraryQuantity !== undefined && capture.libraryQuantity > 0 ? (
                            <div className="absolute top-1.5 right-1.5 bg-blue-600 text-white text-[10px] font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1 shadow-lg">
                              ×{capture.libraryQuantity}
                            </div>
                          ) : scanMode && !capture.dbId ? (
                            <div className="absolute top-1.5 right-1.5 bg-amber-500 text-white text-[9px] font-bold rounded px-1.5 py-0.5 shadow-lg">
                              NEW
                            </div>
                          ) : (
                            <div className="absolute top-2 right-2">
                              <CheckCircle className="h-5 w-5 text-green-500 drop-shadow-lg" />
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    {capture.status === 'completed' && (
                      <div className="p-2 space-y-1 bg-card">
                        <p className="text-xs font-medium line-clamp-2 leading-tight">
                          {capture.cardName || 'Unknown Card'}
                        </p>
                        {capture.cardSet && (
                          <p className="text-xs text-muted-foreground line-clamp-1">
                            {capture.cardSet}
                          </p>
                        )}
                        {capture.cardNumber && (
                          <p className="text-xs text-muted-foreground">
                            #{capture.cardNumber}
                          </p>
                        )}
                        <div className="flex items-center justify-between pt-1">
                          {capture.rarity && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                              {capture.rarity}
                            </Badge>
                          )}
                          {capture.priceFetching ? (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              <span>Loading...</span>
                            </span>
                          ) : capture.value != null && capture.value > 0 ? (
                            <span className="text-sm font-bold text-green-600">
                              ${capture.value.toFixed(2)}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">No price</span>
                          )}
                        </div>
                        {/* Add to Library button for scan mode cards not yet added */}
                        {scanMode && !capture.dbId && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleAddToLibrary(capture.id)}
                            disabled={capture.priceFetching}
                            className="w-full h-7 text-xs mt-1 gap-1"
                          >
                            {capture.priceFetching ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Library className="h-3 w-3" />
                            )}
                            Add to Library
                          </Button>
                        )}
                      </div>
                    )}
                    {capture.status === 'error' && (
                      <div className="p-2 bg-destructive/10">
                        <p className="text-xs text-destructive line-clamp-2">
                          {capture.error || 'Failed to process'}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Detailed Editable Card List */}
      <ScannedCardList 
        cards={captures} 
        onCardUpdate={handleCardUpdate} 
        onCardDelete={handleCardDelete} 
        scanMode={scanMode}
        onAddToLibrary={handleAddToLibrary}
      />
    </div>
  );
};
