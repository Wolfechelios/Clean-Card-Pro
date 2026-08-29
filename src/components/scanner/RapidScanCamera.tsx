import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  CameraOff,
  ChevronDown,
  Flashlight,
  FlashlightOff,
  Focus,
  Loader2,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Smartphone,
  Trash2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { withTimeout } from "@/lib/async/withTimeout";
import { cn } from "@/lib/utils";
import {
  applySharpnessConstraints,
  filterCameraDevices,
  focusAtPoint,
  getCameraStreamWithFallback,
} from "@/lib/camera/cameraPolicy";
import { compressImageForQueue } from "@/lib/imageCompressor";
import {
  idbAdd,
  idbClear,
  idbCountPending,
  idbCountQueued,
  idbGetAll,
  idbRetry,
} from "@/lib/idbQueue";
import { useQueueProcessor } from "@/lib/queueProcessor";
import {
  mergeRecentScanRows,
  reconcileScanRows,
  type ScanRowState,
} from "@/lib/rapidScan/scanRows";
import { clearAllRecentScans, getRecentScans } from "@/lib/recentScans";

type ZoomState = {
  supported: boolean;
  min: number;
  max: number;
  step: number;
  value: number;
};

type BasicCameraCapabilities = MediaTrackCapabilities & {
  torch?: boolean;
  zoom?: { min?: number; max?: number; step?: number } | number[];
  focusMode?: string[];
  exposureMode?: string[];
};

type CameraTrackSettings = MediaTrackSettings & {
  zoom?: number;
};

type CameraConstraintSet = MediaTrackConstraintSet & {
  exposureMode?: string;
  focusMode?: string;
  pointsOfInterest?: Array<{ x: number; y: number }>;
  torch?: boolean;
  zoom?: number;
};

type ScanRow = ScanRowState;

const QUEUE_MAX = 500;
const DEFAULT_ZOOM: ZoomState = { supported: false, min: 1, max: 3, step: 0.1, value: 1 };
const ROTATION_OPTIONS = [0, 90, 180, 270] as const;
type CameraRotation = typeof ROTATION_OPTIONS[number];

