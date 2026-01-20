import { useState, useCallback, RefObject } from "react";
import { toast } from "sonner";
import { getScannerSettings } from "./use-scanner-settings";

interface UseCameraZoomOptions {
  streamRef: RefObject<MediaStream | null>;
  /**
   * Digital zoom fallback ranges (used when hardware zoom isn't available)
   */
  minZoom?: number;
  maxZoom?: number;
  step?: number;
}

interface ZoomCapabilities {
  /** Whether the UI should show zoom controls */
  supported: boolean;
  /** True when applying real camera zoom via track constraints */
  hardware: boolean;
  min: number;
  max: number;
  step: number;
}

/**
 * Camera zoom helper.
 * - Uses hardware zoom (track constraints) when available
 * - Falls back to digital zoom (CSS scale + capture crop) when not
 * - Respects feature flags from scanner settings
 */
export function useCameraZoom({
  streamRef,
  minZoom = 1,
  maxZoom = 4,
  step = 0.1,
}: UseCameraZoomOptions) {
  const [zoomLevel, setZoomLevel] = useState(1);
  const [zoomCapabilities, setZoomCapabilities] = useState<ZoomCapabilities>({
    supported: true,
    hardware: false,
    min: minZoom,
    max: maxZoom,
    step,
  });

  const detectZoomCapabilities = useCallback(async () => {
    const settings = getScannerSettings();
    
    // Check if zoom controls are enabled
    if (!settings.featureZoomControls) {
      setZoomCapabilities({
        supported: false,
        hardware: false,
        min: 1,
        max: 1,
        step: 0,
      });
      setZoomLevel(1);
      console.log("[Zoom] Zoom controls disabled by feature flag");
      return;
    }

    if (!streamRef.current) return;

    try {
      const track = streamRef.current.getVideoTracks()[0];
      if (!track) return;

      const capabilities = track.getCapabilities?.() as any;
      const trackSettings = track.getSettings?.() as any;

      if (capabilities?.zoom) {
        // Hardware zoom supported
        setZoomCapabilities({
          supported: true,
          hardware: true,
          min: capabilities.zoom.min ?? minZoom,
          max: capabilities.zoom.max ?? Math.max(maxZoom, 4),
          step: capabilities.zoom.step ?? step,
        });
        if (typeof trackSettings?.zoom === "number") {
          setZoomLevel(trackSettings.zoom);
        } else {
          setZoomLevel(1);
        }
        console.log("[Zoom] Hardware zoom detected:", capabilities.zoom);
      } else if (settings.featureDigitalZoomFallback) {
        // Digital fallback enabled
        setZoomCapabilities({
          supported: true,
          hardware: false,
          min: minZoom,
          max: maxZoom,
          step,
        });
        setZoomLevel(1);
        console.log("[Zoom] Using digital zoom fallback");
      } else {
        // Digital fallback disabled
        setZoomCapabilities({
          supported: false,
          hardware: false,
          min: 1,
          max: 1,
          step: 0,
        });
        setZoomLevel(1);
        console.log("[Zoom] No hardware zoom and digital fallback disabled");
      }
    } catch (e) {
      console.log("[Zoom] Error detecting capabilities:", e);
      const settings = getScannerSettings();
      if (settings.featureDigitalZoomFallback) {
        setZoomCapabilities({
          supported: true,
          hardware: false,
          min: minZoom,
          max: maxZoom,
          step,
        });
      } else {
        setZoomCapabilities({
          supported: false,
          hardware: false,
          min: 1,
          max: 1,
          step: 0,
        });
      }
    }
  }, [streamRef, minZoom, maxZoom, step]);

  const setZoom = useCallback(
    async (level: number) => {
      const settings = getScannerSettings();
      if (!settings.featureZoomControls) return false;
      if (!streamRef.current) return false;

      const clampedLevel = Math.min(
        Math.max(level, zoomCapabilities.min),
        zoomCapabilities.max
      );

      // Hardware zoom
      if (zoomCapabilities.hardware) {
        try {
          const track = streamRef.current.getVideoTracks()[0];
          if (!track) return false;

          await track.applyConstraints({
            advanced: [{ zoom: clampedLevel } as any],
          });

          setZoomLevel(clampedLevel);
          return true;
        } catch (e) {
          console.error("[Zoom] Hardware zoom failed, falling back:", e);
          if (settings.featureDigitalZoomFallback) {
            setZoomCapabilities((prev) => ({ ...prev, hardware: false }));
            setZoomLevel(clampedLevel);
            return true;
          }
          return false;
        }
      }

      // Digital zoom (if enabled)
      if (settings.featureDigitalZoomFallback) {
        setZoomLevel(clampedLevel);
        return true;
      }

      return false;
    },
    [streamRef, zoomCapabilities]
  );

  const zoomIn = useCallback(async () => {
    const newLevel = Math.min(zoomLevel + zoomCapabilities.step, zoomCapabilities.max);
    const success = await setZoom(newLevel);
    if (success) toast.success(`Zoom: ${newLevel.toFixed(1)}x`);
  }, [zoomLevel, zoomCapabilities, setZoom]);

  const zoomOut = useCallback(async () => {
    const newLevel = Math.max(zoomLevel - zoomCapabilities.step, zoomCapabilities.min);
    const success = await setZoom(newLevel);
    if (success) toast.success(`Zoom: ${newLevel.toFixed(1)}x`);
  }, [zoomLevel, zoomCapabilities, setZoom]);

  const resetZoom = useCallback(async () => {
    const success = await setZoom(1);
    if (success) toast.success("Zoom reset");
  }, [setZoom]);

  return {
    zoomLevel,
    zoomCapabilities,
    usingDigitalZoom: !zoomCapabilities.hardware,
    detectZoomCapabilities,
    setZoom,
    zoomIn,
    zoomOut,
    resetZoom,
  };
}

