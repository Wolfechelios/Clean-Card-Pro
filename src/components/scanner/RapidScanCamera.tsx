// src/components/scanner/RapidScanCamera.tsx

import { useEffect, useRef, useState } from "react";
import {
  RapidScanGate,
  FrameLoopGuard,
  StabilityGate,
  captureFrame,
  destroyFrame,
} from "@/lib/rapid-scan-core";

type RapidScanStatus =
  | "idle"
  | "detecting"
  | "stabilizing"
  | "captured"
  | "processing";

interface RapidScanCameraProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  cardDetected: boolean;
  cardIsStable: boolean;
  onCapture: (image: ImageBitmap) => Promise<void>;
  scanModeLabel?: string; // e.g. "Save Mode", "Inventory Mode"
}

export default function RapidScanCamera({
  videoRef,
  cardDetected,
  cardIsStable,
  onCapture,
  scanModeLabel = "Save Mode",
}: RapidScanCameraProps) {
  const scanGate = useRef(new RapidScanGate()).current;
  const frameGuard = useRef(new FrameLoopGuard()).current;
  const stabilityGate = useRef(new StabilityGate(900)).current;

  const [status, setStatus] = useState<RapidScanStatus>("idle");
  const [sessionCount, setSessionCount] = useState(0);
  const [stabilityProgress, setStabilityProgress] = useState(0);

  useEffect(() => {
    let rafId: number;

    const loop = async () => {
      rafId = requestAnimationFrame(loop);
      if (!videoRef.current) return;

      await frameGuard.run(async () => {
        if (!cardDetected) {
          setStatus("detecting");
          setStabilityProgress(0);
          return;
        }

        if (scanGate.isLocked()) return;

        if (!cardIsStable) {
          setStatus("stabilizing");
          setStabilityProgress(0);
          stabilityGate.reset();
          return;
        }

        const start = performance.now();
        const ready = stabilityGate.update(true);

        if (!ready) {
          const elapsed = performance.now() - start;
          setStabilityProgress(Math.min(elapsed / 900, 1));
          setStatus("stabilizing");
          return;
        }

        if (!scanGate.enter()) return;

        let bitmap: ImageBitmap | null = null;

        try {
          setStatus("captured");
          bitmap = await captureFrame(videoRef.current);
          setStatus("processing");
          await onCapture(bitmap);
          setSessionCount((c) => c + 1);
        } finally {
          destroyFrame(bitmap);
          stabilityGate.reset();
          setStabilityProgress(0);
          scanGate.exit();
          setStatus("detecting");
        }
      });
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [
    videoRef,
    cardDetected,
    cardIsStable,
    onCapture,
    scanGate,
    frameGuard,
    stabilityGate,
  ]);

  return (
    <>
      {/* MODE LABEL */}
      <div className="absolute top-3 left-3 z-20 rounded-md bg-black/60 px-3 py-1 text-xs text-white">
        Rapid Scan · {scanModeLabel}
      </div>

      {/* SESSION COUNT */}
      <div className="absolute top-3 right-3 z-20 rounded-md bg-black/60 px-3 py-1 text-xs text-white">
        Session: {sessionCount}
      </div>

      {/* STATUS */}
      <div className="absolute bottom-24 left-1/2 z-20 -translate-x-1/2 rounded-md bg-black/70 px-4 py-2 text-sm text-white">
        {status === "idle" && "Starting camera"}
        {status === "detecting" && "Looking for card"}
        {status === "stabilizing" && "Hold steady"}
        {status === "captured" && "Captured"}
        {status === "processing" && "Processing"}
      </div>

      {/* STABILITY INDICATOR */}
      {status === "stabilizing" && (
        <div className="absolute inset-0 z-10 flex items-center justify-center">
          <div className="h-24 w-24 rounded-full border-4 border-white/30">
            <div
              className="h-full w-full rounded-full border-4 border-green-400"
              style={{
                clipPath: `inset(${100 - stabilityProgress * 100}% 0 0 0)`,
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
