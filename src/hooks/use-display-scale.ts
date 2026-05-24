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
  const isMobile = /Android|iPhone|iPad|iPod/i.test(ua);
  const cssWidth = window.screen.width;
  const dpr = window.devicePixelRatio || 1;

  if (!isMobile) {
    // Desktops: leave at 100% unless screen is very small
    if (cssWidth < 1100) return 95;
    return 100;
  }

  // Tablet-ish widths: keep close to 100%
  if (cssWidth >= 700) return 95;

  // Phones — pick a default that maximizes usable space without shrinking text too far.
  // Modern flagships report ~390-430 CSS px with DPR 3+. We slightly shrink so dashboards fit.
  if (cssWidth <= 360) return 90;          // small phones
  if (cssWidth <= 414) return 85;          // standard phones (iPhone 12-15, most Androids)
  if (cssWidth <= 480) return 80;          // large/high-res phones (Red Magic, Pixel Pro, Note)
  return 85;                               // foldables / very wide phones
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
