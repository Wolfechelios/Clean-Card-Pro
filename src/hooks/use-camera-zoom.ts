import { useState, useCallback, RefObject } from "react";
import { toast } from "sonner";

interface UseCameraZoomOptions {
  streamRef: RefObject<MediaStream | null>;
  minZoom?: number;
  maxZoom?: number;
  step?: number;
}

interface ZoomCapabilities {
  supported: boolean;
  min: number;
  max: number;
  step: number;
}

export function useCameraZoom({
  streamRef,
  minZoom = 1,
  maxZoom = 10,
  step = 0.5,
}: UseCameraZoomOptions) {
  const [zoomLevel, setZoomLevel] = useState(1);
  const [zoomCapabilities, setZoomCapabilities] = useState<ZoomCapabilities>({
    supported: false,
    min: minZoom,
    max: maxZoom,
    step: step,
  });

  const detectZoomCapabilities = useCallback(async () => {
    if (!streamRef.current) return;

    try {
      const track = streamRef.current.getVideoTracks()[0];
      if (!track) return;

      const capabilities = track.getCapabilities?.() as any;
      const settings = track.getSettings?.() as any;

      if (capabilities?.zoom) {
        setZoomCapabilities({
          supported: true,
          min: capabilities.zoom.min || minZoom,
          max: capabilities.zoom.max || maxZoom,
          step: capabilities.zoom.step || step,
        });
        // Set initial zoom level from current settings
        if (settings?.zoom) {
          setZoomLevel(settings.zoom);
        }
        console.log("Zoom capabilities detected:", capabilities.zoom);
      } else {
        setZoomCapabilities({
          supported: false,
          min: minZoom,
          max: maxZoom,
          step: step,
        });
        console.log("Zoom not supported on this camera");
      }
    } catch (e) {
      console.log("Error detecting zoom capabilities:", e);
    }
  }, [streamRef, minZoom, maxZoom, step]);

  const setZoom = useCallback(
    async (level: number) => {
      if (!streamRef.current || !zoomCapabilities.supported) {
        return false;
      }

      try {
        const track = streamRef.current.getVideoTracks()[0];
        if (!track) return false;

        const clampedLevel = Math.min(
          Math.max(level, zoomCapabilities.min),
          zoomCapabilities.max
        );

        await track.applyConstraints({
          advanced: [{ zoom: clampedLevel } as any],
        });

        setZoomLevel(clampedLevel);
        return true;
      } catch (e) {
        console.error("Failed to set zoom:", e);
        return false;
      }
    },
    [streamRef, zoomCapabilities]
  );

  const zoomIn = useCallback(async () => {
    const newLevel = Math.min(
      zoomLevel + zoomCapabilities.step,
      zoomCapabilities.max
    );
    const success = await setZoom(newLevel);
    if (success) {
      toast.success(`Zoom: ${newLevel.toFixed(1)}x`);
    }
  }, [zoomLevel, zoomCapabilities, setZoom]);

  const zoomOut = useCallback(async () => {
    const newLevel = Math.max(
      zoomLevel - zoomCapabilities.step,
      zoomCapabilities.min
    );
    const success = await setZoom(newLevel);
    if (success) {
      toast.success(`Zoom: ${newLevel.toFixed(1)}x`);
    }
  }, [zoomLevel, zoomCapabilities, setZoom]);

  const resetZoom = useCallback(async () => {
    const success = await setZoom(1);
    if (success) {
      toast.success("Zoom reset");
    }
  }, [setZoom]);

  return {
    zoomLevel,
    zoomCapabilities,
    detectZoomCapabilities,
    setZoom,
    zoomIn,
    zoomOut,
    resetZoom,
  };
}
