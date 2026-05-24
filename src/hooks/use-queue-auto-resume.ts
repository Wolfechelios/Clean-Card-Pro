// src/hooks/use-queue-auto-resume.ts
// Hook to auto-resume the queue processor on app mount.
// Place this in a top-level component (e.g., App.tsx) to ensure
// scanned cards are processed even after app crashes/restarts or after
// the user navigates away mid-scan without pressing Stop.

import { useEffect } from "react";
import { checkAndResumeQueue, useQueueProcessor } from "@/lib/queueProcessor";
import { idbCountQueued } from "@/lib/idbQueue";
import { toast } from "sonner";

export function useQueueAutoResume() {
  const { queueCount, isRunning, processedCount, errorCount, isPausedByAnomaly } = useQueueProcessor();

  useEffect(() => {
    if (isPausedByAnomaly) {
      toast.warning("Scan queue paused — repeated OCR anomaly detected. Resume manually if needed.");
      return;
    }
    // Silently resume any pending items on mount (no popup)
    checkAndResumeQueue();

    // Also re-check whenever the user returns to the tab/app — catches the
    // case where they snapped a bunch of cards and navigated away without
    // pressing Stop, so the items sat unprocessed in IndexedDB.
    const recheck = async () => {
      try {
        const n = await idbCountQueued();
        const state = useQueueProcessor.getState();
        if (n > 0 && !state.isRunning && !state.isPausedByAnomaly) {
          console.log(`[QueueAutoResume] Found ${n} stranded items on focus — starting processor`);
          state.start();
        }
      } catch {
        // ignore
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") recheck();
    };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return { queueCount, isRunning, processedCount, errorCount };
}
