// src/hooks/use-queue-auto-resume.ts
// Hook to auto-resume the queue processor on app mount.
// Place this in a top-level component (e.g., App.tsx) to ensure
// scanned cards are processed even after app crashes/restarts.

import { useEffect } from "react";
import { checkAndResumeQueue, useQueueProcessor } from "@/lib/queueProcessor";
import { toast } from "sonner";

export function useQueueAutoResume() {
  const { queueCount, isRunning, processedCount, errorCount } = useQueueProcessor();

  useEffect(() => {
    // Silently resume any pending items on mount (no popup)
    checkAndResumeQueue();
  }, []);

  return { queueCount, isRunning, processedCount, errorCount };
}
