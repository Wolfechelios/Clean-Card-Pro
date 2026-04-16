import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { CameraDeviceSelector } from "./CameraDeviceSelector";
import { useCameraDevices } from "@/hooks/use-camera-devices";
import { Camera, Loader2, Pause, Play, RefreshCw, Sparkles, TabletSmartphone } from "lucide-react";
import { toast } from "sonner";

interface ContinuityCameraIngestProps {
  onImageCaptured: (imageFile: File) => void;
}

interface FrameMetrics {
  sharpness: number;
  stability: number;
  brightness: number;
}

const DEFAULT_SAMPLE_MS = 350;
const CAPTURE_COOLDOWN_MS = 1400;
const MAX_METRIC_HISTORY = 12;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function normalize(value: number, min: number, max: number) {
  if (max <= min) return 0;
  return clamp(((value - min) / (max - min)) * 100, 0, 100);
}

function computeFrameMetrics(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  prevSampleRef: React.MutableRefObject<Float32Array | null>,
): FrameMetrics | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;

  const sampleW = 160;
  const sampleH = 224;
  const sx = Math.max(0, Math.floor((vw - sampleW) / 2));
  const sy = Math.max(0, Math.floor((vh - sampleH) / 2));

  canvas.width = sampleW;
  canvas.height = sampleH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;

  ctx.drawImage(video, sx, sy, sampleW, sampleH, 0, 0, sampleW, sampleH);
  const imageData = ctx.getImageData(0, 0, sampleW, sampleH).data;

  const gray = new Float32Array(sampleW * sampleH);
  let brightnessSum = 0;

  for (let i = 0, p = 0; i < imageData.length; i += 4, p++) {
    const luminance = imageData[i] * 0.299 + imageData[i + 1] * 0.587 + imageData[i + 2] * 0.114;
    gray[p] = luminance;
    brightnessSum += luminance;
  }

  let edgeEnergy = 0;
  for (let y = 1; y < sampleH - 1; y++) {
    for (let x = 1; x < sampleW - 1; x++) {
      const i = y * sampleW + x;
      const gx = -gray[i - sampleW - 1] - 2 * gray[i - 1] - gray[i + sampleW - 1] + gray[i - sampleW + 1] + 2 * gray[i + 1] + gray[i + sampleW + 1];
      const gy = -gray[i - sampleW - 1] - 2 * gray[i - sampleW] - gray[i - sampleW + 1] + gray[i + sampleW - 1] + 2 * gray[i + sampleW] + gray[i + sampleW + 1];
      edgeEnergy += Math.abs(gx) + Math.abs(gy);
    }
  }

  let frameDelta = 0;
  if (prevSampleRef.current && prevSampleRef.current.length === gray.length) {
    for (let i = 0; i < gray.length; i++) {
      frameDelta += Math.abs(gray[i] - prevSampleRef.current[i]);
    }
    frameDelta /= gray.length;
  } else {
    frameDelta = 999;
  }

  prevSampleRef.current = gray;

  return {
    sharpness: edgeEnergy / (sampleW * sampleH),
    stability: frameDelta,
    brightness: brightnessSum / gray.length,
  };
}

function isLikelyContinuityLabel(label: string) {
  const l = label.toLowerCase();
  return ["ipad", "iphone", "continuity", "desk view", "camo", "epoccam", "droidcam", "iriun"].some((token) => l.includes(token));
}

