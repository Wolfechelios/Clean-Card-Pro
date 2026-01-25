// src/components/scanner/RapidScanCamera.tsx

import { useEffect, useRef } from "react";
import {
  RapidScanGate,
  FrameLoopGuard,
  StabilityGate,
  captureFrame,
  destroyFrame,
} from "@/lib/rapid-scan-core";

interface RapidScanCameraProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  cardDetected: boolean;
  cardIsStable: boolean;
  onCapture: (image: ImageBitmap) => Promise<void>;
}

export default function RapidScanCamera({
  videoRef,
  cardDetected,
  cardIsStable,
  onCapture,
}: RapidScanCameraProps) {
  const scanGate = useRef(new RapidScanGate()).current;
  const frameGuard = useRef(new FrameLoopGuard()).current;
  const stabilityGate = useRef(new StabilityGate(900)).current;

  useEffect(() => {
    let rafId: number;

    const loop = async () => {
      rafId = requestAnimationFrame(loop);

      if (!videoRef.current) return;

      await frameGuard.run(async () => {
        if (!cardDetected) return;
        if (scanGate.isLocked()) return;

        const ready = stabilityGate.update(cardIsStable);
        if (!ready) return;

        if (!scanGate.enter()) return;

        let bitmap: ImageBitmap | null = null;

        try {
          bitmap = await captureFrame(videoRef.current);
          await onCapture(bitmap);
        } finally {
          destroyFrame(bitmap);
          stabilityGate.reset();
          scanGate.exit();
        }
      });
    };

    rafId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [videoRef, cardDetected, cardIsStable, onCapture, scanGate, frameGuard, stabilityGate]);

  return null;
}
