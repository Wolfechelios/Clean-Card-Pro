export function hapticTap(durationMs = 20) {
  try {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (navigator as any).vibrate?.(durationMs);
    }
  } catch {
    // ignore
  }
}