export const ContinuityCameraIngest = ({ onImageCaptured }: ContinuityCameraIngestProps) => {
  const { devices, selectedDeviceId, setSelectedDeviceId, isLoading, refreshDevices } = useCameraDevices();
  const [isStarting, setIsStarting] = useState(false);
  const [isActive, setIsActive] = useState(false);
  const [autoCapture, setAutoCapture] = useState(true);
  const [isSamplerRunning, setIsSamplerRunning] = useState(true);
  const [lastCapturedAt, setLastCapturedAt] = useState<number | null>(null);
  const [captureCount, setCaptureCount] = useState(0);
  const [metrics, setMetrics] = useState<FrameMetrics>({ sharpness: 0, stability: 999, brightness: 0 });
  const [status, setStatus] = useState("Idle");

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const metricCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const prevSampleRef = useRef<Float32Array | null>(null);
  const samplerTimerRef = useRef<number | null>(null);
  const captureLockRef = useRef(false);
  const metricHistoryRef = useRef<FrameMetrics[]>([]);
  const lastAutoCaptureRef = useRef(0);

  const sortedDevices = useMemo(() => {
    return [...devices].sort((a, b) => Number(isLikelyContinuityLabel(b.label)) - Number(isLikelyContinuityLabel(a.label)));
  }, [devices]);

  const continuityDevices = useMemo(() => sortedDevices.filter((d) => isLikelyContinuityLabel(d.label)), [sortedDevices]);

  const stopCamera = useCallback(() => {
    if (samplerTimerRef.current) {
      window.clearInterval(samplerTimerRef.current);
      samplerTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    prevSampleRef.current = null;
    metricHistoryRef.current = [];
    setIsActive(false);
    setStatus("Stopped");
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const startCamera = useCallback(async () => {
    if (!selectedDeviceId) {
      toast.error("No camera selected");
      return;
    }

    setIsStarting(true);
    setStatus("Starting camera...");

    try {
      stopCamera();
      const constraintsChain: MediaStreamConstraints[] = [
        {
          video: {
            deviceId: { exact: selectedDeviceId },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30, max: 30 },
          },
          audio: false,
        },
        {
          video: {
            deviceId: { exact: selectedDeviceId },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        },
        {
          video: { deviceId: selectedDeviceId },
          audio: false,
        },
      ];

      let stream: MediaStream | null = null;
      let lastError: unknown;
      for (const constraints of constraintsChain) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          break;
        } catch (err) {
          lastError = err;
        }
      }

      if (!stream) throw lastError ?? new Error("Unable to start selected camera");
      if (!videoRef.current) throw new Error("Video element unavailable");

      videoRef.current.srcObject = stream;
      videoRef.current.playsInline = true;
      videoRef.current.muted = true;
      await videoRef.current.play().catch(() => undefined);

      streamRef.current = stream;
      setIsActive(true);
      setStatus("Live feed ready");
      toast.success("External camera feed ready");
    } catch (error: any) {
      console.error("Continuity ingest camera error", error);
      setStatus("Camera failed to start");
      toast.error(error?.message || "Failed to start camera");
    } finally {
      setIsStarting(false);
    }
  }, [selectedDeviceId, stopCamera]);

  const captureFrame = useCallback(async (reason: "manual" | "auto") => {
    if (!videoRef.current || captureLockRef.current) return;
    const video = videoRef.current;
    if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;

    captureLockRef.current = true;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) throw new Error("Canvas capture unavailable");
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((value) => resolve(value), "image/jpeg", 0.95);
      });
      if (!blob) throw new Error("Capture failed");

      const file = new File([blob], `continuity-${Date.now()}.jpg`, { type: "image/jpeg" });
      onImageCaptured(file);
      setLastCapturedAt(Date.now());
      setCaptureCount((prev) => prev + 1);
      setStatus(reason === "auto" ? "Auto-captured stable frame" : "Frame captured");
      if (reason === "manual") {
        toast.success("Frame captured from external camera");
      }
    } catch (error: any) {
      console.error("Capture error", error);
      toast.error(error?.message || "Capture failed");
    } finally {
      captureLockRef.current = false;
    }
  }, [onImageCaptured]);

  const runSampler = useCallback(() => {
    if (!videoRef.current) return;
    if (!metricCanvasRef.current) {
      metricCanvasRef.current = document.createElement("canvas");
    }

    const next = computeFrameMetrics(videoRef.current, metricCanvasRef.current, prevSampleRef);
    if (!next) return;

    metricHistoryRef.current = [...metricHistoryRef.current, next].slice(-MAX_METRIC_HISTORY);
    const avg = metricHistoryRef.current.reduce(
      (acc, item) => ({
        sharpness: acc.sharpness + item.sharpness,
        stability: acc.stability + item.stability,
        brightness: acc.brightness + item.brightness,
      }),
      { sharpness: 0, stability: 0, brightness: 0 },
    );
    const count = metricHistoryRef.current.length || 1;
    const averaged = {
      sharpness: avg.sharpness / count,
      stability: avg.stability / count,
      brightness: avg.brightness / count,
    };

    setMetrics(averaged);

    const sharpnessScore = normalize(averaged.sharpness, 12, 42);
    const stabilityScore = 100 - normalize(averaged.stability, 3, 22);
    const brightnessScore = 100 - Math.abs(averaged.brightness - 125) * 0.7;
    const confidence = clamp((sharpnessScore * 0.5) + (stabilityScore * 0.35) + (brightnessScore * 0.15), 0, 100);

    if (confidence >= 78) {
      setStatus("Card looks locked in");
    } else if (sharpnessScore < 50) {
      setStatus("Refine focus / lighting");
    } else if (stabilityScore < 50) {
      setStatus("Hold steady");
    } else {
      setStatus("Framing card");
    }

    const now = Date.now();
    if (
      autoCapture &&
      isSamplerRunning &&
      confidence >= 84 &&
      sharpnessScore >= 62 &&
      stabilityScore >= 70 &&
      now - lastAutoCaptureRef.current >= CAPTURE_COOLDOWN_MS
    ) {
      lastAutoCaptureRef.current = now;
      void captureFrame("auto");
    }
  }, [autoCapture, captureFrame, isSamplerRunning]);

  useEffect(() => {
    if (!isActive || !isSamplerRunning) {
      if (samplerTimerRef.current) {
        window.clearInterval(samplerTimerRef.current);
        samplerTimerRef.current = null;
      }
      return;
    }

    runSampler();
    samplerTimerRef.current = window.setInterval(runSampler, DEFAULT_SAMPLE_MS);
    return () => {
      if (samplerTimerRef.current) {
        window.clearInterval(samplerTimerRef.current);
        samplerTimerRef.current = null;
      }
    };
  }, [isActive, isSamplerRunning, runSampler]);

  const selectedDevice = sortedDevices.find((d) => d.deviceId === selectedDeviceId);
  const sharpnessPct = normalize(metrics.sharpness, 12, 42);
  const stabilityPct = 100 - normalize(metrics.stability, 3, 22);
  const brightnessPct = clamp(100 - Math.abs(metrics.brightness - 125) * 0.7, 0, 100);

  return (
    <Card className="shadow-card">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <TabletSmartphone className="h-5 w-5" />
              Continuity / External Camera Ingest
            </CardTitle>
            <CardDescription>
              Use iPad Continuity, iPhone Continuity, Camo, EpocCam, or any Mac-visible camera as a live scan source.
            </CardDescription>
          </div>
          {continuityDevices.length > 0 && (
            <Badge variant="secondary" className="whitespace-nowrap">
              <Sparkles className="mr-1 h-3 w-3" />
              {continuityDevices.length} continuity-ready
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <CameraDeviceSelector
            devices={sortedDevices}
            selectedDeviceId={selectedDeviceId}
            onDeviceChange={setSelectedDeviceId}
            onRefresh={refreshDevices}
            isLoading={isLoading}
          />

          {!isActive ? (
            <Button onClick={startCamera} disabled={isStarting || !selectedDeviceId}>
              {isStarting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
              Start feed
            </Button>
          ) : (
            <Button variant="outline" onClick={stopCamera}>
              <Pause className="mr-2 h-4 w-4" />
              Stop feed
            </Button>
          )}

          <Button variant="secondary" onClick={() => void captureFrame("manual")} disabled={!isActive}>
            <Camera className="mr-2 h-4 w-4" />
            Capture now
          </Button>
        </div>

        {selectedDevice && (
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant={isLikelyContinuityLabel(selectedDevice.label) ? "default" : "outline"}>
              {isLikelyContinuityLabel(selectedDevice.label) ? "Continuity-class device" : selectedDevice.lensLabel}
            </Badge>
            <Badge variant="outline">{status}</Badge>
            {captureCount > 0 && <Badge variant="secondary">{captureCount} captured</Badge>}
            {lastCapturedAt && <Badge variant="outline">Last {Math.round((Date.now() - lastCapturedAt) / 1000)}s ago</Badge>}
          </div>
        )}

        <div className="relative w-full overflow-hidden rounded-lg bg-black aspect-[4/3]">
          <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-cover" />
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative h-[76%] w-[62%] rounded-[18px] border-2 border-primary/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.22)]">
              <div className="absolute inset-x-0 top-3 text-center text-xs font-medium text-white/90">Center card and hold for auto-lock</div>
              <div className="absolute inset-0 m-auto h-12 w-12 rounded-full border border-primary/40" />
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Sharpness</span>
              <span>{Math.round(sharpnessPct)}%</span>
            </div>
            <Progress value={sharpnessPct} className="h-2" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Stability</span>
              <span>{Math.round(stabilityPct)}%</span>
            </div>
            <Progress value={stabilityPct} className="h-2" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Lighting</span>
              <span>{Math.round(brightnessPct)}%</span>
            </div>
            <Progress value={brightnessPct} className="h-2" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/40 p-3">
          <div className="flex items-center space-x-2">
            <Switch id="continuity-auto-capture" checked={autoCapture} onCheckedChange={setAutoCapture} />
            <Label htmlFor="continuity-auto-capture">Auto-capture stable frames</Label>
          </div>
          <div className="flex items-center space-x-2">
            <Switch id="continuity-sampler" checked={isSamplerRunning} onCheckedChange={setIsSamplerRunning} />
            <Label htmlFor="continuity-sampler">Live frame scoring</Label>
          </div>
          <Button variant="ghost" size="sm" onClick={refreshDevices}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh devices
          </Button>
        </div>

        <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          Best path on Mac: expose the iPad through a webcam-style bridge the browser can see. If Preview-only capture is too slow, this live ingest mode gives your Rapid Scanner a continuous feed instead of one-photo handshakes.
          {continuityDevices.length === 0 && " No continuity-style device is visible right now, so USB phone mode or Remote Phone Camera remains the fallback."}
        </div>
      </CardContent>
    </Card>
  );
};

export default ContinuityCameraIngest;
