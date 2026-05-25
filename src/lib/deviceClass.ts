// src/lib/deviceClass.ts
// Centralized device-class detection used by camera/OCR tuning so the
// rapid scanner and the edge functions stay in lockstep.

let cached: boolean | null = null;

/**
 * iPhone 17 class = iPhone running iOS 26+ with a high-density screen and
 * enough cores to handle 4K capture + heavy OCR preprocessing in-browser.
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

export function getDeviceClassLabel(): string {
  return isIPhone17Class() ? "iphone17pro" : "generic";
}

export function resetDeviceClassCache(): void {
  cached = null;
}