function safeUUID() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `scan-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isContinuityDevice(device: MediaDeviceInfo) {
  const label = device.label.toLowerCase();
  return label.includes("iphone") || label.includes("continuity") || label.includes("desk view");
}

function deviceLabel(device: MediaDeviceInfo, index: number) {
  if (device.label) return device.label;
  return `Camera ${index + 1}`;
}

function sortCameraDevices(list: MediaDeviceInfo[]) {
  return [...list].sort((a, b) => {
    const ac = isContinuityDevice(a) ? 0 : 1;
    const bc = isContinuityDevice(b) ? 0 : 1;
    if (ac !== bc) return ac - bc;
    return a.label.localeCompare(b.label);
  });
}

function normalizeZoom(caps: BasicCameraCapabilities, settings: MediaTrackSettings): ZoomState {
  const raw = caps.zoom;
  if (!raw) return DEFAULT_ZOOM;
  const settingsZoom = (settings as CameraTrackSettings).zoom;

  if (Array.isArray(raw) && raw.length > 0) {
    const sorted = raw.filter((n): n is number => typeof n === "number").sort((a, b) => a - b);
    const min = sorted[0] ?? 1;
    const max = sorted[sorted.length - 1] ?? Math.max(3, min);
    return {
      supported: true,
      min,
      max,
      step: 0.1,
      value: typeof settingsZoom === "number" ? settingsZoom : min,
    };
  }

  if (typeof raw === "object") {
    const rawObj = raw as { min?: number; max?: number; step?: number };
    const min = Number(rawObj.min ?? 1);
    const max = Number(rawObj.max ?? Math.max(3, min));
    const step = Number(rawObj.step ?? 0.1);
    return {
      supported: Number.isFinite(min) && Number.isFinite(max) && max > min,
      min,
      max,
      step: Number.isFinite(step) && step > 0 ? step : 0.1,
      value: typeof settingsZoom === "number" ? settingsZoom : min,
    };
  }


  return DEFAULT_ZOOM;
}

function rowsFromRecent(): ScanRow[] {
  return getRecentScans().map((scan) => ({
    id: scan.id,
    imageUrl: scan.image_url,
    status: "completed" as const,
    cardName: scan.card_name,
    cardSet: scan.card_set ?? undefined,
    cardNumber: scan.card_number ?? undefined,
    value: scan.price,
  }));
}

function getRotationLabel(rotation: CameraRotation) {
  if (rotation === 0) return "Portrait";
  if (rotation === 90) return "Right";
  if (rotation === 180) return "Upside Down";
  return "Left";
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function drawRotatedVideoToCanvas(video: HTMLVideoElement, canvas: HTMLCanvasElement, rotation: CameraRotation) {
  const sourceWidth = video.videoWidth || 1920;
  const sourceHeight = video.videoHeight || 1080;
  const rotatedSideways = rotation === 90 || rotation === 270;
  canvas.width = rotatedSideways ? sourceHeight : sourceWidth;
  canvas.height = rotatedSideways ? sourceWidth : sourceHeight;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Capture canvas unavailable");

  ctx.save();
  if (rotation === 90) {
    ctx.translate(canvas.width, 0);
    ctx.rotate(Math.PI / 2);
  } else if (rotation === 180) {
    ctx.translate(canvas.width, canvas.height);
    ctx.rotate(Math.PI);
  } else if (rotation === 270) {
    ctx.translate(0, canvas.height);
    ctx.rotate((3 * Math.PI) / 2);
  }
  ctx.drawImage(video, 0, 0, sourceWidth, sourceHeight);
  ctx.restore();
}

function waitForVideoMetadata(video: HTMLVideoElement, timeoutMs = 5000): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error("Camera preview timed out"));
    }, timeoutMs);

    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("error", onError);
    };
    const onLoadedMetadata = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("Camera preview failed to load"));
    };

    video.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
    video.addEventListener("error", onError, { once: true });
  });
}

async function startVideoPreview(video: HTMLVideoElement, stream: MediaStream): Promise<void> {
  video.srcObject = stream;
  video.setAttribute("playsinline", "true");
  video.muted = true;
  await waitForVideoMetadata(video);
  await withTimeout(video.play(), 5000, "Camera playback");
}

export default function RapidScanCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const startingRef = useRef(false);
  const processor = useQueueProcessor();

  const [cameraOn, setCameraOn] = useState(false);
  const [phoneOpen, setPhoneOpen] = useState(() => localStorage.getItem("rapid_scan_phone_open") !== "0");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Tap Start Camera");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>(() => localStorage.getItem("rapid_scan_camera_device_id") ?? "");
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [focusSupported, setFocusSupported] = useState(false);
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);
  const [zoom, setZoomState] = useState<ZoomState>(DEFAULT_ZOOM);
  const [digitalZoom, setDigitalZoom] = useState(1);
  const [cameraRotation, setCameraRotation] = useState<CameraRotation>(() => {
    const saved = Number(localStorage.getItem("rapid_scan_camera_rotation") ?? 0);
    return ROTATION_OPTIONS.includes(saved as CameraRotation) ? (saved as CameraRotation) : 0;
  });
  const [queuedCount, setQueuedCount] = useState(0);
  const [rows, setRows] = useState<ScanRow[]>(() => rowsFromRecent());

  const sortedDevices = useMemo(() => sortCameraDevices(devices), [devices]);
  const continuityDevice = useMemo(() => sortedDevices.find(isContinuityDevice), [sortedDevices]);
  const selectedDevice = useMemo(() => sortedDevices.find((d) => d.deviceId === selectedDeviceId), [sortedDevices, selectedDeviceId]);
  const visibleZoom = zoom.supported ? zoom.value : digitalZoom;
  const canUseTorch = cameraOn && torchSupported;
  const canFocus = cameraOn && focusSupported;
  const rotatedSideways = cameraRotation === 90 || cameraRotation === 270;

  const totalValue = useMemo(() => {
    return rows.reduce((sum, row) => sum + (row.status === "completed" ? row.value || 0 : 0), 0);
  }, [rows]);
  const failedCount = useMemo(
    () => processor.queueMeta.filter((item) => item.status === "error").length,
    [processor.queueMeta],
  );

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices(sortCameraDevices(filterCameraDevices(list)));
    } catch {
      // Safari may hide devices until permission is granted.
    }
  }, []);

  const refreshQueueCount = useCallback(async () => {
    try {
      setQueuedCount(await idbCountQueued());
    } catch {
      setQueuedCount(0);
    }
  }, []);

  const rotateCamera = useCallback(() => {
    setCameraRotation((prev) => {
      const idx = ROTATION_OPTIONS.indexOf(prev);
      const next = ROTATION_OPTIONS[(idx + 1) % ROTATION_OPTIONS.length];
      localStorage.setItem("rapid_scan_camera_rotation", String(next));
      setStatus(`Rotation locked: ${getRotationLabel(next)}`);
      return next;
    });
  }, []);

  const resetRotation = useCallback(() => {
    localStorage.setItem("rapid_scan_camera_rotation", "0");
    setCameraRotation(0);
    setStatus("Rotation locked: Portrait");
  }, []);

  useEffect(() => {
    void refreshDevices();
    void refreshQueueCount();
    void idbGetAll().then((items) => {
      setRows((current) => {
        const currentIds = new Set(current.map((row) => row.id));
        const restored: ScanRow[] = items
          .filter((item) => !currentIds.has(item.id))
          .map((item) => ({
            id: item.id,
            imageUrl: URL.createObjectURL(item.blob),
            status:
              item.status === "error"
                ? "error"
                : item.status === "processing"
                  ? "processing"
                  : "queued",
            error: item.error,
          }));
        return restored.length > 0 ? [...restored, ...current] : current;
      });
    });
  }, [refreshDevices, refreshQueueCount]);

  useEffect(() => {
    const onDeviceChange = () => void refreshDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", onDeviceChange);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", onDeviceChange);
  }, [refreshDevices]);

  useEffect(() => {
    const onRecentScanAdded = () => {
      const recent = rowsFromRecent();
      setRows((current) => mergeRecentScanRows(current, recent));
    };
    window.addEventListener("recent-scan-added", onRecentScanAdded);
    return () => window.removeEventListener("recent-scan-added", onRecentScanAdded);
  }, []);

  useEffect(() => {
    const card = processor.lastProcessedCard;
    if (!card) return;
    setRows((prev) => {
      const patch: ScanRow = {
        id: card.id,
        imageUrl: card.imageUrl,
        status: "completed",
        cardName: card.cardName,
        cardSet: card.cardSet,
        cardNumber: card.cardNumber,
        value: card.value,
      };
      const exists = prev.some((row) => row.id === card.id);
      return exists ? prev.map((row) => (row.id === card.id ? { ...row, ...patch } : row)) : [patch, ...prev];
    });
    void refreshQueueCount();
  }, [processor.lastProcessedCard, refreshQueueCount]);

  useEffect(() => {
    const current = processor.currentItem;
    if (!current) return;
    setRows((prev) => prev.map((row) => (row.id === current ? { ...row, status: "processing" } : row)));
  }, [processor.currentItem]);

  useEffect(() => {
    setRows((prev) => reconcileScanRows(prev, processor.queueMeta));
    setQueuedCount(processor.queueCount);
  }, [processor.queueCount, processor.queueMeta]);

  useEffect(() => {
    const onItemError = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; error?: string }>).detail;
      if (!detail?.id) return;
      const message = detail.error || "Scan processing failed";
      setRows((prev) => {
        const exists = prev.some((row) => row.id === detail.id);
        if (exists) {
          return prev.map((row) => (row.id === detail.id ? { ...row, status: "error", error: message } : row));
        }
        // The row may not exist yet (or was reconciled away) — surface the failure anyway.
        return [{ id: detail.id!, imageUrl: "", status: "error", error: message }, ...prev];
      });
    };

    const onDuplicate = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string }>).detail;
      if (!detail?.id) return;
      setRows((prev) => prev.filter((row) => row.id !== detail.id));
      toast.info("Duplicate card skipped");
    };

    window.addEventListener("rapid-scan-item-error", onItemError);
    window.addEventListener("rapid-scan-item-duplicate", onDuplicate);
    return () => {
      window.removeEventListener("rapid-scan-item-error", onItemError);
      window.removeEventListener("rapid-scan-item-duplicate", onDuplicate);
    };
  }, []);

  function stopPreviewOnly() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    trackRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
    setTorchOn(false);
    setTorchSupported(false);
    setFocusSupported(false);
    setFocusPoint(null);
  }

  async function applyZoom(next: number) {
    const clamped = clamp(next, zoom.min, zoom.max);
    const track = trackRef.current;

    if (zoom.supported && track?.applyConstraints) {
      try {
        const advanced: CameraConstraintSet = { zoom: clamped };
        await track.applyConstraints({ advanced: [advanced] });
        setZoomState((prev) => ({ ...prev, value: clamped }));
        return;
      } catch {
        // Fall back to CSS zoom if Safari exposes no hardware zoom control.
      }
    }

    setDigitalZoom(clamp(next, 1, 3));
  }

  async function startCamera(deviceIdOverride?: string) {
    if (startingRef.current) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("Safari camera permission is not available on this page.");
      setStatus("Camera unavailable");
      return;
    }

    startingRef.current = true;
    setBusy(true);

    try {
      stopPreviewOnly();

      const requestedDeviceId = deviceIdOverride ?? selectedDeviceId;
      const { stream, usedFallback } = await getCameraStreamWithFallback(
        navigator.mediaDevices,
        requestedDeviceId,
      );
      streamRef.current = stream;
      trackRef.current = stream.getVideoTracks()[0] ?? null;

      const track = trackRef.current;
      const caps = (track?.getCapabilities?.() ?? {}) as BasicCameraCapabilities;
      const settings = track?.getSettings?.() ?? {};
      const actualDeviceId = (settings as MediaTrackSettings).deviceId;
      if (actualDeviceId) {
        setSelectedDeviceId(actualDeviceId);
        localStorage.setItem("rapid_scan_camera_device_id", actualDeviceId);
      } else if (usedFallback) {
        setSelectedDeviceId("");
        localStorage.removeItem("rapid_scan_camera_device_id");
      }
      setTorchSupported(Boolean(caps.torch));
      setFocusSupported(Boolean(caps.focusMode?.length || caps.exposureMode?.length));
      setZoomState(normalizeZoom(caps, settings));
      setDigitalZoom(1);

      const videoElement = videoRef.current;
      if (!videoElement) throw new Error("Video preview missing");
      await startVideoPreview(videoElement, stream);

      // Continuous autofocus / exposure / white balance for iPhone + Android.
      await applySharpnessConstraints(track);

      setCameraOn(true);
      await refreshDevices();
      const label =
        track?.label ||
        sortedDevices.find((d) => d.deviceId === (usedFallback ? actualDeviceId : actualDeviceId || requestedDeviceId))?.label;
      const res = settings.width && settings.height ? ` @ ${settings.width}×${settings.height}` : "";
      if (usedFallback) {
        setStatus(label ? `Saved camera unavailable — using ${label}${res}` : "Saved camera unavailable — using default camera");
      } else {
        setStatus(label ? `Camera live: ${label}${res}` : `Camera live${res} — tap preview to focus`);
      }
    } catch (error: unknown) {
      console.error(error);
      stopPreviewOnly();
      setStatus(errorMessage(error, "Camera failed"));
      toast.error(errorMessage(error, "Camera failed to start"));
    } finally {
      setBusy(false);
      startingRef.current = false;
    }
  }

  async function switchCamera(deviceId: string) {
    setSelectedDeviceId(deviceId);
    localStorage.setItem("rapid_scan_camera_device_id", deviceId);
    if (cameraOn) {
      setStatus("Switching camera…");
      await startCamera(deviceId);
    }
  }

  async function selectContinuityCamera() {
    if (!continuityDevice) {
      await refreshDevices();
      toast.info("If iPhone does not appear, unlock it and keep it near this Mac, then tap Refresh cameras.");
      return;
    }
    await switchCamera(continuityDevice.deviceId);
    if (!cameraOn) await startCamera(continuityDevice.deviceId);
  }

  async function stopCamera() {
    if (torchOn) await toggleTorch(false);
    stopPreviewOnly();
    setStatus("Camera stopped — queued scans will keep pricing");
    processor.start();
    await refreshQueueCount();
  }

  async function toggleTorch(forced?: boolean) {
    const track = trackRef.current;
    if (!track || !torchSupported) return;
    const next = typeof forced === "boolean" ? forced : !torchOn;
    try {
      const advanced: CameraConstraintSet = { torch: next };
      await track.applyConstraints({ advanced: [advanced] });
      setTorchOn(next);
    } catch {
      toast.error("Torch is blocked by Safari or this camera lens");
    }
  }

  async function resetCameraControls() {
    await applyZoom(1);
    setDigitalZoom(1);
    setFocusPoint(null);
    resetRotation();
    if (torchOn) await toggleTorch(false);
    try {
      const advanced: CameraConstraintSet = {
        focusMode: "continuous",
        exposureMode: "continuous",
      };
      await trackRef.current?.applyConstraints?.({ advanced: [advanced] });
    } catch {
      // not all Safari builds support focus constraints
    }
    setStatus("Camera controls reset");
  }

  async function handleTapFocus(e: React.PointerEvent<HTMLVideoElement>) {
    if (!cameraOn) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = clamp((e.clientX - rect.left) / rect.width, 0, 1);
    const y = clamp((e.clientY - rect.top) / rect.height, 0, 1);
    setFocusPoint({ x: x * 100, y: y * 100 });
    window.setTimeout(() => setFocusPoint(null), 900);

    const applied = await focusAtPoint(trackRef.current, x, y);
    setStatus(applied ? "Focusing…" : "Focus point marked — this lens auto-focuses only");
  }

  async function capture() {
    if (!cameraOn || busy) return;
    setBusy(true);

    try {
      const current = await idbCountPending();
      if (current >= QUEUE_MAX) {
        toast.error(`Queue full (${QUEUE_MAX})`);
        return;
      }

      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) throw new Error("Camera preview not ready");

      drawRotatedVideoToCanvas(video, canvas, cameraRotation);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.95));
      if (!blob) throw new Error("Capture failed");

      const id = safeUUID();
      const previewUrl = URL.createObjectURL(blob);
      setRows((prev) => [{ id, imageUrl: previewUrl, status: "queued" }, ...prev]);

      const { pipelineTracer } = await import("@/lib/pipelineTracer");
      pipelineTracer.record({ itemId: id, stage: "capture", status: "ok", meta: { bytes: blob.size, source: "camera" } });

      const compressed = await compressImageForQueue(blob);
      await idbAdd({
        id,
        createdAt: Date.now(),
        status: "queued",
        blob: compressed,
        mime: compressed.type || "image/jpeg",
        filename: "card.jpg",
      });
      pipelineTracer.record({ itemId: id, stage: "enqueue", status: "start" });

      setStatus(`Captured — ${getRotationLabel(cameraRotation)} rotation applied`);
      await refreshQueueCount();
      processor.start();
    } catch (error: unknown) {
      console.error(error);
      toast.error(errorMessage(error, "Capture failed"));
    } finally {
      setBusy(false);
    }
  }

  async function clearQueueAndRecent() {
    processor.stop();
    await idbClear();
    clearAllRecentScans();
    setRows([]);
    await refreshQueueCount();
    setStatus("Cleared");
  }

  async function retryScan(id: string) {
    try {
      await idbRetry(id);
      setRows((prev) =>
        prev.map((row) =>
          row.id === id ? { ...row, status: "queued", error: undefined } : row,
        ),
      );
      await processor.refreshQueue();
      processor.start();
      setStatus("Retrying scan");
    } catch (error: unknown) {
      toast.error(errorMessage(error, "Could not retry scan"));
    }
  }

  useEffect(() => {
    return () => {
      stopPreviewOnly();
    };
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={cameraOn ? "default" : "secondary"}>{cameraOn ? "Camera Live" : "Camera Off"}</Badge>
          <Badge variant="outline">Queued {queuedCount}</Badge>
          {failedCount > 0 && <Badge variant="destructive">Errors {failedCount}</Badge>}
          <Badge variant="outline">${totalValue.toFixed(2)}</Badge>
          <Badge variant="outline">{getRotationLabel(cameraRotation)}</Badge>
          {selectedDevice?.label && <Badge variant={isContinuityDevice(selectedDevice) ? "default" : "outline"}>{selectedDevice.label}</Badge>}
        </div>
        <Button variant="ghost" size="sm" onClick={() => void refreshDevices()}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh cameras
        </Button>
      </div>

      <Card className="overflow-hidden bg-black">
        <div className="relative">
          <div className="flex h-[62vh] min-h-[360px] max-h-[680px] w-full items-center justify-center overflow-hidden bg-black">
            <video
              ref={videoRef}
              className={cn(
                "block bg-black object-contain touch-none transition-transform duration-200",
                rotatedSideways ? "h-full w-auto max-w-none" : "h-full w-full",
              )}
              style={{
                transform: `rotate(${cameraRotation}deg) scale(${!zoom.supported && digitalZoom > 1 ? digitalZoom : 1})`,
                transformOrigin: "center",
              }}
              playsInline
              muted
              onPointerUp={handleTapFocus}
            />
          </div>
          <canvas ref={canvasRef} className="hidden" />

          {!cameraOn && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-white">
              <div className="px-4 text-center">
                <Camera className="mx-auto mb-3 h-10 w-10" />
                <div className="text-lg font-semibold">Safari Camera</div>
                <div className="text-sm text-white/70">Start camera, then switch to iPhone / Continuity if needed.</div>
              </div>
            </div>
          )}

          {focusPoint && (
            <div
              className="pointer-events-none absolute h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-primary/10"
              style={{ left: `${focusPoint.x}%`, top: `${focusPoint.y}%` }}
            >
              <Focus className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 text-primary" />
            </div>
          )}

          <div className="absolute left-3 top-3 flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={rotateCamera}
              className="h-9 bg-black/65 text-white hover:bg-black/80"
              title="Rotate preview and captured image"
            >
              <RotateCw className="mr-2 h-4 w-4" />
              {cameraRotation}°
            </Button>
          </div>

          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-3 text-white">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs text-white/70">{status}</div>
                <div className="truncate text-sm font-semibold">{selectedDevice?.label || "Tap preview to focus/expose"}</div>
              </div>
              <div className="text-right text-xs text-white/70">
                {visibleZoom.toFixed(1)}× • {getRotationLabel(cameraRotation)}
              </div>
            </div>
          </div>
        </div>
      </Card>

      <div className="flex justify-center py-2">
        <button
          onClick={() => void capture()}
          disabled={!cameraOn || busy}
          className={cn(
            "flex h-20 w-20 items-center justify-center rounded-full transition active:scale-95",
            cameraOn ? "bg-primary text-primary-foreground shadow-lg shadow-primary/30" : "bg-secondary text-secondary-foreground",
            (!cameraOn || busy) && "cursor-not-allowed opacity-50",
          )}
          aria-label="Capture card"
        >
          {busy ? <Loader2 className="h-8 w-8 animate-spin" /> : <Camera className="h-8 w-8" />}
        </button>
      </div>

      <Card className="space-y-3 p-3">
        <div className="rounded-xl border">
          <button
            type="button"
            onClick={() => {
              setPhoneOpen((v) => {
                const next = !v;
                localStorage.setItem("rapid_scan_phone_open", next ? "1" : "0");
                return next;
              });
            }}
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
            aria-expanded={phoneOpen}
          >
            <div className="flex items-center gap-2 text-sm font-medium">
              <Smartphone className="h-4 w-4" />
              Phone / Camera
            </div>
            <ChevronDown className={cn("h-4 w-4 transition-transform", phoneOpen ? "rotate-180" : "")} />
          </button>
          {phoneOpen && (
            <div className="space-y-3 border-t p-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
                <label className="text-xs font-medium text-muted-foreground">
                  Camera / Lens
                  <select
                    value={selectedDeviceId}
                    onChange={(e) => void switchCamera(e.target.value)}
                    className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="">Default Mac/Safari camera</option>
                    {sortedDevices.map((device, index) => (
                      <option key={device.deviceId || index} value={device.deviceId}>
                        {isContinuityDevice(device) ? "📱 " : ""}{deviceLabel(device, index)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => void selectContinuityCamera()} className="h-10">
                    <Smartphone className="mr-2 h-4 w-4" /> Use iPhone
                  </Button>
                  {!cameraOn ? (
                    <Button onClick={() => void startCamera()} disabled={busy} className="h-10 min-w-32">
                      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
                      Start Camera
                    </Button>
                  ) : (
                    <Button variant="destructive" onClick={() => void stopCamera()} className="h-10 min-w-28">
                      <CameraOff className="mr-2 h-4 w-4" /> Stop
                    </Button>
                  )}
                </div>
              </div>
              <div className="rounded-lg border bg-muted/30 p-2 text-xs text-muted-foreground">
                Continuity Camera appears after Safari has camera permission. Unlock the iPhone, keep it near this Mac, tap Refresh cameras, then choose the 📱 iPhone option or Use iPhone.
              </div>
            </div>
          )}
        </div>


        <div className="rounded-xl border p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-sm font-medium">Zoom</div>
            <div className="text-xs text-muted-foreground">
              {visibleZoom.toFixed(1)}× {zoom.supported ? "hardware" : "screen fallback"}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => void applyZoom(visibleZoom - (zoom.step || 0.1))} disabled={!cameraOn}>
              <ZoomOut className="h-4 w-4" />
            </Button>
            <Slider
              value={[visibleZoom]}
              min={zoom.supported ? zoom.min : 1}
              max={zoom.supported ? zoom.max : 3}
              step={zoom.supported ? zoom.step : 0.05}
              disabled={!cameraOn}
              onValueChange={([next]) => void applyZoom(next)}
              className="flex-1"
            />
            <Button variant="outline" size="icon" onClick={() => void applyZoom(visibleZoom + (zoom.step || 0.1))} disabled={!cameraOn}>
              <ZoomIn className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="rounded-xl border p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-sm font-medium">Rotation Lock</div>
            <div className="text-xs text-muted-foreground">Use when the phone is flat</div>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {ROTATION_OPTIONS.map((rotation) => (
              <Button
                key={rotation}
                variant={cameraRotation === rotation ? "default" : "outline"}
                onClick={() => {
                  setCameraRotation(rotation);
                  localStorage.setItem("rapid_scan_camera_rotation", String(rotation));
                  setStatus(`Rotation locked: ${getRotationLabel(rotation)}`);
                }}
              >
                {rotation}°
              </Button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Button
            variant={torchOn ? "secondary" : "outline"}
            onClick={() => void toggleTorch()}
            disabled={!canUseTorch}
            className="h-11"
          >
            {torchOn ? <FlashlightOff className="mr-2 h-4 w-4" /> : <Flashlight className="mr-2 h-4 w-4" />}
            Torch
          </Button>
          <Button variant={canFocus ? "outline" : "secondary"} disabled className="h-11">
            <Focus className="mr-2 h-4 w-4" />
            {canFocus ? "Tap Focus" : "Auto Focus"}
          </Button>
          <Button variant="outline" onClick={() => void resetCameraControls()} disabled={!cameraOn} className="h-11">
            <RotateCcw className="mr-2 h-4 w-4" /> Reset
          </Button>
          <Button variant="outline" onClick={() => void clearQueueAndRecent()} className="h-11 text-destructive hover:text-destructive">
            <Trash2 className="mr-2 h-4 w-4" /> Clear
          </Button>
        </div>
      </Card>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">Recent scans</span>
          <span className="text-xs text-muted-foreground">{rows.length} cards</span>
        </div>
        {rows.length === 0 ? (
          <Card className="p-4 text-center text-sm text-muted-foreground">No scans yet.</Card>
        ) : (
          <div className="grid gap-2">
            {rows.slice(0, 30).map((row) => (
              <Card key={row.id} className="flex items-center gap-3 p-2">
                {row.imageUrl ? (
                  <img
                    src={row.imageUrl}
                    alt="Captured card"
                    className="h-16 w-12 rounded object-cover"
                    onError={(event) => {
                      event.currentTarget.style.visibility = "hidden";
                    }}
                  />
                ) : (
                  <div className="h-16 w-12 rounded bg-muted" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{row.cardName || row.status}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[row.cardSet, row.cardNumber].filter(Boolean).join(" • ") || "Waiting for lookup"}
                  </div>
                  {row.error && <div className="truncate text-xs text-destructive">{row.error}</div>}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge variant={row.status === "completed" ? "default" : row.status === "error" ? "destructive" : "secondary"}>
                    {row.status === "completed" && Number.isFinite(Number(row.value))
                      ? `$${Number(row.value).toFixed(2)}`
                      : row.status}
                  </Badge>

                  {row.status === "error" && (
                    <Button variant="outline" size="sm" onClick={() => void retryScan(row.id)}>
                      <RefreshCw className="mr-1 h-3 w-3" /> Retry
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
