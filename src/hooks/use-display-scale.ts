import { useEffect, useCallback } from "react";
import { useLocalStorageState } from "@/lib/useLocalStorageState";

const SCALE_KEY = "display-scale";
const SCALE_OPTIONS = [75, 80, 85, 90, 95, 100, 110, 120, 125, 150] as const;

/** Auto-detect a good default for high-res mobile screens (e.g. Red Magic 10 Pro) */
function getSmartDefault(): number {
  if (typeof window === "undefined") return 100;
  const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (!isMobile) return 100;
  // High-res phones with small CSS pixels need bigger UI
  const cssWidth = window.screen.width;
  const dpr = window.devicePixelRatio || 1;
  // Phones with very high DPR (≥3) or narrow CSS widths benefit from scaling up
  if (dpr >= 3.5 || (dpr >= 3 && cssWidth <= 400)) return 125;
  if (dpr >= 2.5) return 110;
  return 100;
}

export type ScaleValue = (typeof SCALE_OPTIONS)[number];

export function useDisplayScale() {
  const { value: scale, setValue: setScale } = useLocalStorageState<number>(SCALE_KEY, getSmartDefault());

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
