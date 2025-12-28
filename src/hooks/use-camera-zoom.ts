import { useState, useCallback, RefObject } from "react";
import { toast } from "sonner";

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
    if (!streamRef.current) return;

    try {
      const track = streamRef.current.getVideoTracks()[0];
      if (!track) return;

      const capabilities = track.getCapabilities?.() as any;
      const settings = track.getSettings?.() as any;

      if (capabilities?.zoom) {
        // Hardware zoom supported
        setZoomCapabilities({
          supported: true,
          hardware: true,
          min: capabilities.zoom.min ?? minZoom,
          max: capabilities.zoom.max ?? Math.max(maxZoom, 4),
          step: capabilities.zoom.step ?? step,
        });
        if (typeof settings?.zoom === 'number') {
          setZoomLevel(settings.zoom);
        } else {
          setZoomLevel(1);
        }
        console.log("Hardware zoom capabilities detected:", capabilities.zoom);
      } else {
        // Digital fallback (still "supported" from UX perspective)
        setZoomCapabilities({
          supported: true,
          hardware: false,
          min: minZoom,
          max: maxZoom,
          step,
        });
        setZoomLevel(1);
        console.log("Hardware zoom not supported - using digital zoom fallback");
      }
    } catch (e) {
      console.log("Error detecting zoom capabilities:", e);
      // Still allow digital zoom fallback
      setZoomCapabilities({
        supported: true,
        hardware: false,
        min: minZoom,
        max: maxZoom,
        step,
      });
    }
  }, [streamRef, minZoom, maxZoom, step]);

  const setZoom = useCallback(
    async (level: number) => {
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
          console.error("Failed to set hardware zoom, falling back to digital:", e);
          setZoomCapabilities((prev) => ({ ...prev, hardware: false }));
          setZoomLevel(clampedLevel);
          return true;
        }
      }

      // Digital zoom
      setZoomLevel(clampedLevel);
      return true;
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
