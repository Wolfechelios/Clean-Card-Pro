import { useCallback, useRef, useEffect } from "react";
import { getScannerSettings } from "./use-scanner-settings";

interface UseAutoFocusOptions {
  trackRef: React.RefObject<MediaStreamTrack | null>;
  enabled?: boolean;
}

interface FocusCapabilities {
  focusMode: boolean;
  focusDistance: boolean;
  pointsOfInterest: boolean;
}

/**
 * Enhanced autofocus hook for camera scanning
 * - Continuous autofocus when camera starts
 * - Tap-to-focus with point of interest
 * - Periodic focus refresh for stationary cards
 */
export function useAutoFocus({ trackRef, enabled = true }: UseAutoFocusOptions) {
  const focusIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const lastFocusTriggerRef = useRef<number>(0);

  // Detect focus capabilities
  const detectFocusCapabilities = useCallback((): FocusCapabilities => {
    const track = trackRef.current;
    if (!track?.getCapabilities) {
      return { focusMode: false, focusDistance: false, pointsOfInterest: false };
    }

    try {
      const caps = track.getCapabilities() as any;
      return {
        focusMode: Array.isArray(caps.focusMode) && caps.focusMode.length > 0,
        focusDistance: typeof caps.focusDistance !== "undefined",
        pointsOfInterest: typeof caps.pointsOfInterest !== "undefined",
      };
    } catch {
      return { focusMode: false, focusDistance: false, pointsOfInterest: false };
    }
  }, [trackRef]);

  // Apply continuous autofocus
  const applyContinuousAutoFocus = useCallback(async (): Promise<boolean> => {
    const settings = getScannerSettings();
    if (!settings.featureContinuousAutoFocus || !enabled) return false;

    const track = trackRef.current;
    if (!track?.applyConstraints) return false;

    try {
      await track.applyConstraints({
        advanced: [{ focusMode: "continuous" } as any],
      });
      console.log("[AutoFocus] Continuous autofocus enabled");
      return true;
    } catch (e) {
      console.log("[AutoFocus] Continuous autofocus not supported:", e);
      return false;
    }
  }, [trackRef, enabled]);

  // Trigger single-shot focus (manual then back to continuous)
  const triggerFocus = useCallback(async (): Promise<boolean> => {
    const settings = getScannerSettings();
    if (!settings.featureAutoFocus || !enabled) return false;

    const track = trackRef.current;
    if (!track?.applyConstraints) return false;

    // Debounce focus triggers (minimum 200ms between)
    const now = Date.now();
    if (now - lastFocusTriggerRef.current < 200) return false;
    lastFocusTriggerRef.current = now;

    try {
      // Switch to manual/single-shot focus
      await track.applyConstraints({
        advanced: [{ focusMode: "manual" } as any],
      });

      // Brief delay for focus to lock
      await new Promise((r) => setTimeout(r, 100));

      // Return to continuous focus
      if (settings.featureContinuousAutoFocus) {
        await track.applyConstraints({
          advanced: [{ focusMode: "continuous" } as any],
        });
      }

      console.log("[AutoFocus] Single-shot focus triggered");
      return true;
    } catch (e) {
      console.log("[AutoFocus] Single-shot focus failed:", e);
      return false;
    }
  }, [trackRef, enabled]);

  // Tap-to-focus at specific point (normalized 0-1)
  const focusAtPoint = useCallback(
    async (x: number, y: number): Promise<boolean> => {
      const settings = getScannerSettings();
      if (!settings.featureTapToFocus || !enabled) return false;

      const track = trackRef.current;
      if (!track?.applyConstraints) return false;

      const clampedX = Math.max(0, Math.min(1, x));
      const clampedY = Math.max(0, Math.min(1, y));

      try {
        // Try pointsOfInterest first (most precise)
        await track.applyConstraints({
          advanced: [{ pointsOfInterest: [{ x: clampedX, y: clampedY }] } as any],
        });
        console.log(`[AutoFocus] Focus point set to (${clampedX.toFixed(2)}, ${clampedY.toFixed(2)})`);
        return true;
      } catch {
        // Fallback: just trigger a general refocus
        return triggerFocus();
      }
    },
    [trackRef, enabled, triggerFocus]
  );

  // Set focus distance for macro/close-up (card scanning)
  const setMacroFocus = useCallback(async (): Promise<boolean> => {
    const track = trackRef.current;
    if (!track?.applyConstraints) return false;

    const caps = detectFocusCapabilities();
    if (!caps.focusDistance) return false;

    try {
      const capabilities = track.getCapabilities() as any;
      const minDistance = capabilities.focusDistance?.min ?? 0.1;
      
      // Set to minimum focus distance for close-up card scanning
      await track.applyConstraints({
        advanced: [{ focusDistance: minDistance } as any],
      });
      console.log(`[AutoFocus] Macro focus set to ${minDistance}m`);
      return true;
    } catch (e) {
      console.log("[AutoFocus] Macro focus failed:", e);
      return false;
    }
  }, [trackRef, detectFocusCapabilities]);

  // Start periodic focus refresh (for stationary cards)
  const startPeriodicFocus = useCallback(
    (intervalMs: number = 3000) => {
      stopPeriodicFocus();

      focusIntervalRef.current = setInterval(() => {
        triggerFocus();
      }, intervalMs);

      console.log(`[AutoFocus] Periodic focus started (${intervalMs}ms interval)`);
    },
    [triggerFocus]
  );

  // Stop periodic focus
  const stopPeriodicFocus = useCallback(() => {
    if (focusIntervalRef.current) {
      clearInterval(focusIntervalRef.current);
      focusIntervalRef.current = null;
      console.log("[AutoFocus] Periodic focus stopped");
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopPeriodicFocus();
    };
  }, [stopPeriodicFocus]);

  return {
    detectFocusCapabilities,
    applyContinuousAutoFocus,
    triggerFocus,
    focusAtPoint,
    setMacroFocus,
    startPeriodicFocus,
    stopPeriodicFocus,
  };
}
