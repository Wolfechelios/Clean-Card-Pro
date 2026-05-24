import { useEffect, useCallback } from "react";
import { useLocalStorageState } from "@/lib/useLocalStorageState";

const SCALE_KEY = "display-scale";
const SCALE_OPTIONS = [75, 80, 85, 90, 95, 100, 110, 120, 125, 150] as const;

/** Auto-detect a good default scale based on device characteristics.
 * High-res mobile screens (high DPR, narrow CSS width) get scaled DOWN so more
 * content fits comfortably; small/low-res screens get scaled UP for legibility. */
function getSmartDefault(): number {
  if (typeof window === "undefined") return 100;
  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isMobile = isIOS || isAndroid;
  const cssWidth = window.screen.width;
  const cssHeight = window.screen.height;

  if (!isMobile) {
    if (cssWidth < 1100) return 95;
    return 100;
  }

  // Tablet-ish widths
  if (cssWidth >= 700) return 95;

  // iPhone 17 family (iOS 26): 17/17 Pro ~402×874, 17 Air ~430×932, 17 Pro Max ~440×956.
  // Keep slightly larger scale than ratio alone suggests so upload/OCR cards don't clip.
  if (isIOS && cssWidth >= 430) return 85;                       // 17 Pro Max / 17 Air
  if (isIOS && cssWidth >= 400 && cssHeight >= 850) return 90;   // 17 / 17 Pro

  // General phone buckets
  if (cssWidth <= 360) return 90;
  if (cssWidth <= 414) return 85;
  if (cssWidth <= 480) return 80;
  return 85;
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
