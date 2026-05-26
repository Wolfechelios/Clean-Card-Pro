import { useCallback, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

type LogEntry = {
  time: string;
  event: string;
  data?: Record<string, unknown>;
};

function stamp() {
  return new Date().toLocaleTimeString();
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function trackInfo(track: MediaStreamTrack | null) {
  if (!track) return null;
  const settings = track.getSettings?.() || {};
  return {
    id: track.id,
    kind: track.kind,
    label: track.label,
    enabled: track.enabled,
    muted: (track as any).muted,
    readyState: track.readyState,
    settings,
  };
}

export default function CameraDebugPage() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [mode, setMode] = useState<"safe720" | "safe1080">("safe720");
  const [running, setRunning] = useState(false);

  const addLog = useCallback((event: string, data?: Record<string, unknown>) => {
    const entry = { time: stamp(), event, data };
    setLogs((prev) => [entry, ...prev].slice(0, 150));
    console.info(`[camera-debug] ${event}`, data || {});
  }, []);

  const textLog = useMemo(() => safeStringify({
    location: window.location.href,
    secureContext: window.isSecureContext,
    userAgent: navigator.userAgent,
    mediaDevices: !!navigator.mediaDevices,
    getUserMedia: !!navigator.mediaDevices?.getUserMedia,
    mode,
    logs,
  }), [logs, mode]);

  const stopCamera = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      addLog("stopCamera", { tracks: stream.getTracks().map((t) => trackInfo(t)) });
      stream.getTracks().forEach((t) => t.stop());
    }
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.pause();
      (videoRef.current as any).srcObject = null;
    }
    setRunning(false);
  }, [addLog]);

  const listDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      addLog("enumerateDevices", {
        videoInputs: devices
          .filter((d) => d.kind === "videoinput")
          .map((d, i) => ({ index: i, label: d.label || "blank", hasDeviceId: !!d.deviceId })),
      });
    } catch (error: any) {
      addLog("enumerateDevices-error", { name: error?.name, message: error?.message });
    }
  }, [addLog]);

  const startCamera = useCallback(async () => {
    stopCamera();
    await listDevices();

    const video: MediaTrackConstraints = mode === "safe720"
      ? { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 30 } }
      : { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } };

    addLog("getUserMedia-start", { video });

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0] || null;
      addLog("getUserMedia-success", { track: trackInfo(track) });

      if (track) {
        track.addEventListener("ended", () => addLog("track-ended", { track: trackInfo(track) }));
        track.addEventListener("mute", () => addLog("track-mute", { track: trackInfo(track) }));
        track.addEventListener("unmute", () => addLog("track-unmute", { track: trackInfo(track) }));
      }

      const videoEl = videoRef.current;
      if (!videoEl) throw new Error("Missing video element");
      videoEl.setAttribute("playsinline", "true");
      videoEl.setAttribute("webkit-playsinline", "true");
      videoEl.muted = true;
      videoEl.srcObject = stream;

      ["loadedmetadata", "loadeddata", "canplay", "playing", "pause", "stalled", "waiting", "error"].forEach((eventName) => {
        videoEl.addEventListener(eventName, () => addLog(`video-${eventName}`, {
          readyState: videoEl.readyState,
          videoWidth: videoEl.videoWidth,
          videoHeight: videoEl.videoHeight,
          error: videoEl.error ? { code: videoEl.error.code, message: videoEl.error.message } : null,
        }));
      });

      await videoEl.play();
      addLog("video-play-success", { readyState: videoEl.readyState, videoWidth: videoEl.videoWidth, videoHeight: videoEl.videoHeight });
      setRunning(true);

      window.setTimeout(() => addLog("check-2s", { track: trackInfo(track), videoReadyState: videoEl.readyState }), 2000);
      window.setTimeout(() => addLog("check-6s", { track: trackInfo(track), videoReadyState: videoEl.readyState }), 6000);
    } catch (error: any) {
      addLog("camera-error", { name: error?.name, message: error?.message, constraint: error?.constraint });
      setRunning(false);
    }
  }, [addLog, listDevices, mode, stopCamera]);

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Camera Debug</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Run this on the iPhone, let the camera fail, then copy the log text.</p>
          <div className="flex flex-wrap gap-2">
            <Button variant={mode === "safe720" ? "default" : "outline"} onClick={() => setMode("safe720")}>720p safe</Button>
            <Button variant={mode === "safe1080" ? "default" : "outline"} onClick={() => setMode("safe1080")}>1080p safe</Button>
            <Button onClick={() => void startCamera()}>Start test</Button>
            <Button variant="outline" onClick={stopCamera}>Stop</Button>
            <Button variant="outline" onClick={() => void listDevices()}>List devices</Button>
            <Button variant="destructive" onClick={() => setLogs([])}>Clear</Button>
          </div>
          <div className="text-sm">Status: {running ? "running" : "stopped"}</div>
        </CardContent>
      </Card>

      <div className="overflow-hidden rounded-xl bg-black">
        <video ref={videoRef} className="h-[45vh] min-h-[260px] w-full object-contain" playsInline muted autoPlay />
      </div>

      <Textarea className="min-h-[360px] font-mono text-xs" readOnly value={textLog} />
    </div>
  );
}
