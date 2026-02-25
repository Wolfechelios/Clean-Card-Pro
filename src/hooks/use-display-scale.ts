import { useEffect, useCallback } from "react";
import { useLocalStorageState } from "@/lib/useLocalStorageState";

const SCALE_KEY = "display-scale";
const DEFAULT_SCALE = 100; // percentage
const SCALE_OPTIONS = [75, 80, 85, 90, 95, 100, 110, 120, 125, 150] as const;

export type ScaleValue = (typeof SCALE_OPTIONS)[number];

export function useDisplayScale() {
  const { value: scale, setValue: setScale } = useLocalStorageState<number>(SCALE_KEY, DEFAULT_SCALE);

  const applyScale = useCallback((s: number) => {
    document.documentElement.style.zoom = `${s}%`;
  }, []);

  useEffect(() => {
    applyScale(scale);
    return () => {
      document.documentElement.style.zoom = "";
    };
  }, [scale, applyScale]);

  return { scale, setScale, scaleOptions: SCALE_OPTIONS };
}
