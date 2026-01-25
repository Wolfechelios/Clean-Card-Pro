/**
 * Minimal haptic helper.
 * - Web: navigator.vibrate
 * - Capacitor: will still work if platform supports vibrate.
 */
export function hapticTap(ms = 25) {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      (navigator as any).vibrate(ms);
    }
  } catch {
    // ignore
  }
}
