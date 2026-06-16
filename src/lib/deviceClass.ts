// src/lib/deviceClass.ts
// Centralized device-class detection used by camera/OCR tuning so the
// rapid scanner and the edge functions stay in lockstep.

let cached: boolean | null = null;
let cachedAndroid: boolean | null = null;

/**
 * iPhone 17 class = iPhone running iOS 26+ with a high-density screen and
 * enough cores to handle 4K capture + heavy OCR preprocessing in-browser.
 * iPhone 17 ships with iOS 26 (Sept 2025).
 */
export function isIPhone17Class(): boolean {
  if (cached !== null) return cached;
  if (typeof navigator === "undefined") return false;

  try {
    const ua = navigator.userAgent || "";
    const isIPhone = /iPhone/i.test(ua);
    const iosMatch = ua.match(/OS (\d+)_/);
    const iosMajor = iosMatch ? parseInt(iosMatch[1], 10) : 0;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const cores = navigator.hardwareConcurrency || 0;

    cached = isIPhone && iosMajor >= 26 && dpr >= 3 && cores >= 6;
  } catch {
    cached = false;
  }
  return cached;
}

/**
 * Android flagship class = recent Android phone (Pixel 8+, Galaxy S23+, etc.)
 * with high DPR and >=8 cores. Safe to push 4K capture + heavier OCR.
 */
export function isAndroidFlagship(): boolean {
  if (cachedAndroid !== null) return cachedAndroid;
  if (typeof navigator === "undefined") return false;

  try {
    const ua = navigator.userAgent || "";
    const isAndroid = /Android/i.test(ua);
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const cores = navigator.hardwareConcurrency || 0;
    const mem = (navigator as any).deviceMemory ?? 0;

    cachedAndroid = isAndroid && dpr >= 2.5 && cores >= 8 && (mem === 0 || mem >= 6);
  } catch {
    cachedAndroid = false;
  }
  return cachedAndroid;
}

/**
 * Combined check: device can handle a 4K capture ladder without dropping the
 * track. Used by the scanner to decide whether to try 3840x2160 first.
 */
export function supportsHighResCapture(): boolean {
  if (typeof navigator === "undefined") return false;
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent || "");
  // Non-iOS desktops are safe; iOS only when iPhone 17 class.
  if (!isIOS) return isAndroidFlagship() || !/Android/i.test(navigator.userAgent || "");
  return isIPhone17Class();
}

export function getDeviceClassLabel(): string {
  if (isIPhone17Class()) return "iphone17pro";
  if (isAndroidFlagship()) return "android-flagship";
  return "generic";
}

export function resetDeviceClassCache(): void {
  cached = null;
  cachedAndroid = null;
}
