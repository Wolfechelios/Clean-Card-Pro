import { useCallback, useRef, useState } from "react";
import { Camera, Gauge, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { applyProTrackTuning, getProCaptureConstraints } from "@/lib/vision/mobileCameraProfile";
import { runLocalCardVision } from "@/lib/vision/scanPipeline";
import type { CardVisionResult, ScanMode } from "@/lib/vision/cardVisionTypes";

export function LocalVisionScanner() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [mode, setMode] = useState<ScanMode>("single-card");
  const [status, setStatus] = useState("Local vision ready");
  const [result, setResult] = useState<CardVisionResult | null>(null);

  const startCamera = useCallback(async () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    const stream = await navigator.mediaDevices.getUserMedia(getProCaptureConstraints(mode));
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    }
    const [track] = stream.getVideoTracks();
    if (track) await applyProTrackTuning(track, mode);
    setStatus(mode === "binder-page" ? "Binder viewfinder tuned" : "Single-card viewfinder tuned");
  }, [mode]);

  const scanFrame = useCallback(async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const next = await runLocalCardVision(imageData);
    setResult(next);
    setStatus(next.quality.reason);
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" /> Local Card Vision
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setMode("single-card")} variant={mode === "single-card" ? "default" : "outline"}>Single card</Button>
          <Button onClick={() => setMode("binder-page")} variant={mode === "binder-page" ? "default" : "outline"}>Binder page</Button>
          <Button onClick={startCamera}><Camera className="mr-2 h-4 w-4" /> Start tuned camera</Button>
          <Button onClick={scanFrame} variant="secondary"><Gauge className="mr-2 h-4 w-4" /> Analyze frame</Button>
        </div>
        <video ref={videoRef} playsInline muted className="w-full rounded-lg border bg-black" />
        <canvas ref={canvasRef} className="hidden" />
        <div className="rounded-lg border p-3 text-sm">
          <div className="font-medium">{status}</div>
          {result && (
            <div className="mt-2 text-muted-foreground">
              Brand: {result.brand} · Quality: {Math.round(result.quality.score * 100)}% · Layout: {result.layout.label}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
