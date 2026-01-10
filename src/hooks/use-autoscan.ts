// src/hooks/use-autoscan.ts
// Hook that integrates AutoScanController + FrameAnalyzer into a camera component.
// Runs in requestAnimationFrame loop, never blocks rendering.

import { useCallback, useEffect, useRef, useState } from "react";
import { 
  AutoScanController, 
  FrameAnalyzer, 
  AutoScanTuning,
  FrameAnalyzerConfig,
  AutoScanState,
} from "@/lib/autoscan";

export type AutoScanStatus = {
  enabled: boolean;
  state: AutoScanState;
  progress: number;  // 0-1 stability progress
  qualityIssue: "sharpness" | "exposure" | "glare" | null;
  queueFull: boolean;
  frameStats: {
    sharpness: number;
    exposure: number;
    glare: number;
    drift: number;
    confidence: number;
  };
};

export type UseAutoScanOptions = {
  videoRef: React.RefObject<HTMLVideoElement>;
  enabled: boolean;
  queueHasCapacity: boolean;
  onCapture: () => void;
  tuning?: Partial<AutoScanTuning>;
  analyzerConfig?: Partial<FrameAnalyzerConfig>;
};

export function useAutoScan({
  videoRef,
  enabled,
  queueHasCapacity,
  onCapture,
  tuning,
  analyzerConfig,
}: UseAutoScanOptions) {
  const controllerRef = useRef<AutoScanController | null>(null);
  const analyzerRef = useRef<FrameAnalyzer | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  const lastStatusUpdateRef = useRef<number>(0);
  const targetFpsRef = useRef(15); // Analyze at 15fps max to save CPU

  const [status, setStatus] = useState<AutoScanStatus>({
    enabled: false,
    state: "SEARCHING",
    progress: 0,
    qualityIssue: null,
    queueFull: false,
    frameStats: {
      sharpness: 0,
      exposure: 128,
      glare: 0,
      drift: 0,
      confidence: 0,
    },
  });

  // Initialize controller and analyzer
  useEffect(() => {
    controllerRef.current = new AutoScanController(tuning);
    analyzerRef.current = new FrameAnalyzer(analyzerConfig);

    return () => {
      controllerRef.current = null;
      analyzerRef.current = null;
    };
  }, []);

  // Update tuning if it changes
  useEffect(() => {
    if (controllerRef.current && tuning) {
      controllerRef.current = new AutoScanController(tuning);
    }
  }, [tuning]);

  const frameLoop = useCallback(() => {
    if (!enabled || !videoRef.current || !controllerRef.current || !analyzerRef.current) {
      rafRef.current = requestAnimationFrame(frameLoop);
      return;
    }

    const now = performance.now();
    const elapsed = now - lastFrameTimeRef.current;
    const frameInterval = 1000 / targetFpsRef.current;

    if (elapsed < frameInterval) {
      rafRef.current = requestAnimationFrame(frameLoop);
      return;
    }

    lastFrameTimeRef.current = now;

    const video = videoRef.current;
    if (video.readyState < 2) {
      rafRef.current = requestAnimationFrame(frameLoop);
      return;
    }

    try {
      // Analyze frame
      const analysis = analyzerRef.current.analyze(video);

      // Run state machine
      const decision = controllerRef.current.onFrame(
        {
          now,
          bbox: analysis.bbox,
          inRoi: analysis.inRoi,
          confidence: analysis.confidence,
          driftPx: analysis.driftPx,
          sizeVar: analysis.sizeVar,
          sharpnessOk: analysis.sharpnessOk,
          exposureOk: analysis.exposureOk,
          glareOk: analysis.glareOk,
        },
        queueHasCapacity
      );

      // Update status for UI (throttled to reduce re-render cost)
      const statusUpdateInterval = 1000 / 10; // 10fps UI updates
      if (decision.action === "CAPTURE" || (now - lastStatusUpdateRef.current) >= statusUpdateInterval) {
        lastStatusUpdateRef.current = now;
        setStatus({
          enabled: true,
          state: decision.state,
          progress: controllerRef.current.getProgress(),
          qualityIssue: decision.qualityIssue || null,
          queueFull: !queueHasCapacity,
          frameStats: {
            sharpness: analysis.sharpnessValue,
            exposure: analysis.exposureValue,
            glare: analysis.glareValue,
            drift: analysis.driftPx,
            confidence: analysis.confidence,
          },
        });
      }

      // Trigger capture if decided
      if (decision.action === "CAPTURE") {
        onCapture();
      }
    } catch (err) {
      console.error("[useAutoScan] Frame analysis error:", err);
    }

    rafRef.current = requestAnimationFrame(frameLoop);
  }, [enabled, queueHasCapacity, onCapture, videoRef]);

  // Start/stop the frame loop
  useEffect(() => {
    if (enabled) {
      lastFrameTimeRef.current = performance.now();
      lastStatusUpdateRef.current = 0;
      controllerRef.current?.reset();
      analyzerRef.current?.reset();
      rafRef.current = requestAnimationFrame(frameLoop);
    } else {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      setStatus((s) => ({ ...s, enabled: false, state: "SEARCHING", progress: 0 }));
    }

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [enabled, frameLoop]);

  const reset = useCallback(() => {
    controllerRef.current?.reset();
    analyzerRef.current?.reset();
    setStatus(s => ({ ...s, state: "SEARCHING", progress: 0 }));
  }, []);

  return { status, reset };
}
