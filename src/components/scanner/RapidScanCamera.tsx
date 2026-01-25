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
  isCameraActive: boolean;
  onCapture: (file: File) => Promise<any>;
  scanModeLabel?: string;
}

type Status = "idle" | "detecting" | "stabilizing" | "processing";

export default function RapidScanCamera({
  videoRef,
  startCamera,
  isCameraActive,
  onCapture,
  scanModeLabel = "Save Mode",
}: RapidScanCameraProps) {
  const scanGate = useRef(new RapidScanGate()).current;
  const frameGuard = useRef(new FrameLoopGuard()).current;
  const stabilityGate = useRef(new StabilityGate(900)).current;

  const [status, setStatus] = useState<Status>("idle");
  const [sessionCount, setSessionCount] = useState(0);

  // Ensure camera is running
  useEffect(() => {
    if (!isCameraActive) {
      startCamera();
    }
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

        const ready = stabilityGate.update(true);
        if (!ready) {
          setStatus("stabilizing");
          return;
        }

        if (!scanGate.enter()) return;

        let bitmap: ImageBitmap | null = null;

        try {
          setStatus("processing");
          bitmap = await captureFrame(videoRef.current);

          // ✅ CONVERT ImageBitmap → File (CRITICAL FIX)
          const file = await imageBitmapToFile(bitmap);

          await onCapture(file);
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
    <>
      <div className="absolute top-3 left-3 z-20 rounded bg-black/70 px-3 py-1 text-xs text-white">
        Rapid Scan · {scanModeLabel}
      </div>

      <div className="absolute top-3 right-3 z-20 rounded bg-black/70 px-3 py-1 text-xs text-white">
        Session: {sessionCount}
      </div>

      <div className="absolute bottom-6 left-1/2 z-20 -translate-x-1/2 rounded bg-black/70 px-4 py-2 text-sm text-white">
        {status === "idle" && "Starting"}
        {status === "detecting" && "Looking for card"}
        {status === "stabilizing" && "Hold steady"}
        {status === "processing" && "Processing"}
      </div>
    </>
  );
}

/**
 * Convert ImageBitmap into a File compatible with the rest of the app
 */
async function imageBitmapToFile(bitmap: ImageBitmap): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");

  ctx.drawImage(bitmap, 0, 0);

  const blob: Blob = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.92)
  );

  return new File([blob], `rapid-scan-${Date.now()}.jpg`, {
    type: "image/jpeg",
  });
}
