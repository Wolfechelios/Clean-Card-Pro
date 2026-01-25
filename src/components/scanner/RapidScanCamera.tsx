import { useEffect, useRef, useState } from "react";
import {
  RapidScanGate,
  FrameLoopGuard,
  StabilityGate,
  captureFrame,
  destroyFrame,
} from "@/lib/rapid-scan-core";

interface RapidScanCameraProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  startCamera: () => Promise<void>;
  stopCamera: () => void;
  isCameraActive: boolean;
  onCapture: (image: ImageBitmap) => Promise<any>;
  scanModeLabel?: string;
}

type Status = "idle" | "detecting" | "stabilizing" | "processing";

export default function RapidScanCamera({
  videoRef,
  startCamera,
  stopCamera,
  isCameraActive,
  onCapture,
  scanModeLabel = "Save Mode",
}: RapidScanCameraProps) {
  const scanGate = useRef(new RapidScanGate()).current;
  const frameGuard = useRef(new FrameLoopGuard()).current;
  const stabilityGate = useRef(new StabilityGate(900)).current;

  const [status, setStatus] = useState<Status>("idle");
  const [sessionCount, setSessionCount] = useState(0);

  // Ensure camera is running when entering Rapid Scan
  useEffect(() => {
    if (!isCameraActive) {
      startCamera();
    }
    return () => {
      // do not stop camera automatically; user controls that
    };
  }, [isCameraActive, startCamera]);

  // Rapid scan loop
  useEffect(() => {
    if (!videoRef.current || !isCameraActive) return;

    let rafId: number;

    const loop = async () => {
      rafId = requestAnimationFrame(loop);

      await frameGuard.run(async () => {
        if (!videoRef.current) return;
        if (scanGate.isLocked()) return;

        // This assumes your existing detection logic feeds stability elsewhere.
        // For now, rapid scan assumes the card is present & stable.
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
  }, [videoRef, isCameraActive, onCapture, scanGate, frameGuard, stabilityGate]);

  return (
    <div className="relative h-full w-full bg-black">
      {/* Camera view comes from shared videoRef */}
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        playsInline
        muted
      />

      {/* Mode Label */}
      <div className="absolute top-3 left-3 z-20 rounded bg-black/70 px-3 py-1 text-xs text-white">
        Rapid Scan · {scanModeLabel}
      </div>

      {/* Session Count */}
      <div className="absolute top-3 right-3 z-20 rounded bg-black/70 px-3 py-1 text-xs text-white">
        Session: {sessionCount}
      </div>

      {/* Status */}
      <div className="absolute bottom-6 left-1/2 z-20 -translate-x-1/2 rounded bg-black/70 px-4 py-2 text-sm text-white">
        {status === "idle" && "Starting"}
        {status === "detecting" && "Looking for card"}
        {status === "stabilizing" && "Hold steady"}
        {status === "processing" && "Processing"}
      </div>
    </div>
  );
}
