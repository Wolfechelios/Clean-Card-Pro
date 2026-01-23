import { useCallback, useMemo, useState } from "react";

export function useCameraZoom({ streamRef }: { streamRef: React.RefObject<MediaStream | null> }) {
  const [zoomLevel, setZoomLevel] = useState(1);

  const zoomCapabilities = useMemo(() => {
    const track = streamRef.current?.getVideoTracks?.()?.[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const caps: any = track?.getCapabilities?.() ?? {};
    const z = caps.zoom;
    if (!z || typeof z.min !== "number" || typeof z.max !== "number") {
      return { min: 1, max: 3, step: 0.1, supported: false };
    }
    return { min: z.min, max: z.max, step: z.step ?? 0.1, supported: true };
  }, [streamRef]);

  const usingDigitalZoom = !zoomCapabilities.supported;

  const detectZoomCapabilities = useCallback(() => {
    // no-op: derived live
  }, []);

  const setZoom = useCallback(
    async (z: number) => {
      const clamped = Math.max(zoomCapabilities.min, Math.min(zoomCapabilities.max, z));
      setZoomLevel(clamped);
      const track = streamRef.current?.getVideoTracks?.()?.[0];
      if (zoomCapabilities.supported && track?.applyConstraints) {
        try {
          await track.applyConstraints({ advanced: [{ zoom: clamped } as MediaTrackConstraintSet] });
        } catch {
          // ignore
        }
      }
    },
    [streamRef, zoomCapabilities]
  );

  const zoomIn = useCallback(() => setZoom(zoomLevel + zoomCapabilities.step), [setZoom, zoomLevel, zoomCapabilities.step]);
  const zoomOut = useCallback(() => setZoom(zoomLevel - zoomCapabilities.step), [setZoom, zoomLevel, zoomCapabilities.step]);
  const resetZoom = useCallback(() => setZoom(1), [setZoom]);

  return {
    zoomLevel,
    zoomCapabilities,
    usingDigitalZoom,
    detectZoomCapabilities,
    setZoom,
    zoomIn,
    zoomOut,
    resetZoom,
  };
}
