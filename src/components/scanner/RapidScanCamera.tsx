import { useEffect, useRef, useState } from "react";
import {
  RapidScanGate,
  FrameLoopGuard,
  StabilityGate,
  captureFrame,
  destroyFrame,
} from "@/lib/rapid-scan-core";

type Status =
  | "init"
  | "detecting"
  | "stabilizing"
  | "processing";

interface RapidScanCameraProps {
  onCapture: (image: ImageBitmap) => Promise<void>;
  scanModeLabel?: string;
}

export default function RapidScanCamera({
  onCapture,
  scanModeLabel = "Save Mode",
}: RapidScanCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  const scanGate = useRef(new RapidScanGate()).current;
  const frameGuard = useRef(new FrameLoopGuard()).current;
  const stabilityGate = useRef(new StabilityGate(900)).current;

  const [status, setStatus] = useState<Status>("init");
  const [sessionCount, setSessionCount] = useState(0);
  const [hasCamera, setHasCamera] = useState(false);

  // -------------------------------
  // CAMERA SETUP
  // -------------------------------
  useEffect(() => {
    let stream: MediaStream | null = null;

    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setHasCamera(true);
          setStatus("detecting");
        }
      } catch (err) {
        console.error("Camera error", err);
      }
    }

    startCamera();

    return () => {
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // -------------------------------
  // RAPID SCAN LOOP
  // -------------------------------
  useEffect(() => {
    if (!hasCamera) return;

    let rafId: number;

    const loop = async () => {
      rafId = requestAnimationFrame(loop);

      await frameGuard.run(async () => {
        if (!videoRef.current) return;
        if (scanGate.isLocked()) return;

        // VERY BASIC stability heuristic:
        // we assume the card is stable if video is playing
        // Replace this with your real detection flags if you have them
        const isStable = true;

        const ready = stabilityGate.update(isStable);
        if (!ready) {
          setStatus("stabilizing");
          return;
        }

        if (!scanGate.enter()) return;

        let bitmap: ImageBitmap | null = null;

        try {
          setStatus("processing");
          bitmap = await captureFrame(videoRef.current);
          await onCapture(bitmap);
          setSessionCount((c) => c + 1);
        } finally {
          destroyFrame(bitmap);
          stabilityGate.reset();
          scanGate.exit();
          setStatus("detecting");
        }
      });
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [hasCamera, onCapture, scanGate, frameGuard, stabilityGate]);

  // -------------------------------
  // RENDER
  // -------------------------------
  return (
    <div className="relative h-full w-full bg-black overflow-hidden">
      {/* CAMERA */}
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        playsInline
        muted
      />

      {/* MODE LABEL */}
      <div className="absolute top-3 left-3 z-20 rounded bg-black/70 px-3 py-1 text-xs text-white">
        Rapid Scan · {scanModeLabel}
      </div>

      {/* SESSION COUNT */}
      <div className="absolute top-3 right-3 z-20 rounded bg-black/70 px-3 py-1 text-xs text-white">
        Session: {sessionCount}
      </div>

      {/* STATUS */}
      <div className="absolute bottom-6 left-1/2 z-20 -translate-x-1/2 rounded bg-black/70 px-4 py-2 text-sm text-white">
        {status === "init" && "Starting camera"}
        {status === "detecting" && "Looking for card"}
        {status === "stabilizing" && "Hold steady"}
        {status === "processing" && "Processing"}
      </div>
    </div>
  );
}
